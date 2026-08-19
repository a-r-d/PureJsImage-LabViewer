import {
  RPC_SCHEMA_VERSION,
  RpcValidationError,
  type StructuredRpcError,
  type WorkerResponse,
} from '@pji-workbench/contracts'

export interface WorkerHostResult {
  readonly response: WorkerResponse
  readonly transfer: readonly Transferable[]
}

export function success(
  requestId: string,
  kind: Extract<WorkerResponse, { readonly ok: true }>['kind'],
  payload: unknown,
): WorkerHostResult {
  return {
    response: {
      schemaVersion: RPC_SCHEMA_VERSION,
      requestId,
      ok: true,
      kind,
      payload,
    } as WorkerResponse,
    transfer: [],
  }
}

export function errorResult(requestId: string, error: StructuredRpcError): WorkerHostResult {
  return {
    response: { schemaVersion: RPC_SCHEMA_VERSION, requestId, ok: false, kind: 'error', error },
    transfer: [],
  }
}

export function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError')
}

export function structuredError(
  error: unknown,
  fallback: StructuredRpcError['code'],
): StructuredRpcError {
  if (error instanceof RpcValidationError)
    return { code: error.code, message: error.message, retryable: false }
  if (error instanceof DOMException && error.name === 'AbortError')
    return {
      code: 'ABORTED',
      message: error.message || 'The request was cancelled.',
      retryable: true,
    }
  if (isStructuredRpcError(error)) return error
  const record =
    typeof error === 'object' && error !== null ? (error as { readonly code?: unknown }) : {}
  const code = typeof record.code === 'string' ? record.code : undefined
  const message = errorMessage(error)
  const cause = error instanceof Error ? error.cause : undefined
  const causeMessage = errorMessage(cause)
  const combined = `${message} ${causeMessage}`
  if (fallback === 'SOURCE_OPEN_FAILED') {
    const network = classifyNetworkOpenError(error, combined)
    if (network !== undefined) return network
  }
  if (code === 'LIMIT_EXCEEDED') return { code: 'LIMIT_EXCEEDED', message, retryable: false }
  if (code === 'STALE_ID') return { code: 'STALE_ID', message, retryable: false }
  if (
    code === 'UNSUPPORTED_FORMAT' ||
    code === 'UNSUPPORTED_FEATURE' ||
    code === 'UNSUPPORTED_OPERATION'
  )
    return { code: 'UNSUPPORTED', message, retryable: false }
  return { code: fallback, message, retryable: fallback !== 'INVALID_PAYLOAD' }
}

function classifyNetworkOpenError(
  error: unknown,
  combined: string,
): StructuredRpcError | undefined {
  const cause = error instanceof Error ? error.cause : undefined
  const fetchBlocked =
    /cors|failed to fetch|networkerror|load failed/iu.test(combined) ||
    ((error instanceof TypeError || cause instanceof TypeError) &&
      /range probe failed|range request failed/iu.test(combined))
  if (fetchBlocked) {
    return {
      code: 'CORS_FAILED',
      message: errorMessage(error),
      guidance:
        'The server blocked this origin. Confirm CORS allows GET with Range from this application.',
      retryable: true,
    }
  }
  if (
    /must support byte ranges|content-range|content-encoded|probe returned status|range response/iu.test(
      combined,
    )
  ) {
    return {
      code: 'RANGE_UNSUPPORTED',
      message: errorMessage(error),
      guidance:
        'The server must answer Range requests with HTTP 206 and a Content-Range header. A 200 full-body response is not enough.',
      retryable: true,
    }
  }
  return undefined
}

function isStructuredRpcError(error: unknown): error is StructuredRpcError {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as {
    readonly code?: unknown
    readonly message?: unknown
    readonly retryable?: unknown
  }
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean' &&
    (candidate.code === 'UNSUPPORTED_COMPRESSION' ||
      candidate.code === 'UNSUPPORTED_LAYOUT' ||
      candidate.code === 'MALFORMED_METADATA' ||
      candidate.code === 'CORS_FAILED' ||
      candidate.code === 'RANGE_UNSUPPORTED')
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown worker error'
}
