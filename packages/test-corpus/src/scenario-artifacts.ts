import { corpusManifest } from './manifest.js'
import type {
  ExampleBudgetsV1,
  ExampleExpectedAssertionV1,
  ExampleOracleReferenceV1,
  ExampleScenarioV1,
  ExampleTestPlanV1,
  ExampleWorkflowStepV1,
  ExampleWorkflowV1,
  ScenarioCapability,
  ScenarioTestTier,
} from './types.js'

export const SCENARIO_ARTIFACT_SCHEMA_VERSION = 1 as const

export const REQUIRED_PRODUCT_CAPABILITIES = Object.freeze([
  'source.reader-dataset',
  'source.axes-components-calibration-metadata',
  'source.local-range-parity',
  'source.range-byte-budget',
  'source.first-useful-tile',
  'viewport.navigation-value-readout',
  'roi.all-types-and-units',
  'analysis.filters-transforms-background',
  'analysis.threshold-morphology-watershed',
  'analysis.components-filtering-measurements',
  'analysis.fft-profile-d-spacing',
  'analysis.stack-projection-registration',
  'analysis.afm-leveling-roughness',
  'analysis.batch-partial-failure',
  'scripts.sandbox-recipe-replay',
  'project.save-reopen-rebind',
  'lifecycle.cancel-crash-cleanup-release',
  'accessibility.keyboard',
  'results.linked-selection',
  'export.bounded',
] as const satisfies readonly ScenarioCapability[])

export interface ScenarioTestArtifactV1 {
  readonly schemaVersion: typeof SCENARIO_ARTIFACT_SCHEMA_VERSION
  readonly id: string
  readonly scenarioId: string
  readonly scenarioTitle: string
  readonly workflowId: string
  readonly workflowTitle: string
  readonly fixture: Readonly<{
    kind: 'generated' | 'bundled' | 'hosted' | 'external'
    locator: string
    files: readonly string[]
    format: string
  }>
  readonly metadata: Readonly<{
    modality: string
    calibration: string
    licenseId: string
  }>
  readonly steps: readonly ExampleWorkflowStepV1[]
  readonly expected: readonly ExampleExpectedAssertionV1[]
  readonly oracle: ExampleOracleReferenceV1
  readonly budgets: ExampleBudgetsV1
  readonly testPlan: ExampleTestPlanV1
}

function artifactFor(
  scenario: ExampleScenarioV1,
  workflow: ExampleWorkflowV1,
): ScenarioTestArtifactV1 {
  const locator =
    scenario.source.kind === 'generated'
      ? scenario.source.generatorId
      : scenario.source.files.map(({ path }) => path).join(',')
  return Object.freeze({
    schemaVersion: SCENARIO_ARTIFACT_SCHEMA_VERSION,
    id: `${scenario.id}/${workflow.id}`,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    workflowId: workflow.id,
    workflowTitle: workflow.title,
    fixture: Object.freeze({
      kind: scenario.source.kind,
      locator,
      files: Object.freeze(scenario.source.files.map(({ path }) => path)),
      format: scenario.format,
    }),
    metadata: Object.freeze({
      modality: scenario.modality,
      calibration: scenario.calibration,
      licenseId: scenario.license.id,
    }),
    steps: workflow.steps,
    expected: workflow.expected,
    oracle: workflow.oracle,
    budgets: scenario.budgets,
    testPlan: scenario.testPlan,
  })
}

export function scenarioTestArtifacts(
  tiers: readonly ScenarioTestTier[] = ['pr'],
): readonly ScenarioTestArtifactV1[] {
  const accepted = new Set(tiers)
  return Object.freeze(
    corpusManifest.scenarios.flatMap((scenario) =>
      scenario.status === 'enabled' && accepted.has(scenario.testPlan.tier)
        ? scenario.workflows.map((workflow) => artifactFor(scenario, workflow))
        : [],
    ),
  )
}

export function scenarioArtifact(id: string): ScenarioTestArtifactV1 {
  const artifact = scenarioTestArtifacts([
    'pr',
    'main',
    'nightly',
    'scheduled',
    'manual',
    'local-expensive',
  ]).find((candidate) => candidate.id === id || candidate.scenarioId === id)
  if (artifact === undefined) throw new Error(`Unknown enabled scenario artifact: ${id}.`)
  return artifact
}

export function scenarioCapabilityMatrix(): ReadonlyMap<ScenarioCapability, readonly string[]> {
  const matrix = new Map<ScenarioCapability, string[]>()
  for (const scenario of corpusManifest.scenarios)
    for (const capability of scenario.testPlan.capabilities) {
      const ids = matrix.get(capability) ?? []
      ids.push(scenario.id)
      matrix.set(capability, ids)
    }
  return new Map(
    [...matrix].map(([capability, ids]) => [capability, Object.freeze([...new Set(ids)])]),
  )
}
