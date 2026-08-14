import {
  CORPUS_SCHEMA_VERSION,
  type CorpusManifestV1,
  type CorpusStatus,
  type CorpusValidationIssue,
  type CorpusValidationResult,
  type ExampleScenarioV1,
  type ExampleWorkflowStepAction,
  type ScenarioCapability,
  type ScenarioTestTier,
} from './types.js'

const STATUSES = new Set<CorpusStatus>([
  'enabled',
  'candidate',
  'scheduled',
  'excluded',
  'disabled',
])
const SHA256 = /^[a-f0-9]{64}$/
const SPDX_OR_PROJECT_LICENSE = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/
const SEMANTIC_ID = /^[a-z0-9][a-z0-9.-]*$/
const TEST_TIERS = new Set<ScenarioTestTier>([
  'pr',
  'main',
  'nightly',
  'scheduled',
  'manual',
  'local-expensive',
])
const STEP_ACTIONS = new Set<ExampleWorkflowStepAction>([
  'gallery.open',
  'source.inspect',
  'viewport.inspect',
  'roi.measure',
  'analysis.core',
  'analysis.particles',
  'analysis.watershed',
  'analysis.fft',
  'analysis.surface',
  'analysis.stack',
  'analysis.batch',
  'script.test',
  'project.replay',
  'lifecycle.hostile',
  'accessibility.scan',
  'visual.capture',
])
const CAPABILITIES = new Set<ScenarioCapability>([
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
])

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
  issues: CorpusValidationIssue[],
): void {
  const keys = new Set(allowed)
  for (const key of Object.keys(value))
    if (!keys.has(key)) issues.push({ path: `${path}/${key}`, message: 'Unknown property.' })
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, path: string, issues: CorpusValidationIssue[]): string {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push({ path, message: 'Expected a non-empty string.' })
    return ''
  }
  return value.trim()
}

function stringArray(
  value: unknown,
  path: string,
  issues: CorpusValidationIssue[],
): readonly string[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'Expected an array.' })
    return []
  }
  return value.map((item, index) => text(item, `${path}/${index}`, issues))
}

function validHttps(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function expectedResults(value: unknown, path: string, issues: CorpusValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, message: 'At least one expected-result assertion is required.' })
    return
  }
  value.forEach((assertion, index) => {
    const assertionPath = `${path}/${index}`
    if (!record(assertion)) {
      issues.push({ path: assertionPath, message: 'Expected an assertion object.' })
      return
    }
    rejectUnknownKeys(
      assertion,
      ['id', 'level', 'description', 'value', 'tolerance', 'unit'],
      assertionPath,
      issues,
    )
    const id = text(assertion['id'], `${assertionPath}/id`, issues)
    if (!SEMANTIC_ID.test(id))
      issues.push({ path: `${assertionPath}/id`, message: 'Assertion ID is malformed.' })
    text(assertion['description'], `${assertionPath}/description`, issues)
    if (
      !['exact', 'tolerance', 'structural', 'product', 'performance'].includes(
        String(assertion['level']),
      )
    )
      issues.push({ path: `${assertionPath}/level`, message: 'Invalid correctness level.' })
    if (
      assertion['value'] !== undefined &&
      !['string', 'number', 'boolean'].includes(typeof assertion['value'])
    )
      issues.push({ path: `${assertionPath}/value`, message: 'Expected a JSON scalar.' })
    if (typeof assertion['value'] === 'number' && !Number.isFinite(assertion['value']))
      issues.push({ path: `${assertionPath}/value`, message: 'Expected a finite number.' })
    if (
      assertion['tolerance'] !== undefined &&
      (typeof assertion['tolerance'] !== 'number' ||
        !Number.isFinite(assertion['tolerance']) ||
        assertion['tolerance'] < 0)
    )
      issues.push({ path: `${assertionPath}/tolerance`, message: 'Invalid tolerance.' })
    if (assertion['unit'] !== undefined) text(assertion['unit'], `${assertionPath}/unit`, issues)
  })
}

function validateWorkflows(value: unknown, path: string, issues: CorpusValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, message: 'At least one bounded workflow is required.' })
    return
  }
  value.forEach((workflow, index) => {
    const workflowPath = `${path}/${index}`
    if (!record(workflow)) {
      issues.push({ path: workflowPath, message: 'Expected a workflow object.' })
      return
    }
    rejectUnknownKeys(
      workflow,
      ['id', 'title', 'summary', 'artifactId', 'artifactKind', 'steps', 'oracle', 'expected'],
      workflowPath,
      issues,
    )
    const id = text(workflow['id'], `${workflowPath}/id`, issues)
    if (!SEMANTIC_ID.test(id))
      issues.push({ path: `${workflowPath}/id`, message: 'Workflow ID is malformed.' })
    for (const key of ['title', 'summary', 'artifactId'])
      text(workflow[key], `${workflowPath}/${key}`, issues)
    if (!['recipe', 'script'].includes(String(workflow['artifactKind'])))
      issues.push({ path: `${workflowPath}/artifactKind`, message: 'Invalid artifact kind.' })
    if (!Array.isArray(workflow['steps']) || workflow['steps'].length === 0)
      issues.push({ path: `${workflowPath}/steps`, message: 'Workflow steps are required.' })
    else
      workflow['steps'].forEach((step, stepIndex) => {
        const stepPath = `${workflowPath}/steps/${stepIndex}`
        if (!record(step)) {
          issues.push({ path: stepPath, message: 'Expected a workflow step object.' })
          return
        }
        rejectUnknownKeys(step, ['id', 'action', 'description'], stepPath, issues)
        const stepId = text(step['id'], `${stepPath}/id`, issues)
        if (!SEMANTIC_ID.test(stepId))
          issues.push({ path: `${stepPath}/id`, message: 'Workflow step ID is malformed.' })
        if (
          typeof step['action'] !== 'string' ||
          !STEP_ACTIONS.has(step['action'] as ExampleWorkflowStepAction)
        )
          issues.push({ path: `${stepPath}/action`, message: 'Unknown workflow step action.' })
        text(step['description'], `${stepPath}/description`, issues)
      })
    const oracle = workflow['oracle']
    if (!record(oracle))
      issues.push({ path: `${workflowPath}/oracle`, message: 'Oracle reference is required.' })
    else {
      rejectUnknownKeys(
        oracle,
        ['id', 'implementation', 'version', 'tolerance'],
        `${workflowPath}/oracle`,
        issues,
      )
      for (const key of ['id', 'implementation', 'version'])
        text(oracle[key], `${workflowPath}/oracle/${key}`, issues)
      if (
        oracle['tolerance'] !== undefined &&
        (typeof oracle['tolerance'] !== 'number' ||
          !Number.isFinite(oracle['tolerance']) ||
          oracle['tolerance'] < 0)
      )
        issues.push({
          path: `${workflowPath}/oracle/tolerance`,
          message: 'Invalid oracle tolerance.',
        })
    }
    expectedResults(workflow['expected'], `${workflowPath}/expected`, issues)
  })
}

function validateBudgets(value: unknown, path: string, issues: CorpusValidationIssue[]): void {
  if (!record(value)) {
    issues.push({ path, message: 'Explicit scenario budgets are required.' })
    return
  }
  const keys = [
    'maxSourceBytes',
    'maxRemoteBytes',
    'maxExpandedBytes',
    'maxArchiveFiles',
    'maxFirstUsefulTileMilliseconds',
    'maxCancellationMilliseconds',
    'maxCompletionMilliseconds',
    'maxPeakManagedBytes',
    'maxRangeRequests',
  ]
  rejectUnknownKeys(value, keys, path, issues)
  for (const key of keys)
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0)
      issues.push({ path: `${path}/${key}`, message: 'Expected a non-negative safe integer.' })
}

function validateTestPlan(value: unknown, path: string, issues: CorpusValidationIssue[]): void {
  if (!record(value)) {
    issues.push({ path, message: 'Scenario test plan is required.' })
    return
  }
  rejectUnknownKeys(
    value,
    [
      'tier',
      'capabilities',
      'screenshotStates',
      'accessibility',
      'projectReplay',
      'agentEvalCaseIds',
    ],
    path,
    issues,
  )
  if (typeof value['tier'] !== 'string' || !TEST_TIERS.has(value['tier'] as ScenarioTestTier))
    issues.push({ path: `${path}/tier`, message: 'Unknown scenario test tier.' })
  const capabilities = stringArray(value['capabilities'], `${path}/capabilities`, issues)
  for (const capability of capabilities)
    if (!CAPABILITIES.has(capability as ScenarioCapability))
      issues.push({ path: `${path}/capabilities`, message: `Unknown capability ${capability}.` })
  stringArray(value['screenshotStates'], `${path}/screenshotStates`, issues)
  stringArray(value['agentEvalCaseIds'], `${path}/agentEvalCaseIds`, issues)
  for (const key of ['accessibility', 'projectReplay'])
    if (typeof value[key] !== 'boolean')
      issues.push({ path: `${path}/${key}`, message: 'Expected a boolean.' })
}

function validateScenario(value: unknown, index: number, issues: CorpusValidationIssue[]): void {
  const path = `/scenarios/${index}`
  if (!record(value)) {
    issues.push({ path, message: 'Expected an example scenario object.' })
    return
  }
  rejectUnknownKeys(
    value,
    [
      'schemaVersion',
      'id',
      'status',
      'tier',
      'statusReason',
      'title',
      'summary',
      'modality',
      'vendor',
      'format',
      'sizeClass',
      'calibration',
      'source',
      'license',
      'preview',
      'tags',
      'learningGoals',
      'workflows',
      'expected',
      'budgets',
      'testPlan',
      'testTags',
      'verifiedAt',
    ],
    path,
    issues,
  )
  if (value['schemaVersion'] !== CORPUS_SCHEMA_VERSION)
    issues.push({ path: `${path}/schemaVersion`, message: 'Unsupported scenario schema version.' })
  const id = text(value['id'], `${path}/id`, issues)
  if (!SEMANTIC_ID.test(id))
    issues.push({ path: `${path}/id`, message: 'Use a stable lowercase semantic ID.' })
  const status = value['status']
  if (typeof status !== 'string' || !STATUSES.has(status as CorpusStatus))
    issues.push({ path: `${path}/status`, message: 'Unsupported corpus status.' })
  if (!['generated', 'bundled', 'hosted', 'external'].includes(String(value['tier'])))
    issues.push({ path: `${path}/tier`, message: 'Unsupported corpus tier.' })
  if (!['tiny', 'small', 'medium', 'large', 'very-large'].includes(String(value['sizeClass'])))
    issues.push({ path: `${path}/sizeClass`, message: 'Unsupported size class.' })
  if (value['vendor'] !== undefined) text(value['vendor'], `${path}/vendor`, issues)
  if (value['verifiedAt'] !== undefined) text(value['verifiedAt'], `${path}/verifiedAt`, issues)
  for (const key of ['title', 'summary', 'modality', 'format', 'statusReason', 'calibration'])
    text(value[key], `${path}/${key}`, issues)
  stringArray(value['tags'], `${path}/tags`, issues)
  stringArray(value['learningGoals'], `${path}/learningGoals`, issues)
  stringArray(value['testTags'], `${path}/testTags`, issues)

  const license = value['license']
  if (!record(license)) issues.push({ path: `${path}/license`, message: 'License is required.' })
  else {
    rejectUnknownKeys(
      license,
      ['id', 'name', 'url', 'attribution', 'citation', 'redistribution', 'verifiedAt'],
      `${path}/license`,
      issues,
    )
    const licenseId = text(license['id'], `${path}/license/id`, issues)
    if (!SPDX_OR_PROJECT_LICENSE.test(licenseId))
      issues.push({ path: `${path}/license/id`, message: 'License ID is malformed.' })
    text(license['name'], `${path}/license/name`, issues)
    text(license['attribution'], `${path}/license/attribution`, issues)
    const licenseUrl = text(license['url'], `${path}/license/url`, issues)
    if (licenseUrl !== '' && !validHttps(licenseUrl))
      issues.push({ path: `${path}/license/url`, message: 'License URL must use HTTPS.' })
    if (!['approved', 'review-required', 'prohibited'].includes(String(license['redistribution'])))
      issues.push({
        path: `${path}/license/redistribution`,
        message: 'Invalid redistribution decision.',
      })
    if (license['citation'] !== undefined) {
      const citation = text(license['citation'], `${path}/license/citation`, issues)
      if (citation !== '' && !validHttps(citation))
        issues.push({ path: `${path}/license/citation`, message: 'Citation URL must use HTTPS.' })
    }
    if (license['verifiedAt'] !== undefined)
      text(license['verifiedAt'], `${path}/license/verifiedAt`, issues)
  }

  const preview = value['preview']
  if (!record(preview)) issues.push({ path: `${path}/preview`, message: 'Preview is required.' })
  else {
    rejectUnknownKeys(preview, ['kind', 'value', 'alt'], `${path}/preview`, issues)
    if (!['generated-pattern', 'bundled-image'].includes(String(preview['kind'])))
      issues.push({ path: `${path}/preview/kind`, message: 'Invalid preview kind.' })
    text(preview['value'], `${path}/preview/value`, issues)
    text(preview['alt'], `${path}/preview/alt`, issues)
  }

  const source = value['source']
  if (!record(source)) {
    issues.push({ path: `${path}/source`, message: 'Source is required.' })
    return
  }
  const sourceKind = source['kind']
  if (!['generated', 'bundled', 'hosted', 'external'].includes(String(sourceKind)))
    issues.push({ path: `${path}/source/kind`, message: 'Invalid source kind.' })
  if (sourceKind !== 'generated') {
    rejectUnknownKeys(source, ['kind', 'landingPage', 'files'], `${path}/source`, issues)
    const landingPage = text(source['landingPage'], `${path}/source/landingPage`, issues)
    if (landingPage !== '' && !validHttps(landingPage))
      issues.push({ path: `${path}/source/landingPage`, message: 'Landing page must use HTTPS.' })
  } else {
    rejectUnknownKeys(source, ['kind', 'generatorId', 'files'], `${path}/source`, issues)
    text(source['generatorId'], `${path}/source/generatorId`, issues)
  }
  if (sourceKind !== value['tier'])
    issues.push({ path: `${path}/tier`, message: 'Scenario tier must match its source kind.' })
  if (!Array.isArray(source['files']) || source['files'].length === 0) {
    issues.push({
      path: `${path}/source/files`,
      message: 'At least one exact file record is required.',
    })
    return
  }
  source['files'].forEach((file, fileIndex) => {
    const filePath = `${path}/source/files/${fileIndex}`
    if (!record(file)) {
      issues.push({ path: filePath, message: 'Expected a file record.' })
      return
    }
    rejectUnknownKeys(
      file,
      ['path', 'sizeBytes', 'mediaType', 'sha256', 'sourceChecksum', 'url', 'delivery'],
      filePath,
      issues,
    )
    const selectedPath = text(file['path'], `${filePath}/path`, issues)
    if (
      selectedPath.startsWith('/') ||
      selectedPath.split('/').includes('..') ||
      selectedPath.includes('\\')
    )
      issues.push({ path: `${filePath}/path`, message: 'Unsafe selected-file path.' })
    text(file['mediaType'], `${filePath}/mediaType`, issues)
    if (
      file['sizeBytes'] !== undefined &&
      (!Number.isSafeInteger(file['sizeBytes']) || Number(file['sizeBytes']) < 0)
    )
      issues.push({
        path: `${filePath}/sizeBytes`,
        message: 'Expected a non-negative safe integer.',
      })
    const sha256 = file['sha256']
    if (sha256 !== undefined && (typeof sha256 !== 'string' || !SHA256.test(sha256)))
      issues.push({ path: `${filePath}/sha256`, message: 'Expected a lowercase SHA-256 digest.' })
    const url = file['url']
    if (url !== undefined && (typeof url !== 'string' || !validHttps(url)))
      issues.push({ path: `${filePath}/url`, message: 'File URL must use HTTPS.' })
    if (!['generated', 'bundled', 'download', 'range'].includes(String(file['delivery'])))
      issues.push({ path: `${filePath}/delivery`, message: 'Invalid delivery mode.' })
    if (sourceKind === 'generated' && file['delivery'] !== 'generated')
      issues.push({
        path: `${filePath}/delivery`,
        message: 'Generated sources require generated delivery.',
      })
    if (sourceKind === 'bundled' && file['delivery'] !== 'bundled')
      issues.push({
        path: `${filePath}/delivery`,
        message: 'Bundled sources require bundled delivery.',
      })
    if (
      (sourceKind === 'hosted' || sourceKind === 'external') &&
      file['delivery'] !== 'download' &&
      file['delivery'] !== 'range'
    )
      issues.push({
        path: `${filePath}/delivery`,
        message: 'Hosted and external sources require download or range delivery.',
      })
    if (file['sourceChecksum'] !== undefined)
      text(file['sourceChecksum'], `${filePath}/sourceChecksum`, issues)
    if (
      status === 'enabled' &&
      (sourceKind === 'hosted' || sourceKind === 'external') &&
      (typeof sha256 !== 'string' ||
        typeof url !== 'string' ||
        !Number.isSafeInteger(file['sizeBytes']))
    )
      issues.push({
        path: filePath,
        message: 'Enabled external files require an immutable HTTPS URL and SHA-256.',
      })
    if (
      status === 'enabled' &&
      sourceKind === 'bundled' &&
      (typeof sha256 !== 'string' || !Number.isSafeInteger(file['sizeBytes']))
    )
      issues.push({
        path: filePath,
        message: 'Enabled bundled files require an exact byte size and SHA-256.',
      })
  })
  if (status === 'enabled' && record(license) && license['redistribution'] !== 'approved')
    issues.push({
      path: `${path}/license`,
      message: 'Enabled scenarios require approved redistribution.',
    })
  validateWorkflows(value['workflows'], `${path}/workflows`, issues)
  expectedResults(value['expected'], `${path}/expected`, issues)
  validateBudgets(value['budgets'], `${path}/budgets`, issues)
  validateTestPlan(value['testPlan'], `${path}/testPlan`, issues)
}

export function validateCorpusManifest(value: unknown): CorpusValidationResult<CorpusManifestV1> {
  const issues: CorpusValidationIssue[] = []
  if (!record(value))
    return { ok: false, issues: [{ path: '', message: 'Expected a corpus manifest.' }] }
  rejectUnknownKeys(value, ['schemaVersion', 'generatedAt', 'scenarios'], '', issues)
  if (value['schemaVersion'] !== CORPUS_SCHEMA_VERSION)
    issues.push({ path: '/schemaVersion', message: 'Unsupported corpus schema version.' })
  text(value['generatedAt'], '/generatedAt', issues)
  const scenarios = value['scenarios']
  if (!Array.isArray(scenarios)) issues.push({ path: '/scenarios', message: 'Expected an array.' })
  else {
    scenarios.forEach((scenario, index) => {
      validateScenario(scenario, index, issues)
    })
    const ids = scenarios
      .filter(record)
      .map((scenario) => scenario['id'])
      .filter((id): id is string => typeof id === 'string')
    if (new Set(ids).size !== ids.length)
      issues.push({ path: '/scenarios', message: 'Scenario IDs must be unique.' })
  }
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: value as unknown as CorpusManifestV1, issues: [] }
}

export function normalizeCorpusManifest(value: unknown): CorpusManifestV1 {
  const result = validateCorpusManifest(value)
  if (!result.ok) {
    throw new Error(
      result.issues.map(({ path, message }) => `${path || '/'}: ${message}`).join('\n'),
    )
  }
  return Object.freeze({
    ...result.value,
    scenarios: Object.freeze(result.value.scenarios.map((scenario) => freezeScenario(scenario))),
  })
}

function freezeScenario(scenario: ExampleScenarioV1): ExampleScenarioV1 {
  return Object.freeze({
    ...scenario,
    tags: Object.freeze([...scenario.tags]),
    learningGoals: Object.freeze([...scenario.learningGoals]),
    testTags: Object.freeze([...scenario.testTags]),
    workflows: Object.freeze(
      scenario.workflows.map((workflow) =>
        Object.freeze({
          ...workflow,
          steps: Object.freeze(workflow.steps.map((step) => Object.freeze({ ...step }))),
          oracle: Object.freeze({ ...workflow.oracle }),
          expected: Object.freeze([...workflow.expected]),
        }),
      ),
    ),
    expected: Object.freeze([...scenario.expected]),
    source: Object.freeze({
      ...scenario.source,
      files: Object.freeze(scenario.source.files.map((file) => Object.freeze({ ...file }))),
    }),
    license: Object.freeze({ ...scenario.license }),
    preview: Object.freeze({ ...scenario.preview }),
    budgets: Object.freeze({ ...scenario.budgets }),
    testPlan: Object.freeze({
      ...scenario.testPlan,
      capabilities: Object.freeze([...scenario.testPlan.capabilities]),
      screenshotStates: Object.freeze([...scenario.testPlan.screenshotStates]),
      agentEvalCaseIds: Object.freeze([...scenario.testPlan.agentEvalCaseIds]),
    }),
  })
}
