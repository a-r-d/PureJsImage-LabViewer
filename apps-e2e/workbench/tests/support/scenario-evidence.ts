import type {
  ScenarioCapability,
  ScenarioTestArtifactV1,
  ScenarioTestTier,
} from '@pji-workbench/test-corpus'
import type { Page, TestInfo } from '@playwright/test'
import { readWorkbenchMetrics } from './workbench.js'

export const SCENARIO_EVIDENCE_ATTACHMENT = 'scenario-evidence.json'

export interface ScenarioEvidenceV1 {
  readonly schemaVersion: 1
  readonly scenarioId: string
  readonly workflowId: string
  readonly tier: ScenarioTestTier
  readonly capabilities: readonly ScenarioCapability[]
  readonly oracle: ScenarioTestArtifactV1['oracle']
  readonly expected: ScenarioTestArtifactV1['expected']
  readonly budgets: ScenarioTestArtifactV1['budgets']
  readonly measurements: Readonly<{
    sourceBytes: number
    rangeRequests: number | null
    rangeBytes: number | null
    peakManagedBytes: number | null
    firstTileMilliseconds: number | null
    completionMilliseconds: number
    cancellationMilliseconds: number | null
  }>
  readonly identities: Readonly<{
    projectId: string | null
    invocationIds: readonly string[]
  }>
}

interface ScenarioEvidenceOptions {
  readonly capabilities?: readonly ScenarioCapability[] | undefined
  readonly cancellationMilliseconds?: number | undefined
}

export async function attachScenarioEvidence(
  page: Page,
  testInfo: TestInfo,
  artifact: ScenarioTestArtifactV1,
  options: ScenarioEvidenceOptions = {},
): Promise<void> {
  const metrics = page.isClosed()
    ? {
        reactRenders: 0,
        viewportFrames: 0,
        tilesTransferred: 0,
        tileBytesTransferred: 0,
        tilePixelsTransferred: 0,
        largestTilePixels: 0,
        sourceBytes: 0,
        datasetPixels: 0,
        firstTileMilliseconds: null,
        projectId: '',
        invocationIds: [],
      }
    : await readWorkbenchMetrics(page).catch(() => ({
        reactRenders: 0,
        viewportFrames: 0,
        tilesTransferred: 0,
        tileBytesTransferred: 0,
        tilePixelsTransferred: 0,
        largestTilePixels: 0,
        sourceBytes: 0,
        datasetPixels: 0,
        firstTileMilliseconds: null,
        projectId: '',
        invocationIds: [],
      }))
  const evidence: ScenarioEvidenceV1 = {
    schemaVersion: 1,
    scenarioId: artifact.scenarioId,
    workflowId: artifact.workflowId,
    tier: artifact.testPlan.tier,
    capabilities: options.capabilities ?? artifact.testPlan.capabilities,
    oracle: artifact.oracle,
    expected: artifact.expected,
    budgets: artifact.budgets,
    measurements: {
      sourceBytes: metrics.sourceBytes,
      rangeRequests: null,
      rangeBytes: null,
      peakManagedBytes: null,
      firstTileMilliseconds: metrics.firstTileMilliseconds,
      completionMilliseconds: Math.round(testInfo.duration),
      cancellationMilliseconds: options.cancellationMilliseconds ?? null,
    },
    identities: {
      projectId: metrics.projectId || null,
      invocationIds: metrics.invocationIds,
    },
  }
  await testInfo.attach(SCENARIO_EVIDENCE_ATTACHMENT, {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  })
}
