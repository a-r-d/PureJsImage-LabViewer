import { describe, expect, it } from 'vitest'

import {
  CRS_EPSG_3857,
  CRS_EPSG_4326,
  CrsTransformError,
  canTransformCrs,
  sameCrs,
  transformMapPoint,
} from '../src/index.js'

const utm18 = {
  kind: 'projected' as const,
  authority: 'EPSG',
  code: 32_618,
  name: 'WGS 84 / UTM zone 18N',
}

describe('geo CRS transforms', () => {
  it('leaves native same-CRS coordinates unchanged without projecting', () => {
    const point = { x: 583_960, y: 4_505_256 }
    expect(sameCrs(utm18, utm18)).toBe(true)
    expect(transformMapPoint(point, utm18, utm18)).toEqual(point)
    expect(canTransformCrs(utm18, CRS_EPSG_4326)).toBe(false)
  })

  it('transforms EPSG:4326 and EPSG:3857 when definitions are available', () => {
    const origin = transformMapPoint({ x: 0, y: 0 }, CRS_EPSG_4326, CRS_EPSG_3857)
    expect(origin.x).toBeCloseTo(0, 6)
    expect(origin.y).toBeCloseTo(0, 6)

    const mercator = transformMapPoint({ x: -74.006, y: 40.7128 }, CRS_EPSG_4326, CRS_EPSG_3857)
    expect(mercator.x).toBeCloseTo(-8_238_310.24, 1)
    expect(mercator.y).toBeCloseTo(4_970_071.58, 1)

    const back = transformMapPoint(mercator, CRS_EPSG_3857, CRS_EPSG_4326)
    expect(back.x).toBeCloseTo(-74.006, 5)
    expect(back.y).toBeCloseTo(40.7128, 5)
    expect(canTransformCrs(CRS_EPSG_4326, CRS_EPSG_3857)).toBe(true)
  })

  it('returns a typed error for an unsupported CRS', () => {
    expect(canTransformCrs(utm18, CRS_EPSG_4326)).toBe(false)
    try {
      transformMapPoint({ x: 583_960, y: 4_505_256 }, utm18, CRS_EPSG_4326)
      throw new Error('Expected unsupported CRS to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(CrsTransformError)
      expect((error as CrsTransformError).code).toBe('UNSUPPORTED_CRS')
      expect((error as CrsTransformError).from).toEqual(utm18)
      expect((error as CrsTransformError).to).toEqual(CRS_EPSG_4326)
    }
  })

  it('returns a typed error for an unknown CRS without authority', () => {
    const unknown = { kind: 'unknown' as const }
    try {
      transformMapPoint({ x: 0, y: 0 }, unknown, CRS_EPSG_4326)
      throw new Error('Expected unknown CRS to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(CrsTransformError)
      expect((error as CrsTransformError).code).toBe('UNSUPPORTED_CRS')
    }
  })
})
