import {
  CRS_EPSG_4326,
  createDerivedGeoRasterLayer,
  createGeoProject,
  createGeoRasterLayer,
  createGeoRasterSource,
} from '@pji-workbench/domain-geo'
import { describe, expect, it } from 'vitest'

import {
  catalogRehydrationEntry,
  finalizeGeoProjectRehydrationPlan,
  initialGeoProjectRehydrationPlan,
  localRehydrationEntry,
} from '../src/index.js'

function source(kind: 'stac' | 'local' = 'stac') {
  return createGeoRasterSource({
    id: 'source',
    label: 'Source',
    width: 4,
    height: 4,
    componentCount: 1,
    spatialReference: {
      crs: CRS_EPSG_4326,
      pixelInterpretation: 'pixel-is-area',
      pixelToModel: [1, 0, 0, 0, -1, 4],
    },
    locator:
      kind === 'local'
        ? {
            kind: 'local-file',
            fingerprint: {
              name: 'source.tif',
              size: 3,
              lastModified: 123,
              companionNames: ['source.tfw'],
            },
          }
        : {
            kind: 'stac-asset',
            catalog: {
              catalogId: 'catalog',
              catalogTitle: 'Catalog',
              collectionId: 'collection',
              itemId: 'item',
              assetKey: 'data',
            },
            roles: ['data'],
            bands: [{ index: 0, name: 'Band 1' }],
          },
    validators: { checksum: 'old', size: 3 },
    lastKnownMetadata: { bands: [{ index: 0, name: 'Band 1' }], license: 'old-license' },
  })
}

function projectWithDerived() {
  const raster = source()
  const input = createGeoRasterLayer({ id: 'input', sourceId: raster.id, label: 'Input' })
  const provenance = {
    id: 'provenance',
    sourceIds: [raster.id],
    recipe: { recipeId: 'geo.analysis.band_math', recipeVersion: '1' },
    createdAt: '2026-08-20T00:00:00.000Z',
  } as const
  const derived = createDerivedGeoRasterLayer({
    id: 'derived',
    inputLayerIds: [input.id],
    label: 'Derived',
    recipe: {
      schemaVersion: 1,
      operationVersion: 1,
      operation: {
        kind: 'band-math',
        expression: 'a',
        divideByZero: 'nodata',
        nonFinite: 'nodata',
      },
      inputs: [
        {
          name: 'a',
          layerId: input.id,
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
        width: 4,
        height: 4,
        affine: [1, 0, 0, 0, -1, 4],
        pixelInterpretation: 'area',
        extent: [0, 0, 4, 4],
        sampleType: 'float32',
        noData: { kind: 'nan' },
        resampling: 'nearest',
      },
      alignment: 'exact',
      outputNoData: { kind: 'nan' },
      minimumValidWeight: 0.5,
      limits: { maxTilePixels: 256, maxOutputBytes: 4_096, maxWorkingBytes: 8_192 },
    },
    provenance,
  })
  return createGeoProject({
    title: 'Changed source',
    crs: CRS_EPSG_4326,
    sources: [raster],
    layers: [input, derived],
    provenance: [provenance],
  })
}

describe('Atlas project rehydration planning', () => {
  it('refreshes STAC hrefs and invalidates derived outputs when content validators change', () => {
    const project = projectWithDerived()
    const saved = project.sources[0]
    if (saved === undefined) throw new Error('Expected source')
    const entry = catalogRehydrationEntry(saved, {
      catalogId: 'catalog',
      catalogTitle: 'Catalog',
      collectionId: 'collection',
      itemId: 'item',
      assetKey: 'data',
      href: 'https://fresh.invalid/item.tif?temporary=1',
      label: 'Fresh item',
      roles: ['data'],
      bands: [{ index: 0, name: 'Band 1' }],
      checksum: 'new',
      fileSize: 3,
      license: 'new-license',
    })
    const plan = finalizeGeoProjectRehydrationPlan(project, [entry])
    expect(entry).toMatchObject({
      status: 'changed',
      refreshedUrl: 'https://fresh.invalid/item.tif?temporary=1',
    })
    expect(plan).toMatchObject({
      readyToCommit: true,
      requiresConfirmation: true,
      invalidatedDerivedLayerIds: ['derived'],
    })
  })

  it('classifies missing catalog assets and local companion reassociation explicitly', () => {
    const project = projectWithDerived()
    const saved = project.sources[0]
    if (saved === undefined) throw new Error('Expected source')
    expect(catalogRehydrationEntry(saved, undefined)).toMatchObject({ status: 'missing' })

    const local = source('local')
    expect(
      initialGeoProjectRehydrationPlan(
        createGeoProject({
          title: 'Local',
          crs: CRS_EPSG_4326,
          sources: [local],
        }),
      ),
    ).toMatchObject({ entries: [{ status: 'rebind-required' }] })
    const primary = new File([Uint8Array.of(1, 2, 3)], 'source.tif', { lastModified: 123 })
    const companion = new File([Uint8Array.of(4)], 'source.tfw', { lastModified: 123 })
    expect(localRehydrationEntry(local, primary, [companion])).toMatchObject({
      status: 'unchanged',
    })
    expect(localRehydrationEntry(local, primary, [])).toMatchObject({
      status: 'changed',
      differences: ['companion:source.tfw'],
    })
  })
})
