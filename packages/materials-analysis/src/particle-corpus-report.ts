import type {
  ParticleCorpusFeatures,
  ParticleCorpusSelection,
} from './particle-corpus-selection.js'
import { selectParticleCorpusHardCases } from './particle-corpus-selection.js'
import type {
  ParticleRefinementAssessment,
  ParticleSegmentationEvaluation,
} from './particle-evaluation.js'

export interface ParticleCorpusRunV1 {
  readonly id: string
  readonly reviewStatus: string
  readonly oracleClaim: string
  readonly baseline: Readonly<{
    settings: Readonly<Record<string, string | number | boolean>>
    runtimeMilliseconds: number
    managedPeakBytesEstimate: number
    metrics: ParticleSegmentationEvaluation
  }>
  readonly refined: Readonly<{
    settings: Readonly<Record<string, string | number | boolean>>
    runtimeMilliseconds: number
    managedPeakBytesEstimate: number
    metrics: ParticleSegmentationEvaluation
  }>
  readonly refinement: ParticleRefinementAssessment
  readonly features: ParticleCorpusFeatures
}

export interface ParticleCorpusReportV1 {
  readonly schemaVersion: 1
  readonly corpusVersion: string
  readonly runnerVersion: 'particle-corpus-runner-v1'
  readonly edgePolicy: 'partial border objects stay in masks and counts; morphometry excludes them'
  readonly aggregate: Readonly<{
    fixtureCount: number
    truthCountIncludingBorder: number
    baselinePredictedCountIncludingBorder: number
    baselineMeanF1: number
    baselineMeanMaskIoU: number
    baselineMeanBoundaryF1: number
    predictedCountIncludingBorder: number
    countErrorIncludingBorder: number
    countErrorExcludingBorder: number
    meanPrecision: number
    meanRecall: number
    meanF1: number
    meanMaskIoU: number
    meanBoundaryF1: number
    totalRuntimeMilliseconds: number
    maximumManagedPeakBytesEstimate: number
  }>
  readonly fixtures: readonly ParticleCorpusRunV1[]
  readonly selection: readonly ParticleCorpusSelection[]
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}

export function createParticleCorpusReport(
  corpusVersion: string,
  runs: readonly ParticleCorpusRunV1[],
): ParticleCorpusReportV1 {
  if (corpusVersion.trim() === '') throw new Error('Corpus version is required.')
  const fixtures = [...runs].sort((left, right) => left.id.localeCompare(right.id))
  if (new Set(fixtures.map(({ id }) => id)).size !== fixtures.length)
    throw new Error('Particle corpus report fixture IDs must be unique.')
  for (const fixture of fixtures)
    for (const value of [
      fixture.baseline.runtimeMilliseconds,
      fixture.refined.runtimeMilliseconds,
      fixture.baseline.managedPeakBytesEstimate,
      fixture.refined.managedPeakBytesEstimate,
    ])
      if (!Number.isFinite(value) || value < 0)
        throw new Error(`Particle corpus observation ${fixture.id} is invalid.`)
  const metrics = fixtures.map(({ refined }) => refined.metrics)
  const baselineMetrics = fixtures.map(({ baseline }) => baseline.metrics)
  return {
    schemaVersion: 1,
    corpusVersion,
    runnerVersion: 'particle-corpus-runner-v1',
    edgePolicy: 'partial border objects stay in masks and counts; morphometry excludes them',
    aggregate: {
      fixtureCount: fixtures.length,
      truthCountIncludingBorder: metrics.reduce(
        (total, value) => total + value.truthCount.includingBorder,
        0,
      ),
      baselinePredictedCountIncludingBorder: baselineMetrics.reduce(
        (total, value) => total + value.predictedCount.includingBorder,
        0,
      ),
      baselineMeanF1: mean(baselineMetrics.map(({ f1 }) => f1)),
      baselineMeanMaskIoU: mean(baselineMetrics.map(({ maskIoU }) => maskIoU)),
      baselineMeanBoundaryF1: mean(baselineMetrics.map(({ boundaryF1 }) => boundaryF1)),
      predictedCountIncludingBorder: metrics.reduce(
        (total, value) => total + value.predictedCount.includingBorder,
        0,
      ),
      countErrorIncludingBorder: metrics.reduce(
        (total, value) => total + value.countError.includingBorder,
        0,
      ),
      countErrorExcludingBorder: metrics.reduce(
        (total, value) => total + value.countError.excludingBorder,
        0,
      ),
      meanPrecision: mean(metrics.map(({ precision }) => precision)),
      meanRecall: mean(metrics.map(({ recall }) => recall)),
      meanF1: mean(metrics.map(({ f1 }) => f1)),
      meanMaskIoU: mean(metrics.map(({ maskIoU }) => maskIoU)),
      meanBoundaryF1: mean(metrics.map(({ boundaryF1 }) => boundaryF1)),
      totalRuntimeMilliseconds: fixtures.reduce(
        (total, { baseline, refined }) =>
          total + baseline.runtimeMilliseconds + refined.runtimeMilliseconds,
        0,
      ),
      maximumManagedPeakBytesEstimate: fixtures.reduce(
        (maximum, { baseline, refined }) =>
          Math.max(maximum, baseline.managedPeakBytesEstimate, refined.managedPeakBytesEstimate),
        0,
      ),
    },
    fixtures,
    selection: selectParticleCorpusHardCases(
      fixtures.map(({ id, features }) => ({ id, features })),
      Math.min(3, fixtures.length),
    ),
  }
}

export function renderParticleCorpusReportMarkdown(report: ParticleCorpusReportV1): string {
  return [
    '# Particle corpus report',
    '',
    `Corpus version: ${report.corpusVersion}`,
    '',
    `Evaluated ${report.aggregate.fixtureCount} fixtures with ${report.aggregate.truthCountIncludingBorder} upstream instance labels. Macro F1 is ${report.aggregate.baselineMeanF1.toFixed(4)} -> ${report.aggregate.meanF1.toFixed(4)}, mask IoU is ${report.aggregate.baselineMeanMaskIoU.toFixed(4)} -> ${report.aggregate.meanMaskIoU.toFixed(4)}, and boundary F1 is ${report.aggregate.baselineMeanBoundaryF1.toFixed(4)} -> ${report.aggregate.meanBoundaryF1.toFixed(4)}.`,
    '',
    '| Fixture | Status | Baseline count | Refined count | F1 | Mask IoU | Boundary F1 | Assessment |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...report.fixtures.map(
      ({ id, reviewStatus, baseline, refined, refinement }) =>
        `| ${id} | ${reviewStatus} | ${baseline.metrics.predictedCount.includingBorder} | ${refined.metrics.predictedCount.includingBorder} | ${refined.metrics.f1.toFixed(4)} | ${refined.metrics.maskIoU.toFixed(4)} | ${refined.metrics.boundaryF1.toFixed(4)} | ${refinement.classification} |`,
    ),
    '',
    'These preview masks are upstream-unreviewed wiring fixtures, not adjudicated gold. Results do not establish broad particle-count validity.',
    '',
  ].join('\n')
}
