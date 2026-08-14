import { describe, expect, it } from 'vitest'

import { ScriptHostClient } from '../src/index.js'
import { fixtureInvoker, scriptFixture, testApi, testLimits } from './helpers.js'

class FakeWorker extends EventTarget {
  readonly messages: unknown[] = []
  terminated = false

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  emitMessage(data: unknown): void {
    const event = new Event('message') as Event & { data: unknown }
    Object.defineProperty(event, 'data', { value: data })
    this.dispatchEvent(event)
  }
}

describe('ScriptHostClient lifecycle', () => {
  it('cancels by terminating the dedicated Worker and returns immutable provenance', async () => {
    const worker = new FakeWorker()
    const fixture = await scriptFixture(
      `export function main() { while (true) {} }\nglobalThis.__scriptMain = main`,
    )
    const client = new ScriptHostClient({
      api: testApi,
      invoker: fixtureInvoker,
      workerFactory: () => worker as unknown as Worker,
    })
    const result = client.run({ document: fixture.document, permissionGrant: fixture.grant })
    expect(worker.messages).toHaveLength(1)
    client.cancel()
    await expect(result).resolves.toMatchObject({
      status: 'cancelled',
      error: 'Execution cancelled; sandbox Worker terminated.',
      provenance: {
        scriptId: 'test-script',
        sourceHash: fixture.document.integrity,
        permissions: fixture.grant,
      },
    })
    expect(worker.terminated).toBe(true)
  })

  it('terminates the Worker on malformed or cross-request messages', async () => {
    const worker = new FakeWorker()
    const fixture = await scriptFixture(
      `export function main() { return null }\nglobalThis.__scriptMain = main`,
    )
    const client = new ScriptHostClient({
      api: testApi,
      invoker: fixtureInvoker,
      workerFactory: () => worker as unknown as Worker,
    })
    const result = client.run({ document: fixture.document, permissionGrant: fixture.grant })
    worker.emitMessage({ schemaVersion: 1, kind: 'sandbox.complete', requestId: '../wrong' })
    await expect(result).resolves.toMatchObject({
      status: 'failed',
      error: 'Malformed sandbox Worker message.',
    })
    expect(worker.terminated).toBe(true)
  })

  it('terminates stalled and oversized Worker exchanges', async () => {
    const stalledWorker = new FakeWorker()
    const fixture = await scriptFixture(
      `export function main() { return null }\nglobalThis.__scriptMain = main`,
    )
    const stalledClient = new ScriptHostClient({
      api: testApi,
      invoker: fixtureInvoker,
      workerFactory: () => stalledWorker as unknown as Worker,
    })
    await expect(
      stalledClient.run({
        document: fixture.document,
        permissionGrant: fixture.grant,
        limits: { ...testLimits, deadlineMilliseconds: 10 },
      }),
    ).resolves.toMatchObject({
      status: 'limit-exceeded',
      error: 'Sandbox execution deadline exceeded.',
    })
    expect(stalledWorker.terminated).toBe(true)

    const oversizedWorker = new FakeWorker()
    const oversizedClient = new ScriptHostClient({
      api: testApi,
      invoker: fixtureInvoker,
      workerFactory: () => oversizedWorker as unknown as Worker,
    })
    const result = oversizedClient.run({
      document: fixture.document,
      permissionGrant: fixture.grant,
      limits: { ...testLimits, messageBytes: 256 },
    })
    const startMessage = oversizedWorker.messages[0] as { readonly requestId: string }
    oversizedWorker.emitMessage({
      schemaVersion: 1,
      kind: 'sandbox.log',
      requestId: startMessage.requestId,
      level: 'info',
      message: 'x'.repeat(300),
    })
    await expect(result).resolves.toMatchObject({ status: 'limit-exceeded' })
    expect(oversizedWorker.terminated).toBe(true)
  })
})
