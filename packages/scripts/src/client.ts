import type {
  AnalysisScriptDocumentV1,
  PluginJsonValue,
  SandboxLimitsV1,
  SandboxWorkerMessageV1,
  ScriptPermissionGrantV1,
  ScriptRunProvenanceV1,
} from '@pji-workbench/plugin-sdk'
import {
  validateAnalysisScriptDocument,
  validatePermissionGrant,
  validateSandboxLimits,
  validateSandboxWorkerMessage,
} from '@pji-workbench/plugin-sdk'
import { type ScriptActionInvoker, ScriptCapabilityHost } from './capability-host.js'
import type { GeneratedScriptApiV1 } from './catalog.js'
import { DEFAULT_SANDBOX_LIMITS } from './limits.js'

export interface ScriptRunOutcome {
  readonly status: 'completed' | 'cancelled' | 'failed' | 'limit-exceeded'
  readonly output?: PluginJsonValue
  readonly error?: string
  readonly logs: readonly string[]
  readonly proposals: readonly PluginJsonValue[]
  readonly provenance: ScriptRunProvenanceV1
}

interface ActiveRun {
  readonly requestId: string
  readonly worker: Worker
  readonly host: ScriptCapabilityHost
  readonly document: AnalysisScriptDocumentV1
  readonly permissionGrant: ScriptPermissionGrantV1
  readonly limits: SandboxLimitsV1
  readonly logs: string[]
  readonly resolve: (outcome: ScriptRunOutcome) => void
  messages: number
  settled: boolean
  startupTimer: ReturnType<typeof setTimeout>
  deadlineTimer?: ReturnType<typeof setTimeout>
  executionStarted: boolean
}

let requestSequence = 0
const SANDBOX_STARTUP_DEADLINE_MILLISECONDS = 30_000

function createSandboxWorker(): Worker {
  return new Worker(new URL('./sandbox.worker.ts', import.meta.url), {
    type: 'module',
    name: 'pji-script-sandbox',
  })
}

function messageBytes(message: unknown): number {
  return new TextEncoder().encode(JSON.stringify(message)).byteLength
}

export class ScriptHostClient {
  readonly #api: GeneratedScriptApiV1
  readonly #invoker: ScriptActionInvoker
  readonly #workerFactory: () => Worker
  #active: ActiveRun | undefined

  constructor(options: {
    readonly api: GeneratedScriptApiV1
    readonly invoker: ScriptActionInvoker
    readonly workerFactory?: () => Worker
  }) {
    this.#api = options.api
    this.#invoker = options.invoker
    this.#workerFactory = options.workerFactory ?? createSandboxWorker
  }

  run(options: {
    readonly document: AnalysisScriptDocumentV1
    readonly permissionGrant: ScriptPermissionGrantV1
    readonly limits?: SandboxLimitsV1
  }): Promise<ScriptRunOutcome> {
    if (this.#active !== undefined) return Promise.reject(new Error('A script is already running.'))
    const documentValidation = validateAnalysisScriptDocument(options.document)
    const grantValidation = validatePermissionGrant(options.permissionGrant)
    const limits = options.limits ?? DEFAULT_SANDBOX_LIMITS
    const limitsValidation = validateSandboxLimits(limits)
    if (!documentValidation.ok || !grantValidation.ok || !limitsValidation.ok)
      return Promise.reject(
        new Error(
          [...documentValidation.issues, ...grantValidation.issues, ...limitsValidation.issues]
            .map(({ path, message }) => `${path || '/'}: ${message}`)
            .join('\n'),
        ),
      )
    requestSequence += 1
    const requestId = `script-${requestSequence}`
    const worker = this.#workerFactory()
    const host = new ScriptCapabilityHost({
      api: this.#api,
      document: options.document,
      permissionGrant: options.permissionGrant,
      invoker: this.#invoker,
      maximumBytes: limits.messageBytes,
    })
    return new Promise((resolve) => {
      let active: ActiveRun
      const startupTimer = setTimeout(() => {
        active.worker.terminate()
        this.#finish(active, 'failed', undefined, 'Sandbox Worker startup deadline exceeded.')
      }, SANDBOX_STARTUP_DEADLINE_MILLISECONDS)
      active = {
        requestId,
        worker,
        host,
        document: options.document,
        permissionGrant: options.permissionGrant,
        limits,
        logs: [],
        resolve,
        messages: 0,
        settled: false,
        startupTimer,
        executionStarted: false,
      }
      this.#active = active
      worker.addEventListener('message', (event: MessageEvent<unknown>) =>
        this.#onMessage(active, event.data),
      )
      worker.addEventListener('error', () =>
        this.#finish(active, 'failed', undefined, 'Sandbox Worker crashed.'),
      )
      worker.postMessage({
        schemaVersion: 1,
        kind: 'sandbox.start',
        requestId,
        document: options.document,
        permissionGrant: options.permissionGrant,
        limits,
        api: this.#api as unknown as PluginJsonValue,
      })
    })
  }

  cancel(): void {
    const active = this.#active
    if (active === undefined) return
    this.#invoker.cancel?.()
    active.worker.postMessage({
      schemaVersion: 1,
      kind: 'sandbox.cancel',
      requestId: active.requestId,
    })
    active.worker.terminate()
    this.#finish(active, 'cancelled', undefined, 'Execution cancelled; sandbox Worker terminated.')
  }

  dispose(): void {
    this.cancel()
  }

  #onMessage(active: ActiveRun, value: unknown): void {
    if (active !== this.#active || active.settled) return
    active.messages += 1
    if (
      active.messages > active.limits.messages ||
      messageBytes(value) > active.limits.messageBytes
    ) {
      active.worker.terminate()
      this.#finish(active, 'limit-exceeded', undefined, 'Sandbox message limit exceeded.')
      return
    }
    const parsed = validateSandboxWorkerMessage(value)
    if (!parsed.ok || parsed.value === undefined) {
      active.worker.terminate()
      this.#finish(active, 'failed', undefined, 'Malformed sandbox Worker message.')
      return
    }
    const message = parsed.value
    if (message.kind === 'sandbox.ready') return
    if (message.requestId !== active.requestId) {
      active.worker.terminate()
      this.#finish(active, 'failed', undefined, 'Sandbox request identity mismatch.')
      return
    }
    if (message.kind === 'sandbox.executing') {
      if (active.executionStarted) {
        active.worker.terminate()
        this.#finish(active, 'failed', undefined, 'Malformed sandbox Worker lifecycle.')
        return
      }
      active.executionStarted = true
      clearTimeout(active.startupTimer)
      active.deadlineTimer = setTimeout(() => {
        active.worker.terminate()
        this.#finish(active, 'limit-exceeded', undefined, 'Sandbox execution deadline exceeded.')
      }, active.limits.deadlineMilliseconds)
      return
    }
    if (!active.executionStarted) {
      active.worker.terminate()
      this.#finish(active, 'failed', undefined, 'Malformed sandbox Worker lifecycle.')
      return
    }
    if (message.kind === 'sandbox.log') {
      active.logs.push(`${message.level}: ${message.message}`)
      return
    }
    if (message.kind === 'sandbox.capability-request') {
      void this.#invoke(active, message)
      return
    }
    this.#finish(active, message.status, message.output, message.error)
  }

  async #invoke(
    active: ActiveRun,
    message: Extract<SandboxWorkerMessageV1, { kind: 'sandbox.capability-request' }>,
  ): Promise<void> {
    try {
      const value = await active.host.invoke(message.api, message.input)
      if (!active.settled)
        active.worker.postMessage({
          schemaVersion: 1,
          kind: 'sandbox.capability-result',
          requestId: active.requestId,
          capabilityRequestId: message.capabilityRequestId,
          ok: true,
          value,
        })
    } catch (error) {
      if (!active.settled)
        active.worker.postMessage({
          schemaVersion: 1,
          kind: 'sandbox.capability-result',
          requestId: active.requestId,
          capabilityRequestId: message.capabilityRequestId,
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 4_096) : 'Capability denied.',
        })
    }
  }

  #finish(
    active: ActiveRun,
    status: ScriptRunOutcome['status'],
    output?: PluginJsonValue,
    error?: string,
  ): void {
    if (active.settled) return
    active.settled = true
    clearTimeout(active.startupTimer)
    if (active.deadlineTimer !== undefined) clearTimeout(active.deadlineTimer)
    active.worker.terminate()
    if (this.#active === active) this.#active = undefined
    const hostResult = active.host.result()
    active.resolve({
      status,
      ...(output === undefined ? {} : { output }),
      ...(error === undefined ? {} : { error }),
      logs: Object.freeze([...active.logs]),
      proposals: hostResult.proposals,
      provenance: {
        schemaVersion: 1,
        scriptId: active.document.id,
        sourceHash: active.document.integrity,
        manifest: active.document.manifest,
        permissions: active.permissionGrant,
        actionTrace: hostResult.trace,
        references: hostResult.references,
        ...(output === undefined ? {} : { resultSummary: output }),
      },
    })
  }
}
