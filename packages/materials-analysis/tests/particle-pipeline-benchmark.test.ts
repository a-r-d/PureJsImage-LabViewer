import { describe, expect, it } from 'vitest'

import { analyzeParticles } from '../src/particles.js'
import { applyThreshold, binaryMorphology } from '../src/segmentation.js'
import {
  generatedParticleBenchmarkFixture,
  labelBinaryMask,
} from './particle-benchmark-fixtures.js'

const FILTERS = {
  edgePolicy: 'include' as const,
  minimumArea: 12,
  maximumArea: 1_000,
  minimumCircularity: 0,
  maximumCircularity: 1,
  minimumAspectRatio: 1,
  maximumAspectRatio: 100,
  minimumSolidity: 0,
  maximumSolidity: 1,
}

const SCENARIOS = [
  ['clean-light-96', 11, 'light', 12, 8, 0, 8],
  ['clean-light-120', 29, 'light', 15, 8, 0, 10],
  ['gradient-light-96', 47, 'light', 12, 8, 38, 12],
  ['noisy-light-108', 71, 'light', 12, 9, 18, 22],
  ['clean-dark-96', 97, 'dark', 12, 8, 0, 8],
  ['gradient-dark-96', 113, 'dark', 12, 8, 38, 12],
  ['noisy-dark-108', 131, 'dark', 12, 9, 18, 22],
  ['repeat-light-a-80', 151, 'light', 10, 8, 12, 16],
  ['repeat-light-b-80', 173, 'light', 10, 8, 12, 16],
  ['repeat-light-c-80', 191, 'light', 10, 8, 12, 16],
] as const

describe('particle grayscale-to-measurement benchmark corpus', () => {
  it('counts more than 900 seeded particles across density, shading, noise, and polarity cases', () => {
    let totalTruth = 0
    let totalPredicted = 0
    const failures: string[] = []
    for (const [id, seed, polarity, columns, rows, gradient, noise] of SCENARIOS) {
      const fixture = generatedParticleBenchmarkFixture(id, {
        seed,
        polarity,
        columns,
        rows,
        gradient,
        noise,
      })
      const threshold = applyThreshold(fixture.image, 0, {
        method: 'otsu',
        polarity,
        lower: 0,
        upper: 255,
        histogramBins: 256,
        windowRadius: 15,
        sauvolaK: 0.2,
        dynamicRange: 128,
        noDataPolicy: 'background',
      })
      const cleaned = binaryMorphology(
        Uint8Array.from(threshold.mask, (value) => (value === 1 ? 1 : 0)),
        fixture.width,
        fixture.height,
        { kind: 'remove-small-objects', minimumSize: 12, connectivity: 8 },
      )
      const labels = labelBinaryMask(cleaned, fixture.width, fixture.height)
      const result = analyzeParticles(
        labels,
        Float64Array.from(fixture.image.values),
        fixture.width,
        fixture.height,
        { filters: FILTERS },
      )
      totalTruth += fixture.objectCount
      totalPredicted += result.measurements.length
      if (result.measurements.length !== fixture.objectCount)
        failures.push(`${id}: expected ${fixture.objectCount}, got ${result.measurements.length}`)
    }
    expect(totalTruth).toBeGreaterThan(900)
    expect(failures, failures.join('\n')).toEqual([])
    expect(totalPredicted).toBe(totalTruth)
  })

  it('records a controlled undercount and proves a local-threshold refinement improves recall', () => {
    const fixture = generatedParticleBenchmarkFixture('dim-gradient-refinement-120', {
      seed: 223,
      polarity: 'light',
      columns: 15,
      rows: 8,
      gradient: 72,
      noise: 10,
      dimEvery: 5,
    })
    const countWith = (method: 'otsu' | 'sauvola'): number => {
      const threshold = applyThreshold(fixture.image, 0, {
        method,
        polarity: 'light',
        lower: 0,
        upper: 255,
        histogramBins: 256,
        windowRadius: 11,
        sauvolaK: 0.08,
        dynamicRange: 128,
        noDataPolicy: 'background',
      })
      const cleaned = binaryMorphology(
        Uint8Array.from(threshold.mask, (value) => (value === 1 ? 1 : 0)),
        fixture.width,
        fixture.height,
        { kind: 'remove-small-objects', minimumSize: 12, connectivity: 8 },
      )
      return analyzeParticles(
        labelBinaryMask(cleaned, fixture.width, fixture.height),
        Float64Array.from(fixture.image.values),
        fixture.width,
        fixture.height,
        { filters: FILTERS },
      ).measurements.length
    }
    const baseline = countWith('otsu')
    const refined = countWith('sauvola')
    expect(baseline).toBeLessThan(fixture.objectCount)
    expect(refined).toBeGreaterThan(baseline)
    expect(Math.abs(fixture.objectCount - refined)).toBeLessThanOrEqual(5)
  })
})
