import { describe, expect, it } from 'vitest'

import { analyzeParticles } from '../src/particles.js'

describe('particle measurements', () => {
  it('measures isolated generated circle and ellipse fixtures within raster tolerances', () => {
    const width = 40
    const height = 30
    const labels = new Uint32Array(width * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if ((x - 10) ** 2 + (y - 10) ** 2 <= 4 ** 2) labels[y * width + x] = 1
        if ((x - 27) ** 2 / 6 ** 2 + (y - 15) ** 2 / 3 ** 2 <= 1) labels[y * width + x] = 2
      }
    }
    const result = analyzeParticles(
      labels,
      Float64Array.from(labels, (_label, index) => index % width),
      width,
      height,
      {
        filters: {
          edgePolicy: 'exclude',
          minimumArea: 1,
          maximumArea: 1_000,
          minimumCircularity: 0,
          maximumCircularity: 1,
          minimumAspectRatio: 1,
          maximumAspectRatio: 10,
          minimumSolidity: 0,
          maximumSolidity: 1,
        },
        calibration: { xSpacing: 0.5, ySpacing: 1, unit: 'µm' },
      },
    )
    expect(result.measurements).toHaveLength(2)
    const circle = result.measurements[0]
    const ellipse = result.measurements[1]
    expect(circle).toMatchObject({ label: 1, centroidX: 10, centroidY: 10, pixelArea: 49 })
    expect(ellipse).toMatchObject({ label: 2, centroidX: 27, centroidY: 15, pixelArea: 55 })
    expect(circle?.physicalArea).toBeCloseTo(24.5, 8)
    expect(ellipse?.physicalArea).toBeCloseTo(27.5, 8)
    expect(ellipse?.pixelMajorAxis).toBeCloseTo(12.38, 1)
    expect(ellipse?.pixelMinorAxis).toBeCloseTo(5.824, 1)
    expect(Math.abs(ellipse?.orientationRadians ?? 1)).toBeLessThan(1e-12)
  })

  it('filters edge objects and reports calibrated shape, intensity, summary, and CDF', () => {
    const labels = Uint32Array.from([
      2, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
    const intensities = Float64Array.from(labels, (label, index) => (label === 1 ? index : 0))
    const result = analyzeParticles(labels, intensities, 6, 5, {
      filters: {
        edgePolicy: 'exclude',
        minimumArea: 4,
        maximumArea: 20,
        minimumCircularity: 0,
        maximumCircularity: 1,
        minimumAspectRatio: 1,
        maximumAspectRatio: 10,
        minimumSolidity: 0.9,
        maximumSolidity: 1,
      },
      calibration: { xSpacing: 2, ySpacing: 3, unit: 'nm' },
      intensityUnit: 'a.u.',
    })
    expect(result.measurements).toHaveLength(1)
    expect(result.measurements[0]).toMatchObject({
      label: 1,
      pixelArea: 9,
      physicalArea: 54,
      centroidX: 2,
      centroidY: 2,
      solidity: 1,
    })
    expect(result.measurements[0]?.intensityMean).toBe(14)
    expect(result.includedLabels).toEqual(new Set([1]))
    expect(result.filteredLabels[0]).toBe(0)
    expect(result.table.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'physicalArea',
        'majorAxis',
        'minorAxis',
        'solidity',
        'intensityMean',
      ]),
    )
    expect(result.summary.results.find(({ name }) => name === 'objectCount')).toMatchObject({
      result: { value: 1 },
    })
    expect(result.distribution.series[0]?.values).toEqual(Float64Array.of(1))
  })

  it('is deterministic across repeated analysis and rejects bounded hull overflow', () => {
    const labels = Uint32Array.from([1, 1, 0, 2, 2, 1, 1, 0, 2, 2])
    const intensities = Float64Array.from(labels, (_label, index) => index)
    const options = {
      filters: {
        edgePolicy: 'include' as const,
        minimumArea: 0,
        maximumArea: 100,
        minimumCircularity: 0,
        maximumCircularity: 1,
        minimumAspectRatio: 1,
        maximumAspectRatio: 100,
        minimumSolidity: 0,
        maximumSolidity: 1,
      },
    }
    const first = analyzeParticles(labels, intensities, 5, 2, options)
    const second = analyzeParticles(labels, intensities, 5, 2, options)
    expect(first.measurements).toEqual(second.measurements)
    expect(() =>
      analyzeParticles(labels, intensities, 5, 2, { ...options, maximumHullPoints: 1 }),
    ).toThrow(/convex-hull work/u)
  })
})
