import {
  type AnalysisScriptDocumentV1,
  type PluginJsonValue,
  type SandboxLimitsV1,
  type ScriptPermissionGrantV1,
  scriptContentIntegrity,
  validateAnalysisScriptDocument,
  validatePermissionGrant,
  validatePluginJsonValue,
} from '@pji-workbench/plugin-sdk'
import type {
  QuickJSContext,
  QuickJSHandle,
  QuickJSRuntime,
  QuickJSWASMModule,
} from 'quickjs-emscripten-core'
import type { GeneratedScriptApiV1 } from './catalog.js'
import { loadReleaseQuickJs } from './release-module.js'

export interface QuickJsRunOptions {
  readonly document: AnalysisScriptDocumentV1
  readonly permissionGrant: ScriptPermissionGrantV1
  readonly limits: SandboxLimitsV1
  readonly api: GeneratedScriptApiV1
  readonly invoke: (api: string, input: PluginJsonValue) => Promise<PluginJsonValue>
  readonly log: (level: 'info' | 'warn' | 'error', message: string) => void
  readonly module?: QuickJSWASMModule
  readonly aborted?: () => boolean
  readonly onExecutionStart?: () => void
}

export interface QuickJsRunResult {
  readonly output: PluginJsonValue
  readonly apiCalls: number
  readonly consoleLines: number
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function errorMessage(vm: QuickJSContext, handle: QuickJSHandle): string {
  const dumped: unknown = vm.dump(handle)
  if (typeof dumped === 'object' && dumped !== null && 'message' in dumped) {
    const message = (dumped as { readonly message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return typeof dumped === 'string' ? dumped : JSON.stringify(dumped)
}

function jsonHandle(vm: QuickJSContext, value: PluginJsonValue): QuickJSHandle {
  const encoded = JSON.stringify(value)
  const result = vm.evalCode(`JSON.parse(${JSON.stringify(encoded)})`)
  if (result.error !== undefined) {
    const message = errorMessage(vm, result.error)
    result.error.dispose()
    throw new Error(message)
  }
  return result.value
}

function installBridge(
  vm: QuickJSContext,
  options: QuickJsRunOptions,
  counters: { apiCalls: number; consoleLines: number },
): void {
  const call = vm.newFunction('__labCall', (apiHandle, inputHandle) => {
    const api = vm.getString(apiHandle)
    const promise = vm.newPromise()
    counters.apiCalls += 1
    if (counters.apiCalls > options.limits.apiCalls) {
      const reason = vm.newError('Sandbox API call limit exceeded.')
      promise.reject(reason)
      reason.dispose()
    } else {
      const encodedInput = vm.getString(inputHandle)
      if (byteLength(encodedInput) > options.limits.messageBytes) {
        const reason = vm.newError('Capability input exceeds byte limit.')
        promise.reject(reason)
        reason.dispose()
        return promise.handle
      }
      let input: unknown
      try {
        input = JSON.parse(encodedInput)
      } catch {
        const reason = vm.newError('Capability input must be JSON serializable.')
        promise.reject(reason)
        reason.dispose()
        return promise.handle
      }
      const validation = validatePluginJsonValue(input, options.limits.messageBytes)
      if (!validation.ok || validation.value === undefined) {
        const reason = vm.newError('Capability input must be a bounded JSON value.')
        promise.reject(reason)
        reason.dispose()
        return promise.handle
      }
      void options
        .invoke(api, validation.value)
        .then((value) => {
          const handle = jsonHandle(vm, value)
          promise.resolve(handle)
          handle.dispose()
        })
        .catch((error: unknown) => {
          const reason = vm.newError(
            error instanceof Error ? error.message : 'Capability call failed.',
          )
          promise.reject(reason)
          reason.dispose()
        })
    }
    void promise.settled.then(() => vm.runtime.executePendingJobs())
    return promise.handle
  })
  vm.setProp(vm.global, '__labCall', call)
  call.dispose()

  const consoleObject = vm.newObject()
  for (const level of ['info', 'warn', 'error'] as const) {
    const method = vm.newFunction(level, (...args) => {
      counters.consoleLines += 1
      if (counters.consoleLines > options.limits.consoleLines)
        throw new Error('Sandbox console line limit exceeded.')
      options.log(
        level,
        args
          .map((handle) => String(vm.dump(handle)))
          .join(' ')
          .slice(0, 4_096),
      )
    })
    vm.setProp(consoleObject, level, method)
    method.dispose()
  }
  vm.setProp(vm.global, 'console', consoleObject)
  consoleObject.dispose()
}

function serializeHandle(vm: QuickJSContext, handle: QuickJSHandle): string {
  const json = vm.getProp(vm.global, 'JSON')
  const stringify = vm.getProp(json, 'stringify')
  const result = vm.callFunction(stringify, json, handle)
  stringify.dispose()
  json.dispose()
  if (result.error !== undefined) {
    const message = errorMessage(vm, result.error)
    result.error.dispose()
    throw new Error(message)
  }
  if (vm.typeof(result.value) !== 'string') {
    result.value.dispose()
    throw new Error('Sandbox output must be JSON serializable.')
  }
  const encoded = vm.getString(result.value)
  result.value.dispose()
  return encoded
}

function configureRuntime(runtime: QuickJSRuntime, options: QuickJsRunOptions): void {
  runtime.setMemoryLimit(options.limits.memoryBytes)
  runtime.setMaxStackSize(options.limits.stackBytes)
  runtime.setModuleLoader((moduleName) => {
    if (moduleName !== '@lab/api') throw new Error(`Module is not permitted: ${moduleName}`)
    return options.api.moduleSource
  })
}

function startExecutionDeadline(runtime: QuickJSRuntime, options: QuickJsRunOptions): void {
  const deadline = performance.now() + options.limits.deadlineMilliseconds
  runtime.setInterruptHandler(() => performance.now() > deadline || options.aborted?.() === true)
}

function hardenContext(vm: QuickJSContext): void {
  const result = vm.evalCode(`
    delete globalThis.Date;
    delete globalThis.SharedArrayBuffer;
    Object.defineProperty(Math, 'random', {
      configurable: false,
      enumerable: false,
      value() { throw new Error('Randomness is unavailable in deterministic mode.'); }
    });
  `)
  if (result.error !== undefined) {
    const message = errorMessage(vm, result.error)
    result.error.dispose()
    throw new Error(message)
  }
  result.value.dispose()
}

function assertDocumentSource(document: AnalysisScriptDocumentV1): void {
  if (document.language !== 'javascript')
    throw new Error('TypeScript execution is reserved for the full Script Studio compiler.')
  if (byteLength(document.source) === 0) throw new Error('Script source is empty.')
  if (!document.source.includes('__scriptMain = main'))
    throw new Error('Script must export main and bind globalThis.__scriptMain.')
}

async function validateRun(options: QuickJsRunOptions): Promise<void> {
  const documentResult = validateAnalysisScriptDocument(options.document)
  if (!documentResult.ok)
    throw new Error(
      documentResult.issues.map(({ path, message }) => `${path || '/'}: ${message}`).join('\n'),
    )
  const grantResult = validatePermissionGrant(options.permissionGrant)
  if (!grantResult.ok)
    throw new Error(
      grantResult.issues.map(({ path, message }) => `${path || '/'}: ${message}`).join('\n'),
    )
  assertDocumentSource(options.document)
  if (byteLength(options.document.source) > options.limits.sourceBytes)
    throw new Error('Sandbox source byte limit exceeded.')
  const { integrity: _integrity, ...withoutIntegrity } = options.document
  const integrity = await scriptContentIntegrity(withoutIntegrity)
  if (integrity.digest !== options.document.integrity.digest)
    throw new Error('Script content integrity mismatch.')
  if (
    options.permissionGrant.scriptId !== options.document.id ||
    options.permissionGrant.sourceDigest !== integrity.digest
  )
    throw new Error('Permission grant does not match script identity.')
  const requested = new Set(options.document.manifest.requestedCapabilities)
  if (options.permissionGrant.grantedCapabilities.some((capability) => !requested.has(capability)))
    throw new Error('Permission grant exceeds requested capabilities.')
}

export async function runQuickJs(options: QuickJsRunOptions): Promise<QuickJsRunResult> {
  await validateRun(options)
  const module = options.module ?? (await loadReleaseQuickJs())
  const runtime = module.newRuntime()
  const vm = runtime.newContext()
  const counters = { apiCalls: 0, consoleLines: 0 }
  try {
    configureRuntime(runtime, options)
    hardenContext(vm)
    installBridge(vm, options, counters)
    startExecutionDeadline(runtime, options)
    options.onExecutionStart?.()
    const moduleResult = vm.evalCode(options.document.source, `${options.document.id}.mjs`, {
      type: 'module',
    })
    if (moduleResult.error !== undefined) {
      const message = errorMessage(vm, moduleResult.error)
      moduleResult.error.dispose()
      throw new Error(message)
    }
    moduleResult.value.dispose()
    const runResult = vm.evalCode('Promise.resolve(globalThis.__scriptMain())')
    if (runResult.error !== undefined) {
      const message = errorMessage(vm, runResult.error)
      runResult.error.dispose()
      throw new Error(message)
    }
    const promise = runResult.value
    const settlement = vm.resolvePromise(promise)
    runtime.executePendingJobs()
    const settled = await settlement
    promise.dispose()
    if (settled.error !== undefined) {
      const message = errorMessage(vm, settled.error)
      settled.error.dispose()
      throw new Error(message)
    }
    const encoded = serializeHandle(vm, settled.value)
    settled.value.dispose()
    if (byteLength(encoded) > options.limits.outputBytes)
      throw new Error('Sandbox output byte limit exceeded.')
    const output: unknown = JSON.parse(encoded)
    const validation = validatePluginJsonValue(output, options.limits.outputBytes)
    if (!validation.ok || validation.value === undefined)
      throw new Error('Sandbox output must be a bounded JSON value.')
    return { output: validation.value, ...counters }
  } finally {
    vm.dispose()
    runtime.dispose()
  }
}
