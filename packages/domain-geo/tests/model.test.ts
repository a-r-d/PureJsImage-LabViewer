import type { SpatialReference } from '@pji-workbench/contracts'
import { describe, expect, it } from 'vitest'

import {
  assertSameCrsComposition,
  CRS_EPSG_3857,
  CRS_EPSG_4326,
  createDerivedGeoRasterLayer,
  createGeoMapRoi,
  createGeoProject,
  createGeoRasterLayer,
  createGeoRasterSource,
  formatMapPointerReadout,
  GeoValidationError,
  orderedGeoLayers,
  visibleGeoLayers,
} from '../src/index.js'

const wgs84NorthUp: SpatialReference = {
  crs: CRS_EPSG_4326,
  pixelInterpretation: 'pixel-is-area',
  pixelToModel: [10, 0, 100, 0, -20, 200],
  bounds: { minX: 100, minY: 160, maxX: 140, maxY: 200 },
}

function source(id: string, spatialReference: SpatialReference = wgs84NorthUp, datetime?: string) {
  return createGeoRasterSource({
    id,
    label: id,
    width: 4,
    height: 2,
    componentCount: 1,
    spatialReference,
    locator:
      datetime === undefined
        ? { kind: 'bundled-example', scenarioId: `test.${id}` }
        : {
            kind: 'stac-asset',
            catalog: {
              catalogId: 'dated-fixture',
              catalogTitle: 'Dated fixture catalog',
              collectionId: 'same-crs-series',
              itemId: id,
              assetKey: 'data',
              href: `https://fixtures.invalid/${id}.tif`,
            },
            datetime,
            roles: ['data'],
            bands: [],
          },
  })
}

describe('geo project model', () => {
  it('stores georeferenced sources, styled layers, comparison, map ROIs, and provenance', () => {
    const west = source('west')
    const east = source('east')
    const base = createGeoRasterLayer({
      id: 'west-layer',
      sourceId: west.id,
      label: 'West',
      zIndex: 1,
      opacity: 0.8,
      blendMode: 'multiply',
      style: { mapping: { gray: 0 }, resample: 'nearest' },
    })
    const overlay = createGeoRasterLayer({
      id: 'east-layer',
      sourceId: east.id,
      label: 'East',
      zIndex: 2,
      style: { mapping: { red: 0, green: 0, blue: 0 } },
    })
    const derived = createDerivedGeoRasterLayer({
      id: 'ndvi',
      inputLayerIds: [base.id, overlay.id],
      label: 'NDVI',
      zIndex: 3,
      recipe: {
        schemaVersion: 1,
        operationVersion: 1,
        operation: { kind: 'normalized-difference', left: 'west', right: 'east' },
        inputs: [
          {
            name: 'west',
            layerId: base.id,
            component: 0,
            valueMode: 'raw',
            scale: 1,
            offset: 0,
            noData: { kind: 'none' },
          },
          {
            name: 'east',
            layerId: overlay.id,
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
          width: 100,
          height: 100,
          affine: [1, 0, 100, 0, -1, 200],
          pixelInterpretation: 'area',
          extent: [100, 100, 200, 200],
          sampleType: 'float32',
          noData: { kind: 'nan' },
          resampling: 'nearest',
        },
        alignment: 'exact',
        outputNoData: { kind: 'nan' },
        minimumValidWeight: 0.5,
        limits: {
          maxTilePixels: 65_536,
          maxOutputBytes: 4_194_304,
          maxWorkingBytes: 16_777_216,
        },
      },
      provenance: {
        id: 'prov-1',
        sourceIds: [west.id, east.id],
        recipe: { recipeId: 'geo.ndvi', recipeVersion: '1' },
        createdAt: '2026-08-18T00:00:00.000Z',
      },
    })
    const roi = createGeoMapRoi({
      id: 'aoi',
      name: 'Harbor',
      crs: CRS_EPSG_4326,
      geometry: { kind: 'rectangle', minX: 110, minY: 170, maxX: 130, maxY: 190 },
    })
    const project = createGeoProject({
      title: 'Coast',
      crs: CRS_EPSG_4326,
      sources: [west, east],
      layers: [overlay, derived, base],
      comparison: {
        mode: 'swipe',
        leftLayerId: base.id,
        rightLayerId: overlay.id,
        swipePosition: 0.4,
      },
      rois: [roi],
      provenance: [derived.provenance],
    })

    expect(project.schemaVersion).toBe(1)
    expect(project.crs).toEqual(CRS_EPSG_4326)
    expect(orderedGeoLayers(project.layers).map(({ id }) => id)).toEqual([
      'west-layer',
      'east-layer',
      'ndvi',
    ])
    expect(visibleGeoLayers(project.layers)).toHaveLength(3)
    expect(project.rois[0]?.coordinateSpace).toBe('map')
    expect(project.comparison).toMatchObject({ mode: 'swipe', swipePosition: 0.4 })
    const parsed = JSON.parse(JSON.stringify(project)) as {
      readonly layers: readonly { readonly kind: string }[]
    }
    expect(parsed.layers[2]?.kind).toBe('raster')
    assertSameCrsComposition(project)
  })

  it('composes two same-CRS layers and rejects mixed-CRS pixel composition', () => {
    const wgs = source('wgs')
    const utm = source('utm', {
      crs: { kind: 'projected', authority: 'EPSG', code: 32_618, name: 'WGS 84 / UTM zone 18N' },
      pixelInterpretation: 'pixel-is-area',
      pixelToModel: [2, 0.5, 10, -0.25, -3, 20],
    })
    const sameCrsProject = createGeoProject({
      title: 'Same CRS',
      crs: CRS_EPSG_4326,
      sources: [wgs, source('wgs-2')],
      layers: [
        createGeoRasterLayer({ id: 'a', sourceId: 'wgs', label: 'A' }),
        createGeoRasterLayer({ id: 'b', sourceId: 'wgs-2', label: 'B', zIndex: 1 }),
      ],
    })
    expect(() => assertSameCrsComposition(sameCrsProject)).not.toThrow()

    expect(() =>
      createGeoProject({
        title: 'Mixed',
        crs: CRS_EPSG_4326,
        sources: [wgs, utm],
        layers: [
          createGeoRasterLayer({ id: 'a', sourceId: 'wgs', label: 'A' }),
          createGeoRasterLayer({ id: 'b', sourceId: 'utm', label: 'B' }),
        ],
      }),
    ).toThrow(GeoValidationError)
  })

  it('formats map-coordinate pointer readout', () => {
    expect(formatMapPointerReadout({ x: -74.006, y: 40.7128 }, CRS_EPSG_4326)).toBe(
      '-74.006000°, 40.712800°',
    )
    expect(formatMapPointerReadout({ x: -8_237_642.14, y: 4_970_241.33 }, CRS_EPSG_3857)).toBe(
      '-8237642.14 m, 4970241.33 m',
    )
  })

  it('rejects a source without an affine', () => {
    expect(() =>
      createGeoRasterSource({
        id: 'plain',
        label: 'plain',
        width: 4,
        height: 2,
        componentCount: 1,
        spatialReference: { crs: CRS_EPSG_4326, pixelInterpretation: 'unspecified' },
        locator: { kind: 'bundled-example', scenarioId: 'test.plain' },
      }),
    ).toThrow(GeoValidationError)
  })
})

describe('raster style and cursor readout', () => {
  it('stores stretch, gamma, and nodata transparency on a layer', () => {
    const layer = createGeoRasterLayer({
      id: 'styled',
      sourceId: source('west').id,
      label: 'Styled',
      style: {
        mapping: { gray: 0 },
        stretch: 'percentile',
        percentileLow: 2,
        percentileHigh: 98,
        gamma: 1.4,
        nodataTransparent: true,
      },
    })
    expect(layer.style).toMatchObject({
      stretch: 'percentile',
      percentileLow: 2,
      percentileHigh: 98,
      rangeMode: 'stable',
      valueMode: 'raw',
      gamma: 1.4,
      nodataTransparent: true,
    })
  })

  it('validates same-CRS blink comparison and its bounded interval', () => {
    const first = source('dated-first', wgs84NorthUp, '2020-01-01T00:00:00Z')
    const second = source('dated-second', wgs84NorthUp, '2025-01-01T00:00:00Z')
    const firstLayer = createGeoRasterLayer({ id: 'first', sourceId: first.id, label: 'First' })
    const secondLayer = createGeoRasterLayer({ id: 'second', sourceId: second.id, label: 'Second' })
    const project = createGeoProject({
      title: 'Blink',
      crs: CRS_EPSG_4326,
      sources: [first, second],
      layers: [firstLayer, secondLayer],
      comparison: {
        mode: 'blink',
        firstLayerId: firstLayer.id,
        secondLayerId: secondLayer.id,
        intervalMilliseconds: 750,
      },
    })
    expect(project.comparison).toEqual({
      mode: 'blink',
      firstLayerId: 'first',
      secondLayerId: 'second',
      intervalMilliseconds: 750,
    })
    expect(project.sources.map(({ locator }) => locator)).toMatchObject([
      { kind: 'stac-asset', datetime: '2020-01-01T00:00:00Z' },
      { kind: 'stac-asset', datetime: '2025-01-01T00:00:00Z' },
    ])
    expect(() =>
      createGeoProject({
        ...project,
        comparison: {
          mode: 'blink',
          firstLayerId: firstLayer.id,
          secondLayerId: secondLayer.id,
          intervalMilliseconds: 20,
        },
      }),
    ).toThrow(GeoValidationError)
  })

  it('rejects out-of-range mapped bands and unidentified multi-source CRS', () => {
    const oneBand = source('one-band')
    expect(() =>
      createGeoProject({
        title: 'Bad band',
        crs: CRS_EPSG_4326,
        sources: [oneBand],
        layers: [
          createGeoRasterLayer({
            id: 'bad-band',
            sourceId: oneBand.id,
            label: 'Bad band',
            style: { mapping: { gray: 1 } },
          }),
        ],
      }),
    ).toThrow(GeoValidationError)

    const unknownSpatial: SpatialReference = {
      crs: { kind: 'unknown' },
      pixelInterpretation: 'pixel-is-area',
      pixelToModel: [1, 0, 0, 0, 1, 0],
    }
    expect(() =>
      createGeoProject({
        title: 'Unknown pair',
        crs: { kind: 'unknown' },
        sources: [source('unknown-a', unknownSpatial), source('unknown-b', unknownSpatial)],
      }),
    ).toThrow(GeoValidationError)
  })
})
