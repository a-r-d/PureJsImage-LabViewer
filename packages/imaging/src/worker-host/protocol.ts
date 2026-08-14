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
  const record =
    typeof error === 'object' && error !== null ? (error as { readonly code?: unknown }) : {}
  const code = typeof record.code === 'string' ? record.code : undefined
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown worker error'
  if (
    fallback === 'SOURCE_OPEN_FAILED' &&
    (error instanceof TypeError || /cors|range|fetch|network|content-range|206/iu.test(message))
  ) {
    return {
      code: 'CORS_OR_RANGE_UNAVAILABLE',
      message,
      guidance:
        'Confirm the server allows this origin, supports byte Range requests, and exposes Content-Range.',
      retryable: true,
    }
  }
  if (code === 'LIMIT_EXCEEDED') return { code: 'LIMIT_EXCEEDED', message, retryable: false }
  if (code === 'STALE_ID') return { code: 'STALE_ID', message, retryable: false }
  if (code === 'UNSUPPORTED_FORMAT' || code === 'UNSUPPORTED_FEATURE')
    return { code: 'UNSUPPORTED', message, retryable: false }
  return { code: fallback, message, retryable: fallback !== 'INVALID_PAYLOAD' }
}
