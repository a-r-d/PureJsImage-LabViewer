import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync'
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core'
import { describe, expect, it } from 'vitest'

import { ScriptCapabilityHost } from '../src/index.js'
import { runQuickJs } from '../src/runner.js'
import { fixtureInvoker, scriptFixture, testApi, testLimits } from './helpers.js'

describe('QuickJS release sandbox', () => {
  it('exposes only the generated API and no ambient browser, storage, network, clock, or random access', async () => {
    const module = await newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
    const fixture = await scriptFixture(`
      export async function main() {
        return {
          window: typeof window,
          document: typeof document,
          storage: typeof localStorage,
          indexedDb: typeof indexedDB,
          fetch: typeof fetch,
          websocket: typeof WebSocket,
          eventSource: typeof EventSource,
          xhr: typeof XMLHttpRequest,
          worker: typeof Worker,
          navigator: typeof navigator,
          crypto: typeof crypto,
          date: typeof Date,
          shared: typeof SharedArrayBuffer,
          credential: typeof OPENROUTER_API_KEY,
          randomDenied: (() => { try { Math.random(); return false } catch { return true } })()
        }
      }
      globalThis.__scriptMain = main
    `)
    await expect(
      runQuickJs({
        ...fixture,
        permissionGrant: fixture.grant,
        limits: testLimits,
        api: testApi,
        module,
        invoke: () => Promise.resolve(null),
        log: () => undefined,
      }),
    ).resolves.toMatchObject({
      output: {
        window: 'undefined',
        document: 'undefined',
        storage: 'undefined',
        indexedDb: 'undefined',
        fetch: 'undefined',
        websocket: 'undefined',
        eventSource: 'undefined',
        xhr: 'undefined',
        worker: 'undefined',
        navigator: 'undefined',
        crypto: 'undefined',
        date: 'undefined',
        shared: 'undefined',
        credential: 'undefined',
        randomDenied: true,
      },
    })
  }, 15_000)

  it('routes generated API calls through permission and action validation', async () => {
    const module = await newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
    const fixture = await scriptFixture(
      `import { lab } from '@lab/api'
       export async function main() {
         const summary = await lab.workspace.getSummary()
         return { title: summary.title }
       }
       globalThis.__scriptMain = main`,
      ['workspace.read'],
    )
    const host = new ScriptCapabilityHost({
      api: testApi,
      document: fixture.document,
      permissionGrant: fixture.grant,
      invoker: fixtureInvoker,
      maximumBytes: testLimits.messageBytes,
    })
    const result = await runQuickJs({
      document: fixture.document,
      permissionGrant: fixture.grant,
      limits: testLimits,
      api: testApi,
      module,
      invoke: (api, input) => host.invoke(api, input),
      log: () => undefined,
    })
    expect(result.output).toEqual({ title: 'Generated particles' })
    expect(host.result().trace).toMatchObject([
      { actionId: 'workspace.summary.read', permission: 'workspace.read', outcome: 'allowed' },
    ])

    const denied = await scriptFixture(
      `import { lab } from '@lab/api'
       export async function main() { return lab.analysis.catalog() }
       globalThis.__scriptMain = main`,
      ['workspace.read'],
    )
    const deniedHost = new ScriptCapabilityHost({
      api: testApi,
      document: denied.document,
      permissionGrant: denied.grant,
      invoker: fixtureInvoker,
      maximumBytes: testLimits.messageBytes,
    })
    await expect(
      runQuickJs({
        document: denied.document,
        permissionGrant: denied.grant,
        limits: testLimits,
        api: testApi,
        module,
        invoke: (api, input) => deniedHost.invoke(api, input),
        log: () => undefined,
      }),
    ).rejects.toThrow('Capability is not granted')
  }, 15_000)

  it('terminates infinite loops, stack growth, oversized output, and API-call exhaustion', async () => {
    const module = await newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
    const infinite = await scriptFixture(
      `export function main() { while (true) {} }\nglobalThis.__scriptMain = main`,
    )
    await expect(
      runQuickJs({
        document: infinite.document,
        permissionGrant: infinite.grant,
        limits: { ...testLimits, deadlineMilliseconds: 20 },
        api: testApi,
        module,
        invoke: () => Promise.resolve(null),
        log: () => undefined,
      }),
    ).rejects.toThrow(/interrupted/iu)

    const output = await scriptFixture(
      `export function main() { return 'x'.repeat(4096) }\nglobalThis.__scriptMain = main`,
    )
    await expect(
      runQuickJs({
        document: output.document,
        permissionGrant: output.grant,
        limits: { ...testLimits, outputBytes: 64 },
        api: testApi,
        module,
        invoke: () => Promise.resolve(null),
        log: () => undefined,
      }),
    ).rejects.toThrow('output byte limit')

    const nonJsonOutput = await scriptFixture(
      `export function main() { return undefined }\nglobalThis.__scriptMain = main`,
    )
    await expect(
      runQuickJs({
        document: nonJsonOutput.document,
        permissionGrant: nonJsonOutput.grant,
        limits: testLimits,
        api: testApi,
        module,
        invoke: () => Promise.resolve(null),
        log: () => undefined,
      }),
    ).rejects.toThrow('output must be JSON serializable')
  }, 15_000)

  it('rejects source identity changes before evaluating code', async () => {
    const module = await newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
    const fixture = await scriptFixture(
      `export function main() { return 1 }\nglobalThis.__scriptMain = main`,
    )
    await expect(
      runQuickJs({
        document: { ...fixture.document, source: `${fixture.document.source}\n// changed` },
        permissionGrant: fixture.grant,
        limits: testLimits,
        api: testApi,
        module,
        invoke: () => Promise.resolve(null),
        log: () => undefined,
      }),
    ).rejects.toThrow('integrity mismatch')
  }, 15_000)

  it('denies unrestricted imports and enforces stack, memory, console, and API quotas', async () => {
    const importModule = await newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
    const imported = await scriptFixture(
      `import secret from 'unapproved-module'\nexport function main() { return secret }\nglobalThis.__scriptMain = main`,
    )
    await expect(
      runQuickJs({
        document: imported.document,
        permissionGrant: imported.grant,
        limits: testLimits,
        api: testApi,
        module: importModule,
        invoke: () => Promise.resolve(null),
        log: () => undefined,
      }),
    ).rejects.toThrow('Module is not permitted')

    const stackModule = await newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
    const stack = await scriptFixture(
      `function recurse() { return recurse() }\nexport function main() { return recurse() }\nglobalThis.__scriptMain = main`,
    )
    await expect(
      runQuickJs({
        document: stack.document,
        permissionGrant: stack.grant,
        limits: { ...testLimits, stackBytes: 65_536 },
        api: testApi,
        module: stackModule,
        invoke: () => Promise.resolve(null),
        log: () => undefined,
      }),
    ).rejects.toThrow(/stack|interrupted/iu)

    const memoryModule = await newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
    const memory = await scriptFixture(
      `export function main() { const values = []; while (true) values.push('x'.repeat(4096)) }\nglobalThis.__scriptMain = main`,
    )
    await expect(
      runQuickJs({
        document: memory.document,
        permissionGrant: memory.grant,
        limits: { ...testLimits, memoryBytes: 1_048_576 },
        api: testApi,
        module: memoryModule,
        invoke: () => Promise.resolve(null),
        log: () => undefined,
      }),
    ).rejects.toThrow(/memory|interrupted|null/iu)

    const apiModule = await newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
    const calls = await scriptFixture(
      `import { lab } from '@lab/api'\nexport async function main() { await lab.workspace.getSummary(); await lab.workspace.getSummary(); return lab.workspace.getSummary() }\nglobalThis.__scriptMain = main`,
      ['workspace.read'],
    )
    await expect(
      runQuickJs({
        document: calls.document,
        permissionGrant: calls.grant,
        limits: { ...testLimits, apiCalls: 2 },
        api: testApi,
        module: apiModule,
        invoke: () => Promise.resolve({ ok: true }),
        log: () => undefined,
      }),
    ).rejects.toThrow('API call limit')

    const consoleModule = await newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
    const consoleFixture = await scriptFixture(
      `export function main() { console.info('one'); console.info('two'); return null }\nglobalThis.__scriptMain = main`,
    )
    await expect(
      runQuickJs({
        document: consoleFixture.document,
        permissionGrant: consoleFixture.grant,
        limits: { ...testLimits, consoleLines: 1 },
        api: testApi,
        module: consoleModule,
        invoke: () => Promise.resolve(null),
        log: () => undefined,
      }),
    ).rejects.toThrow('console line limit')
  }, 15_000)
})
