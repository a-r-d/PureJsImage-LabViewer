import type {
  ActionAbortSignal,
  ActionHandler,
  JsonValue,
  WorkbenchActionHost,
  WorkbenchActionRegistry,
} from '@pji-workbench/actions'
import {
  type AnalysisScriptDocumentV1,
  normalizeStudioDocument,
  type ScriptStudioRepository,
} from '@pji-workbench/plugin-sdk'
import { generateScriptApi } from '@pji-workbench/scripts'
import type { CommandContext } from '@pji-workbench/workbench-core'
import { executeOnlyAction, fixtureAction, rpcObject } from '@pji-workbench/workbench-core'

const ACTIVE_ACTION_SIGNAL: ActionAbortSignal = {
  aborted: false,
  throwIfAborted: () => undefined,
}

export interface ScriptActionPorts {
  readonly store: ScriptStudioRepository
  readonly registry: WorkbenchActionRegistry<CommandContext>
  currentHost(): WorkbenchActionHost<CommandContext> | undefined
  appendScriptLog(message: string): void
}

export function createScriptActionHandlers(
  ports: ScriptActionPorts,
): ReadonlyMap<string, ActionHandler<CommandContext>> {
  return new Map<string, ActionHandler<CommandContext>>([
    [
      'script.log@1',
      fixtureAction((input) => {
        const message =
          typeof input === 'object' && input !== null && !Array.isArray(input)
            ? (input as { readonly [key: string]: JsonValue })['message']
            : undefined
        if (typeof message === 'string') ports.appendScriptLog(message)
        return null
      }),
    ],
    [
      'script.create_draft@1',
      executeOnlyAction(async (input) => {
        const request = rpcObject(input)
        const id = request?.['id']
        const title = request?.['title']
        if (typeof id !== 'string' || typeof title !== 'string')
          throw new Error('Script draft requires bounded id and title fields.')
        const document = (await normalizeStudioDocument({
          schemaVersion: 1,
          kind: 'analysis-script',
          id,
          title,
          language: 'typescript',
          source: `export async function main() { return {} }\nglobalThis.__scriptMain = main\n`,
          manifest: {
            scriptApiVersion: 1,
            requestedCapabilities: [],
            pureJsImageCompatibility: '^4.0.0',
            workbenchCompatibility: '^0.0.0',
            entrypoint: 'main',
            deterministic: true,
          },
          tests: [],
          integrity: { algorithm: 'sha256', digest: '0'.repeat(64) },
        })) as AnalysisScriptDocumentV1
        await ports.store.put({
          schemaVersion: 1,
          id,
          kind: 'analysis-script',
          document,
          savedDocument: document,
          editor: {
            schemaVersion: 1,
            selectionAnchor: 0,
            selectionHead: 0,
            scrollTop: 0,
            activePanel: 'problems',
          },
          testResults: [],
        })
        return { id, digest: document.integrity.digest }
      }),
    ],
    [
      'script.read@1',
      fixtureAction(async (input) => {
        const id = rpcObject(input)?.['id']
        if (typeof id !== 'string') throw new Error('Script read requires an id.')
        const record = await ports.store.get(id)
        if (record === undefined) throw new Error('Script or recipe was not found.')
        return record as unknown as JsonValue
      }),
    ],
    [
      'script.apply_patch@1',
      executeOnlyAction(async (input) => {
        const request = rpcObject(input)
        const id = request?.['id']
        const expectedDigest = request?.['expectedDigest']
        const source = request?.['source']
        if (
          typeof id !== 'string' ||
          typeof expectedDigest !== 'string' ||
          typeof source !== 'string'
        )
          throw new Error('Script patch requires id, expectedDigest, and source.')
        const record = await ports.store.get(id)
        if (record?.document.kind !== 'analysis-script')
          throw new Error('Only sandboxed script source can be patched by this action.')
        if (record.document.integrity.digest !== expectedDigest)
          throw new Error('Script changed since the requested patch was prepared.')
        const document = (await normalizeStudioDocument({
          ...record.document,
          source,
        })) as AnalysisScriptDocumentV1
        await ports.store.put({ ...record, document, testResults: [] })
        return { id, digest: document.integrity.digest, status: 'draft-updated' }
      }),
    ],
    [
      'script.typecheck@1',
      fixtureAction(async (input) => {
        const request = rpcObject(input)
        const id = request?.['id']
        const expectedDigest = request?.['expectedDigest']
        if (typeof id !== 'string' || typeof expectedDigest !== 'string')
          throw new Error('Script typecheck requires id and expectedDigest.')
        const record = await ports.store.get(id)
        if (record?.document.kind !== 'analysis-script')
          throw new Error('Typecheck requires a sandboxed script.')
        if (record.document.integrity.digest !== expectedDigest)
          throw new Error('Script changed since typecheck was requested.')
        const [{ ScriptLanguageClient }] = await Promise.all([import('./language-client.js')])
        const client = new ScriptLanguageClient()
        try {
          const result = await client.check(
            record.document.source,
            record.document.language,
            generateScriptApi(ports.registry.manifest()),
          )
          return {
            id,
            digest: record.document.integrity.digest,
            problems: result.problems,
          } as unknown as JsonValue
        } finally {
          client.dispose()
        }
      }),
    ],
    [
      'script.run_tests@1',
      executeOnlyAction(async (input) => {
        const request = rpcObject(input)
        const id = request?.['id']
        const expectedDigest = request?.['expectedDigest']
        if (typeof id !== 'string' || typeof expectedDigest !== 'string')
          throw new Error('Script tests require id and expectedDigest.')
        const record = await ports.store.get(id)
        if (record === undefined) throw new Error('Script or recipe was not found.')
        if (record.document.integrity.digest !== expectedDigest)
          throw new Error('Script changed since tests were requested.')
        const host = ports.currentHost()
        if (host === undefined) throw new Error('Script action host is unavailable.')
        const [studio, languageModule, scriptModule] = await Promise.all([
          import('./studio-operations.js'),
          import('./language-client.js'),
          import('@pji-workbench/scripts/examples'),
        ])
        const languageClient = new languageModule.ScriptLanguageClient()
        try {
          const examples = await scriptModule.createBuiltInScriptStudioExamples()
          const example = examples.find((candidate) => candidate.id === id)
          const results = await studio.runDocumentTests({
            document: record.document,
            ...(example === undefined ? {} : { recipeTests: example.tests }),
            language: languageClient,
            api: generateScriptApi(ports.registry.manifest()),
            invoker: {
              invoke: (actionId, version, actionInput, mode) =>
                mode === 'dry-run'
                  ? host.dryRun(
                      actionId,
                      version,
                      actionInput,
                      { hasDataset: true },
                      ACTIVE_ACTION_SIGNAL,
                    )
                  : host.execute(
                      actionId,
                      version,
                      actionInput,
                      { hasDataset: true },
                      ACTIVE_ACTION_SIGNAL,
                    ),
            },
          })
          await ports.store.put({ ...record, testResults: results })
          return {
            id,
            digest: record.document.integrity.digest,
            results,
            status: results.every(({ status }) => status === 'passed') ? 'passed' : 'failed',
          } as unknown as JsonValue
        } finally {
          languageClient.dispose()
        }
      }),
    ],
    [
      'script.diff@1',
      fixtureAction(async (input) => {
        const request = rpcObject(input)
        const id = request?.['id']
        const expectedDigest = request?.['expectedDigest']
        if (typeof id !== 'string' || typeof expectedDigest !== 'string')
          throw new Error('Script diff requires id and expectedDigest.')
        const record = await ports.store.get(id)
        if (record === undefined) throw new Error('Script or recipe was not found.')
        if (record.document.integrity.digest !== expectedDigest)
          throw new Error('Script changed since diff was requested.')
        const { boundedLineDiff, documentText } = await import('./studio-operations.js')
        return {
          id,
          lines: boundedLineDiff(documentText(record.savedDocument), documentText(record.document)),
        }
      }),
    ],
    [
      'script.request_install@1',
      fixtureAction(async (input) => {
        const request = rpcObject(input)
        const id = request?.['id']
        const expectedDigest = request?.['expectedDigest']
        if (typeof id !== 'string' || typeof expectedDigest !== 'string')
          throw new Error('Installation request requires id and expectedDigest.')
        const record = await ports.store.get(id)
        if (record === undefined) throw new Error('Script or recipe was not found.')
        if (record.document.integrity.digest !== expectedDigest)
          throw new Error('Script changed since installation was requested.')
        return {
          id,
          digest: record.document.integrity.digest,
          status: 'requires-user-review',
        }
      }),
    ],
    [
      'script.request_execute@1',
      fixtureAction(async (input) => {
        const request = rpcObject(input)
        const id = request?.['id']
        const expectedDigest = request?.['expectedDigest']
        if (typeof id !== 'string' || typeof expectedDigest !== 'string')
          throw new Error('Execution request requires id and expectedDigest.')
        const record = await ports.store.get(id)
        if (record === undefined) throw new Error('Script or recipe was not found.')
        if (record.document.integrity.digest !== expectedDigest)
          throw new Error('Script changed since execution was requested.')
        return {
          id,
          digest: record.document.integrity.digest,
          status: 'requires-user-review',
        }
      }),
    ],
  ])
}
