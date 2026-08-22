import { describe, expect, it } from 'vitest'

import {
  assessParticleRefinement,
  computeParticleCorpusFeatures,
  createParticleCorpusReport,
  evaluateParticleSegmentation,
  renderParticleCorpusReportMarkdown,
} from '../src/index.js'

function run(id: string, predicted: Uint32Array, truth: Uint32Array) {
  const width = 4
  const height = 4
  const metrics = evaluateParticleSegmentation({
    predictedLabels: predicted,
    truthLabels: truth,
    width,
    height,
  })
  const features = computeParticleCorpusFeatures({
    id,
    image: Float64Array.from(truth, (value) => (value === 0 ? 10 : 100)),
    instanceLabels: truth,
    width,
    height,
    bitDepth: 8,
    channelCount: 1,
  })
  return {
    id,
    reviewStatus: 'upstream-unreviewed',
    oracleClaim: 'fixture-only',
    baseline: {
      settings: { thresholdMethod: 'otsu', minimumSize: 1 },
      runtimeMilliseconds: 2,
      managedPeakBytesEstimate: 128,
      metrics,
    },
    refined: {
      settings: { thresholdMethod: 'otsu', minimumSize: 12 },
      runtimeMilliseconds: 3,
      managedPeakBytesEstimate: 160,
      metrics,
    },
    refinement: assessParticleRefinement(metrics, metrics),
    features,
  }
}

describe('particle corpus report', () => {
  it('stably aggregates, orders, and renders machine and human results', () => {
    const truth = new Uint32Array(16)
    truth[5] = 1
    truth[6] = 1
    truth[9] = 1
    truth[10] = 1
    const report = createParticleCorpusReport('0.1.0', [
      run('fixture-b', truth, truth),
      run('fixture-a', truth, truth),
    ])

    expect(report.fixtures.map(({ id }) => id)).toEqual(['fixture-a', 'fixture-b'])
    expect(report.aggregate).toEqual({
      fixtureCount: 2,
      truthCountIncludingBorder: 2,
      baselinePredictedCountIncludingBorder: 2,
      baselineMeanF1: 1,
      baselineMeanMaskIoU: 1,
      baselineMeanBoundaryF1: 1,
      predictedCountIncludingBorder: 2,
      countErrorIncludingBorder: 0,
      countErrorExcludingBorder: 0,
      meanPrecision: 1,
      meanRecall: 1,
      meanF1: 1,
      meanMaskIoU: 1,
      meanBoundaryF1: 1,
      totalRuntimeMilliseconds: 10,
      maximumManagedPeakBytesEstimate: 160,
    })
    expect(renderParticleCorpusReportMarkdown(report)).toBe(`# Particle corpus report

Corpus version: 0.1.0

Evaluated 2 fixtures with 2 upstream instance labels. Macro F1 is 1.0000 -> 1.0000, mask IoU is 1.0000 -> 1.0000, and boundary F1 is 1.0000 -> 1.0000.

| Fixture | Status | Baseline count | Refined count | F1 | Mask IoU | Boundary F1 | Assessment |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| fixture-a | upstream-unreviewed | 1 | 1 | 1.0000 | 1.0000 | 1.0000 | unchanged |
| fixture-b | upstream-unreviewed | 1 | 1 | 1.0000 | 1.0000 | 1.0000 | unchanged |

These preview masks are upstream-unreviewed wiring fixtures, not adjudicated gold. Results do not establish broad particle-count validity.
`)
  })

  it('rejects duplicate fixture IDs and invalid runtime observations', () => {
    const truth = new Uint32Array(16)
    truth[5] = 1
    const fixture = run('duplicate', truth, truth)
    expect(() => createParticleCorpusReport('0.1.0', [fixture, fixture])).toThrow('unique')
    expect(() =>
      createParticleCorpusReport('0.1.0', [
        { ...fixture, refined: { ...fixture.refined, runtimeMilliseconds: Number.NaN } },
      ]),
    ).toThrow('invalid')
  })
})
