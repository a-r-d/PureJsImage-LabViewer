import { BoundedBodyError, cancelBody, readBoundedResponseBytes } from './bounded-response.js'

/**
 * Some object stores answer HTTP 206 correctly but do not expose Content-Range to browser
 * JavaScript. Validate the exact response body first, discover the object size with bounded
 * probes, and only then reconstruct the hidden header for PureJsImage's HttpRangeSource.
 */
const UNSATISFIABLE_RANGE = 'bytes=9007199254740990-9007199254740990'
const SIZE_PROBE_BODY_LIMIT = 65_536
const MAX_RANGE_RESPONSE_BYTES = 8 * 1024 * 1024

export type RangeFetchErrorCode =
  | 'INVALID_RANGE'
  | 'MULTIPART_RANGE'
  | 'CONTENT_ENCODING'
  | 'INVALID_CONTENT_RANGE'
  | 'OBJECT_SIZE_UNAVAILABLE'

export class RangeFetchError extends Error {
  constructor(
    readonly code: RangeFetchErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'RangeFetchError'
  }
}

export function wrapFetchToExposeContentRange(baseFetch: typeof fetch): typeof fetch {
  const sizes = new Map<string, number>()
  const inflight = new Map<string, Promise<number | undefined>>()

  const resolveSize = (url: string, init: RequestInit | undefined): Promise<number | undefined> => {
    const cached = sizes.get(url)
    if (cached !== undefined) return Promise.resolve(cached)
    const pending = inflight.get(url)
    if (pending !== undefined) return pending
    const probe = discoverObjectSize(baseFetch, url, init).then((size) => {
      if (size !== undefined) sizes.set(url, size)
      return size
    })
    inflight.set(url, probe)
    return probe.finally(() => {
      inflight.delete(url)
    })
  }

  return async (input, init) => {
    const range = parseRequestByteRange(input, init)
    const response = await baseFetch(input, init)
    if (range === undefined) return response
    if (response.status === 200) {
      await cancelBody(response, 'Server ignored the Range request.')
      return responseWithoutBody(response)
    }
    if (response.status !== 206) return response

    const contentType = response.headers.get('content-type')?.toLowerCase()
    if (contentType?.startsWith('multipart/byteranges') === true) {
      await cancelBody(response, 'Multipart ranges are not supported.')
      throw new RangeFetchError('MULTIPART_RANGE', 'HTTP range responses must not be multipart.')
    }
    const encoding = response.headers.get('content-encoding')
    if (encoding !== null && encoding.length > 0 && encoding.toLowerCase() !== 'identity') {
      await cancelBody(response, 'Content-encoded ranges are not supported.')
      throw new RangeFetchError(
        'CONTENT_ENCODING',
        `HTTP range response used unsupported content encoding ${encoding}.`,
      )
    }
    if (range.end === undefined || range.end < range.start) {
      await cancelBody(response, 'Open-ended or invalid ranges are not supported.')
      throw new RangeFetchError(
        'INVALID_RANGE',
        'HTTP range requests must declare a finite inclusive byte extent.',
      )
    }
    const expectedBytes = range.end - range.start + 1
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > MAX_RANGE_RESPONSE_BYTES
    ) {
      await cancelBody(response, 'Range response exceeds the hard byte limit.')
      throw new RangeFetchError(
        'INVALID_RANGE',
        `HTTP range extent exceeds ${String(MAX_RANGE_RESPONSE_BYTES)} bytes.`,
      )
    }

    const exposed = response.headers.get('content-range')
    const parsed = exposed === null ? undefined : parseSatisfiedContentRange(exposed)
    if (
      exposed !== null &&
      (parsed === undefined ||
        parsed.start !== range.start ||
        parsed.end !== range.end ||
        parsed.end >= parsed.total)
    ) {
      await cancelBody(response, 'Content-Range does not match the request.')
      throw new RangeFetchError(
        'INVALID_CONTENT_RANGE',
        `HTTP Content-Range ${exposed} does not match bytes ${String(range.start)}-${String(range.end)}.`,
      )
    }

    const bytes = await readBoundedResponseBytes(response, {
      maxBytes: expectedBytes,
      exactBytes: expectedBytes,
      ...(init?.signal == null ? {} : { signal: init.signal }),
      label: `HTTP range ${String(range.start)}-${String(range.end)}`,
    })
    const url = requestHref(input)
    const total = parsed?.total ?? (await resolveSize(url, init))
    if (total === undefined) {
      throw new RangeFetchError(
        'OBJECT_SIZE_UNAVAILABLE',
        'HTTP range response hid Content-Range and object size could not be discovered.',
      )
    }
    if (!Number.isSafeInteger(total) || total < 1 || range.end >= total) {
      throw new RangeFetchError(
        'INVALID_CONTENT_RANGE',
        'HTTP range start, end, body length, and object size are inconsistent.',
      )
    }
    sizes.set(url, total)
    const headers = new Headers(response.headers)
    headers.set(
      'content-range',
      `bytes ${String(range.start)}-${String(range.end)}/${String(total)}`,
    )
    headers.set('content-length', String(bytes.byteLength))
    return new Response(bytes.slice().buffer, {
      status: 206,
      statusText: response.statusText,
      headers,
    })
  }
}

function requestHref(input: RequestInfo | URL): string {
  if (typeof input === 'string') return new URL(input).href
  if (input instanceof URL) return input.href
  return new URL(input.url).href
}

function requestRangeHeader(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): string | null {
  const fromInit = new Headers(init?.headers).get('range')
  if (fromInit !== null) return fromInit
  if (input instanceof Request) return input.headers.get('range')
  return null
}

function parseRequestByteRange(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): { readonly start: number; readonly end?: number } | undefined {
  const header = requestRangeHeader(input, init)
  if (header === null) return undefined
  const match = /^bytes=(\d+)-(\d*)$/u.exec(header)
  if (match?.[1] === undefined) return undefined
  const start = Number(match[1])
  const end = match[2] === undefined || match[2].length === 0 ? undefined : Number(match[2])
  if (!Number.isSafeInteger(start) || start < 0) return undefined
  return { start, ...(end === undefined ? {} : { end }) }
}

function parseSatisfiedContentRange(
  header: string,
): { readonly start: number; readonly end: number; readonly total: number } | undefined {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(header)
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return undefined
  }
  const start = Number(match[1])
  const end = Number(match[2])
  const total = Number(match[3])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total < 1
  ) {
    return undefined
  }
  return { start, end, total }
}

function totalFromContentRange(header: string): number | undefined {
  const ranged = parseSatisfiedContentRange(header)
  if (ranged !== undefined) return ranged.total
  const unsatisfiable = /^bytes \*\/(\d+)$/u.exec(header)
  if (unsatisfiable?.[1] === undefined) return undefined
  return parsePositiveSafeInteger(unsatisfiable[1])
}

function parsePositiveSafeInteger(value: string | null): number | undefined {
  if (value === null || value.length === 0) return undefined
  const size = Number(value)
  return Number.isSafeInteger(size) && size > 0 ? size : undefined
}

function actualObjectSizeFromBody(text: string): number | undefined {
  const match = /<ActualObjectSize>(\d+)<\/ActualObjectSize>/u.exec(text)
  if (match?.[1] === undefined) return undefined
  return parsePositiveSafeInteger(match[1])
}

function headersWithoutRange(init: RequestInit | undefined): Headers {
  const headers = new Headers(init?.headers)
  headers.delete('range')
  return headers
}

async function discoverObjectSize(
  baseFetch: typeof fetch,
  url: string,
  init: RequestInit | undefined,
): Promise<number | undefined> {
  const fromHead = await sizeFromHead(baseFetch, url, init)
  if (fromHead !== undefined) return fromHead
  return sizeFromUnsatisfiableRange(baseFetch, url, init)
}

async function sizeFromHead(
  baseFetch: typeof fetch,
  url: string,
  init: RequestInit | undefined,
): Promise<number | undefined> {
  let probe: Response
  try {
    probe = await baseFetch(url, {
      method: 'HEAD',
      headers: headersWithoutRange(init),
      ...(init?.signal === undefined ? {} : { signal: init.signal }),
    })
  } catch (error) {
    if (init?.signal?.aborted === true) throw error
    return undefined
  }
  try {
    if (!probe.ok) return undefined
    return parsePositiveSafeInteger(probe.headers.get('content-length'))
  } finally {
    await cancelBody(probe)
  }
}

async function sizeFromUnsatisfiableRange(
  baseFetch: typeof fetch,
  url: string,
  init: RequestInit | undefined,
): Promise<number | undefined> {
  const headers = headersWithoutRange(init)
  headers.set('range', UNSATISFIABLE_RANGE)
  let probe: Response
  try {
    probe = await baseFetch(url, {
      method: 'GET',
      headers,
      ...(init?.signal === undefined ? {} : { signal: init.signal }),
    })
  } catch (error) {
    if (init?.signal?.aborted === true) throw error
    return undefined
  }
  if (probe.status !== 416) {
    await cancelBody(probe)
    return undefined
  }
  const fromHeader = totalFromContentRange(probe.headers.get('content-range') ?? '')
  if (fromHeader !== undefined) {
    await cancelBody(probe)
    return fromHeader
  }
  const bytes = await readBoundedResponseBytes(probe, {
    maxBytes: SIZE_PROBE_BODY_LIMIT,
    ...(init?.signal == null ? {} : { signal: init.signal }),
    label: 'HTTP 416 size probe',
  })
  return actualObjectSizeFromBody(new TextDecoder().decode(bytes))
}

function responseWithoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export function isBoundedRangeBodyError(error: unknown): error is BoundedBodyError {
  return error instanceof BoundedBodyError
}
