export const RPC_SCHEMA_VERSION = 1 as const

export interface RpcEnvelope {
  readonly schemaVersion: typeof RPC_SCHEMA_VERSION
  readonly requestId: string
  readonly kind: string
  readonly payload: unknown
}

interface RpcEnvelopeCandidate {
  readonly schemaVersion?: unknown
  readonly requestId?: unknown
  readonly kind?: unknown
  readonly payload?: unknown
}

export function isRpcEnvelope(value: unknown): value is RpcEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as RpcEnvelopeCandidate
  return (
    candidate.schemaVersion === RPC_SCHEMA_VERSION &&
    typeof candidate.requestId === 'string' &&
    candidate.requestId.length > 0 &&
    typeof candidate.kind === 'string' &&
    candidate.kind.length > 0 &&
    'payload' in candidate
  )
}
