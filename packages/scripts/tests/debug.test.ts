import DEBUG_SYNC from '@jitl/quickjs-wasmfile-debug-sync'
import { newQuickJSWASMModuleFromVariant, TestQuickJSWASMModule } from 'quickjs-emscripten-core'
import { expect, it } from 'vitest'

import { runQuickJs } from '../src/runner.js'
import { scriptFixture, testApi, testLimits } from './helpers.js'

it('disposes every QuickJS handle, context, and runtime under the debug leak detector', async () => {
  const parent = await newQuickJSWASMModuleFromVariant(DEBUG_SYNC)
  const module = new TestQuickJSWASMModule(parent)
  const fixture = await scriptFixture(
    `export function main() { return { ok: true } }\nglobalThis.__scriptMain = main`,
  )
  await expect(
    runQuickJs({
      document: fixture.document,
      permissionGrant: fixture.grant,
      limits: testLimits,
      api: testApi,
      module,
      invoke: () => Promise.resolve(null),
      log: () => undefined,
    }),
  ).resolves.toMatchObject({ output: { ok: true } })
  expect([...module.runtimes].every(({ alive }) => !alive)).toBe(true)
  expect([...module.contexts].every(({ alive }) => !alive)).toBe(true)
  module.disposeAll()
  expect(() => module.assertNoMemoryAllocated()).not.toThrow()
}, 15_000)
