import {
  type AnalysisScriptDocumentV1,
  type AnalysisScriptTestResultV1,
  type ContentIntegrityV1,
  type LocalPluginInstallationV1,
  PLUGIN_LIMITS,
  type PluginJsonValue,
  type PluginManifestV1,
  type RecipeDocumentV1,
  type SandboxHostMessageV1,
  type SandboxLimitsV1,
  type SandboxWorkerMessageV1,
  type ScriptCapability,
  type ScriptPermissionGrantV1,
  type ScriptRunProvenanceV1,
  type ValidationIssue,
  type ValidationResult,
} from './types.js'
import {
  addIssue,
  byteLength,
  CAPABILITIES,
  COMPATIBILITY,
  isRecord,
  SEMVER,
  SHA256,
  sortedCapabilities,
  stringField,
  validateCapabilities,
  validateIdentifier,
  validateJson,
  validationResult,
} from './validation-helpers.js'

function validateIntegrity(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is ContentIntegrityV1 {
  if (
    !isRecord(value) ||
    value['algorithm'] !== 'sha256' ||
    typeof value['digest'] !== 'string' ||
    !SHA256.test(value['digest'])
  ) {
    addIssue(issues, path, 'Expected a lowercase SHA-256 integrity record.')
    return false
  }
  return true
}

function validateCompatibility(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is string {
  if (typeof value !== 'string' || value.length > 128 || !COMPATIBILITY.test(value.trim())) {
    addIssue(issues, path, 'Expected a bounded semantic compatibility range.')
    return false
  }
  return true
}

export function normalizeCompatibilityRange(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, ' ')
  if (!COMPATIBILITY.test(normalized)) throw new Error('Invalid compatibility range.')
  return normalized
}

function versionParts(value: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value)
  if (match === null) return undefined
  const [, major, minor, patch] = match
  if (major === undefined || minor === undefined || patch === undefined) return undefined
  return [Number(major), Number(minor), Number(patch)]
}

function compareVersion(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function satisfiesComparator(
  version: readonly [number, number, number],
  comparator: string,
): boolean {
  const match = /^(\^|~|>=|>|<=|<)?\s*(\d+\.\d+\.\d+)$/u.exec(comparator.trim())
  if (match === null) return false
  const operator = match[1] ?? '='
  const target = versionParts(match[2] ?? '')
  if (target === undefined) return false
  const compared = compareVersion(version, target)
  if (operator === '=') return compared === 0
  if (operator === '>') return compared > 0
  if (operator === '>=') return compared >= 0
  if (operator === '<') return compared < 0
  if (operator === '<=') return compared <= 0
  if (compared < 0) return false
  if (operator === '~') return version[0] === target[0] && version[1] === target[1]
  if (target[0] > 0) return version[0] === target[0]
  if (target[1] > 0) return version[0] === 0 && version[1] === target[1]
  return version[0] === 0 && version[1] === 0 && version[2] === target[2]
}

export function isVersionCompatible(range: string, version: string): boolean {
  const normalized = normalizeCompatibilityRange(range)
  if (normalized === '*') return SEMVER.test(version)
  const parsed = versionParts(version)
  if (parsed === undefined || !SEMVER.test(version)) return false
  const comparators = normalized.match(/(?:\^|~|>=|>|<=|<)?\s*\d+\.\d+\.\d+/gu)
  return comparators?.every((comparator) => satisfiesComparator(parsed, comparator)) === true
}

export function validatePluginManifest(value: unknown): ValidationResult<PluginManifestV1> {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'Expected an object.' }] }
  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) addIssue(issues, '', 'Manifest must be JSON serializable.')
    else if (byteLength(encoded) > PLUGIN_LIMITS.manifestBytes)
      addIssue(issues, '', 'Manifest exceeds byte limit.')
  } catch {
    addIssue(issues, '', 'Manifest must be JSON serializable.')
  }
  if (value['schemaVersion'] !== 1) addIssue(issues, '/schemaVersion', 'Expected schema version 1.')
  validateIdentifier(value['id'], '/id', issues)
  if (typeof value['version'] !== 'string' || !SEMVER.test(value['version']))
    addIssue(issues, '/version', 'Expected semantic version.')
  const title = stringField(value, 'title', issues, PLUGIN_LIMITS.titleCharacters)
  const description = stringField(value, 'description', issues, PLUGIN_LIMITS.descriptionCharacters)
  const author = stringField(value, 'author', issues, 256, true)
  const license = stringField(value, 'license', issues, 128, true)
  if (!['recipe', 'sandboxed-module', 'trusted-module'].includes(String(value['entryKind'])))
    addIssue(issues, '/entryKind', 'Unknown plugin entry kind.')
  validateCapabilities(value['requestedCapabilities'], '/requestedCapabilities', issues)
  const range = value['compatibility']
  if (!isRecord(range)) addIssue(issues, '/compatibility', 'Expected compatibility object.')
  else {
    validateCompatibility(range['pureJsImage'], '/compatibility/pureJsImage', issues)
    validateCompatibility(range['workbench'], '/compatibility/workbench', issues)
  }
  if (value['integrity'] !== undefined) validateIntegrity(value['integrity'], '/integrity', issues)
  const requested = Array.isArray(value['requestedCapabilities'])
    ? value['requestedCapabilities'].filter(
        (entry): entry is ScriptCapability =>
          typeof entry === 'string' && CAPABILITIES.has(entry as ScriptCapability),
      )
    : []
  return validationResult(issues, {
    schemaVersion: 1,
    id: typeof value['id'] === 'string' ? value['id'] : '',
    version: typeof value['version'] === 'string' ? value['version'] : '',
    title: title ?? '',
    description: description ?? '',
    ...(author === undefined ? {} : { author }),
    ...(license === undefined ? {} : { license }),
    entryKind:
      value['entryKind'] === 'recipe' || value['entryKind'] === 'trusted-module'
        ? value['entryKind']
        : 'sandboxed-module',
    requestedCapabilities: sortedCapabilities(requested),
    compatibility: {
      pureJsImage:
        isRecord(range) && typeof range['pureJsImage'] === 'string'
          ? range['pureJsImage'].trim()
          : '',
      workbench:
        isRecord(range) && typeof range['workbench'] === 'string' ? range['workbench'].trim() : '',
    },
    ...(validateIntegrity(value['integrity'], '/integrity', [])
      ? { integrity: value['integrity'] }
      : {}),
  })
}

export function validatePluginJsonValue(
  value: unknown,
  maximumBytes = PLUGIN_LIMITS.messageBytes,
): ValidationResult<PluginJsonValue> {
  const issues: ValidationIssue[] = []
  const valid = validateJson(value, '', issues)
  if (valid) {
    const encoded = JSON.stringify(value)
    if (byteLength(encoded) > maximumBytes) addIssue(issues, '', 'JSON value exceeds byte limit.')
  }
  return validationResult(issues, value as PluginJsonValue)
}

export function validateRecipeDocument(value: unknown): ValidationResult<RecipeDocumentV1> {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'Expected an object.' }] }
  if (value['schemaVersion'] !== 1 || value['kind'] !== 'recipe')
    addIssue(issues, '', 'Expected RecipeDocumentV1.')
  validateIdentifier(value['id'], '/id', issues)
  if (typeof value['version'] !== 'string' || !SEMVER.test(value['version']))
    addIssue(issues, '/version', 'Expected semantic version.')
  const title = stringField(value, 'title', issues, PLUGIN_LIMITS.titleCharacters)
  const description = stringField(
    value,
    'description',
    issues,
    PLUGIN_LIMITS.descriptionCharacters,
    true,
  )
  validateCapabilities(value['requestedCapabilities'], '/requestedCapabilities', issues)
  if (!Array.isArray(value['operations']) || value['operations'].length > 256)
    addIssue(issues, '/operations', 'Expected at most 256 recipe operations.')
  else
    value['operations'].forEach((operation, index) => {
      if (!isRecord(operation))
        addIssue(issues, `/operations/${index}`, 'Expected operation object.')
      else {
        validateIdentifier(operation['actionId'], `/operations/${index}/actionId`, issues)
        if (
          !Number.isSafeInteger(operation['actionVersion']) ||
          Number(operation['actionVersion']) < 1
        )
          addIssue(
            issues,
            `/operations/${index}/actionVersion`,
            'Expected a positive action version.',
          )
        validateJson(operation['input'], `/operations/${index}/input`, issues)
      }
    })
  const range = value['compatibility']
  if (!isRecord(range)) addIssue(issues, '/compatibility', 'Expected compatibility object.')
  else {
    validateCompatibility(range['pureJsImage'], '/compatibility/pureJsImage', issues)
    validateCompatibility(range['workbench'], '/compatibility/workbench', issues)
  }
  validateIntegrity(value['integrity'], '/integrity', issues)
  return validationResult(issues, {
    schemaVersion: 1,
    kind: 'recipe',
    id: typeof value['id'] === 'string' ? value['id'] : '',
    version: typeof value['version'] === 'string' ? value['version'] : '',
    title: title ?? '',
    ...(description === undefined ? {} : { description }),
    operations: Array.isArray(value['operations'])
      ? (value['operations'] as RecipeDocumentV1['operations'])
      : [],
    requestedCapabilities: Array.isArray(value['requestedCapabilities'])
      ? sortedCapabilities(value['requestedCapabilities'] as ScriptCapability[])
      : [],
    compatibility: {
      pureJsImage:
        isRecord(range) && typeof range['pureJsImage'] === 'string'
          ? range['pureJsImage'].trim()
          : '',
      workbench:
        isRecord(range) && typeof range['workbench'] === 'string' ? range['workbench'].trim() : '',
    },
    integrity: validateIntegrity(value['integrity'], '/integrity', [])
      ? value['integrity']
      : { algorithm: 'sha256', digest: ''.padStart(64, '0') },
  })
}

export function validateAnalysisScriptDocument(
  value: unknown,
): ValidationResult<AnalysisScriptDocumentV1> {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'Expected an object.' }] }
  if (value['schemaVersion'] !== 1 || value['kind'] !== 'analysis-script')
    addIssue(issues, '', 'Expected AnalysisScriptDocumentV1.')
  validateIdentifier(value['id'], '/id', issues)
  const title = stringField(value, 'title', issues, PLUGIN_LIMITS.titleCharacters)
  const description = stringField(
    value,
    'description',
    issues,
    PLUGIN_LIMITS.descriptionCharacters,
    true,
  )
  if (value['language'] !== 'javascript' && value['language'] !== 'typescript')
    addIssue(issues, '/language', 'Expected javascript or typescript.')
  if (
    typeof value['source'] !== 'string' ||
    byteLength(value['source']) > PLUGIN_LIMITS.sourceBytes
  )
    addIssue(issues, '/source', `Source exceeds ${PLUGIN_LIMITS.sourceBytes} bytes.`)
  const manifest = value['manifest']
  if (!isRecord(manifest)) addIssue(issues, '/manifest', 'Expected manifest object.')
  else {
    if (manifest['scriptApiVersion'] !== 1 || manifest['entrypoint'] !== 'main')
      addIssue(issues, '/manifest', 'Unsupported script API or entrypoint.')
    if (typeof manifest['deterministic'] !== 'boolean')
      addIssue(issues, '/manifest/deterministic', 'Expected deterministic boolean.')
    validateCapabilities(
      manifest['requestedCapabilities'],
      '/manifest/requestedCapabilities',
      issues,
    )
    validateCompatibility(
      manifest['pureJsImageCompatibility'],
      '/manifest/pureJsImageCompatibility',
      issues,
    )
    validateCompatibility(
      manifest['workbenchCompatibility'],
      '/manifest/workbenchCompatibility',
      issues,
    )
  }
  const tests = value['tests']
  if (!Array.isArray(tests) || tests.length > PLUGIN_LIMITS.tests)
    addIssue(issues, '/tests', `Expected at most ${PLUGIN_LIMITS.tests} tests.`)
  else
    tests.forEach((test, index) => {
      if (!isRecord(test)) addIssue(issues, `/tests/${index}`, 'Expected test object.')
      else {
        validateIdentifier(test['id'], `/tests/${index}/id`, issues)
        stringField(test, 'title', issues, PLUGIN_LIMITS.titleCharacters)
        validateIdentifier(test['fixtureId'], `/tests/${index}/fixtureId`, issues)
        if (
          validateJson(test['expected'], `/tests/${index}/expected`, issues) &&
          byteLength(JSON.stringify(test['expected'])) > PLUGIN_LIMITS.testValueBytes
        )
          addIssue(issues, `/tests/${index}/expected`, 'Expected value exceeds byte limit.')
      }
    })
  validateIntegrity(value['integrity'], '/integrity', issues)
  const normalizedManifest = isRecord(manifest)
    ? {
        scriptApiVersion: 1 as const,
        requestedCapabilities: Array.isArray(manifest['requestedCapabilities'])
          ? sortedCapabilities(manifest['requestedCapabilities'] as ScriptCapability[])
          : [],
        pureJsImageCompatibility:
          typeof manifest['pureJsImageCompatibility'] === 'string'
            ? manifest['pureJsImageCompatibility'].trim()
            : '',
        workbenchCompatibility:
          typeof manifest['workbenchCompatibility'] === 'string'
            ? manifest['workbenchCompatibility'].trim()
            : '',
        entrypoint: 'main' as const,
        deterministic: manifest['deterministic'] === true,
      }
    : {
        scriptApiVersion: 1 as const,
        requestedCapabilities: [],
        pureJsImageCompatibility: '',
        workbenchCompatibility: '',
        entrypoint: 'main' as const,
        deterministic: true,
      }
  return validationResult(issues, {
    schemaVersion: 1,
    kind: 'analysis-script',
    id: typeof value['id'] === 'string' ? value['id'] : '',
    title: title ?? '',
    ...(description === undefined ? {} : { description }),
    language: value['language'] === 'typescript' ? 'typescript' : 'javascript',
    source: typeof value['source'] === 'string' ? value['source'] : '',
    manifest: normalizedManifest,
    tests: Array.isArray(tests) ? (tests as AnalysisScriptDocumentV1['tests']) : [],
    integrity: validateIntegrity(value['integrity'], '/integrity', [])
      ? value['integrity']
      : { algorithm: 'sha256', digest: ''.padStart(64, '0') },
  })
}

export function validatePermissionGrant(value: unknown): ValidationResult<ScriptPermissionGrantV1> {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'Expected an object.' }] }
  if (value['schemaVersion'] !== 1) addIssue(issues, '/schemaVersion', 'Expected schema version 1.')
  validateIdentifier(value['scriptId'], '/scriptId', issues)
  if (typeof value['sourceDigest'] !== 'string' || !SHA256.test(value['sourceDigest']))
    addIssue(issues, '/sourceDigest', 'Expected SHA-256 digest.')
  validateCapabilities(value['grantedCapabilities'], '/grantedCapabilities', issues)
  validateCapabilities(value['deniedCapabilities'], '/deniedCapabilities', issues)
  const overlap = new Set(
    Array.isArray(value['grantedCapabilities']) ? value['grantedCapabilities'] : [],
  )
  if (
    Array.isArray(value['deniedCapabilities']) &&
    value['deniedCapabilities'].some((entry) => overlap.has(entry))
  )
    addIssue(issues, '', 'A capability cannot be both granted and denied.')
  return validationResult(issues, {
    schemaVersion: 1,
    scriptId: typeof value['scriptId'] === 'string' ? value['scriptId'] : '',
    sourceDigest: typeof value['sourceDigest'] === 'string' ? value['sourceDigest'] : '',
    grantedCapabilities: Array.isArray(value['grantedCapabilities'])
      ? sortedCapabilities(value['grantedCapabilities'] as ScriptCapability[])
      : [],
    deniedCapabilities: Array.isArray(value['deniedCapabilities'])
      ? sortedCapabilities(value['deniedCapabilities'] as ScriptCapability[])
      : [],
  })
}

export function validateLocalInstallation(
  value: unknown,
): ValidationResult<LocalPluginInstallationV1> {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'Expected an object.' }] }
  if (value['schemaVersion'] !== 1) addIssue(issues, '/schemaVersion', 'Expected schema version 1.')
  validateIdentifier(value['pluginId'], '/pluginId', issues)
  if (typeof value['pluginVersion'] !== 'string' || !SEMVER.test(value['pluginVersion']))
    addIssue(issues, '/pluginVersion', 'Expected semantic version.')
  if (typeof value['contentDigest'] !== 'string' || !SHA256.test(value['contentDigest']))
    addIssue(issues, '/contentDigest', 'Expected SHA-256 digest.')
  if (value['installedKind'] !== 'recipe' && value['installedKind'] !== 'sandboxed-script')
    addIssue(issues, '/installedKind', 'Unknown installation kind.')
  if (typeof value['enabled'] !== 'boolean') addIssue(issues, '/enabled', 'Expected boolean.')
  const grant = validatePermissionGrant(value['permissionGrant'])
  issues.push(
    ...grant.issues.map(({ path, message }) => ({ path: `/permissionGrant${path}`, message })),
  )
  if (
    value['installedKind'] === 'sandboxed-script' &&
    grant.value !== undefined &&
    value['pluginId'] !== grant.value.scriptId
  )
    addIssue(issues, '/permissionGrant/scriptId', 'Installation and permission identities differ.')
  return validationResult(issues, {
    schemaVersion: 1,
    pluginId: typeof value['pluginId'] === 'string' ? value['pluginId'] : '',
    pluginVersion: typeof value['pluginVersion'] === 'string' ? value['pluginVersion'] : '',
    contentDigest: typeof value['contentDigest'] === 'string' ? value['contentDigest'] : '',
    installedKind: value['installedKind'] === 'recipe' ? 'recipe' : 'sandboxed-script',
    permissionGrant: grant.value ?? {
      schemaVersion: 1,
      scriptId: '',
      sourceDigest: '',
      grantedCapabilities: [],
      deniedCapabilities: [],
    },
    enabled: value['enabled'] === true,
  })
}

export function validateScriptTestResult(
  value: unknown,
): ValidationResult<AnalysisScriptTestResultV1> {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'Expected an object.' }] }
  if (value['schemaVersion'] !== 1) addIssue(issues, '/schemaVersion', 'Expected schema version 1.')
  validateIdentifier(value['testId'], '/testId', issues)
  if (!['passed', 'failed', 'cancelled', 'limit-exceeded'].includes(String(value['status'])))
    addIssue(issues, '/status', 'Unknown script test status.')
  if (value['output'] !== undefined) {
    if (
      validateJson(value['output'], '/output', issues) &&
      byteLength(JSON.stringify(value['output'])) > PLUGIN_LIMITS.testValueBytes
    )
      addIssue(issues, '/output', 'Test output exceeds byte limit.')
  }
  if (
    !Array.isArray(value['issues']) ||
    value['issues'].length > 128 ||
    value['issues'].some((entry) => typeof entry !== 'string' || entry.length > 4_096)
  )
    addIssue(issues, '/issues', 'Expected at most 128 bounded issue strings.')
  return validationResult(issues, {
    schemaVersion: 1,
    testId: typeof value['testId'] === 'string' ? value['testId'] : '',
    status: ['passed', 'cancelled', 'limit-exceeded'].includes(String(value['status']))
      ? (value['status'] as 'passed' | 'cancelled' | 'limit-exceeded')
      : 'failed',
    ...(value['output'] === undefined ? {} : { output: value['output'] as never }),
    issues: Array.isArray(value['issues'])
      ? value['issues'].filter((entry): entry is string => typeof entry === 'string')
      : [],
  })
}

export function validateScriptProvenance(value: unknown): ValidationResult<ScriptRunProvenanceV1> {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'Expected an object.' }] }
  if (value['schemaVersion'] !== 1) addIssue(issues, '/schemaVersion', 'Expected schema version 1.')
  validateIdentifier(value['scriptId'], '/scriptId', issues)
  validateIntegrity(value['sourceHash'], '/sourceHash', issues)
  const grant = validatePermissionGrant(value['permissions'])
  issues.push(
    ...grant.issues.map(({ path, message }) => ({ path: `/permissions${path}`, message })),
  )
  const references = value['references']
  if (!Array.isArray(references) || references.length > PLUGIN_LIMITS.provenanceReferences)
    addIssue(
      issues,
      '/references',
      `Expected at most ${PLUGIN_LIMITS.provenanceReferences} references.`,
    )
  else
    references.forEach((reference, index) => {
      if (!isRecord(reference))
        addIssue(issues, `/references/${index}`, 'Expected reference object.')
      else {
        if (
          !['action', 'dataset', 'result', 'roi', 'source', 'workspace'].includes(
            String(reference['kind']),
          )
        )
          addIssue(issues, `/references/${index}/kind`, 'Unknown provenance reference kind.')
        if (typeof reference['id'] !== 'string' || reference['id'].length > 256)
          addIssue(issues, `/references/${index}/id`, 'Expected bounded reference id.')
      }
    })
  if (!Array.isArray(value['actionTrace']) || value['actionTrace'].length > 1_000)
    addIssue(issues, '/actionTrace', 'Expected at most 1000 action trace entries.')
  if (value['resultSummary'] !== undefined)
    validateJson(value['resultSummary'], '/resultSummary', issues)
  if (!isRecord(value['manifest'])) addIssue(issues, '/manifest', 'Expected script manifest.')
  return issues.length === 0
    ? { ok: true, value: value as unknown as ScriptRunProvenanceV1, issues }
    : { ok: false, issues }
}

export function validateSandboxLimits(value: unknown): ValidationResult<SandboxLimitsV1> {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'Expected an object.' }] }
  const ranges = {
    memoryBytes: [1_048_576, 268_435_456],
    stackBytes: [65_536, 8_388_608],
    deadlineMilliseconds: [10, 60_000],
    sourceBytes: [1, PLUGIN_LIMITS.sourceBytes],
    outputBytes: [1, PLUGIN_LIMITS.messageBytes],
    messages: [1, 10_000],
    messageBytes: [256, PLUGIN_LIMITS.messageBytes],
    apiCalls: [1, 1_000],
    consoleLines: [0, 1_000],
  } as const
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    const candidate = value[key]
    if (
      !Number.isSafeInteger(candidate) ||
      Number(candidate) < minimum ||
      Number(candidate) > maximum
    )
      addIssue(issues, `/${key}`, `Expected integer from ${minimum} to ${maximum}.`)
  }
  return validationResult(issues, value as unknown as SandboxLimitsV1)
}

function validateSandboxMessage(
  value: unknown,
  worker: boolean,
): ValidationResult<SandboxHostMessageV1 | SandboxWorkerMessageV1> {
  const issues: ValidationIssue[] = []
  if (!isRecord(value))
    return { ok: false, issues: [{ path: '', message: 'Expected message object.' }] }
  let encoded = ''
  try {
    encoded = JSON.stringify(value)
  } catch {
    addIssue(issues, '', 'Message must be JSON serializable.')
  }
  if (byteLength(encoded) > PLUGIN_LIMITS.messageBytes)
    addIssue(issues, '', 'Message exceeds byte limit.')
  if (value['schemaVersion'] !== 1 || typeof value['kind'] !== 'string')
    addIssue(issues, '', 'Malformed sandbox envelope.')
  const kinds = worker
    ? ['sandbox.ready', 'sandbox.capability-request', 'sandbox.log', 'sandbox.complete']
    : ['sandbox.start', 'sandbox.cancel', 'sandbox.capability-result']
  if (!kinds.includes(String(value['kind'])))
    addIssue(issues, '/kind', 'Unexpected sandbox message kind.')
  if (value['kind'] !== 'sandbox.ready')
    validateIdentifier(value['requestId'], '/requestId', issues)
  if (value['kind'] === 'sandbox.start') {
    issues.push(
      ...validateAnalysisScriptDocument(value['document']).issues.map(({ path, message }) => ({
        path: `/document${path}`,
        message,
      })),
      ...validatePermissionGrant(value['permissionGrant']).issues.map(({ path, message }) => ({
        path: `/permissionGrant${path}`,
        message,
      })),
      ...validateSandboxLimits(value['limits']).issues.map(({ path, message }) => ({
        path: `/limits${path}`,
        message,
      })),
    )
    validateJson(value['api'], '/api', issues)
  }
  if (value['kind'] === 'sandbox.capability-request') {
    validateIdentifier(value['capabilityRequestId'], '/capabilityRequestId', issues)
    if (typeof value['api'] !== 'string' || value['api'].length > 128)
      addIssue(issues, '/api', 'Expected bounded API name.')
    validateJson(value['input'], '/input', issues)
  }
  if (value['kind'] === 'sandbox.capability-result') {
    validateIdentifier(value['capabilityRequestId'], '/capabilityRequestId', issues)
    if (typeof value['ok'] !== 'boolean') addIssue(issues, '/ok', 'Expected boolean.')
    if (value['value'] !== undefined) validateJson(value['value'], '/value', issues)
    if (
      value['error'] !== undefined &&
      (typeof value['error'] !== 'string' || value['error'].length > 4_096)
    )
      addIssue(issues, '/error', 'Expected bounded error.')
  }
  if (
    value['kind'] === 'sandbox.log' &&
    (typeof value['message'] !== 'string' || value['message'].length > 4_096)
  )
    addIssue(issues, '/message', 'Expected bounded log message.')
  if (value['kind'] === 'sandbox.complete') {
    if (!['completed', 'cancelled', 'failed', 'limit-exceeded'].includes(String(value['status'])))
      addIssue(issues, '/status', 'Unknown completion status.')
    if (value['output'] !== undefined) validateJson(value['output'], '/output', issues)
  }
  return issues.length === 0
    ? {
        ok: true,
        value: value as unknown as SandboxHostMessageV1 | SandboxWorkerMessageV1,
        issues,
      }
    : { ok: false, issues }
}

export function validateSandboxHostMessage(value: unknown): ValidationResult<SandboxHostMessageV1> {
  return validateSandboxMessage(value, false) as ValidationResult<SandboxHostMessageV1>
}

export function validateSandboxWorkerMessage(
  value: unknown,
): ValidationResult<SandboxWorkerMessageV1> {
  return validateSandboxMessage(value, true) as ValidationResult<SandboxWorkerMessageV1>
}
