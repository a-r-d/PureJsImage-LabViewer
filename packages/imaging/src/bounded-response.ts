export type BoundedBodyErrorCode =
  | 'ABORTED'
  | 'DECLARED_TOO_LARGE'
  | 'BODY_TOO_LARGE'
  | 'LENGTH_MISMATCH'
  | 'READ_FAILED'

export class BoundedBodyError extends Error {
  constructor(
    readonly code: BoundedBodyErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BoundedBodyError'
  }
}

export interface BoundedBodyReadOptions {
  readonly maxBytes: number
  readonly exactBytes?: number
  readonly signal?: AbortSignal
  readonly label?: string
}

export async function readBoundedResponseBytes(
  response: Response,
  options: BoundedBodyReadOptions,
): Promise<Uint8Array> {
  validateLimit(options.maxBytes, 'maxBytes')
  if (options.exactBytes !== undefined) {
    validateLimit(options.exactBytes, 'exactBytes', true)
    if (options.exactBytes > options.maxBytes) {
      throw new BoundedBodyError(
        'DECLARED_TOO_LARGE',
        `${options.label ?? 'Response'} expected length exceeds its byte limit.`,
      )
    }
  }

  const label = options.label ?? 'Response'
  throwIfAborted(options.signal, label)
  const declared = contentLength(response.headers)
  if (declared !== undefined) {
    if (declared > options.maxBytes) {
      await cancelBody(response, `${label} declared length exceeds the byte limit.`)
      throw new BoundedBodyError(
        'DECLARED_TOO_LARGE',
        `${label} declares ${String(declared)} bytes; limit is ${String(options.maxBytes)}.`,
      )
    }
    if (options.exactBytes !== undefined && declared !== options.exactBytes) {
      await cancelBody(response, `${label} declared length does not match the expected length.`)
      throw new BoundedBodyError(
        'LENGTH_MISMATCH',
        `${label} declares ${String(declared)} bytes; expected ${String(options.exactBytes)}.`,
      )
    }
  }

  if (response.body === null) {
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await response.arrayBuffer())
    } catch (cause) {
      throwIfAborted(options.signal, label)
      throw new BoundedBodyError('READ_FAILED', `${label} body could not be read.`, { cause })
    }
    return validateFinalLength(bytes, options, label)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let abortReject: ((reason?: unknown) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    abortReject = reject
  })
  const onAbort = (): void => {
    const reason = new BoundedBodyError('ABORTED', `${label} body read was cancelled.`)
    void reader.cancel(reason).catch(() => undefined)
    abortReject?.(reason)
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
        throw cause instanceof BoundedBodyError
          ? cause
          : new BoundedBodyError('READ_FAILED', `${label} body could not be read.`, { cause })
      }
      if (result.done) break
      const chunk = result.value
      if (!(chunk instanceof Uint8Array)) {
        await reader.cancel(`${label} returned an invalid stream chunk.`).catch(() => undefined)
        throw new BoundedBodyError('READ_FAILED', `${label} returned an invalid stream chunk.`)
      }
      total += chunk.byteLength
      if (
        total > options.maxBytes ||
        (options.exactBytes !== undefined && total > options.exactBytes)
      ) {
        await reader.cancel(`${label} exceeded its byte limit.`).catch(() => undefined)
        throw new BoundedBodyError(
          'BODY_TOO_LARGE',
          `${label} exceeded ${String(options.exactBytes ?? options.maxBytes)} bytes.`,
        )
      }
      if (chunk.byteLength > 0) chunks.push(chunk)
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
  return validateFinalLength(bytes, options, label)
}

export async function cancelBody(response: Response, reason?: unknown): Promise<void> {
  try {
    await response.body?.cancel(reason)
  } catch {
    // Cleanup is best-effort; the body may already be locked, consumed, or errored.
  }
}

function validateFinalLength(
  bytes: Uint8Array,
  options: BoundedBodyReadOptions,
  label: string,
): Uint8Array {
  if (bytes.byteLength > options.maxBytes) {
    throw new BoundedBodyError(
      'BODY_TOO_LARGE',
      `${label} exceeded ${String(options.maxBytes)} bytes.`,
    )
  }
  if (options.exactBytes !== undefined && bytes.byteLength !== options.exactBytes) {
    throw new BoundedBodyError(
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

function validateLimit(value: number, label: string, allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new TypeError(
      `${label} must be ${allowZero ? 'a non-negative' : 'a positive'} safe integer.`,
    )
  }
}

function throwIfAborted(signal: AbortSignal | undefined, label: string): void {
  if (signal?.aborted === true) {
    throw new BoundedBodyError('ABORTED', `${label} body read was cancelled.`)
  }
}
