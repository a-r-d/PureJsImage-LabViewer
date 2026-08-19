/**
 * Some object stores (including KyFromAbove on S3) answer HTTP 206 correctly but do not
 * list Content-Range in Access-Control-Expose-Headers. The browser then hides that header
 * from Worker JavaScript even though the Range request succeeded.
 *
 * PureJsImage HttpRangeSource requires a numeric `bytes start-end/total` header. Reconstruct
 * it from the request Range plus the object size. Size is recovered from a CORS-readable
 * HEAD Content-Length. A 416 XML `ActualObjectSize` body is a fallback; Chrome ORB empties
 * that cross-origin error body, so HEAD is the browser path.
 */
const UNSATISFIABLE_RANGE = 'bytes=9007199254740990-9007199254740990'
const SIZE_PROBE_BODY_LIMIT = 65_536

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
    const response = await baseFetch(input, init)
    if (response.status !== 206) return response
    const exposed = response.headers.get('Content-Range')
    if (exposed !== null) {
      const total = totalFromContentRange(exposed)
      if (total !== undefined) sizes.set(requestHref(input), total)
      return response
    }
    const range = parseRequestByteRange(input, init)
    if (range === undefined) return response
    const body = await response.arrayBuffer()
    const url = requestHref(input)
    const size = await resolveSize(url, init)
    if (size === undefined) {
      return new Response(body, {
        status: 206,
        statusText: response.statusText,
        headers: response.headers,
      })
    }
    const end = range.end ?? range.start + Math.max(body.byteLength, 1) - 1
    const headers = new Headers(response.headers)
    headers.set('Content-Range', `bytes ${range.start}-${end}/${size}`)
    headers.set('Content-Length', String(body.byteLength))
    return new Response(body, { status: 206, statusText: response.statusText, headers })
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
  const fromInit = new Headers(init?.headers).get('Range')
  if (fromInit !== null) return fromInit
  if (input instanceof Request) return input.headers.get('Range')
  return null
}

function parseRequestByteRange(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): { readonly start: number; readonly end: number | undefined } | undefined {
  const header = requestRangeHeader(input, init)
  if (header === null) return undefined
  const match = /^bytes=(\d+)-(\d*)$/u.exec(header)
  if (match === null || match[1] === undefined) return undefined
  return {
    start: Number(match[1]),
    end: match[2] === undefined || match[2].length === 0 ? undefined : Number(match[2]),
  }
}

function totalFromContentRange(header: string): number | undefined {
  const ranged = /^bytes \d+-\d+\/(\d+)$/u.exec(header)
  if (ranged?.[1] !== undefined) return Number(ranged[1])
  const unsatisfiable = /^bytes \*\/(\d+)$/u.exec(header)
  if (unsatisfiable?.[1] !== undefined) return Number(unsatisfiable[1])
  return undefined
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
  headers.delete('Range')
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
  } catch {
    return undefined
  }
  const size = parsePositiveSafeInteger(probe.headers.get('Content-Length'))
  try {
    await probe.body?.cancel()
  } catch {
    // HEAD bodies are empty; cancellation is best-effort.
  }
  return size
}

async function sizeFromUnsatisfiableRange(
  baseFetch: typeof fetch,
  url: string,
  init: RequestInit | undefined,
): Promise<number | undefined> {
  const headers = headersWithoutRange(init)
  headers.set('Range', UNSATISFIABLE_RANGE)
  let probe: Response
  try {
    probe = await baseFetch(url, {
      method: 'GET',
      headers,
      ...(init?.signal === undefined ? {} : { signal: init.signal }),
    })
  } catch {
    return undefined
  }
  if (probe.status === 416) {
    const fromHeader = totalFromContentRange(probe.headers.get('Content-Range') ?? '')
    if (fromHeader !== undefined) {
      try {
        await probe.body?.cancel()
      } catch {
        // Best-effort; the body may already be consumed or closed.
      }
      return fromHeader
    }
    const text = await readBoundedText(probe, SIZE_PROBE_BODY_LIMIT)
    return actualObjectSizeFromBody(text)
  }
  try {
    await probe.body?.cancel()
  } catch {
    // Best-effort; the body may already be consumed or closed.
  }
  return undefined
}

async function readBoundedText(response: Response, limit: number): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  const slice = bytes.byteLength <= limit ? bytes : bytes.subarray(0, limit)
  return new TextDecoder().decode(slice)
}
