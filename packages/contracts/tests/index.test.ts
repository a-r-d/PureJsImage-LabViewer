import { describe, expect, it } from 'vitest'

import { isRpcEnvelope, RPC_SCHEMA_VERSION } from '../src/index.js'

describe('RPC envelope', () => {
  it('accepts the bounded JSON-safe shell', () => {
    expect(
      isRpcEnvelope({
        schemaVersion: RPC_SCHEMA_VERSION,
        requestId: 'request-1',
        kind: 'runtime.ping',
        payload: null,
      }),
    ).toBe(true)
  })

  it('rejects unknown versions', () => {
    expect(
      isRpcEnvelope({ schemaVersion: 2, requestId: 'request-1', kind: 'ping', payload: null }),
    ).toBe(false)
  })
})
