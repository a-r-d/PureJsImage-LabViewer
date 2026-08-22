import { describe, expect, it } from 'vitest'

import {
  evaluateParticleSegmentation,
  labelBinaryMaskForEvaluation,
} from '../src/particle-evaluation.js'
import { analyzeParticles } from '../src/particles.js'
import { applyThreshold, binaryMorphology } from '../src/segmentation.js'
import { generatedParticleBenchmarkFixture } from './particle-benchmark-fixtures.js'

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
    let totalMatched = 0
    let totalTruthObjects = 0
    let totalPredictedObjects = 0
    let totalMaskIntersection = 0
    let totalMaskUnion = 0
    let maximumMergeRate = 0
    let maximumSplitRate = 0
    let minimumBoundaryF1 = 1
    let retainedBytes = 0
    const started = performance.now()
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
      const labels = labelBinaryMaskForEvaluation(cleaned, fixture.width, fixture.height)
      const result = analyzeParticles(
        labels,
        Float64Array.from(fixture.image.values),
        fixture.width,
        fixture.height,
        { filters: FILTERS },
      )
      totalTruth += fixture.objectCount
      totalPredicted += result.measurements.length
      const evaluation = evaluateParticleSegmentation({
        predictedLabels: labels,
        truthLabels: fixture.truth,
        width: fixture.width,
        height: fixture.height,
      })
      totalMatched += evaluation.matches.length
      totalTruthObjects += evaluation.truthCount.includingBorder
      totalPredictedObjects += evaluation.predictedCount.includingBorder
      maximumMergeRate = Math.max(maximumMergeRate, evaluation.mergeRate)
      maximumSplitRate = Math.max(maximumSplitRate, evaluation.splitRate)
      minimumBoundaryF1 = Math.min(minimumBoundaryF1, evaluation.boundaryF1)
      for (let index = 0; index < labels.length; index += 1) {
        const predictedForeground = labels[index] !== 0
        const truthForeground = fixture.truth[index] !== 0
        if (predictedForeground && truthForeground) totalMaskIntersection += 1
        if (predictedForeground || truthForeground) totalMaskUnion += 1
      }
      retainedBytes = Math.max(
        retainedBytes,
        fixture.image.values.byteLength +
          fixture.truth.byteLength +
          threshold.mask.byteLength +
          cleaned.byteLength +
          labels.byteLength +
          result.filteredLabels.byteLength,
      )
      if (result.measurements.length !== fixture.objectCount)
        failures.push(`${id}: expected ${fixture.objectCount}, got ${result.measurements.length}`)
    }
    expect(totalTruth).toBeGreaterThan(900)
    expect(failures, failures.join('\n')).toEqual([])
    expect(totalPredicted).toBe(totalTruth)
    expect(totalMatched / totalPredictedObjects).toBeGreaterThanOrEqual(0.99)
    expect(totalMatched / totalTruthObjects).toBeGreaterThanOrEqual(0.99)
    expect(maximumMergeRate).toBe(0)
    expect(maximumSplitRate).toBe(0)
    expect(totalMaskIntersection / totalMaskUnion).toBeGreaterThanOrEqual(0.9)
    expect(minimumBoundaryF1).toBeGreaterThanOrEqual(0.9)
    expect(performance.now() - started).toBeLessThan(5_000)
    expect(retainedBytes).toBeLessThan(16 * 1_024 * 1_024)
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
        labelBinaryMaskForEvaluation(cleaned, fixture.width, fixture.height),
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
