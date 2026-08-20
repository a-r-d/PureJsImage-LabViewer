export type CatalogBodyErrorCode =
  | 'ABORTED'
  | 'DECLARED_TOO_LARGE'
  | 'BODY_TOO_LARGE'
  | 'LENGTH_MISMATCH'
  | 'READ_FAILED'

export class CatalogBodyError extends Error {
  constructor(
    readonly code: CatalogBodyErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CatalogBodyError'
  }
}

export async function readBoundedCatalogBody(
  response: Response,
  options: {
    readonly maxBytes: number
    readonly exactBytes?: number
    readonly signal?: AbortSignal
    readonly label?: string
  },
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
    throw new TypeError('maxBytes must be a positive safe integer.')
  }
  const label = options.label ?? 'Catalog response'
  throwIfAborted(options.signal, label)
  const declared = contentLength(response.headers)
  if (declared !== undefined && declared > options.maxBytes) {
    await cancelCatalogBody(response, `${label} declared length exceeds the byte limit.`)
    throw new CatalogBodyError(
      'DECLARED_TOO_LARGE',
      `${label} declares ${String(declared)} bytes; limit is ${String(options.maxBytes)}.`,
    )
  }
  if (
    declared !== undefined &&
    options.exactBytes !== undefined &&
    declared !== options.exactBytes
  ) {
    await cancelCatalogBody(response, `${label} declared length does not match.`)
    throw new CatalogBodyError('LENGTH_MISMATCH', `${label} declared length does not match.`)
  }

  if (response.body === null) {
    try {
      const bytes = new Uint8Array(await response.arrayBuffer())
      return validateLength(bytes, options, label)
    } catch (cause) {
      throwIfAborted(options.signal, label)
      if (cause instanceof CatalogBodyError) throw cause
      throw new CatalogBodyError('READ_FAILED', `${label} body could not be read.`, { cause })
    }
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let rejectAbort: ((reason?: unknown) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const onAbort = (): void => {
    const error = new CatalogBodyError('ABORTED', `${label} body read was cancelled.`)
    void reader.cancel(error).catch(() => undefined)
    rejectAbort?.(error)
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      throwIfAborted(options.signal, label)
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await Promise.race([reader.read(), aborted])
      } catch (cause) {
        throwIfAborted(options.signal, label)
        throw cause instanceof CatalogBodyError
          ? cause
          : new CatalogBodyError('READ_FAILED', `${label} body could not be read.`, { cause })
      }
      if (result.done) break
      if (!(result.value instanceof Uint8Array)) {
        await reader.cancel(`${label} returned an invalid stream chunk.`).catch(() => undefined)
        throw new CatalogBodyError('READ_FAILED', `${label} returned an invalid stream chunk.`)
      }
      total += result.value.byteLength
      if (
        total > options.maxBytes ||
        (options.exactBytes !== undefined && total > options.exactBytes)
      ) {
        await reader.cancel(`${label} exceeded its byte limit.`).catch(() => undefined)
        throw new CatalogBodyError('BODY_TOO_LARGE', `${label} exceeded its byte limit.`)
      }
      if (result.value.byteLength > 0) chunks.push(result.value)
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return validateLength(bytes, options, label)
}

export async function cancelCatalogBody(response: Response, reason?: unknown): Promise<void> {
  try {
    await response.body?.cancel(reason)
  } catch {
    // Cleanup is best-effort; the body may already be locked, consumed, or errored.
  }
}

function validateLength(
  bytes: Uint8Array,
  options: { readonly maxBytes: number; readonly exactBytes?: number },
  label: string,
): Uint8Array {
  if (bytes.byteLength > options.maxBytes) {
    throw new CatalogBodyError('BODY_TOO_LARGE', `${label} exceeded its byte limit.`)
  }
  if (options.exactBytes !== undefined && bytes.byteLength !== options.exactBytes) {
    throw new CatalogBodyError(
      'LENGTH_MISMATCH',
      `${label} returned ${String(bytes.byteLength)} bytes; expected ${String(options.exactBytes)}.`,
    )
  }
  return bytes
}

function contentLength(headers: Headers): number | undefined {
  const raw = headers.get('content-length')
  if (raw === null || raw.length === 0) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function throwIfAborted(signal: AbortSignal | undefined, label: string): void {
  if (signal?.aborted === true) {
    throw new CatalogBodyError('ABORTED', `${label} body read was cancelled.`)
  }
}
