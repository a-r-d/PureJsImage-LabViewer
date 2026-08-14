import type { JsonValue } from '@pji-workbench/actions'
import type {
  AnalysisScriptDocumentV1,
  PluginJsonValue,
  ScriptActionTraceV1,
  ScriptPermissionGrantV1,
  ScriptProvenanceReferenceV1,
} from '@pji-workbench/plugin-sdk'
import { validatePluginJsonValue } from '@pji-workbench/plugin-sdk'
import { findScriptEndpoint, type GeneratedScriptApiV1 } from './catalog.js'

export interface ScriptActionInvoker {
  invoke(
    actionId: string,
    actionVersion: number,
    input: JsonValue,
    mode: 'dry-run' | 'execute',
  ): Promise<JsonValue>
  cancel?(): void
}

export interface ScriptCapabilityHostResult {
  readonly trace: readonly ScriptActionTraceV1[]
  readonly proposals: readonly PluginJsonValue[]
  readonly references: readonly ScriptProvenanceReferenceV1[]
}

export class ScriptCapabilityHost {
  readonly #api: GeneratedScriptApiV1
  readonly #document: AnalysisScriptDocumentV1
  readonly #grant: ScriptPermissionGrantV1
  readonly #invoker: ScriptActionInvoker
  readonly #maximumBytes: number
  readonly #trace: ScriptActionTraceV1[] = []
  readonly #proposals: PluginJsonValue[] = []

  constructor(options: {
    readonly api: GeneratedScriptApiV1
    readonly document: AnalysisScriptDocumentV1
    readonly permissionGrant: ScriptPermissionGrantV1
    readonly invoker: ScriptActionInvoker
    readonly maximumBytes: number
  }) {
    this.#api = options.api
    this.#document = options.document
    this.#grant = options.permissionGrant
    this.#invoker = options.invoker
    this.#maximumBytes = options.maximumBytes
  }

  async invoke(apiName: string, input: PluginJsonValue): Promise<PluginJsonValue> {
    const endpoint = findScriptEndpoint(this.#api, apiName)
    if (endpoint === undefined) throw new Error(`Unknown script API: ${apiName}`)
    const sequence = this.#trace.length + 1
    const requested = this.#document.manifest.requestedCapabilities.includes(endpoint.permission)
    const granted = this.#grant.grantedCapabilities.includes(endpoint.permission)
    const denied = this.#grant.deniedCapabilities.includes(endpoint.permission)
    if (!requested || !granted || denied) {
      this.#trace.push({
        sequence,
        api: apiName,
        actionId: endpoint.actionId,
        actionVersion: endpoint.actionVersion,
        permission: endpoint.permission,
        input,
        outcome: 'denied',
      })
      throw new Error(`Capability is not granted: ${endpoint.permission}`)
    }
    const inputValidation = validatePluginJsonValue(input, this.#maximumBytes)
    if (!inputValidation.ok || inputValidation.value === undefined)
      throw new Error('Capability input must be a bounded JSON value.')
    try {
      const result = (await this.#invoker.invoke(
        endpoint.actionId,
        endpoint.actionVersion,
        input as JsonValue,
        endpoint.mode,
      )) as PluginJsonValue
      const resultValidation = validatePluginJsonValue(result, this.#maximumBytes)
      if (!resultValidation.ok || resultValidation.value === undefined)
        throw new Error('Capability result must be a bounded JSON value.')
      this.#trace.push({
        sequence,
        api: apiName,
        actionId: endpoint.actionId,
        actionVersion: endpoint.actionVersion,
        permission: endpoint.permission,
        input,
        outcome: 'allowed',
        resultSummary: result,
      })
      if (
        endpoint.mode === 'dry-run' &&
        (endpoint.permission.endsWith('propose') ||
          endpoint.actionId === 'analysis.request-execute' ||
          endpoint.actionId === 'analysis.graph.request-execute' ||
          endpoint.actionId === 'analysis.batch.request-execute' ||
          endpoint.actionId === 'result.export.propose')
      )
        this.#proposals.push(result)
      return result
    } catch (error) {
      if (this.#trace.at(-1)?.sequence !== sequence)
        this.#trace.push({
          sequence,
          api: apiName,
          actionId: endpoint.actionId,
          actionVersion: endpoint.actionVersion,
          permission: endpoint.permission,
          input,
          outcome: 'failed',
        })
      throw error
    }
  }

  result(): ScriptCapabilityHostResult {
    return {
      trace: Object.freeze([...this.#trace]),
      proposals: Object.freeze([...this.#proposals]),
      references: Object.freeze(
        this.#trace.map(({ actionId, actionVersion }) => ({
          kind: 'action' as const,
          id: actionId,
          version: String(actionVersion),
        })),
      ),
    }
  }
}
