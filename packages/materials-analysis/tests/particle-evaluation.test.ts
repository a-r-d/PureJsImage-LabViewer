import { describe, expect, it } from 'vitest'

import {
  assessParticleRefinement,
  evaluateParticleSegmentation,
  labelColorInstanceMaskForEvaluation,
} from '../src/particle-evaluation.js'

function fillRectangle(
  labels: Uint32Array | Uint8Array,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  label: number,
): void {
  for (let y = top; y <= bottom; y += 1)
    for (let x = left; x <= right; x += 1) labels[y * width + x] = label
}

describe('particle instance evaluation', () => {
  it('keeps disconnected instances distinct when an indexed mask reuses a color', () => {
    const samples = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255])
    const labels = labelColorInstanceMaskForEvaluation(samples, 3, 1, 4)
    expect([...labels]).toEqual([1, 0, 2])
  })

  it('reports exact instance, boundary, morphology, and edge-policy metrics', () => {
    const width = 16
    const height = 12
    const truth = new Uint32Array(width * height)
    fillRectangle(truth, width, 0, 0, 2, 2, 1)
    fillRectangle(truth, width, 6, 3, 9, 7, 2)

    const report = evaluateParticleSegmentation({
      predictedLabels: truth,
      truthLabels: truth,
      width,
      height,
    })

    expect(report).toMatchObject({
      truthCount: { includingBorder: 2, excludingBorder: 1 },
      predictedCount: { includingBorder: 2, excludingBorder: 1 },
      countError: { includingBorder: 0, excludingBorder: 0 },
      precision: 1,
      recall: 1,
      f1: 1,
      mergeRate: 0,
      splitRate: 0,
      maskIoU: 1,
      maskDice: 1,
      boundaryF1: 1,
      meanCentroidErrorPixels: 0,
      meanAreaRelativeBias: 0,
      meanEquivalentDiameterRelativeBias: 0,
      meanAspectRatioRelativeBias: 0,
      meanAbsoluteOrientationErrorRadians: 0,
      foregroundFractionError: 0,
    })
  })

  it('uses one-to-one matching and distinguishes merges from splits', () => {
    const width = 18
    const height = 10
    const truth = new Uint32Array(width * height)
    fillRectangle(truth, width, 2, 2, 5, 6, 1)
    fillRectangle(truth, width, 7, 2, 10, 6, 2)
    const merged = Uint32Array.from(truth, (label) => (label === 0 ? 0 : 1))
    fillRectangle(merged, width, 6, 3, 6, 5, 1)

    const mergedReport = evaluateParticleSegmentation({
      predictedLabels: merged,
      truthLabels: truth,
      width,
      height,
      overlapThreshold: 0.1,
      boundaryTolerancePixels: 0,
    })
    expect(mergedReport.precision).toBeLessThanOrEqual(1)
    expect(mergedReport.recall).toBe(0)
    expect(mergedReport.mergeRate).toBe(1)
    expect(mergedReport.boundaryF1).toBeLessThan(1)

    const split = new Uint32Array(truth)
    for (let y = 2; y <= 6; y += 1) for (let x = 8; x <= 10; x += 1) split[y * width + x] = 3
    const splitReport = evaluateParticleSegmentation({
      predictedLabels: split,
      truthLabels: truth,
      width,
      height,
      overlapThreshold: 0.1,
    })
    expect(splitReport.splitRate).toBe(0.5)
    expect(splitReport.predictedCount.includingBorder).toBe(3)
  })

  it('removes ignored ambiguity before counts and scores', () => {
    const width = 12
    const height = 8
    const truth = new Uint32Array(width * height)
    const predicted = new Uint32Array(width * height)
    fillRectangle(truth, width, 2, 2, 4, 5, 1)
    fillRectangle(predicted, width, 2, 2, 4, 5, 1)
    fillRectangle(predicted, width, 8, 2, 10, 5, 2)
    const ignoreMask = new Uint8Array(width * height)
    fillRectangle(ignoreMask, width, 7, 1, 11, 6, 1)

    const report = evaluateParticleSegmentation({
      predictedLabels: predicted,
      truthLabels: truth,
      ignoreMask,
      width,
      height,
    })

    expect(report.policy.ignoredPixels).toBe(30)
    expect(report.predictedCount.includingBorder).toBe(1)
    expect(report.precision).toBe(1)
    expect(report.maskIoU).toBe(1)
  })

  it('treats two empty masks as exact and retains degenerate one-pixel instances', () => {
    const empty = evaluateParticleSegmentation({
      predictedLabels: new Uint32Array(9),
      truthLabels: new Uint32Array(9),
      width: 3,
      height: 3,
    })
    expect(empty).toMatchObject({ precision: 1, recall: 1, f1: 1, maskIoU: 1, maskDice: 1 })

    const onePixel = new Uint32Array(9)
    onePixel[4] = 7
    const exact = evaluateParticleSegmentation({
      predictedLabels: onePixel,
      truthLabels: onePixel,
      width: 3,
      height: 3,
    })
    expect(exact).toMatchObject({
      truthCount: { includingBorder: 1, excludingBorder: 1 },
      predictedCount: { includingBorder: 1, excludingBorder: 1 },
      precision: 1,
      recall: 1,
      f1: 1,
      maskIoU: 1,
      maskDice: 1,
    })
  })

  it('rejects mismatched masks and unsupported thresholds', () => {
    expect(() =>
      evaluateParticleSegmentation({
        predictedLabels: new Uint32Array(3),
        truthLabels: new Uint32Array(4),
        width: 2,
        height: 2,
      }),
    ).toThrow('dimensions do not match')
    expect(() =>
      evaluateParticleSegmentation({
        predictedLabels: new Uint32Array(4),
        truthLabels: new Uint32Array(4),
        width: 2,
        height: 2,
        iouThreshold: 0,
      }),
    ).toThrow('IoU threshold')
  })

  it('classifies refinement from oracle metrics rather than a higher count', () => {
    const width = 18
    const height = 10
    const truth = new Uint32Array(width * height)
    fillRectangle(truth, width, 2, 2, 5, 6, 1)
    fillRectangle(truth, width, 8, 2, 11, 6, 2)
    const merged = Uint32Array.from(truth, (label) => (label === 0 ? 0 : 1))
    fillRectangle(merged, width, 6, 3, 7, 5, 1)
    const noisyHigherCount = new Uint32Array(truth)
    noisyHigherCount[height * width - 2] = 3
    const baseline = evaluateParticleSegmentation({
      predictedLabels: merged,
      truthLabels: truth,
      width,
      height,
      overlapThreshold: 0.1,
    })
    const improved = evaluateParticleSegmentation({
      predictedLabels: truth,
      truthLabels: truth,
      width,
      height,
    })
    const noisy = evaluateParticleSegmentation({
      predictedLabels: noisyHigherCount,
      truthLabels: truth,
      width,
      height,
    })

    expect(assessParticleRefinement(baseline, improved).classification).toBe('improved')
    expect(noisy.predictedCount.includingBorder).toBeGreaterThan(
      improved.predictedCount.includingBorder,
    )
    expect(assessParticleRefinement(improved, noisy).classification).toBe('regressed')
  })
})
