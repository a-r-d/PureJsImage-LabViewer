import type {
  DocumentId,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  SpatialReference,
  WorkerResponse,
} from '@pji-workbench/contracts'
import { normalizeSpatialReference, rpcRequest } from '@pji-workbench/contracts'
import { MemorySource } from 'purejsimage'
import { ScientificReaderRegistry } from 'purejsimage/scientific'
import { encodeGsf } from 'purejsimage/scientific/readers/gsf'
import { tiffReader } from 'purejsimage/scientific/readers/tiff'
import { describe, expect, it } from 'vitest'

import { ImagingWorkerHost } from '../src/index.js'
import {
  northUpGeoTiffFixture,
  rotatedGeoTiffFixture,
  scientificTiffFixture,
  unknownCrsGeoTiffFixture,
} from './geotiff-fixture.js'

function payload<Kind extends Extract<WorkerResponse, { ok: true }>['kind']>(
  response: WorkerResponse,
  kind: Kind,
): Extract<WorkerResponse, { kind: Kind }>['payload'] {
  if (!response.ok) throw new Error(response.error.message)
  expect(response.kind).toBe(kind)
  return response.payload as Extract<WorkerResponse, { kind: Kind }>['payload']
}

function jsonClone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
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
        etag: '"geotiff-spatial-v1"',
      },
    })
  }
}

async function librarySpatialReference(bytes: Uint8Array): Promise<SpatialReference | undefined> {
  const document = await new ScientificReaderRegistry([tiffReader]).open({
    primary: { id: 'primary', name: 'fixture.tif', source: new MemorySource(bytes) },
  })
  const dataset = await document.openDataset(document.datasets[0]?.id ?? 'series-0')
  const reference = dataset.descriptor.spatialReference
  return reference === undefined ? undefined : jsonClone(reference)
}

async function openLocal(
  host: ImagingWorkerHost,
  bytes: Uint8Array,
  name: string,
): Promise<OpenedDatasetDescriptor> {
  const file = new File([bytes.slice().buffer as ArrayBuffer], name)
  const sourceResult = await host.handle(
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
  const source = payload(sourceResult.response, 'source.opened') as OpenedSourceDescriptor
  const datasetResult = await host.handle(
    rpcRequest('dataset-open', 'dataset.open', {
      documentId: source.documentId,
      datasetId: source.datasets[0]?.id ?? 'missing',
      generation: 1,
    }),
  )
  return payload(datasetResult.response, 'dataset.opened') as OpenedDatasetDescriptor
}

async function openRemote(host: ImagingWorkerHost, url: string): Promise<OpenedDatasetDescriptor> {
  const sourceResult = await host.handle(
    rpcRequest('remote-open', 'source.open-remote', { generation: 1, url }),
  )
  const source = payload(sourceResult.response, 'source.opened') as OpenedSourceDescriptor
  const datasetResult = await host.handle(
    rpcRequest('remote-dataset', 'dataset.open', {
      documentId: source.documentId as DocumentId,
      datasetId: source.datasets[0]?.id ?? 'missing',
      generation: 1,
    }),
  )
  return payload(datasetResult.response, 'dataset.opened') as OpenedDatasetDescriptor
}

function expectIdenticalSpatialReference(
  application: SpatialReference | undefined,
  library: SpatialReference | undefined,
  componentCount: number,
): SpatialReference {
  if (application === undefined || library === undefined) {
    throw new Error('Expected a spatial reference on both the worker and library descriptors')
  }
  const wire = jsonClone(application)
  expect(wire).toEqual(jsonClone(library))
  expect(normalizeSpatialReference(wire, { componentCount })).toEqual(application)
  return application
}

describe('imaging Worker spatial references', () => {
  it('round-trips a GeoTIFF spatial reference across the Worker protocol', async () => {
    const bytes = northUpGeoTiffFixture()
    const host = new ImagingWorkerHost()
    const file = new File([bytes.slice().buffer as ArrayBuffer], 'north-up.tif')
    const sourceResult = await host.handle(
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
    const sourceWire = jsonClone(sourceResult.response)
    const source = payload(sourceWire, 'source.opened') as OpenedSourceDescriptor
    const datasetResult = await host.handle(
      rpcRequest('dataset-open', 'dataset.open', {
        documentId: source.documentId,
        datasetId: source.datasets[0]?.id ?? 'missing',
        generation: 1,
      }),
    )
    const datasetWire = jsonClone(datasetResult.response)
    const opened = payload(datasetWire, 'dataset.opened') as OpenedDatasetDescriptor
    const spatial = expectIdenticalSpatialReference(
      opened.dataset.spatialReference,
      await librarySpatialReference(bytes),
      opened.dataset.components.length,
    )
    expect(source.datasets[0]?.spatialReference).toEqual(spatial)
    expect(spatial).toMatchObject({
      crs: { kind: 'geographic', authority: 'EPSG', code: 4_326, name: 'WGS 84' },
      pixelInterpretation: 'pixel-is-area',
      pixelToModel: [10, 0, 100, 0, -20, 200],
      modelToPixel: [0.1, 0, -10, 0, -0.05, 10],
      bounds: { minX: 100, minY: 160, maxX: 140, maxY: 200 },
      noData: { kind: 'scalar', value: -9_999 },
    })
    expect(spatial.metadata?.['purejsimage:geotiff']).toMatchObject({
      citation: 'WGS 84',
      geographicCrs: 4_326,
    })
    await host.dispose()
  })

  it('exposes identical spatial references for local and HTTP-range GeoTIFF opens', async () => {
    const bytes = northUpGeoTiffFixture()
    const localHost = new ImagingWorkerHost()
    const remoteHost = new ImagingWorkerHost({ fetch: rangeFetch(bytes) })
    const local = await openLocal(localHost, bytes, 'north-up.tif')
    const remote = await openRemote(remoteHost, 'https://fixtures.invalid/north-up.tif')
    expect(local.dataset.spatialReference).toEqual(remote.dataset.spatialReference)
    expect(jsonClone(local.dataset.spatialReference)).toEqual(
      jsonClone(remote.dataset.spatialReference),
    )
    expect(remoteHost.diagnostics().source?.rangeRequests).toBeGreaterThan(0)
    expect(remoteHost.diagnostics().source?.kind).toBe('remote')
    await localHost.dispose()
    await remoteHost.dispose()
  })

  it('preserves a rotated six-parameter affine', async () => {
    const bytes = rotatedGeoTiffFixture()
    const host = new ImagingWorkerHost()
    const opened = await openLocal(host, bytes, 'rotated.tif')
    const spatial = expectIdenticalSpatialReference(
      opened.dataset.spatialReference,
      await librarySpatialReference(bytes),
      opened.dataset.components.length,
    )
    expect(spatial.crs).toMatchObject({
      kind: 'projected',
      authority: 'EPSG',
      code: 32_618,
    })
    expect(spatial.pixelToModel).toEqual([2, 0.5, 10, -0.25, -3, 20])
    expect(spatial.pixelToModel?.[1]).not.toBe(0)
    expect(spatial.pixelToModel?.[3]).not.toBe(0)
    const inverse = spatial.modelToPixel
    if (inverse === undefined) throw new Error('Expected an invertible GeoTIFF affine')
    const modelX = 2 * 3 + 0.5 * 1 + 10
    const modelY = -0.25 * 3 - 3 * 1 + 20
    expect(inverse[0] * modelX + inverse[1] * modelY + inverse[2]).toBeCloseTo(3, 12)
    expect(inverse[3] * modelX + inverse[4] * modelY + inverse[5]).toBeCloseTo(1, 12)
    await host.dispose()
  })

  it('keeps an unknown CRS instead of omitting the spatial reference', async () => {
    const bytes = unknownCrsGeoTiffFixture()
    const host = new ImagingWorkerHost()
    const opened = await openLocal(host, bytes, 'unknown-crs.tif')
    const spatial = expectIdenticalSpatialReference(
      opened.dataset.spatialReference,
      await librarySpatialReference(bytes),
      opened.dataset.components.length,
    )
    expect(spatial.crs).toEqual({ kind: 'unknown' })
    expect(spatial.pixelInterpretation).toBe('pixel-is-area')
    expect(spatial.metadata?.['purejsimage:geotiff']).toMatchObject({
      geographicCrs: null,
      projectedCrs: null,
    })
    await host.dispose()
  })

  it('leaves non-geospatial TIFF and science GSF descriptors without a spatial reference', async () => {
    const tiffHost = new ImagingWorkerHost()
    const tiff = await openLocal(tiffHost, scientificTiffFixture(), 'plain.tif')
    expect(tiff.dataset.spatialReference).toBeUndefined()
    expect(await librarySpatialReference(scientificTiffFixture())).toBeUndefined()
    await tiffHost.dispose()

    const gsfHost = new ImagingWorkerHost()
    const values = Float32Array.from([1, 2, 3, 4, 5, 6])
    const gsf = encodeGsf({
      width: 3,
      height: 2,
      values,
      xyUnit: 'nm',
      xReal: 1.5,
      yReal: 1.5,
    })
    const openedGsf = await openLocal(gsfHost, gsf, 'surface.gsf')
    expect(openedGsf.dataset.spatialReference).toBeUndefined()
    expect(openedGsf.dataset.axes.map(({ unit }) => unit)).toEqual(['nm', 'nm'])
    await gsfHost.dispose()

    const sampleHost = new ImagingWorkerHost()
    const sample = await sampleHost.handle(
      rpcRequest('sample-open', 'source.open-sample', { generation: 1 }),
    )
    const source = payload(sample.response, 'source.opened') as OpenedSourceDescriptor
    expect(source.datasets[0]?.spatialReference).toBeUndefined()
    await sampleHost.dispose()
  })
})
