import { describe, expect, it } from 'vitest'

import {
  CRS_EPSG_4326,
  canonicalGeoProject,
  createDerivedGeoRasterLayer,
  createGeoMapRoi,
  createGeoProject,
  createGeoRasterLayer,
  createGeoRasterSource,
  exportGeoProjectDocument,
  GEO_PROJECT_DOCUMENT_LIMITS,
  GeoProjectDocumentError,
  importGeoProjectDocument,
} from '../src/index.js'

function catalogSource(id: string, checksum: string) {
  return createGeoRasterSource({
    id,
    label: id,
    width: 16,
    height: 8,
    componentCount: 1,
    spatialReference: {
      crs: CRS_EPSG_4326,
      pixelInterpretation: 'pixel-is-area',
      pixelToModel: [1, 0, 0, 0, -1, 8],
    },
    locator: {
      kind: 'stac-asset',
      catalog: {
        catalogId: 'catalog',
        catalogTitle: 'Catalog',
        collectionId: 'collection',
        itemId: id,
        assetKey: 'data',
        href: `https://session.invalid/${id}.tif?temporary=1`,
      },
      roles: ['data'],
      bands: [{ index: 0, name: 'Band 1' }],
      checksum,
    },
    validators: { checksum, size: 256 },
    lastKnownMetadata: { bands: [{ index: 0, name: 'Band 1' }], license: 'public-domain' },
  })
}

function completeProject() {
  const left = catalogSource('left', 'sha256:left')
  const right = catalogSource('right', 'sha256:right')
  const leftLayer = createGeoRasterLayer({ id: 'left-layer', sourceId: left.id, label: 'Left' })
  const rightLayer = createGeoRasterLayer({
    id: 'right-layer',
    sourceId: right.id,
    label: 'Right',
    zIndex: 1,
  })
  const provenance = {
    id: 'difference-provenance',
    sourceIds: [left.id, right.id],
    recipe: { recipeId: 'geo.analysis.raster_difference', recipeVersion: '1' },
    createdAt: '2026-08-20T00:00:00.000Z',
    execution: {
      schemaVersion: 1,
      engine: 'purejsimage/geo',
      packageVersion: '0.16.0',
      cacheSchemaVersion: 2,
      inputs: [
        {
          layerId: leftLayer.id,
          relationship: 'exact-grid',
          pixelAligned: true,
          pyramidCompatible: true,
          sourceGridIdentity: 'left-grid',
          targetGridIdentity: 'target-grid',
        },
      ],
    },
  } as const
  const derived = createDerivedGeoRasterLayer({
    id: 'difference',
    inputLayerIds: [leftLayer.id, rightLayer.id],
    label: 'Difference',
    zIndex: 2,
    recipe: {
      schemaVersion: 1,
      operationVersion: 1,
      operation: { kind: 'raster-difference', minuend: 'left', subtrahend: 'right' },
      inputs: [
        {
          name: 'left',
          layerId: leftLayer.id,
          component: 0,
          valueMode: 'raw',
          scale: 1,
          offset: 0,
          noData: { kind: 'none' },
        },
        {
          name: 'right',
          layerId: rightLayer.id,
          component: 0,
          valueMode: 'raw',
          scale: 1,
          offset: 0,
          noData: { kind: 'none' },
        },
      ],
      targetGrid: {
        schemaVersion: 1,
        crs: 'EPSG:4326',
        width: 16,
        height: 8,
        affine: [1, 0, 0, 0, -1, 8],
        pixelInterpretation: 'area',
        extent: [0, 0, 16, 8],
        sampleType: 'float32',
        noData: { kind: 'nan' },
        resampling: 'nearest',
      },
      alignment: 'exact',
      outputNoData: { kind: 'nan' },
      minimumValidWeight: 0.5,
      limits: { maxTilePixels: 65_536, maxOutputBytes: 1_048_576, maxWorkingBytes: 2_097_152 },
    },
    provenance,
  })
  const roi = createGeoMapRoi({
    id: 'roi',
    name: 'AOI',
    crs: CRS_EPSG_4326,
    geometry: { kind: 'rectangle', minX: 1, minY: 1, maxX: 3, maxY: 4 },
  })
  return createGeoProject({
    id: 'complete',
    title: 'Complete Atlas project',
    crs: CRS_EPSG_4326,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T01:00:00.000Z',
    viewport: { kind: 'map', centerX: 2, centerY: 3, zoom: 4 },
    sources: [left, right],
    layers: [leftLayer, rightLayer, derived],
    comparison: {
      mode: 'swipe',
      leftLayerId: leftLayer.id,
      rightLayerId: rightLayer.id,
      swipePosition: 0.35,
    },
    rois: [roi],
    provenance: [provenance],
    selection: { sourceId: right.id, layerId: derived.id, roiId: roi.id, inspector: 'vectors' },
  })
}

describe('Atlas project documents', () => {
  it('round-trips comparisons, normalized recipes, ROIs, viewport, and selection canonically', () => {
    const project = completeProject()
    const exported = exportGeoProjectDocument(project, {
      appVersion: '1.2.3',
      pureJsImageVersion: '0.16.0',
    })
    const imported = importGeoProjectDocument(exported.text)
    expect(imported.checksumVerified).toBe(true)
    expect(imported.project.comparison).toEqual(project.comparison)
    expect(imported.project.layers[2]).toMatchObject({
      kind: 'derived',
      recipe: { operationVersion: 1 },
    })
    expect(imported.project.rois).toEqual(project.rois)
    expect(imported.project.viewport).toEqual(project.viewport)
    expect(imported.project.selection).toEqual(project.selection)
    expect(imported.project.provenance[0]?.execution).toEqual(project.provenance[0]?.execution)
    expect(canonicalGeoProject(imported.project)).toBe(canonicalGeoProject(project))
  })

  it('removes signed session hrefs from durable source identity', () => {
    const { text } = exportGeoProjectDocument(completeProject(), {
      appVersion: '1',
      pureJsImageVersion: '0.16.0',
    })
    expect(text).not.toContain('temporary=1')
    expect(text).not.toContain('session.invalid')
    expect(text).toContain('"itemId":"left"')
  })

  it('migrates a schema-one project deterministically', () => {
    const project = completeProject()
    const legacy = JSON.parse(JSON.stringify(project)) as Record<string, unknown>
    legacy['schemaVersion'] = 1
    delete legacy['createdAt']
    delete legacy['updatedAt']
    delete legacy['viewport']
    delete legacy['selection']
    const legacySources = legacy['sources']
    if (Array.isArray(legacySources)) {
      for (const value of legacySources) {
        const legacySource = value as Record<string, unknown>
        const locator = legacySource['locator'] as Record<string, unknown>
        const catalog = locator['catalog'] as Record<string, unknown>
        catalog['href'] = 'https://signed.invalid/item.tif?X-Amz-Signature=secret'
      }
    }
    const first = importGeoProjectDocument(JSON.stringify(legacy))
    const second = importGeoProjectDocument(JSON.stringify(legacy))
    expect(first.fromSchemaVersion).toBe(1)
    expect(first.migrations).toContain('v1-project-metadata-defaults')
    expect(canonicalGeoProject(first.project)).not.toContain('X-Amz-Signature')
    expect(canonicalGeoProject(first.project)).toBe(canonicalGeoProject(second.project))
  })

  it('keeps v1 derived projects without package execution provenance readable', () => {
    const legacy = JSON.parse(JSON.stringify(completeProject())) as {
      provenance: Array<Record<string, unknown>>
      layers: Array<Record<string, unknown>>
    }
    delete legacy.provenance[0]?.['execution']
    const layerProvenance = legacy.layers[2]?.['provenance']
    if (typeof layerProvenance === 'object' && layerProvenance !== null)
      delete (layerProvenance as Record<string, unknown>)['execution']
    const imported = importGeoProjectDocument(JSON.stringify(legacy))
    expect(imported.project.provenance[0]?.execution).toBeUndefined()
  })

  it('rejects oversized imports, pollution keys, secret fields, and bad checksums', () => {
    expect(() =>
      importGeoProjectDocument(' '.repeat(GEO_PROJECT_DOCUMENT_LIMITS.maxDocumentBytes + 1)),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
    expect(() =>
      importGeoProjectDocument('{"schemaVersion":2,"__proto__":{"polluted":true}}'),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN_KEY' }))
    const project = completeProject()
    const roi = project.rois[0]
    if (roi === undefined) throw new Error('Expected ROI')
    const unsafe = createGeoProject({
      ...project,
      rois: [{ ...roi, properties: { apiKey: 'do-not-persist' } }],
    })
    expect(() =>
      exportGeoProjectDocument(unsafe, { appVersion: '1', pureJsImageVersion: '0.16.0' }),
    ).toThrow(GeoProjectDocumentError)
    const exported = exportGeoProjectDocument(project, {
      appVersion: '1',
      pureJsImageVersion: '0.16.0',
    })
    const damaged = JSON.parse(exported.text) as { project: { title: string } }
    damaged.project.title = 'tampered'
    expect(() => importGeoProjectDocument(JSON.stringify(damaged))).toThrowError(
      expect.objectContaining({ code: 'CHECKSUM_MISMATCH' }),
    )
  })
})
