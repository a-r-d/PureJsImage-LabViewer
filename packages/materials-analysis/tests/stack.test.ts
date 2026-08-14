import { describe, expect, it } from 'vitest'

import {
  alignStack,
  montageStack,
  projectStack,
  propagateStackRoi,
  stackStatistics,
} from '../src/stack.js'

describe('stack and registration reference algorithms', () => {
  it('computes min, max, mean, and sum projections plus per-frame statistics', () => {
    const values = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8])
    expect(projectStack(values, 2, 2, 2, 'min')).toEqual(Float64Array.from([1, 2, 3, 4]))
    expect(projectStack(values, 2, 2, 2, 'max')).toEqual(Float64Array.from([5, 6, 7, 8]))
    expect(projectStack(values, 2, 2, 2, 'mean')).toEqual(Float64Array.from([3, 4, 5, 6]))
    expect(projectStack(values, 2, 2, 2, 'sum')).toEqual(Float64Array.from([6, 8, 10, 12]))
    const statistics = stackStatistics(values, 2, 2, 2)
    expect(statistics.map(({ mean }) => mean)).toEqual([2.5, 6.5])
  })

  it('creates deterministic contact sheets', () => {
    const montage = montageStack(Float64Array.from([1, 2, 3, 4, 5, 6]), 2, 1, 3, 2)
    expect(montage.width).toBe(4)
    expect(montage.height).toBe(2)
    expect(montage.values).toEqual(Float64Array.from([1, 2, 3, 4, 5, 6, Number.NaN, Number.NaN]))
  })

  it('aligns a known translated stack, reports drift, and propagates ROIs', () => {
    const width = 32
    const height = 32
    const reference = new Float64Array(width * height)
    for (let y = 8; y < 17; y += 1)
      for (let x = 7; x < 15; x += 1) reference[y * width + x] = 1 + ((x * y) % 5)
    const shifted = new Float64Array(width * height)
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1)
        shifted[y * width + x] =
          reference[((y - 2 + height) % height) * width + ((x - 4 + width) % width)] ?? 0
    const stack = new Float64Array(width * height * 2)
    stack.set(reference)
    stack.set(shifted, width * height)
    const alignment = alignStack(stack, width, height, 2, {
      referenceIndex: 0,
      maximumShift: 8,
      minimumPeakRatio: 2,
      edgePolicy: 'crop-overlap',
      fillValue: Number.NaN,
    })
    expect(alignment.registrations[1]).toMatchObject({ offsetX: -4, offsetY: -2, accepted: true })
    expect(alignment.crop).toEqual({ x: 0, y: 0, width: 28, height: 30 })
    expect(
      propagateStackRoi({ x: 10, y: 10, width: 5, height: 4 }, alignment.registrations)[1],
    ).toEqual({
      frame: 1,
      x: 14,
      y: 12,
      width: 5,
      height: 4,
    })
  })
})
