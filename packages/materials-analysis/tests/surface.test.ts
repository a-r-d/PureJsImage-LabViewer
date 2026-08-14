import { describe, expect, it } from 'vitest'

import {
  correctSurface,
  extractSurfaceProfile,
  surfaceGrainMask,
  surfaceRoughness,
} from '../src/surface.js'

describe('AFM surface reference algorithms', () => {
  it('removes an exact first-order plane without changing the raw input', () => {
    const width = 19
    const height = 13
    const raw = Float64Array.from({ length: width * height }, (_value, index) => {
      const x = index % width
      const y = Math.floor(index / width)
      return 12 + 0.75 * x - 1.25 * y
    })
    const original = raw.slice()
    const corrected = correctSurface(raw, width, height, {
      correction: 'first-order-plane',
      polynomialDegree: 1,
    })
    expect(raw).toEqual(original)
    expect(Math.max(...corrected.values.map(Math.abs))).toBeLessThan(1e-10)
    expect(corrected.includedCount).toBe(width * height)
  })

  it('fits a bounded quadratic background and honors exclusion masks', () => {
    const width = 16
    const height = 12
    const values = Float64Array.from({ length: width * height }, (_value, index) => {
      const x = index % width
      const y = Math.floor(index / width)
      return 3 + 0.2 * x + 0.3 * y + 0.01 * x * x - 0.02 * x * y + 0.015 * y * y
    })
    const excluded = new Uint8Array(values.length)
    excluded[0] = 1
    values[0] = 10_000
    const corrected = correctSurface(values, width, height, {
      correction: 'polynomial',
      polynomialDegree: 2,
      exclusionMask: excluded,
    })
    expect(Math.max(...corrected.values.slice(1).map(Math.abs))).toBeLessThan(1e-9)
  })

  it('uses explicit Ra, Rq, and peak-to-valley Rz definitions', () => {
    const roughness = surfaceRoughness(Float64Array.from([-2, -1, 1, 2]))
    expect(roughness.mean).toBe(0)
    expect(roughness.ra).toBe(1.5)
    expect(roughness.rq).toBeCloseTo(Math.sqrt(2.5), 12)
    expect(roughness.rz).toBe(4)
  })

  it('extracts calibrated profiles and routes grain detection through shared threshold semantics', () => {
    const width = 8
    const height = 4
    const values = Float64Array.from({ length: width * height }, (_value, index) => index % width)
    const profile = extractSurfaceProfile(values, width, height, {
      x0: 0,
      y0: 1,
      x1: 7,
      y1: 1,
      samples: 8,
      xSpacing: 2,
      ySpacing: 3,
    })
    expect(profile.distance.at(-1)).toBe(14)
    expect(profile.height).toEqual(Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7]))
    const mask = surfaceGrainMask(values, width, height, {
      method: 'manual',
      polarity: 'light',
      lower: 5,
      upper: 7,
      histogramBins: 16,
    })
    expect(mask.reduce((sum, value) => sum + value, 0)).toBe(12)
  })
})
