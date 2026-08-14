import type { CorpusFileV1 } from './types.js'

export interface CorpusCache {
  read(key: string): Promise<Uint8Array | undefined>
  write(key: string, bytes: Uint8Array): Promise<void>
  remove(key: string): Promise<void>
}

export interface CorpusFetchResponse {
  readonly ok: boolean
  readonly status: number
  readonly body?: AsyncIterable<Uint8Array> | undefined
  header(name: string): string | undefined
  arrayBuffer(): Promise<ArrayBuffer>
}

export type CorpusFetcher = (
  url: string,
  options: Readonly<{ signal: AbortSignal }>,
) => Promise<CorpusFetchResponse>

export interface CorpusDownloadOptions {
  readonly maxBytes: number
  readonly offline?: boolean | undefined
  readonly retries?: number | undefined
  readonly signal: AbortSignal
  readonly onProgress?: ((receivedBytes: number, totalBytes: number) => void) | undefined
  readonly onRetry?: ((attempt: number, error: Error) => void) | undefined
}

export interface CorpusDownloadResult {
  readonly bytes: Uint8Array
  readonly source: 'cache' | 'network'
  readonly attempts: number
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Corpus download cancelled.', 'AbortError')
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

function exactDownloadFile(file: CorpusFileV1): asserts file is CorpusFileV1 & {
  readonly sha256: string
  readonly sizeBytes: number
  readonly url: string
} {
  if (file.delivery === 'range')
    throw new Error(
      'Range-backed sources must be opened through bounded range reads, not full download.',
    )
  if (file.delivery !== 'download')
    throw new Error('Only external download files use the corpus downloader.')
  if (file.sha256 === undefined || file.sizeBytes === undefined || file.url === undefined)
    throw new Error('Corpus download requires an exact URL, byte size, and SHA-256.')
  const url = new URL(file.url)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '')
    throw new Error('Corpus downloads require credential-free HTTPS URLs.')
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function verified(bytes: Uint8Array, size: number, sha256: string): Promise<boolean> {
  return bytes.byteLength === size && (await sha256Hex(bytes)) === sha256
}

async function responseBytes(
  response: CorpusFetchResponse,
  expectedBytes: number,
  options: CorpusDownloadOptions,
): Promise<Uint8Array> {
  const declared = response.header('content-length')
  if (declared !== undefined && Number(declared) !== expectedBytes)
    throw new Error(`Corpus response length ${declared} did not match ${expectedBytes}.`)
  if (expectedBytes > options.maxBytes)
    throw new Error(`Corpus file exceeds the ${options.maxBytes.toLocaleString()} byte budget.`)
  if (response.body === undefined) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > options.maxBytes)
      throw new Error('Corpus response exceeded its byte budget.')
    options.onProgress?.(bytes.byteLength, expectedBytes)
    return bytes
  }
  const chunks: Uint8Array[] = []
  let received = 0
  for await (const chunk of response.body) {
    assertNotAborted(options.signal)
    received += chunk.byteLength
    if (received > options.maxBytes || received > expectedBytes)
      throw new Error('Corpus response exceeded its declared or configured byte budget.')
    chunks.push(chunk.slice())
    options.onProgress?.(received, expectedBytes)
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function downloadCorpusFile(
  file: CorpusFileV1,
  cache: CorpusCache,
  fetcher: CorpusFetcher,
  options: CorpusDownloadOptions,
): Promise<CorpusDownloadResult> {
  exactDownloadFile(file)
  assertNotAborted(options.signal)
  const key = `sha256:${file.sha256}`
  const cached = await cache.read(key)
  if (cached !== undefined) {
    if (await verified(cached, file.sizeBytes, file.sha256)) {
      options.onProgress?.(cached.byteLength, file.sizeBytes)
      return { bytes: cached, source: 'cache', attempts: 0 }
    }
    await cache.remove(key)
  }
  if (options.offline === true)
    throw new Error('Corpus file is not present in the verified offline cache.')

  const attempts = Math.max(1, Math.min(3, (options.retries ?? 1) + 1))
  let lastError = new Error('Corpus download failed.')
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    assertNotAborted(options.signal)
    try {
      const response = await fetcher(file.url, { signal: options.signal })
      if (!response.ok) throw new Error(`Corpus download returned HTTP ${response.status}.`)
      const bytes = await responseBytes(response, file.sizeBytes, options)
      if (!(await verified(bytes, file.sizeBytes, file.sha256)))
        throw new Error('Corpus SHA-256 or exact byte size did not match the manifest.')
      assertNotAborted(options.signal)
      await cache.write(key, bytes)
      return { bytes, source: 'network', attempts: attempt }
    } catch (error) {
      if (options.signal.aborted) throw abortError(options.signal)
      lastError = error instanceof Error ? error : new Error('Corpus download failed.')
      if (attempt < attempts) options.onRetry?.(attempt + 1, lastError)
    }
  }
  throw lastError
}

export class MemoryCorpusCache implements CorpusCache {
  readonly #values = new Map<string, Uint8Array>()

  async read(key: string): Promise<Uint8Array | undefined> {
    return this.#values.get(key)?.slice()
  }

  async write(key: string, bytes: Uint8Array): Promise<void> {
    this.#values.set(key, bytes.slice())
  }

  async remove(key: string): Promise<void> {
    this.#values.delete(key)
  }
}
