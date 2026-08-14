import { describe, expect, it } from 'vitest'

import { type CorpusFetchResponse, downloadCorpusFile, MemoryCorpusCache } from '../src/index.js'

const bytes = new TextEncoder().encode('hello')
const file = {
  path: 'hello.bin',
  sizeBytes: 5,
  mediaType: 'application/octet-stream',
  sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  url: 'https://example.test/immutable/hello.bin',
  delivery: 'download' as const,
}

function response(value: Uint8Array, status = 200): CorpusFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: undefined,
    header: (name) =>
      name.toLowerCase() === 'content-length' ? String(value.byteLength) : undefined,
    arrayBuffer: async () => value.slice().buffer,
  }
}

describe('verified corpus delivery', () => {
  it('downloads once, verifies SHA-256, and works from the offline cache', async () => {
    const cache = new MemoryCorpusCache()
    let fetches = 0
    const controller = new AbortController()
    const first = await downloadCorpusFile(
      file,
      cache,
      async () => {
        fetches += 1
        return response(bytes)
      },
      { signal: controller.signal, maxBytes: 10 },
    )
    const offline = await downloadCorpusFile(file, cache, async () => response(bytes, 500), {
      signal: controller.signal,
      maxBytes: 10,
      offline: true,
    })
    expect(first).toMatchObject({ source: 'network', attempts: 1 })
    expect(offline).toMatchObject({ source: 'cache', attempts: 0 })
    expect(fetches).toBe(1)
  })

  it('evicts corrupt cache data, retries a transient response, and verifies the replacement', async () => {
    const cache = new MemoryCorpusCache()
    await cache.write(`sha256:${file.sha256}`, new Uint8Array([1, 2, 3, 4, 5]))
    let fetches = 0
    const retries: number[] = []
    const result = await downloadCorpusFile(
      file,
      cache,
      async () => {
        fetches += 1
        return fetches === 1 ? response(new Uint8Array(), 503) : response(bytes)
      },
      {
        signal: new AbortController().signal,
        maxBytes: 10,
        retries: 1,
        onRetry: (attempt) => retries.push(attempt),
      },
    )
    expect(result.attempts).toBe(2)
    expect(retries).toEqual([2])
  })

  it('refuses over-budget, range-backed, invalid-integrity, and cancelled downloads', async () => {
    const cache = new MemoryCorpusCache()
    await expect(
      downloadCorpusFile(file, cache, async () => response(bytes), {
        signal: new AbortController().signal,
        maxBytes: 4,
      }),
    ).rejects.toThrow('byte budget')
    await expect(
      downloadCorpusFile({ ...file, delivery: 'range' }, cache, async () => response(bytes), {
        signal: new AbortController().signal,
        maxBytes: 10,
      }),
    ).rejects.toThrow('bounded range reads')
    await expect(
      downloadCorpusFile({ ...file, sha256: '0'.repeat(64) }, cache, async () => response(bytes), {
        signal: new AbortController().signal,
        maxBytes: 10,
        retries: 0,
      }),
    ).rejects.toThrow('SHA-256')
    const cancelled = new AbortController()
    cancelled.abort(new DOMException('User cancelled.', 'AbortError'))
    await expect(
      downloadCorpusFile(file, cache, async () => response(bytes), {
        signal: cancelled.signal,
        maxBytes: 10,
      }),
    ).rejects.toThrow('User cancelled')
  })

  it('cancels between streamed chunks without admitting partial cache data', async () => {
    const cache = new MemoryCorpusCache()
    const controller = new AbortController()
    const streamed: CorpusFetchResponse = {
      ok: true,
      status: 200,
      header: () => '5',
      arrayBuffer: async () => bytes.buffer,
      body: {
        async *[Symbol.asyncIterator]() {
          yield bytes.slice(0, 2)
          controller.abort(new DOMException('Stop streaming.', 'AbortError'))
          yield bytes.slice(2)
        },
      },
    }
    await expect(
      downloadCorpusFile(file, cache, async () => streamed, {
        signal: controller.signal,
        maxBytes: 10,
      }),
    ).rejects.toThrow('Stop streaming')
    await expect(
      downloadCorpusFile(file, cache, async () => response(bytes), {
        signal: new AbortController().signal,
        maxBytes: 10,
        offline: true,
      }),
    ).rejects.toThrow('not present')
  })
})
