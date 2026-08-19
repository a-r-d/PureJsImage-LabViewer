import type { SpatialReference } from '@pji-workbench/contracts'
import { describe, expect, it } from 'vitest'

import {
  assertSameCrsComposition,
  CRS_EPSG_3857,
  CRS_EPSG_4326,
  CrsTransformError,
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

function source(id: string, spatialReference: SpatialReference = wgs84NorthUp) {
  return createGeoRasterSource({
    id,
    label: id,
    width: 4,
    height: 2,
    componentCount: 1,
    spatialReference,
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

    const mixed = createGeoProject({
      title: 'Mixed',
      crs: CRS_EPSG_4326,
      sources: [wgs, utm],
      layers: [
        createGeoRasterLayer({ id: 'a', sourceId: 'wgs', label: 'A' }),
        createGeoRasterLayer({ id: 'b', sourceId: 'utm', label: 'B' }),
      ],
    })
    try {
      assertSameCrsComposition(mixed)
      throw new Error('Expected mixed CRS composition to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(CrsTransformError)
      expect((error as CrsTransformError).code).toBe('UNSUPPORTED_TRANSFORM')
    }
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
      }),
    ).toThrow(GeoValidationError)
  })
})
