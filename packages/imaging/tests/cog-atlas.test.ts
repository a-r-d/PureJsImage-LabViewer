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
    const bytes = paddedRemoteObject(northUpGeoTiffFixture())
    const host = new ImagingWorkerHost({ fetch: rangeFetch(bytes) })
    const opened = await host.handle(
      rpcRequest('remote-open', 'source.open-remote', {
        generation: 1,
        url: 'https://fixtures.invalid/north-up.tif',
      }),
    )
    const source = payload(opened.response, 'source.opened') as OpenedSourceDescriptor
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
    expect(diagnostics.sources[0]?.rangeCacheHits).toBeGreaterThan(0)
    await host.dispose()
  })

  it('classifies unsupported TIFF compression separately from layout', async () => {
    const host = new ImagingWorkerHost()
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
    const host = new ImagingWorkerHost()
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
    const host = new ImagingWorkerHost()
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
    const host = new ImagingWorkerHost()
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
