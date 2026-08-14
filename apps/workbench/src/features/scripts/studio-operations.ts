import type { JsonValue } from '@pji-workbench/actions'
import {
  type AnalysisScriptDocumentV1,
  type AnalysisScriptTestResultV1,
  normalizeStudioDocument,
  type PluginJsonValue,
  type RecipeDocumentV1,
  type ScriptPermissionGrantV1,
  type ScriptStudioDocumentV1,
  type ScriptStudioRecordV1,
} from '@pji-workbench/plugin-sdk'
import {
  type GeneratedScriptApiV1,
  type ScriptActionInvoker,
  ScriptHostClient,
  type ScriptRunOutcome,
} from '@pji-workbench/scripts'

import type { ScriptLanguageClient, ScriptLanguageProblem } from './language-client.js'

export const DEFAULT_EDITOR_STATE = Object.freeze({
  schemaVersion: 1 as const,
  selectionAnchor: 0,
  selectionHead: 0,
  scrollTop: 0,
  activePanel: 'problems' as const,
})

export async function createStudioRecord(
  document: ScriptStudioDocumentV1,
): Promise<ScriptStudioRecordV1> {
  const normalized = await normalizeStudioDocument(document)
  return {
    schemaVersion: 1,
    id: normalized.id,
    kind: normalized.kind,
    document: normalized,
    savedDocument: normalized,
    editor: DEFAULT_EDITOR_STATE,
    testResults: [],
  }
}

export function permissionGrant(document: AnalysisScriptDocumentV1): ScriptPermissionGrantV1 {
  return {
    schemaVersion: 1,
    scriptId: document.id,
    sourceDigest: document.integrity.digest,
    grantedCapabilities: document.manifest.requestedCapabilities,
    deniedCapabilities: [],
  }
}

export function approvedExecutionApi(api: GeneratedScriptApiV1): GeneratedScriptApiV1 {
  return {
    ...api,
    endpoints: api.endpoints.map((endpoint) =>
      endpoint.actionId === 'analysis.graph.request-execute'
        ? { ...endpoint, mode: 'execute' as const }
        : endpoint,
    ),
  }
}

export function boundedLineDiff(before: string, after: string): readonly string[] {
  if (before === after) return ['No changes from the saved snapshot.']
  const left = before.split('\n').slice(0, 2_000)
  const right = after.split('\n').slice(0, 2_000)
  const output: string[] = []
  let characters = 0
  const maximum = Math.max(left.length, right.length)
  for (let index = 0; index < maximum && output.length < 400 && characters < 32_768; index += 1) {
    if (left[index] === right[index]) continue
    for (const line of [
      left[index] === undefined ? undefined : `- ${index + 1}: ${left[index]}`,
      right[index] === undefined ? undefined : `+ ${index + 1}: ${right[index]}`,
    ]) {
      if (line === undefined || output.length >= 400 || characters >= 32_768) continue
      const bounded = line.slice(0, Math.min(1_024, 32_768 - characters))
      output.push(bounded)
      characters += bounded.length
    }
  }
  if (output.length === 400 || characters >= 32_768)
    output.push('… diff truncated at the review limit')
  return output
}

export function documentText(document: ScriptStudioDocumentV1): string {
  return document.kind === 'analysis-script' ? document.source : JSON.stringify(document, null, 2)
}

function isPartialMatch(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((value, index) => isPartialMatch(actual[index], value))
    )
  if (typeof expected === 'object' && expected !== null && !Array.isArray(expected)) {
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false
    return Object.entries(expected).every(([key, value]) =>
      isPartialMatch((actual as Readonly<Record<string, unknown>>)[key], value),
    )
  }
  return false
}

export async function compileScript(
  document: AnalysisScriptDocumentV1,
  language: ScriptLanguageClient,
  api: GeneratedScriptApiV1,
): Promise<{
  readonly document?: AnalysisScriptDocumentV1
  readonly problems: readonly ScriptLanguageProblem[]
}> {
  const result = await language.compile(document.source, document.language, api)
  if (result.javascript === undefined) return { problems: result.problems }
  const compiled = await normalizeStudioDocument({
    ...document,
    language: 'javascript',
    source: result.javascript,
  })
  return { document: compiled as AnalysisScriptDocumentV1, problems: result.problems }
}

export async function runScript(
  document: AnalysisScriptDocumentV1,
  language: ScriptLanguageClient,
  api: GeneratedScriptApiV1,
  invoker: ScriptActionInvoker,
): Promise<{
  readonly outcome?: ScriptRunOutcome
  readonly problems: readonly ScriptLanguageProblem[]
}> {
  const compiled = await compileScript(document, language, api)
  if (compiled.document === undefined) return { problems: compiled.problems }
  const client = new ScriptHostClient({ api, invoker })
  try {
    return {
      problems: compiled.problems,
      outcome: await client.run({
        document: compiled.document,
        permissionGrant: permissionGrant(compiled.document),
      }),
    }
  } finally {
    client.dispose()
  }
}

export async function runDocumentTests(options: {
  readonly document: ScriptStudioDocumentV1
  readonly recipeTests?: readonly {
    readonly id: string
    readonly expected: PluginJsonValue
  }[]
  readonly language: ScriptLanguageClient
  readonly api: GeneratedScriptApiV1
  readonly invoker: ScriptActionInvoker
}): Promise<readonly AnalysisScriptTestResultV1[]> {
  if (options.document.kind === 'recipe') {
    const output = {
      operationCount: options.document.operations.length,
      actionId: options.document.operations[0]?.actionId ?? '',
    }
    return (options.recipeTests ?? []).map((test) => ({
      schemaVersion: 1,
      testId: test.id,
      status: isPartialMatch(output, test.expected) ? 'passed' : 'failed',
      output,
      issues: isPartialMatch(output, test.expected)
        ? []
        : ['Recipe structure differs from expected output.'],
    }))
  }
  const run = await runScript(options.document, options.language, options.api, options.invoker)
  if (run.outcome === undefined)
    return options.document.tests.map((test) => ({
      schemaVersion: 1,
      testId: test.id,
      status: 'failed',
      issues: run.problems.map(({ line, column, message }) => `${line}:${column} ${message}`),
    }))
  return options.document.tests.map((test) => {
    const passed =
      run.outcome?.status === 'completed' && isPartialMatch(run.outcome.output, test.expected)
    return {
      schemaVersion: 1,
      testId: test.id,
      status:
        run.outcome?.status === 'cancelled' || run.outcome?.status === 'limit-exceeded'
          ? run.outcome.status
          : passed
            ? 'passed'
            : 'failed',
      ...(run.outcome?.output === undefined ? {} : { output: run.outcome.output }),
      issues: passed
        ? []
        : [run.outcome?.error ?? 'Output did not match the expected fixture result.'],
    }
  })
}

export async function runRecipe(
  document: RecipeDocumentV1,
  invoker: ScriptActionInvoker,
  mode: 'dry-run' | 'execute',
): Promise<readonly JsonValue[]> {
  const results: JsonValue[] = []
  for (const operation of document.operations)
    results.push(
      await invoker.invoke(
        operation.actionId,
        operation.actionVersion,
        operation.input as JsonValue,
        mode,
      ),
    )
  return results
}
