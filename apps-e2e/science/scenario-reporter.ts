import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { ScenarioCapability, ScenarioTestTier } from '@pji-workbench/test-corpus'
import { REQUIRED_PRODUCT_CAPABILITIES, scenarioCapabilityMatrix } from '@pji-workbench/test-corpus'
import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'
import {
  SCENARIO_EVIDENCE_ATTACHMENT,
  type ScenarioEvidenceV1,
} from './tests/support/scenario-evidence.js'

interface ScenarioRunReportV1 extends ScenarioEvidenceV1 {
  readonly browser: string
  readonly status: TestResult['status']
  readonly durationMilliseconds: number
  readonly title: string
  readonly errors: readonly string[]
  readonly failureArtifacts: readonly string[]
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const TIERS = new Set<ScenarioTestTier>([
  'pr',
  'main',
  'nightly',
  'scheduled',
  'manual',
  'local-expensive',
])
const CAPABILITIES = new Set<ScenarioCapability>(REQUIRED_PRODUCT_CAPABILITIES)

function exactRecord(value: unknown, keys: readonly string[], label: string): void {
  if (!record(value)) throw new Error(`${label} must be an object.`)
  const allowed = new Set(keys)
  for (const key of Object.keys(value))
    if (!allowed.has(key)) throw new Error(`${label} has unknown ${key}.`)
}

function nonEmptyText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is invalid.`)
}

function nonNegativeNumber(value: unknown, label: string, nullable = false): void {
  if (nullable && value === null) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error(`${label} is invalid.`)
}

function parseEvidence(body: Buffer): ScenarioEvidenceV1 {
  const value: unknown = JSON.parse(body.toString('utf8'))
  exactRecord(
    value,
    [
      'schemaVersion',
      'scenarioId',
      'workflowId',
      'tier',
      'capabilities',
      'oracle',
      'expected',
      'budgets',
      'measurements',
      'identities',
    ],
    'Scenario evidence',
  )
  if (!record(value) || value['schemaVersion'] !== 1)
    throw new Error('Scenario evidence version is invalid.')
  nonEmptyText(value['scenarioId'], 'Scenario ID')
  nonEmptyText(value['workflowId'], 'Workflow ID')
  if (typeof value['tier'] !== 'string' || !TIERS.has(value['tier'] as ScenarioTestTier))
    throw new Error('Scenario tier is invalid.')
  if (
    !Array.isArray(value['capabilities']) ||
    value['capabilities'].length === 0 ||
    !value['capabilities'].every(
      (capability) =>
        typeof capability === 'string' && CAPABILITIES.has(capability as ScenarioCapability),
    )
  )
    throw new Error('Scenario capabilities are invalid.')

  exactRecord(value['oracle'], ['id', 'implementation', 'version', 'tolerance'], 'Scenario oracle')
  const oracle = value['oracle']
  if (!record(oracle)) throw new Error('Scenario oracle is invalid.')
  for (const key of ['id', 'implementation', 'version']) nonEmptyText(oracle[key], `Oracle ${key}`)
  if (oracle['tolerance'] !== undefined) nonNegativeNumber(oracle['tolerance'], 'Oracle tolerance')

  if (!Array.isArray(value['expected']) || value['expected'].length === 0)
    throw new Error('Scenario expected assertions are invalid.')
  for (const [index, assertion] of value['expected'].entries()) {
    exactRecord(
      assertion,
      ['id', 'level', 'description', 'value', 'tolerance', 'unit'],
      `Scenario assertion ${index}`,
    )
    if (!record(assertion)) throw new Error(`Scenario assertion ${index} is invalid.`)
    nonEmptyText(assertion['id'], `Scenario assertion ${index} ID`)
    nonEmptyText(assertion['description'], `Scenario assertion ${index} description`)
    if (
      !['exact', 'tolerance', 'structural', 'product', 'performance'].includes(
        String(assertion['level']),
      )
    )
      throw new Error(`Scenario assertion ${index} level is invalid.`)
    const expectedValue = assertion['value']
    if (
      expectedValue !== undefined &&
      typeof expectedValue !== 'string' &&
      typeof expectedValue !== 'boolean' &&
      (typeof expectedValue !== 'number' || !Number.isFinite(expectedValue))
    )
      throw new Error(`Scenario assertion ${index} value is invalid.`)
    if (assertion['tolerance'] !== undefined)
      nonNegativeNumber(assertion['tolerance'], `Scenario assertion ${index} tolerance`)
    if (assertion['unit'] !== undefined)
      nonEmptyText(assertion['unit'], `Scenario assertion ${index} unit`)
  }

  const budgetKeys = [
    'maxSourceBytes',
    'maxRemoteBytes',
    'maxExpandedBytes',
    'maxArchiveFiles',
    'maxFirstUsefulTileMilliseconds',
    'maxCancellationMilliseconds',
    'maxCompletionMilliseconds',
    'maxPeakManagedBytes',
    'maxRangeRequests',
  ] as const
  exactRecord(value['budgets'], budgetKeys, 'Scenario budgets')
  const budgets = value['budgets']
  if (!record(budgets)) throw new Error('Scenario budgets are invalid.')
  for (const key of budgetKeys) nonNegativeNumber(budgets[key], `Scenario budget ${key}`)

  const measurementKeys = [
    'sourceBytes',
    'rangeRequests',
    'rangeBytes',
    'peakManagedBytes',
    'firstTileMilliseconds',
    'completionMilliseconds',
    'cancellationMilliseconds',
  ] as const
  exactRecord(value['measurements'], measurementKeys, 'Scenario measurements')
  const measurements = value['measurements']
  if (!record(measurements)) throw new Error('Scenario measurements are invalid.')
  nonNegativeNumber(measurements['sourceBytes'], 'Scenario source bytes')
  nonNegativeNumber(measurements['completionMilliseconds'], 'Scenario completion time')
  for (const key of measurementKeys.slice(1).filter((key) => key !== 'completionMilliseconds'))
    nonNegativeNumber(measurements[key], `Scenario measurement ${key}`, true)

  exactRecord(value['identities'], ['projectId', 'invocationIds'], 'Scenario identities')
  const identities = value['identities']
  if (!record(identities)) throw new Error('Scenario identities are invalid.')
  if (identities['projectId'] !== null) nonEmptyText(identities['projectId'], 'Scenario project ID')
  if (
    !Array.isArray(identities['invocationIds']) ||
    !identities['invocationIds'].every((id) => typeof id === 'string' && id.length > 0)
  )
    throw new Error('Scenario invocation IDs are invalid.')
  return value as unknown as ScenarioEvidenceV1
}

export default class ScenarioReporter implements Reporter {
  private readonly runs: ScenarioRunReportV1[] = []
  private outputDirectory = resolve('test-results/science')

  onBegin(config: FullConfig): void {
    const projectOutput = config.projects[0]?.outputDir
    this.outputDirectory =
      typeof projectOutput === 'string' && projectOutput.length > 0
        ? projectOutput
        : resolve(
            dirname(config.configFile ?? resolve('playwright.config.ts')),
            'test-results/science',
          )
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const attachment = result.attachments.find(({ name }) => name === SCENARIO_EVIDENCE_ATTACHMENT)
    if (attachment?.body === undefined) return
    const evidence = parseEvidence(attachment.body)
    this.runs.push({
      ...evidence,
      browser: test.parent.project()?.name ?? 'unknown',
      status: result.status,
      durationMilliseconds: result.duration,
      title: test.titlePath().join(' › '),
      errors: result.errors.map(({ message }) => message ?? 'Unknown test error'),
      failureArtifacts: result.attachments
        .filter(({ name }) => name !== SCENARIO_EVIDENCE_ATTACHMENT)
        .flatMap(({ path }) => (path === undefined ? [] : [path])),
    })
  }

  onEnd(result: FullResult): void {
    const matrix = scenarioCapabilityMatrix()
    const capabilities = REQUIRED_PRODUCT_CAPABILITIES.map((capability) => {
      const runs = this.runs.filter((run) => run.capabilities.includes(capability))
      return {
        capability,
        declaredScenarios: matrix.get(capability) ?? [],
        state:
          runs.length === 0
            ? ('not-run' as const)
            : runs.some(({ status }) => status !== 'passed')
              ? ('failed' as const)
              : ('passed' as const),
        executedRuns: runs.length,
        passedRuns: runs.filter(({ status }) => status === 'passed').length,
        failedRuns: runs.filter(({ status }) => status !== 'passed').length,
      }
    })
    const report = {
      schemaVersion: 1,
      status: result.status,
      generatedAt: new Date().toISOString(),
      runs: this.runs,
      capabilities,
    }
    const jsonPath = resolve(this.outputDirectory, 'scenario-report.json')
    mkdirSync(dirname(jsonPath), { recursive: true })
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    const rows = capabilities.map(
      ({ capability, declaredScenarios, state, executedRuns, passedRuns, failedRuns }) =>
        `| ${capability} | ${declaredScenarios.join(', ')} | ${state} | ${executedRuns} | ${passedRuns} | ${failedRuns} |`,
    )
    writeFileSync(
      resolve(this.outputDirectory, 'scenario-report.md'),
      [
        '# Scientific scenario report',
        '',
        `Overall Playwright status: **${result.status}**`,
        '',
        '| Capability | Declared scenarios | State | Runs | Passed | Failed |',
        '| --- | --- | --- | ---: | ---: | ---: |',
        ...rows,
        '',
        'Machine-readable measurements, tolerances, budgets, identities, and failure artifacts are in `scenario-report.json`.',
        '',
      ].join('\n'),
      'utf8',
    )
  }
}
