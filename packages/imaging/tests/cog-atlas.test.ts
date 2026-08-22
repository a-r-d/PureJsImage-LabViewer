import type {
  CogInspectionReport,
  DocumentId,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  WorkerResponse,
} from '@pji-workbench/contracts'
import { COG_INSPECTION_METADATA_KEY, rpcRequest } from '@pji-workbench/contracts'
import { describe, expect, it } from 'vitest'

import { ImagingWorkerHost } from '../src/index.js'
import { mapTile } from '../src/worker-host/view-rpc.js'
import {
  missingStripTableTiffFixture,
  northUpGeoTiffFixture,
  rgbGeoTiffFixture,
  tiledGradientPyramidGeoTiffFixture,
  unsupportedCompressionTiffFixture,
} from './geotiff-fixture.js'

function payload<Kind extends Extract<WorkerResponse, { ok: true }>['kind']>(
  response: WorkerResponse,
  kind: Kind,
): Extract<WorkerResponse, { kind: Kind }>['payload'] {
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
  expect(response.kind).toBe(kind)
  return response.payload as Extract<WorkerResponse, { kind: Kind }>['payload']
}

function paddedRemoteObject(bytes: Uint8Array, size = 256 * 1_024): Uint8Array {
  if (bytes.byteLength >= size) return bytes
  const padded = new Uint8Array(size)
  padded.set(bytes)
  return padded
}

function rangeFetch(bytes: Uint8Array): typeof fetch {
  return async (_input, init) => {
    const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
    if (match === undefined || match === null) return new Response(null, { status: 416 })
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: {
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
        etag: '"atlas-cog-v1"',
      },
    })
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function openNamed(
  host: ImagingWorkerHost,
  bytes: Uint8Array,
  name: string,
): Promise<OpenedSourceDescriptor> {
  const file = new File([bytes.slice().buffer as ArrayBuffer], name)
  const opened = await host.handle(
    rpcRequest('local-open', 'source.open-local', {
      generation: 1,
      primaryId: 'file-0',
      files: [
        {
          id: 'file-0',
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
          blob: file,
        },
      ],
    }),
  )
  return payload(opened.response, 'source.opened') as OpenedSourceDescriptor
}

describe('COG inspection and classified GeoTIFF opens', () => {
  it('attaches inspectCog metadata without reading a complete remote object', async () => {
    const bytes = paddedRemoteObject(northUpGeoTiffFixture('255'))
    const host = new ImagingWorkerHost({ profile: 'geo', fetch: rangeFetch(bytes) })
    const opened = await host.handle(
      rpcRequest('remote-open', 'source.open-remote', {
        generation: 1,
        url: 'https://fixtures.invalid/north-up.tif',
      }),
    )
    const source = payload(opened.response, 'source.opened') as OpenedSourceDescriptor
    expect(source.reader).toMatchObject({
      id: 'purejsimage/geo/geotiff',
      version: '1.0.0',
      format: 'GeoTIFF',
    })
    expect(source.datasets[0]?.geo).toMatchObject({
      schemaVersion: 1,
      spatialReference: {
        authority: 'EPSG',
        code: 4_326,
        state: 'complete',
      },
      grid: {
        pixelToWorld: [10, 0, 100, 0, -20, 200],
        worldBounds: { minX: 100, minY: 160, maxX: 140, maxY: 200 },
        pixelRegistration: 'pixel-is-area',
        noData: { kind: 'scalar', value: 255 },
      },
      bands: [{ dataType: 'uint8', noData: 255 }],
      levels: [{ width: 4, height: 2, storage: { organization: 'stripped' } }],
    })
    expect(source.datasets[0]?.geo?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'info', code: 'incomplete-crs' }),
      ]),
    )
    const inspection = source.metadata[COG_INSPECTION_METADATA_KEY] as CogInspectionReport
    expect(inspection.container).toBe('TIFF')
    expect(inspection.byteOrder).toBe('little-endian')
    expect(inspection.directories[0]).toMatchObject({
      role: 'image',
      width: 4,
      height: 2,
      tiled: false,
      samplesPerPixel: 1,
    })
    expect(inspection.issues.some((issue) => issue.code === 'STRIPED_IMAGE')).toBe(true)
    const diagnostics = host.diagnostics()
    expect(diagnostics.sources[0]?.rangeRequests).toBeGreaterThan(0)
    expect(diagnostics.sources[0]?.rangeBytesFetched).toBeLessThan(bytes.byteLength)
    expect(diagnostics.sources[0]?.rangeCacheHits).toBeGreaterThanOrEqual(0)
    await host.dispose()
  })

  it('reads one selected overview band through bounded remote ranges', async () => {
    const bytes = tiledGradientPyramidGeoTiffFixture({
      width: 512,
      height: 256,
      tileWidth: 128,
    })
    const reads: Array<readonly [number, number]> = []
    let recordReads = false
    const fetcher: typeof fetch = async (_input, init) => {
      const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
      if (match === null || match === undefined) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Math.min(Number(match[2]), bytes.byteLength - 1)
      if (recordReads) reads.push([start, end])
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
          etag: '"overview-band-v1"',
        },
      })
    }
    const host = new ImagingWorkerHost({ profile: 'geo', fetch: fetcher })
    const source = payload(
      (
        await host.handle(
          rpcRequest('overview-source', 'source.open-remote', {
            generation: 1,
            url: 'https://fixtures.invalid/overview-band.tif',
          }),
        )
      ).response,
      'source.opened',
    ) as OpenedSourceDescriptor
    const dataset = payload(
      (
        await host.handle(
          rpcRequest('overview-dataset', 'dataset.open', {
            documentId: source.documentId,
            datasetId: source.datasets[0]?.id ?? 'missing',
            generation: 1,
            sourceId: source.sourceId,
          }),
        )
      ).response,
      'dataset.opened',
    ) as OpenedDatasetDescriptor
    recordReads = true
    const tile = payload(
      (
        await host.handle(
          rpcRequest('overview-tile', 'tile.request', {
            tileId: 'overview-green',
            datasetHandleId: dataset.handleId,
            generation: 1,
            displayAxes: dataset.selection.displayAxes,
            fixedIndices: dataset.selection.fixedIndices,
            resolutionLevel: 1,
            component: 1,
            mapping: { mode: 'linear', range: 'auto' },
            region: { x: 192, y: 64, width: 16, height: 16 },
            priority: 'visible',
          }),
        )
      ).response,
      'tile.ready',
    )
    expect(tile.values).toHaveLength(256)
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.reduce((total, [start, end]) => total + end - start + 1, 0)).toBeLessThan(
      bytes.byteLength,
    )
    expect(reads.every(([start, end]) => end - start + 1 <= 64 * 1_024)).toBe(true)
    await host.dispose()
  })

  it('opens a remote GeoTIFF when CORS hides Content-Range on a valid 206', async () => {
    const bytes = paddedRemoteObject(northUpGeoTiffFixture('255'))
    const hiddenRangeFetch: typeof fetch = async (_input, init) => {
      if ((init?.method ?? 'GET') === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'accept-ranges': 'bytes', 'content-length': String(bytes.byteLength) },
        })
      }
      const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
      if (match === undefined || match === null) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const requestedEnd = Number(match[2])
      if (start >= bytes.byteLength) {
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidRange</Code><ActualObjectSize>${String(bytes.byteLength)}</ActualObjectSize></Error>`,
          { status: 416, headers: { 'content-type': 'application/xml' } },
        )
      }
      const end = Math.min(requestedEnd, bytes.byteLength - 1)
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { 'accept-ranges': 'bytes', etag: '"atlas-cog-hidden-range-v1"' },
      })
    }
    const host = new ImagingWorkerHost({ profile: 'geo', fetch: hiddenRangeFetch })
    const opened = await host.handle(
      rpcRequest('remote-open-hidden-range', 'source.open-remote', {
        generation: 1,
        url: 'https://fixtures.invalid/north-up.tif',
      }),
    )
    const source = payload(opened.response, 'source.opened') as OpenedSourceDescriptor
    expect(source.datasets[0]?.id).toBeTruthy()
    await host.dispose()
  })

  it('opens an integrity-checked bundled GeoTIFF through the Geo reader', async () => {
    const bytes = rgbGeoTiffFixture()
    const host = new ImagingWorkerHost({
      profile: 'geo',
      baseUrl: 'https://atlas.invalid/',
      fetch: async () =>
        new Response(bytes.slice().buffer, {
          status: 200,
          headers: { 'content-length': String(bytes.byteLength) },
        }),
    })
    const opened = payload(
      (
        await host.handle(
          rpcRequest('bundled-geotiff', 'source.open-bundled', {
            generation: 1,
            path: 'examples/geo/rgb.tif',
            name: 'rgb.tif',
            size: bytes.byteLength,
            sha256: await sha256(bytes),
            mediaType: 'image/tiff',
          }),
        )
      ).response,
      'source-bundled.opened',
    )
    expect(opened.source.reader).toMatchObject({
      id: 'purejsimage/geo/geotiff',
      version: '1.0.0',
    })
    expect(opened.dataset.dataset.geo?.bands).toHaveLength(3)
    await host.dispose()
  })

  it('opens a remote GeoTIFF larger than the default 128 MiB codec input limit', async () => {
    const bytes = paddedRemoteObject(northUpGeoTiffFixture('255'))
    const advertisedSize = 200_000_000
    const largeRangeFetch: typeof fetch = async (_input, init) => {
      if ((init?.method ?? 'GET') === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'accept-ranges': 'bytes', 'content-length': String(advertisedSize) },
        })
      }
      const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
      if (match === undefined || match === null) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const requestedEnd = Number(match[2])
      if (start >= advertisedSize) {
        return new Response(null, { status: 416, headers: { 'content-length': '0' } })
      }
      const end = Math.min(requestedEnd, advertisedSize - 1)
      const slice = new Uint8Array(end - start + 1)
      if (start < bytes.byteLength) {
        slice.set(bytes.subarray(start, Math.min(end + 1, bytes.byteLength)))
      }
      return new Response(slice, {
        status: 206,
        headers: { 'accept-ranges': 'bytes', etag: '"atlas-cog-large-v1"' },
      })
    }
    const host = new ImagingWorkerHost({ profile: 'geo', fetch: largeRangeFetch })
    const opened = await host.handle(
      rpcRequest('remote-open-large', 'source.open-remote', {
        generation: 1,
        url: 'https://fixtures.invalid/north-up.tif',
      }),
    )
    const largeSource = payload(opened.response, 'source.opened') as OpenedSourceDescriptor
    expect(largeSource.source.size).toBe(advertisedSize)
    expect(largeSource.datasets[0]?.id).toBeTruthy()
    await host.dispose()
  })

  it('classifies unsupported TIFF compression separately from layout', async () => {
    const host = new ImagingWorkerHost({ profile: 'geo' })
    const file = new File(
      [unsupportedCompressionTiffFixture().slice().buffer as ArrayBuffer],
      'jpegxl.tif',
    )
    const opened = await host.handle(
      rpcRequest('bad-compression', 'source.open-local', {
        generation: 1,
        primaryId: 'file-0',
        files: [
          {
            id: 'file-0',
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            blob: file,
          },
        ],
      }),
    )
    expect(opened.response).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_COMPRESSION' },
    })
    await host.dispose()
  })

  it('classifies truncated GeoTIFF bytes as malformed metadata', async () => {
    const host = new ImagingWorkerHost({ profile: 'geo' })
    const truncated = northUpGeoTiffFixture().slice(0, 24)
    const file = new File([truncated.slice().buffer as ArrayBuffer], 'truncated.tif')
    const opened = await host.handle(
      rpcRequest('truncated', 'source.open-local', {
        generation: 1,
        primaryId: 'file-0',
        files: [
          {
            id: 'file-0',
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            blob: file,
          },
        ],
      }),
    )
    expect(opened.response).toMatchObject({
      ok: false,
      error: { code: 'MALFORMED_METADATA' },
    })
    await host.dispose()
  })

  it('classifies a TIFF without a strip or tile table as unsupported layout', async () => {
    const host = new ImagingWorkerHost({ profile: 'geo' })
    const file = new File(
      [missingStripTableTiffFixture().slice().buffer as ArrayBuffer],
      'empty-table.tif',
    )
    const opened = await host.handle(
      rpcRequest('bad-layout', 'source.open-local', {
        generation: 1,
        primaryId: 'file-0',
        files: [
          {
            id: 'file-0',
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            blob: file,
          },
        ],
      }),
    )
    expect(opened.response).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_LAYOUT' },
    })
    await host.dispose()
  })

  it('maps RGB bands and nodata transparency on a GeoTIFF tile', async () => {
    const host = new ImagingWorkerHost({ profile: 'geo' })
    const source = await openNamed(host, rgbGeoTiffFixture(), 'rgb.tif')
    const datasetResponse = await host.handle(
      rpcRequest('dataset', 'dataset.open', {
        documentId: source.documentId as DocumentId,
        datasetId: source.datasets[0]?.id ?? 'missing',
        generation: 1,
      }),
    )
    const dataset = payload(datasetResponse.response, 'dataset.opened') as OpenedDatasetDescriptor
    const tileResult = await host.handle(
      rpcRequest('rgb-tile', 'tile.request', {
        tileId: 'rgb',
        datasetHandleId: dataset.handleId,
        generation: 1,
        displayAxes: dataset.selection.displayAxes,
        fixedIndices: dataset.selection.fixedIndices,
        resolutionLevel: dataset.selection.resolutionLevel,
        component: 0,
        mapping: {
          mode: 'linear',
          range: 'manual',
          minimum: 0,
          maximum: 255,
          nodata: 0,
          nodataTransparent: true,
          bands: { red: 0, green: 1, blue: 2 },
        },
        region: { x: 0, y: 0, width: 2, height: 1 },
        priority: 'visible',
      }),
    )
    const tile = payload(tileResult.response, 'tile.ready')
    expect(tile.rgba[0]).toBe(10)
    expect(tile.rgba[1]).toBe(20)
    expect(tile.rgba[2]).toBe(30)
    expect(tile.rgba[3]).toBe(255)
    expect(tile.rgba[7]).toBe(0)
    expect(tile.bandValues).toHaveLength(3)
    await host.dispose()
  })
})

describe('display mapping', () => {
  it('keeps grayscale min/max mapping identical when extra fields are omitted', () => {
    const tile = {
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      sampleType: 'float32' as const,
      componentCount: 1,
      layout: 'interleaved' as const,
      rowStrideElements: 2,
      data: Float32Array.of(0, 100),
      release: () => undefined,
    }
    const mapped = mapTile(tile, 0, { mode: 'linear', range: 'manual', minimum: 0, maximum: 100 })
    expect([...mapped.rgba]).toEqual([0, 0, 0, 255, 255, 255, 255, 255])
    expect([...mapped.values]).toEqual([0, 100])
  })

  it('applies gamma, percentile stretch, and nodata transparency', () => {
    const tile = {
      x: 0,
      y: 0,
      width: 4,
      height: 1,
      sampleType: 'float32' as const,
      componentCount: 1,
      layout: 'interleaved' as const,
      rowStrideElements: 4,
      data: Float32Array.of(0, 10, 90, -9999),
      release: () => undefined,
    }
    const mapped = mapTile(tile, 0, {
      mode: 'linear',
      range: 'auto',
      stretch: 'percentile',
      percentileLow: 0,
      percentileHigh: 100,
      gamma: 2,
      nodata: -9999,
      nodataTransparent: true,
    })
    expect(mapped.rgba[15]).toBe(0)
    expect(mapped.rgba[3]).toBe(255)
    expect(mapped.range.minimum).toBe(0)
    expect(mapped.range.maximum).toBe(90)
  })
})
