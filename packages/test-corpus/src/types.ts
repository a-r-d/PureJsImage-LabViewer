export const CORPUS_SCHEMA_VERSION = 1 as const

export type CorpusStatus = 'enabled' | 'candidate' | 'scheduled' | 'excluded' | 'disabled'
export type CorpusTier = 'generated' | 'bundled' | 'hosted' | 'external'
export type ExpectedResultLevel = 'exact' | 'tolerance' | 'structural' | 'product' | 'performance'

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
  readonly expected: readonly ExampleExpectedAssertionV1[]
}

export interface ExampleBudgetsV1 {
  readonly maxSourceBytes: number
  readonly maxRemoteBytes: number
  readonly maxExpandedBytes: number
  readonly maxArchiveFiles: number
  readonly maxFirstUsefulTileMilliseconds: number
  readonly maxCancellationMilliseconds: number
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
  readonly tags: readonly string[]
  readonly learningGoals: readonly string[]
  readonly workflows: readonly ExampleWorkflowV1[]
  readonly expected: readonly ExampleExpectedAssertionV1[]
  readonly budgets: ExampleBudgetsV1
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
