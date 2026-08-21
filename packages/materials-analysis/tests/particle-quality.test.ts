import { describe, expect, it } from 'vitest'

import { particleQualityDiagnostics } from '../src/particle-quality.js'

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
        backgroundRadius: 0,
      },
      calibration: { unit: 'nm', xSpacing: 1, ySpacing: 1 },
    })
    expect(report.objectCount).toBe(4)
    expect(report.likelyMergedObjectCount).toBeGreaterThan(0)
    expect(report.calibration.unit).toBe('nm')
    expect(report.limitations[0]).toContain('not a formal statistical guarantee')
  })
})
