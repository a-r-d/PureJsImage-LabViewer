export const CORPUS_SCHEMA_VERSION = 1 as const

export type CorpusStatus = 'enabled' | 'candidate' | 'scheduled' | 'excluded' | 'disabled'
export type CorpusTier = 'generated' | 'bundled' | 'hosted' | 'external'
export type ExpectedResultLevel = 'exact' | 'tolerance' | 'structural' | 'product' | 'performance'
export type ScenarioTestTier =
  | 'pr'
  | 'main'
  | 'nightly'
  | 'scheduled'
  | 'manual'
  | 'local-expensive'
export type ScenarioCapability =
  | 'source.reader-dataset'
  | 'source.axes-components-calibration-metadata'
  | 'source.local-range-parity'
  | 'source.range-byte-budget'
  | 'source.first-useful-tile'
  | 'viewport.navigation-value-readout'
  | 'roi.all-types-and-units'
  | 'analysis.filters-transforms-background'
  | 'analysis.threshold-morphology-watershed'
  | 'analysis.components-filtering-measurements'
  | 'analysis.fft-profile-d-spacing'
  | 'analysis.stack-projection-registration'
  | 'analysis.afm-leveling-roughness'
  | 'analysis.batch-partial-failure'
  | 'scripts.sandbox-recipe-replay'
  | 'project.save-reopen-rebind'
  | 'lifecycle.cancel-crash-cleanup-release'
  | 'accessibility.keyboard'
  | 'results.linked-selection'
  | 'export.bounded'

export type ExampleWorkflowStepAction =
  | 'gallery.open'
  | 'source.inspect'
  | 'viewport.inspect'
  | 'roi.measure'
  | 'analysis.core'
  | 'analysis.particles'
  | 'analysis.watershed'
  | 'analysis.fft'
  | 'analysis.surface'
  | 'analysis.stack'
  | 'analysis.batch'
  | 'script.test'
  | 'project.replay'
  | 'lifecycle.hostile'
  | 'accessibility.scan'
  | 'visual.capture'

export interface CorpusLicenseV1 {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly attribution: string
  readonly citation?: string | undefined
  readonly redistribution: 'approved' | 'review-required' | 'prohibited'
  readonly verifiedAt?: string | undefined
}

export interface CorpusFileV1 {
  readonly path: string
  readonly sizeBytes?: number | undefined
  readonly mediaType: string
  readonly sha256?: string | undefined
  readonly sourceChecksum?: string | undefined
  readonly url?: string | undefined
  readonly delivery: 'generated' | 'bundled' | 'download' | 'range'
}

export interface GeneratedExampleSourceV1 {
  readonly kind: 'generated'
  readonly generatorId: string
  readonly files: readonly CorpusFileV1[]
}

export interface ExternalExampleSourceV1 {
  readonly kind: 'bundled' | 'hosted' | 'external'
  readonly landingPage: string
  readonly files: readonly CorpusFileV1[]
}

export type ExampleSourceV1 = GeneratedExampleSourceV1 | ExternalExampleSourceV1

export interface ExamplePreviewV1 {
  readonly kind: 'generated-pattern' | 'bundled-image'
  readonly value: string
  readonly alt: string
}

export type ExampleInitialAnalysisV1 =
  | Readonly<{
      kind: 'histogram'
      title: string
      description: string
      component: number
    }>
  | Readonly<{
      kind: 'connected-components'
      title: string
      description: string
      component: number
      threshold: number
      mode: 'greater-than' | 'greater-than-or-equal' | 'less-than' | 'less-than-or-equal'
      connectivity: 4 | 8
      overlay: 'mask' | 'labels'
    }>

export interface ExampleExpectedAssertionV1 {
  readonly id: string
  readonly level: ExpectedResultLevel
  readonly description: string
  readonly value?: string | number | boolean | undefined
  readonly tolerance?: number | undefined
  readonly unit?: string | undefined
}

export interface ExampleWorkflowV1 {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly artifactId: string
  readonly artifactKind: 'recipe' | 'script'
  readonly steps: readonly ExampleWorkflowStepV1[]
  readonly oracle: ExampleOracleReferenceV1
  readonly expected: readonly ExampleExpectedAssertionV1[]
}

export interface ExampleWorkflowStepV1 {
  readonly id: string
  readonly action: ExampleWorkflowStepAction
  readonly description: string
}

export interface ExampleOracleReferenceV1 {
  readonly id: string
  readonly implementation: string
  readonly version: string
  readonly tolerance?: number | undefined
}

export interface ExampleBudgetsV1 {
  readonly maxSourceBytes: number
  readonly maxRemoteBytes: number
  readonly maxExpandedBytes: number
  readonly maxArchiveFiles: number
  readonly maxFirstUsefulTileMilliseconds: number
  readonly maxCancellationMilliseconds: number
  readonly maxCompletionMilliseconds: number
  readonly maxPeakManagedBytes: number
  readonly maxRangeRequests: number
}

export interface ExampleTestPlanV1 {
  readonly tier: ScenarioTestTier
  readonly capabilities: readonly ScenarioCapability[]
  readonly screenshotStates: readonly string[]
  readonly accessibility: boolean
  readonly projectReplay: boolean
  readonly agentEvalCaseIds: readonly string[]
}

export interface ExampleScenarioV1 {
  readonly schemaVersion: typeof CORPUS_SCHEMA_VERSION
  readonly id: string
  readonly status: CorpusStatus
  readonly tier: CorpusTier
  readonly statusReason: string
  readonly title: string
  readonly summary: string
  readonly modality: string
  readonly vendor?: string | undefined
  readonly format: string
  readonly sizeClass: 'tiny' | 'small' | 'medium' | 'large' | 'very-large'
  readonly calibration: string
  readonly source: ExampleSourceV1
  readonly license: CorpusLicenseV1
  readonly preview: ExamplePreviewV1
  readonly initialAnalysis?: ExampleInitialAnalysisV1 | undefined
  readonly tags: readonly string[]
  readonly learningGoals: readonly string[]
  readonly workflows: readonly ExampleWorkflowV1[]
  readonly expected: readonly ExampleExpectedAssertionV1[]
  readonly budgets: ExampleBudgetsV1
  readonly testPlan: ExampleTestPlanV1
  readonly testTags: readonly string[]
  readonly verifiedAt?: string | undefined
}

export interface CorpusManifestV1 {
  readonly schemaVersion: typeof CORPUS_SCHEMA_VERSION
  readonly generatedAt: string
  readonly scenarios: readonly ExampleScenarioV1[]
}

export interface CorpusValidationIssue {
  readonly path: string
  readonly message: string
}

export type CorpusValidationResult<T> =
  | Readonly<{ ok: true; value: T; issues: readonly [] }>
  | Readonly<{ ok: false; issues: readonly CorpusValidationIssue[] }>

export interface CorpusAuditEntryV1 {
  readonly id: string
  readonly status: CorpusStatus
  readonly ready: boolean
  readonly reasons: readonly string[]
}

export interface CorpusAuditReportV1 {
  readonly schemaVersion: typeof CORPUS_SCHEMA_VERSION
  readonly generatedAt: string
  readonly entries: readonly CorpusAuditEntryV1[]
  readonly counts: Readonly<Record<CorpusStatus, number>>
}
