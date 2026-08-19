import { describe, expect, it } from 'vitest'

import { preflightRasterAsset } from '../src/raster-preflight.js'
import { northUpGeoTiffFixture, unsupportedCompressionTiffFixture } from './geotiff-fixture.js'

function padded(bytes: Uint8Array, size = 128 * 1024): Uint8Array {
  if (bytes.byteLength >= size) return bytes
  const next = new Uint8Array(size)
  next.set(bytes)
  return next
}

function rangeFetch(bytes: Uint8Array): typeof fetch {
  return async (_input, init) => {
    const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
    if (match === undefined || match === null) {
      return new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength) },
      })
    }
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: {
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
        'content-length': String(end - start + 1),
      },
    })
  }
}

describe('raster preflight', () => {
  it('marks a Range-capable classic TIFF as ready', async () => {
    const bytes = padded(northUpGeoTiffFixture())
    const result = await preflightRasterAsset('https://fixtures.invalid/north-up.tif', {
      fetch: rangeFetch(bytes),
    })
    expect(result.compatibility).toBe('ready')
    expect(result.transport.rangeStatus).toBe('partial')
    expect(result.raster?.width).toBeGreaterThan(0)
  })

  it('classifies a 200 full-body Range ignore as no-range', async () => {
    const bytes = padded(northUpGeoTiffFixture())
    const result = await preflightRasterAsset('https://fixtures.invalid/full.tif', {
      fetch: async () =>
        new Response(bytes, {
          status: 200,
          headers: { 'content-length': String(bytes.byteLength) },
        }),
    })
    expect(result.compatibility).toBe('no-range')
  })

  it('classifies HTTP 416 as no-range', async () => {
    const result = await preflightRasterAsset('https://fixtures.invalid/unsatisfiable.tif', {
      fetch: async () => new Response(null, { status: 416 }),
    })
    expect(result.compatibility).toBe('no-range')
  })

  it('rejects non-identity content encoding', async () => {
    const result = await preflightRasterAsset('https://fixtures.invalid/gzip.tif', {
      fetch: async () =>
        new Response(new Uint8Array([1]), {
          status: 206,
          headers: { 'content-encoding': 'gzip', 'content-range': 'bytes 0-0/16' },
        }),
    })
    expect(result.compatibility).toBe('content-encoding')
  })

  it('keeps s3 hrefs metadata-only and does not fetch', async () => {
    let fetched = false
    const result = await preflightRasterAsset('s3://usgs-landsat/scene.tif', {
      fetch: async () => {
        fetched = true
        return new Response(null, { status: 500 })
      },
    })
    expect(result.compatibility).toBe('metadata-only')
    expect(fetched).toBe(false)
  })

  it('classifies fetch throws as browser-network-blocked without assuming CORS', async () => {
    const result = await preflightRasterAsset('https://fixtures.invalid/blocked.tif', {
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect(result.compatibility).toBe('browser-network-blocked')
  })

  it('classifies unsupported TIFF compression', async () => {
    const bytes = padded(unsupportedCompressionTiffFixture())
    const result = await preflightRasterAsset('https://fixtures.invalid/bad-codec.tif', {
      fetch: rangeFetch(bytes),
    })
    expect(result.compatibility).toBe('unsupported-tiff')
  })
})
