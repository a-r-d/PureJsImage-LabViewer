import { describe, expect, it } from 'vitest'

import { particleQualityDiagnostics } from '../src/particle-quality.js'
import { analyzeParticles, type ParticleMeasurement } from '../src/particles.js'

const FILTERS = {
  edgePolicy: 'include' as const,
  minimumArea: 1,
  maximumArea: 10_000,
  minimumCircularity: 0,
  maximumCircularity: 1,
  minimumAspectRatio: 1,
  maximumAspectRatio: 100,
  minimumSolidity: 0,
  maximumSolidity: 1,
}

function fillDisk(
  labels: Uint32Array,
  width: number,
  cx: number,
  cy: number,
  radius: number,
  label: number,
): void {
  const r2 = radius * radius
  for (let y = 0; y < labels.length / width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) labels[y * width + x] = label
    }
  }
}

function fillEllipse(
  labels: Uint32Array,
  width: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  label: number,
): void {
  for (let y = 0; y < labels.length / width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((x - cx) ** 2 / rx ** 2 + (y - cy) ** 2 / ry ** 2 <= 1) labels[y * width + x] = label
    }
  }
}

function grade(
  predicted: Uint32Array,
  truth: Uint32Array,
  iouThreshold = 0.5,
): Readonly<{
  precision: number
  recall: number
  mergeRate: number
  splitRate: number
  maskIoU: number
}> {
  const truthIds = [...new Set(truth.filter((value) => value > 0))]
  const predictedIds = [...new Set(predicted.filter((value) => value > 0))]
  const overlap = (
    left: number,
    right: number,
    source: Uint32Array,
    other: Uint32Array,
  ): number => {
    let intersection = 0
    let union = 0
    for (let index = 0; index < source.length; index += 1) {
      const inLeft = source[index] === left
      const inRight = other[index] === right
      if (inLeft || inRight) union += 1
      if (inLeft && inRight) intersection += 1
    }
    return union === 0 ? 0 : intersection / union
  }
  let truePositive = 0
  const matchedPredicted = new Set<number>()
  const splitCount = truthIds.filter((truthId) => {
    const hits = predictedIds.filter(
      (predictedId) => overlap(truthId, predictedId, truth, predicted) > 0.15,
    )
    return hits.length > 1
  }).length
  for (const truthId of truthIds) {
    let best = 0
    let bestId = 0
    for (const predictedId of predictedIds) {
      const value = overlap(truthId, predictedId, truth, predicted)
      if (value > best) {
        best = value
        bestId = predictedId
      }
    }
    if (best >= iouThreshold) {
      truePositive += 1
      matchedPredicted.add(bestId)
    }
  }
  const mergeCount = predictedIds.filter((predictedId) => {
    const hits = truthIds.filter(
      (truthId) => overlap(predictedId, truthId, predicted, truth) > 0.15,
    )
    return hits.length > 1
  }).length
  let intersection = 0
  let union = 0
  for (let index = 0; index < truth.length; index += 1) {
    const left = (truth[index] ?? 0) > 0
    const right = (predicted[index] ?? 0) > 0
    if (left || right) union += 1
    if (left && right) intersection += 1
  }
  return {
    precision: predictedIds.length === 0 ? 0 : truePositive / predictedIds.length,
    recall: truthIds.length === 0 ? 0 : truePositive / truthIds.length,
    mergeRate: predictedIds.length === 0 ? 0 : mergeCount / predictedIds.length,
    splitRate: truthIds.length === 0 ? 0 : splitCount / truthIds.length,
    maskIoU: union === 0 ? 1 : intersection / union,
  }
}

function qualityFrom(
  measurements: readonly ParticleMeasurement[],
  extras: Parameters<typeof particleQualityDiagnostics>[0],
) {
  return particleQualityDiagnostics({
    ...extras,
    areas: measurements.map(({ pixelArea }) => pixelArea),
    equivalentDiameters: measurements.map(
      ({ equivalentCircularDiameter }) => equivalentCircularDiameter,
    ),
    circularities: measurements.map(({ circularity }) => circularity),
    solidities: measurements.map(({ solidity }) => solidity),
    borderCount: measurements.filter(({ edge }) => edge).length,
  })
}

describe('deterministic particle scenario fixtures', () => {
  it('grades clean isolated particles with unit-correct calibration', () => {
    const width = 48
    const height = 32
    const labels = new Uint32Array(width * height)
    fillDisk(labels, width, 10, 10, 4, 1)
    fillDisk(labels, width, 24, 10, 4, 2)
    fillDisk(labels, width, 38, 10, 4, 3)
    fillDisk(labels, width, 16, 22, 4, 4)
    const result = analyzeParticles(
      labels,
      Float64Array.from(labels, () => 180),
      width,
      height,
      {
        filters: FILTERS,
        calibration: { xSpacing: 0.42, ySpacing: 0.42, unit: 'nm' },
      },
    )
    expect(result.measurements).toHaveLength(4)
    const scored = grade(labels, labels)
    expect(scored.precision).toBe(1)
    expect(scored.recall).toBe(1)
    expect(scored.mergeRate).toBe(0)
    expect(scored.splitRate).toBe(0)
    const quality = qualityFrom(result.measurements, {
      objectCount: result.measurements.length,
      validPixels: width * height,
      nodataPixels: 0,
      planeWidth: width,
      planeHeight: height,
      settings: {
        thresholdMethod: 'otsu',
        polarity: 'light',
        openRadius: 0,
        closeRadius: 0,
        fillHoles: false,
        clearBorder: false,
        watershed: false,
      },
      calibration: { unit: 'nm', xSpacing: 0.42, ySpacing: 0.42 },
    })
    expect(quality.objectCount).toBe(4)
    expect(quality.calibration.unit).toBe('nm')
    expect(quality.likelyMergedObjectCount).toBe(0)
    expect(quality.warnings.some((warning) => warning.includes('pixels'))).toBe(false)
  })

  it('flags touching particles as a likely merge until watershed labels split them', () => {
    const width = 32
    const height = 20
    const merged = new Uint32Array(width * height)
    fillDisk(merged, width, 12, 10, 6, 1)
    fillDisk(merged, width, 20, 10, 6, 1)
    const truth = new Uint32Array(width * height)
    fillDisk(truth, width, 12, 10, 6, 1)
    fillDisk(truth, width, 20, 10, 6, 2)
    const mergedResult = analyzeParticles(
      merged,
      Float64Array.from(merged, () => 200),
      width,
      height,
      {
        filters: FILTERS,
      },
    )
    expect(mergedResult.measurements).toHaveLength(1)
    const mergedScore = grade(merged, truth)
    expect(mergedScore.mergeRate).toBeGreaterThan(0)
    const split = new Uint32Array(truth)
    const splitResult = analyzeParticles(
      split,
      Float64Array.from(split, () => 200),
      width,
      height,
      {
        filters: FILTERS,
      },
    )
    expect(splitResult.measurements).toHaveLength(2)
    expect(grade(split, truth).mergeRate).toBe(0)
  })

  it('counts border objects, tiny debris, and elongated shapes', () => {
    const width = 24
    const height = 18
    const labels = new Uint32Array(width * height)
    fillDisk(labels, width, 1, 1, 3, 1)
    fillDisk(labels, width, 12, 9, 4, 2)
    labels[5] = 3
    labels[6] = 4
    fillEllipse(labels, width, 18, 9, 5, 2, 5)
    const result = analyzeParticles(
      labels,
      Float64Array.from(labels, () => 90),
      width,
      height,
      {
        filters: FILTERS,
      },
    )
    expect(result.measurements.some(({ edge }) => edge)).toBe(true)
    const quality = qualityFrom(result.measurements, {
      objectCount: result.measurements.length,
      validPixels: width * height,
      nodataPixels: 0,
      planeWidth: width,
      planeHeight: height,
      settings: {
        thresholdMethod: 'manual',
        thresholdValue: 40,
        polarity: 'dark',
        openRadius: 0,
        closeRadius: 0,
        fillHoles: false,
        clearBorder: false,
        watershed: false,
      },
    })
    expect(quality.borderObjectCount).toBeGreaterThan(0)
    expect(quality.tinyObjectFraction).toBeGreaterThan(0)
    expect(quality.polarity).toBe('dark')
    expect(quality.warnings.some((warning) => warning.includes('pixels'))).toBe(true)
  })

  it('records sampled-page and incorrect-calibration limitations without a statistical guarantee', () => {
    const report = particleQualityDiagnostics({
      objectCount: 40,
      sampledObjectCount: 8,
      validPixels: 100,
      nodataPixels: 0,
      planeWidth: 10,
      planeHeight: 10,
      areas: [8, 9, 9, 10, 11, 12, 13, 80],
      equivalentDiameters: [3, 3, 3, 3, 3, 3, 3, 10],
      circularities: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.2],
      solidities: [0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.5],
      borderCount: 0,
      settings: {
        thresholdMethod: 'otsu',
        polarity: 'auto',
        openRadius: 0,
        closeRadius: 0,
        fillHoles: false,
        clearBorder: false,
        watershed: false,
      },
      calibration: { unit: 'px', xSpacing: 1, ySpacing: 1 },
    })
    expect(report.warnings.join(' ')).toMatch(/loaded table page/u)
    expect(report.warnings.join(' ')).toMatch(/pixels/u)
    expect(report.limitations.join(' ')).toMatch(/not a formal statistical guarantee/u)
    expect(report.likelyMergedObjectCount).toBeGreaterThan(0)
  })
})
