import { describe, expect, it } from 'vitest'

import { wrapFetchToExposeContentRange } from '../src/cors-range-fetch.js'

const OBJECT_SIZE = 210_670_850
const URL = 'https://fixtures.invalid/hidden-range.tif'

function chromeOrbS3Fetch(calls: string[]): typeof fetch {
  const bytes = new Uint8Array([0x49, 0x49, 0x2a, 0x00])
  return async (_input, init) => {
    const method = init?.method ?? 'GET'
    const range = new Headers(init?.headers).get('range') ?? ''
    calls.push(`${method} ${range}`)
    if (method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'accept-ranges': 'bytes', 'content-length': String(OBJECT_SIZE), etag: '"s3"' },
      })
    }
    const match = /^bytes=(\d+)-(\d+)$/u.exec(range)
    if (match === null || match[1] === undefined || match[2] === undefined) {
      return new Response(null, { status: 416, headers: { 'content-length': '0' } })
    }
    const start = Number(match[1])
    if (start >= OBJECT_SIZE) {
      return new Response(null, { status: 416, headers: { 'content-length': '0' } })
    }
    const end = Number(match[2])
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: {
        'accept-ranges': 'bytes',
        'content-length': String(end - start + 1),
        etag: '"s3"',
      },
    })
  }
}

function xml416Fetch(calls: string[]): typeof fetch {
  const bytes = new Uint8Array([0x49, 0x49, 0x2a, 0x00])
  return async (_input, init) => {
    const method = init?.method ?? 'GET'
    const range = new Headers(init?.headers).get('range') ?? ''
    calls.push(`${method} ${range}`)
    if (method === 'HEAD') {
      return new Response(null, { status: 405, headers: { 'content-length': '999' } })
    }
    const match = /^bytes=(\d+)-(\d+)$/u.exec(range)
    if (match === null || match[1] === undefined || match[2] === undefined) {
      return new Response(null, { status: 416 })
    }
    const start = Number(match[1])
    if (start >= OBJECT_SIZE) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidRange</Code><ActualObjectSize>${String(OBJECT_SIZE)}</ActualObjectSize></Error>`,
        { status: 416, headers: { 'content-type': 'application/xml' } },
      )
    }
    const end = Number(match[2])
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { 'accept-ranges': 'bytes', etag: '"s3-hidden-range"' },
    })
  }
}

describe('wrapFetchToExposeContentRange', () => {
  it('leaves a 206 with Content-Range unchanged and does not probe size', async () => {
    const calls: string[] = []
    const wrapped = wrapFetchToExposeContentRange(async (_input, init) => {
      calls.push(new Headers(init?.headers).get('range') ?? '')
      return new Response(new Uint8Array([1]), {
        status: 206,
        headers: { 'content-range': 'bytes 0-0/16', etag: '"exposed"' },
      })
    })
    const response = await wrapped(URL, { headers: { Range: 'bytes=0-0' } })
    expect(response.headers.get('Content-Range')).toBe('bytes 0-0/16')
    expect(calls).toEqual(['bytes=0-0'])
  })

  it('synthesizes Content-Range from a CORS-readable HEAD Content-Length when Chrome ORB empties 416 bodies', async () => {
    const calls: string[] = []
    const wrapped = wrapFetchToExposeContentRange(chromeOrbS3Fetch(calls))
    const probe = await wrapped(URL, { headers: { Range: 'bytes=0-0' } })
    expect(probe.status).toBe(206)
    expect(probe.headers.get('Content-Range')).toBe(`bytes 0-0/${String(OBJECT_SIZE)}`)
    expect(calls[0]).toBe('GET bytes=0-0')
    expect(calls[1]).toBe('HEAD ')

    const block = await wrapped(URL, { headers: { Range: 'bytes=0-3' } })
    expect(block.headers.get('Content-Range')).toBe(`bytes 0-3/${String(OBJECT_SIZE)}`)
    expect(calls.filter((call) => call.startsWith('HEAD'))).toHaveLength(1)
  })

  it('falls back to an S3 416 ActualObjectSize body when HEAD fails', async () => {
    const calls: string[] = []
    const wrapped = wrapFetchToExposeContentRange(xml416Fetch(calls))
    const probe = await wrapped(URL, { headers: { Range: 'bytes=0-0' } })
    expect(probe.headers.get('Content-Range')).toBe(`bytes 0-0/${String(OBJECT_SIZE)}`)
    expect(calls.some((call) => call.startsWith('HEAD'))).toBe(true)
    expect(calls.some((call) => call.includes('9007199254740990'))).toBe(true)
  })

  it('cancels a declared 500 MB HTTP 200 without reading its body', async () => {
    let cancelled = false
    const wrapped = wrapFetchToExposeContentRange(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true
            },
          }),
          { status: 200, headers: { 'content-length': String(500 * 1024 * 1024) } },
        ),
    )
    const response = await wrapped(URL, { headers: { Range: 'bytes=0-0' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Range')).toBeNull()
    expect((await response.arrayBuffer()).byteLength).toBe(0)
    expect(cancelled).toBe(true)
  })

  it('rejects oversized and short streaming 206 bodies', async () => {
    const oversized = wrapFetchToExposeContentRange(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Uint8Array.of(1, 2))
            },
          }),
          {
            status: 206,
            headers: { 'content-range': 'bytes 0-0/16' },
          },
        ),
    )
    await expect(oversized(URL, { headers: { Range: 'bytes=0-0' } })).rejects.toMatchObject({
      code: 'BODY_TOO_LARGE',
    })

    const short = wrapFetchToExposeContentRange(
      async () =>
        new Response(Uint8Array.of(1), {
          status: 206,
          headers: { 'content-range': 'bytes 0-1/16' },
        }),
    )
    await expect(short(URL, { headers: { Range: 'bytes=0-1' } })).rejects.toMatchObject({
      code: 'LENGTH_MISMATCH',
    })
  })

  it('rejects a hidden Content-Range body whose size does not match the request', async () => {
    const wrapped = wrapFetchToExposeContentRange(async (_input, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'content-length': '16' } })
      }
      return new Response(Uint8Array.of(1, 2), { status: 206 })
    })
    await expect(wrapped(URL, { headers: { Range: 'bytes=0-0' } })).rejects.toMatchObject({
      code: 'BODY_TOO_LARGE',
    })
  })

  it('bounds an oversized HTTP 416 XML fallback after HEAD fails', async () => {
    const wrapped = wrapFetchToExposeContentRange(async (_input, init) => {
      if (init?.method === 'HEAD') throw new Error('HEAD unavailable')
      const range = new Headers(init?.headers).get('range')
      if (range?.includes('9007199254740990') === true) {
        return new Response(new Uint8Array(65_537), { status: 416 })
      }
      return new Response(Uint8Array.of(1), { status: 206 })
    })
    await expect(wrapped(URL, { headers: { Range: 'bytes=0-0' } })).rejects.toMatchObject({
      code: 'BODY_TOO_LARGE',
    })
  })

  it('propagates cancellation while reading a range stream', async () => {
    const controller = new AbortController()
    const wrapped = wrapFetchToExposeContentRange(
      async () =>
        new Response(
          new ReadableStream({
            pull() {
              return new Promise(() => undefined)
            },
          }),
          {
            status: 206,
            headers: { 'content-range': 'bytes 0-0/16' },
          },
        ),
    )
    const pending = wrapped(URL, {
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })
})
