import { recipeContentIntegrity, scriptContentIntegrity } from './hash.js'
import {
  type AnalysisScriptDocumentV1,
  type AnalysisScriptTestResultV1,
  type LocalPluginInstallationV1,
  PLUGIN_LIMITS,
  type RecipeDocumentV1,
  type ValidationIssue,
  type ValidationResult,
} from './types.js'
import { utf8ByteLength } from './utf8.js'
import {
  validateAnalysisScriptDocument,
  validateLocalInstallation,
  validateRecipeDocument,
  validateScriptTestResult,
} from './validation.js'

export const SCRIPT_STUDIO_SCHEMA_VERSION = 1 as const
export const SCRIPT_STUDIO_LIMITS = Object.freeze({
  records: 256,
  exportBytes: 768 * 1024,
  editorStateBytes: 16 * 1024,
  logs: 256,
  logCharacters: 4_096,
  testResults: PLUGIN_LIMITS.tests,
})

export type ScriptStudioDocumentV1 = AnalysisScriptDocumentV1 | RecipeDocumentV1

export interface ScriptEditorStateV1 {
  readonly schemaVersion: 1
  readonly selectionAnchor: number
  readonly selectionHead: number
  readonly scrollTop: number
  readonly activePanel: 'api' | 'diff' | 'manifest' | 'problems' | 'tests'
}

export interface ScriptStudioInstallationSnapshotV1 {
  readonly schemaVersion: 1
  readonly installation: LocalPluginInstallationV1
  readonly document: ScriptStudioDocumentV1
}

export interface ScriptStudioRecordV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly kind: 'analysis-script' | 'recipe'
  readonly document: ScriptStudioDocumentV1
  readonly savedDocument: ScriptStudioDocumentV1
  readonly editor: ScriptEditorStateV1
  readonly testResults: readonly AnalysisScriptTestResultV1[]
  readonly installation?: ScriptStudioInstallationSnapshotV1
}

export interface ScriptStudioExportV1 {
  readonly schemaVersion: 1
  readonly kind: 'purejsimage-lab-script-studio-export'
  readonly record: ScriptStudioRecordV1
}

export interface ScriptStudioRepository {
  put(record: ScriptStudioRecordV1): Promise<void>
  get(id: string): Promise<ScriptStudioRecordV1 | undefined>
  list(): Promise<readonly ScriptStudioRecordV1[]>
  delete(id: string): Promise<void>
  warnings(): readonly string[]
}

export interface ScriptStudioReplayResolutionV1 {
  readonly schemaVersion: 1
  readonly status: 'exact' | 'mismatch' | 'missing'
  readonly pluginId: string
  readonly expectedDigest: string
  readonly document?: ScriptStudioDocumentV1
  readonly warning?: string
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function byteLength(value: string): number {
  return utf8ByteLength(value)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function issue(path: string, message: string): ValidationResult<never> {
  return { ok: false, issues: [{ path, message }] }
}

function validateEditor(value: unknown): value is ScriptEditorStateV1 {
  if (!isRecord(value) || value['schemaVersion'] !== 1) return false
  return (
    Number.isSafeInteger(value['selectionAnchor']) &&
    Number(value['selectionAnchor']) >= 0 &&
    Number.isSafeInteger(value['selectionHead']) &&
    Number(value['selectionHead']) >= 0 &&
    typeof value['scrollTop'] === 'number' &&
    Number.isFinite(value['scrollTop']) &&
    Number(value['scrollTop']) >= 0 &&
    ['api', 'diff', 'manifest', 'problems', 'tests'].includes(String(value['activePanel']))
  )
}

function validateDocument(value: unknown): ValidationResult<ScriptStudioDocumentV1> {
  if (!isRecord(value)) return issue('', 'Expected a script or recipe document.')
  return value['kind'] === 'recipe'
    ? validateRecipeDocument(value)
    : validateAnalysisScriptDocument(value)
}

function validateTestResults(value: unknown): value is readonly AnalysisScriptTestResultV1[] {
  if (!Array.isArray(value) || value.length > SCRIPT_STUDIO_LIMITS.testResults) return false
  return value.every((result) => validateScriptTestResult(result).ok)
}

function validateInstallation(
  value: unknown,
  document: ScriptStudioDocumentV1,
): value is ScriptStudioInstallationSnapshotV1 {
  if (!isRecord(value) || value['schemaVersion'] !== 1 || !isRecord(value['installation']))
    return false
  const installation = value['installation']
  const snapshot = validateDocument(value['document'])
  const validatedInstallation = validateLocalInstallation(installation)
  const requested =
    snapshot.value?.kind === 'recipe'
      ? snapshot.value.requestedCapabilities
      : snapshot.value?.manifest.requestedCapabilities
  const grant = validatedInstallation.value?.permissionGrant
  const accountedCapabilities = new Set([
    ...(grant?.grantedCapabilities ?? []),
    ...(grant?.deniedCapabilities ?? []),
  ])
  return (
    snapshot.ok &&
    snapshot.value !== undefined &&
    validatedInstallation.ok &&
    validatedInstallation.value !== undefined &&
    validatedInstallation.value.pluginId === document.id &&
    validatedInstallation.value.contentDigest === snapshot.value.integrity.digest &&
    validatedInstallation.value.installedKind ===
      (snapshot.value.kind === 'recipe' ? 'recipe' : 'sandboxed-script') &&
    grant?.scriptId === snapshot.value.id &&
    grant.sourceDigest === snapshot.value.integrity.digest &&
    requested?.length === accountedCapabilities.size &&
    requested.every((capability) => accountedCapabilities.has(capability)) &&
    snapshot.value.id === document.id
  )
}

function normalizeInstallation(value: unknown): ScriptStudioInstallationSnapshotV1 | undefined {
  if (!isRecord(value) || !isRecord(value['installation'])) return undefined
  const installation = validateLocalInstallation(value['installation'])
  const document = validateDocument(value['document'])
  if (
    !installation.ok ||
    installation.value === undefined ||
    !document.ok ||
    document.value === undefined
  )
    return undefined
  return { schemaVersion: 1, installation: installation.value, document: document.value }
}

export function validateScriptStudioRecord(value: unknown): ValidationResult<ScriptStudioRecordV1> {
  if (!isRecord(value) || value['schemaVersion'] !== 1)
    return issue('', 'Expected ScriptStudioRecordV1.')
  const document = validateDocument(value['document'])
  const saved = validateDocument(value['savedDocument'])
  const installation =
    value['installation'] === undefined ? undefined : normalizeInstallation(value['installation'])
  const issues: ValidationIssue[] = [...document.issues, ...saved.issues]
  if (typeof value['id'] !== 'string' || value['id'].length < 1 || value['id'].length > 128)
    issues.push({ path: '/id', message: 'Expected a bounded record ID.' })
  if (!validateEditor(value['editor']))
    issues.push({ path: '/editor', message: 'Editor state is malformed.' })
  if (!validateTestResults(value['testResults']))
    issues.push({ path: '/testResults', message: 'Test results are malformed or unbounded.' })
  if (
    document.value !== undefined &&
    (value['id'] !== document.value.id || value['kind'] !== document.value.kind)
  )
    issues.push({ path: '/document', message: 'Record and document identity do not match.' })
  if (
    document.value !== undefined &&
    saved.value !== undefined &&
    (saved.value.id !== document.value.id || saved.value.kind !== document.value.kind)
  )
    issues.push({ path: '/savedDocument', message: 'Saved and current identities do not match.' })
  if (
    document.value !== undefined &&
    value['installation'] !== undefined &&
    (!validateInstallation(value['installation'], document.value) || installation === undefined)
  )
    issues.push({ path: '/installation', message: 'Installed content snapshot is malformed.' })
  if (byteLength(JSON.stringify(value['editor'])) > SCRIPT_STUDIO_LIMITS.editorStateBytes)
    issues.push({ path: '/editor', message: 'Editor state exceeds its byte limit.' })
  if (issues.length > 0 || document.value === undefined || saved.value === undefined)
    return { ok: false, issues }
  const editor = value['editor'] as unknown as ScriptEditorStateV1
  const testResults = (value['testResults'] as readonly unknown[]).flatMap((result) => {
    const validation = validateScriptTestResult(result)
    return validation.value === undefined ? [] : [validation.value]
  })
  return {
    ok: true,
    issues: [],
    value: {
      schemaVersion: 1,
      id: document.value.id,
      kind: document.value.kind,
      document: document.value,
      savedDocument: saved.value,
      editor: {
        schemaVersion: 1,
        selectionAnchor: editor.selectionAnchor,
        selectionHead: editor.selectionHead,
        scrollTop: editor.scrollTop,
        activePanel: editor.activePanel,
      },
      testResults,
      ...(installation === undefined ? {} : { installation }),
    },
  }
}

export async function normalizeStudioDocument(
  document: ScriptStudioDocumentV1,
): Promise<ScriptStudioDocumentV1> {
  let normalized: ScriptStudioDocumentV1
  if (document.kind === 'recipe') {
    const { integrity: _integrity, ...content } = document
    normalized = { ...content, integrity: await recipeContentIntegrity(content) }
  } else {
    const { integrity: _integrity, ...content } = document
    normalized = { ...content, integrity: await scriptContentIntegrity(content) }
  }
  const validation = validateDocument(normalized)
  if (!validation.ok || validation.value === undefined)
    throw new Error(
      validation.issues.map(({ path, message }) => `${path || '/'}: ${message}`).join('\n'),
    )
  return validation.value
}

export async function serializeScriptStudioExport(record: ScriptStudioRecordV1): Promise<string> {
  const validation = validateScriptStudioRecord(record)
  if (!validation.ok || validation.value === undefined)
    throw new Error('Script Studio record is invalid and cannot be exported.')
  await assertScriptStudioRecordIntegrity(validation.value)
  const envelope: ScriptStudioExportV1 = {
    schemaVersion: 1,
    kind: 'purejsimage-lab-script-studio-export',
    record: validation.value,
  }
  const json = JSON.stringify(envelope, null, 2)
  if (byteLength(json) > SCRIPT_STUDIO_LIMITS.exportBytes)
    throw new Error('Script Studio export exceeds its byte limit.')
  return json
}

export async function importScriptStudioExport(json: string): Promise<ScriptStudioRecordV1> {
  if (byteLength(json) > SCRIPT_STUDIO_LIMITS.exportBytes)
    throw new Error('Script Studio import exceeds its byte limit.')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Script Studio import is not valid JSON.')
  }
  if (
    !isRecord(parsed) ||
    parsed['schemaVersion'] !== 1 ||
    parsed['kind'] !== 'purejsimage-lab-script-studio-export'
  )
    throw new Error('Script Studio import envelope is unsupported.')
  const validation = validateScriptStudioRecord(parsed['record'])
  if (!validation.ok || validation.value === undefined)
    throw new Error(
      `Script Studio import is invalid:\n${validation.issues
        .map(({ path, message }) => `${path || '/'}: ${message}`)
        .join('\n')}`,
    )
  const normalizedDocument = await normalizeStudioDocument(validation.value.document)
  if (normalizedDocument.integrity.digest !== validation.value.document.integrity.digest)
    throw new Error('Script Studio import content integrity mismatch.')
  const normalizedSaved = await normalizeStudioDocument(validation.value.savedDocument)
  if (normalizedSaved.integrity.digest !== validation.value.savedDocument.integrity.digest)
    throw new Error('Script Studio import saved-content integrity mismatch.')
  if (
    validation.value.installation !== undefined &&
    validation.value.installation.document.integrity.digest !==
      validation.value.installation.installation.contentDigest
  )
    throw new Error('Script Studio installed-content identity mismatch.')
  return validation.value
}

export async function assertScriptStudioRecordIntegrity(
  record: ScriptStudioRecordV1,
): Promise<void> {
  const documents = [record.document, record.savedDocument, record.installation?.document].filter(
    (document): document is ScriptStudioDocumentV1 => document !== undefined,
  )
  for (const document of documents) {
    const normalized = await normalizeStudioDocument(document)
    if (normalized.integrity.digest !== document.integrity.digest)
      throw new Error(`Script Studio content integrity mismatch: ${document.id}`)
  }
}

export async function resolveStudioInstallation(
  repository: ScriptStudioRepository,
  pluginId: string,
  expectedDigest: string,
): Promise<ScriptStudioReplayResolutionV1> {
  const record = await repository.get(pluginId)
  const installed = record?.installation
  if (record === undefined || installed === undefined)
    return {
      schemaVersion: 1,
      status: 'missing',
      pluginId,
      expectedDigest,
      warning: `Required local plugin is missing: ${pluginId}@sha256:${expectedDigest}`,
    }
  if (installed.installation.contentDigest !== expectedDigest)
    return {
      schemaVersion: 1,
      status: 'mismatch',
      pluginId,
      expectedDigest,
      warning: `Local plugin content mismatch: ${pluginId}; expected sha256:${expectedDigest}, installed sha256:${installed.installation.contentDigest}.`,
    }
  return {
    schemaVersion: 1,
    status: 'exact',
    pluginId,
    expectedDigest,
    document: clone(installed.document),
  }
}

export class MemoryScriptStudioRepository implements ScriptStudioRepository {
  readonly #records = new Map<string, unknown>()
  readonly #warnings: string[] = []

  async put(record: ScriptStudioRecordV1): Promise<void> {
    const validation = validateScriptStudioRecord(record)
    if (!validation.ok || validation.value === undefined)
      throw new Error('Cannot store an invalid Script Studio record.')
    if (!this.#records.has(record.id) && this.#records.size >= SCRIPT_STUDIO_LIMITS.records)
      throw new Error('Script Studio record limit exceeded.')
    await assertScriptStudioRecordIntegrity(validation.value)
    this.#records.set(record.id, clone(validation.value))
  }

  async get(id: string): Promise<ScriptStudioRecordV1 | undefined> {
    const value = this.#records.get(id)
    if (value === undefined) return undefined
    const validation = validateScriptStudioRecord(value)
    if (!validation.ok || validation.value === undefined) {
      this.#warnings.push(`Ignored corrupt Script Studio record: ${id}`)
      return undefined
    }
    try {
      await assertScriptStudioRecordIntegrity(validation.value)
    } catch {
      this.#warnings.push(`Ignored corrupt Script Studio record: ${id}`)
      return undefined
    }
    return clone(validation.value)
  }

  async list(): Promise<readonly ScriptStudioRecordV1[]> {
    const records: ScriptStudioRecordV1[] = []
    for (const id of this.#records.keys()) {
      const record = await this.get(id)
      if (record !== undefined) records.push(record)
    }
    return records.sort((left, right) => left.document.title.localeCompare(right.document.title))
  }

  async delete(id: string): Promise<void> {
    this.#records.delete(id)
  }

  warnings(): readonly string[] {
    return [...this.#warnings]
  }

  injectCorruptRecordForTest(id: string, value: unknown): void {
    this.#records.set(id, value)
  }
}
