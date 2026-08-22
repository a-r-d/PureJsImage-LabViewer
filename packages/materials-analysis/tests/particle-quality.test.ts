import { describe, expect, it } from 'vitest'

import {
  compareParticleQualityDiagnostics,
  particleQualityDiagnostics,
} from '../src/particle-quality.js'

describe('particle quality diagnostics', () => {
  it('summarizes distributions and flags likely merges without guaranteeing quality', () => {
    const report = particleQualityDiagnostics({
      objectCount: 4,
      validPixels: 100,
      nodataPixels: 2,
      planeWidth: 10,
      planeHeight: 10,
      areas: [8, 9, 10, 40],
      equivalentDiameters: [3, 3.2, 3.4, 7],
      circularities: [0.9, 0.88, 0.92, 0.3],
      solidities: [0.95, 0.94, 0.96, 0.6],
      borderCount: 1,
      settings: {
        thresholdMethod: 'otsu',
        thresholdValue: 120,
        polarity: 'light',
        openRadius: 1,
        closeRadius: 0,
        fillHoles: true,
        clearBorder: false,
        watershed: true,
        minimumPeakDistance: 20,
        minimumPeakHeight: 4,
        backgroundRadius: 0,
      },
      calibration: { unit: 'nm', xSpacing: 1, ySpacing: 1 },
    })
    expect(report.objectCount).toBe(4)
    expect(report.likelyMergedObjectCount).toBeGreaterThan(0)
    expect(report.calibration.unit).toBe('nm')
    expect(report.minimumPeakDistance).toBe(20)
    expect(report.minimumPeakHeight).toBe(4)
    expect(report.limitations[0]).toContain('not a formal statistical guarantee')
  })

  it('compares bounded diagnostics without turning a count increase into improvement', () => {
    const diagnostics = (objectCount: number, areas: readonly number[]) =>
      particleQualityDiagnostics({
        objectCount,
        validPixels: 100,
        nodataPixels: 0,
        planeWidth: 10,
        planeHeight: 10,
        areas,
        equivalentDiameters: areas.map((area) => Math.sqrt(area)),
        circularities: areas.map(() => 0.9),
        solidities: areas.map(() => 0.95),
        borderCount: 0,
        settings: {
          thresholdMethod: 'otsu',
          polarity: 'light',
          openRadius: 0,
          closeRadius: 0,
          fillHoles: false,
          clearBorder: false,
          watershed: false,
        },
      })
    const comparison = compareParticleQualityDiagnostics(
      diagnostics(2, [10, 10]),
      diagnostics(4, [0.001, 0.1, 10, 10]),
    )
    expect(comparison.countDelta).toBe(2)
    expect(comparison.classification).toBe('not-determined-without-oracle-or-visual-adjudication')
    expect(comparison.likelySplitOrNoiseCountDelta).toBeGreaterThan(0)
    expect(comparison.limitation).toContain('do not establish improvement')
  })
})
