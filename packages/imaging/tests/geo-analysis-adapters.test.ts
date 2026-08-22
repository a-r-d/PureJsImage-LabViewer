import type { RasterTargetGridV1 } from '@pji-workbench/contracts'
import {
  areGeoGridsPixelAligned,
  areGeoPyramidLevelsCompatible,
  canonicalizeGeoTargetGrid,
  classifyGeoGridRelationship,
} from 'purejsimage/geo'
import { describe, expect, it } from 'vitest'

import {
  createApplicationGeoTransformProvider,
  geoTargetGridToRasterTargetGrid,
  rasterNoDataToGeoReprojectionNoData,
  rasterTargetGridToGeoTargetGrid,
} from '../src/geo-analysis-adapters.js'

function target(width = 4, height = 2): RasterTargetGridV1 {
  return {
    schemaVersion: 1,
    crs: 'EPSG:4326',
    width,
    height,
    affine: [1, 0, 0, 0, -1, height],
    pixelInterpretation: 'area',
    extent: [0, 0, width, height],
    sampleType: 'uint8',
    noData: { kind: 'value', value: 255 },
    resampling: 'nearest',
  }
}

describe('Atlas to public Geo analysis adapters', () => {
  it('round-trips a bounded v1 target grid without changing its semantics', () => {
    const authored = target()
    const geo = rasterTargetGridToGeoTargetGrid(authored, { sourceBands: [0] })
    expect(geoTargetGridToRasterTargetGrid(geo, { resampling: 'nearest' })).toEqual(authored)
    expect(classifyGeoGridRelationship(geo, geo)).toBe('exact-grid')
    expect(areGeoGridsPixelAligned(geo, geo)).toBe(true)
    expect(areGeoPyramidLevelsCompatible(geo, geo)).toBe(true)
  })

  it('uses package canonicalization independent of object-key insertion order', () => {
    const first = rasterTargetGridToGeoTargetGrid(target())
    const reordered = {
      bandLayout: first.bandLayout,
      noData: first.noData,
      sampleType: first.sampleType,
      bounds: first.bounds,
      pixelRegistration: first.pixelRegistration,
      worldToPixel: first.worldToPixel,
      pixelToWorld: first.pixelToWorld,
      height: first.height,
      width: first.width,
      crs: first.crs,
      schemaVersion: first.schemaVersion,
    }
    expect(canonicalizeGeoTargetGrid(reordered)).toBe(canonicalizeGeoTargetGrid(first))
  })

  it('rejects target extents and 64-bit target nodata that cannot be projected losslessly', () => {
    expect(() => rasterTargetGridToGeoTargetGrid({ ...target(), extent: [0, 0, 5, 2] })).toThrow(
      /extent/u,
    )
    expect(() =>
      rasterTargetGridToGeoTargetGrid({
        ...target(),
        sampleType: 'uint64',
        noData: { kind: 'integer64', value: '18446744073709551615' },
      }),
    ).toThrow(/information loss/u)
  })

  it('preserves canonical exact 64-bit nodata for package reprojection', () => {
    expect(
      rasterNoDataToGeoReprojectionNoData({
        kind: 'integer64',
        value: '18446744073709551615',
      }),
    ).toEqual({ kind: 'integer64', value: '18446744073709551615' })
    expect(() => rasterNoDataToGeoReprojectionNoData({ kind: 'integer64', value: '01' })).toThrow(
      /canonical/u,
    )
    expect(() =>
      rasterNoDataToGeoReprojectionNoData({ kind: 'integer64', value: '18446744073709551616' }),
    ).toThrow(/ranges/u)
  })

  it('constructs the package transform provider from a narrow application adapter', async () => {
    const descriptor = { id: 'fixture.shift', version: '1', accuracy: { kind: 'exact' as const } }
    const provider = createApplicationGeoTransformProvider(
      {
        implementationIdentity: 'fixture@1',
        supports: (candidate) => candidate.id === descriptor.id,
        transform: (_candidate, source, _target, point) =>
          source === 'EPSG:4326' ? [point[0] + 10, point[1]] : [point[0] - 10, point[1]],
      },
      descriptor,
      'EPSG:4326',
      'EPSG:3857',
    )
    const transformer = await provider.createTransformer(
      rasterTargetGridToGeoTargetGrid(target()).crs,
      rasterTargetGridToGeoTargetGrid({ ...target(), crs: 'EPSG:3857' }).crs,
    )
    expect(transformer.transformIdentity).toBe('proj4-compatible:EPSG:4326->EPSG:3857')
    expect(transformer.implementationIdentity).toBe('fixture@1')
    expect(transformer.forward(1, 2)).toEqual([11, 2])
    expect(transformer.inverse?.(11, 2)).toEqual([1, 2])
  })
})
