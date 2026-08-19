import { StacClientError } from '../stac/types.js'

export const DEFAULT_CATALOG_MAX_JSON_BYTES = 8 * 1024 * 1024
export const DEFAULT_CATALOG_TIMEOUT_MS = 30_000

export interface CatalogJsonFetchOptions {
  readonly fetch: typeof fetch
  readonly maxBytes?: number
  readonly timeoutMs?: number
}

export interface CatalogJsonRequest {
  readonly href: string
  readonly method?: 'GET' | 'POST' | 'HEAD'
  readonly body?: unknown
  readonly signal?: AbortSignal
  readonly maxBytes?: number
}

export async function fetchCatalogJson(
  options: CatalogJsonFetchOptions,
  request: CatalogJsonRequest,
): Promise<unknown> {
  const maxBytes = request.maxBytes ?? options.maxBytes ?? DEFAULT_CATALOG_MAX_JSON_BYTES
  const method = request.method ?? 'GET'
  if (method === 'HEAD') {
    const response = await catalogFetch(options, request, method)
    const length = contentLength(response)
    if (length !== undefined && length > maxBytes) {
      throw tooLarge(request.href, maxBytes)
    }
    return undefined
  }
  const response = await catalogFetch(options, request, method)
  const length = contentLength(response)
  if (length !== undefined && length > maxBytes) {
    try {
      await response.body?.cancel()
    } catch {
      // Best-effort; the body may already be closed.
    }
    throw tooLarge(request.href, maxBytes)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) {
    throw tooLarge(request.href, maxBytes)
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new StacClientError('INVALID_DOCUMENT', 'The catalog response was not valid JSON.')
  }
}

export async function headCatalogBytes(
  options: CatalogJsonFetchOptions,
  href: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  try {
    const response = await catalogFetch(
      options,
      { href, ...(signal === undefined ? {} : { signal }) },
      'HEAD',
    )
    try {
      await response.body?.cancel()
    } catch {
      // HEAD bodies are empty.
    }
    return contentLength(response)
  } catch (error) {
    if (error instanceof StacClientError && error.code === 'ABORTED') throw error
    return undefined
  }
}

export function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return false
  }
}

export function httpMethod(value: string | undefined): 'GET' | 'POST' | undefined {
  if (value === undefined) return undefined
  const method = value.toUpperCase()
  if (method === 'GET' || method === 'POST') return method
  return undefined
}

function catalogFetch(
  options: CatalogJsonFetchOptions,
  request: CatalogJsonRequest,
  method: 'GET' | 'POST' | 'HEAD',
): Promise<Response> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS)
  const signal = request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout])
  const init: RequestInit = { method, signal }
  if (method === 'POST') {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(request.body ?? {})
  }
  return options.fetch
    .call(globalThis, request.href, init)
    .then((response) => {
      if (response.status === 404) {
        throw new StacClientError('NOT_FOUND', `Catalog resource not found: ${request.href}`)
      }
      if (!response.ok) {
        throw new StacClientError(
          'UNAVAILABLE',
          `Catalog request failed with HTTP ${response.status}.`,
          'Retry later, or refresh the catalog cache.',
        )
      }
      return response
    })
    .catch((error: unknown) => {
      if (error instanceof StacClientError) throw error
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new StacClientError('ABORTED', 'The catalog request was cancelled.')
      }
      throw new StacClientError(
        'UNAVAILABLE',
        error instanceof Error ? error.message : 'The catalog could not be reached.',
        'The server may be offline, or this origin may be blocked by CORS.',
      )
    })
}

function contentLength(response: Response): number | undefined {
  const header = response.headers.get('content-length')
  if (header === null || header.length === 0) return undefined
  const size = Number(header)
  return Number.isSafeInteger(size) && size >= 0 ? size : undefined
}

function tooLarge(href: string, maxBytes: number): StacClientError {
  return new StacClientError(
    'TOO_LARGE',
    `Catalog document exceeds ${String(maxBytes)} bytes: ${href}`,
    'This static STAC item collection is too large to browse directly in the browser.',
  )
}
