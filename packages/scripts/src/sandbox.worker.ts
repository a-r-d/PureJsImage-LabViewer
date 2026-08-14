import type {
  PluginJsonValue,
  SandboxCapabilityResultV1,
  SandboxCompleteEventV1,
  SandboxHostMessageV1,
  SandboxWorkerMessageV1,
} from '@pji-workbench/plugin-sdk'
import { validateSandboxHostMessage } from '@pji-workbench/plugin-sdk'
import { parseGeneratedScriptApi } from './catalog.js'
import { runQuickJs } from './runner.js'

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  postMessage(message: SandboxWorkerMessageV1): void
}

const scope = globalThis as unknown as WorkerScope
const capabilityResults = new Map<
  string,
  {
    readonly resolve: (value: PluginJsonValue) => void
    readonly reject: (error: Error) => void
  }
>()
let activeRequestId: string | undefined
let cancelled = false
let capabilitySequence = 0

function send(message: SandboxWorkerMessageV1): void {
  scope.postMessage(message)
}

function complete(message: Omit<SandboxCompleteEventV1, 'schemaVersion' | 'kind'>): void {
  send({ schemaVersion: 1, kind: 'sandbox.complete', ...message })
}

function invokeCapability(
  requestId: string,
  api: string,
  input: PluginJsonValue,
): Promise<PluginJsonValue> {
  capabilitySequence += 1
  const capabilityRequestId = `call-${capabilitySequence}`
  return new Promise((resolve, reject) => {
    capabilityResults.set(capabilityRequestId, { resolve, reject })
    send({
      schemaVersion: 1,
      kind: 'sandbox.capability-request',
      requestId,
      capabilityRequestId,
      api,
      input,
    })
  })
}

function settleCapability(message: SandboxCapabilityResultV1): void {
  const pending = capabilityResults.get(message.capabilityRequestId)
  if (pending === undefined) return
  capabilityResults.delete(message.capabilityRequestId)
  if (message.ok) pending.resolve(message.value ?? null)
  else pending.reject(new Error(message.error ?? 'Capability call failed.'))
}

async function run(
  message: Extract<SandboxHostMessageV1, { kind: 'sandbox.start' }>,
): Promise<void> {
  if (activeRequestId !== undefined) {
    complete({
      requestId: message.requestId,
      status: 'failed',
      error: 'Sandbox is already running.',
    })
    return
  }
  activeRequestId = message.requestId
  cancelled = false
  try {
    const result = await runQuickJs({
      document: message.document,
      permissionGrant: message.permissionGrant,
      limits: message.limits,
      api: parseGeneratedScriptApi(message.api),
      invoke: (api, input) => invokeCapability(message.requestId, api, input),
      log: (level, logMessage) =>
        send({
          schemaVersion: 1,
          kind: 'sandbox.log',
          requestId: message.requestId,
          level,
          message: logMessage,
        }),
      aborted: () => cancelled,
      onExecutionStart: () =>
        send({ schemaVersion: 1, kind: 'sandbox.executing', requestId: message.requestId }),
    })
    complete({ requestId: message.requestId, status: 'completed', output: result.output })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Sandbox execution failed.'
    const limit = /limit|interrupted|out of memory|stack overflow/iu.test(detail)
    complete({
      requestId: message.requestId,
      status: cancelled ? 'cancelled' : limit ? 'limit-exceeded' : 'failed',
      error: detail.slice(0, 4_096),
    })
  } finally {
    activeRequestId = undefined
    for (const pending of capabilityResults.values()) pending.reject(new Error('Sandbox stopped.'))
    capabilityResults.clear()
  }
}

scope.addEventListener('message', (event) => {
  const parsed = validateSandboxHostMessage(event.data)
  if (!parsed.ok || parsed.value === undefined) {
    if (activeRequestId !== undefined)
      complete({ requestId: activeRequestId, status: 'failed', error: 'Malformed host message.' })
    return
  }
  const message = parsed.value
  if (message.kind === 'sandbox.start') void run(message)
  else if (message.kind === 'sandbox.cancel') cancelled = true
  else settleCapability(message)
})

send({ schemaVersion: 1, kind: 'sandbox.ready' })
