import type {
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  WorkerResponse,
} from '@pji-workbench/contracts'
import { rpcRequest } from '@pji-workbench/contracts'
import { describe, expect, it } from 'vitest'

import { ImagingWorkerHost } from '../src/index.js'
import { multidimensionalGeoZarrFixture } from './geozarr-fixture.js'
import { storeFetch } from './ome-zarr-fixtures.js'

function payload<Kind extends Extract<WorkerResponse, { ok: true }>['kind']>(
  response: WorkerResponse,
  kind: Kind,
): Extract<WorkerResponse, { kind: Kind }>['payload'] {
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
  expect(response.kind).toBe(kind)
  return response.payload as Extract<WorkerResponse, { kind: Kind }>['payload']
}

describe('GeoZarr imaging Worker profile', () => {
  it('opens the bounded bundled multidimensional object-store fixture without enumeration', async () => {
    const files = [...multidimensionalGeoZarrFixture()].map(
      ([name, bytes]) =>
        new File([bytes.slice().buffer as ArrayBuffer], name, {
          type: name === 'zarr.json' ? 'application/json' : 'application/octet-stream',
          lastModified: 0,
        }),
    )
    const primaryIndex = files.findIndex(({ name }) => name === 'zarr.json')
    const host = new ImagingWorkerHost({ profile: 'geo' })
    const source = payload(
      (
        await host.handle(
          rpcRequest('open-bundled-geozarr', 'source.open-geozarr-bundled', {
            generation: 1,
            primaryId: `file-${primaryIndex}`,
            files: files.map((file, index) => ({
              id: `file-${index}`,
              name: file.name,
              relativePath: file.name,
              size: file.size,
              type: file.type,
              lastModified: file.lastModified,
              blob: file,
            })),
          }),
        )
      ).response,
      'source.opened',
    ) as OpenedSourceDescriptor
    expect(source.source.kind).toBe('geo-zarr-bundled')
    expect(source.reader.id).toBe('purejsimage/geo/geozarr')
    expect(source.datasets[0]?.geo?.axes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'time', kind: 'time', length: 2 }),
        expect.objectContaining({ id: 'band', kind: 'band', length: 2 }),
      ]),
    )
    expect(source.datasets[0]?.geoZarrStructure?.structuralMetadata).toMatchObject({
      store: expect.any(Object),
    })
    await host.dispose()
  })

  it('opens the deterministic multidimensional store and reads only the selected time-band chunk', async () => {
    const rootUrl = 'https://fixtures.invalid/fixture.zarr/'
    const requested = new Set<string>()
    const fixtureFetch = storeFetch(rootUrl, multidimensionalGeoZarrFixture())
    const trackedFetch: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      )
      requested.add(url.pathname)
      return fixtureFetch(input, init)
    }
    const host = new ImagingWorkerHost({ profile: 'geo', fetch: trackedFetch })
    const source = payload(
      (
        await host.handle(
          rpcRequest('open-geozarr', 'source.open-geozarr-remote', {
            generation: 1,
            url: rootUrl,
          }),
        )
      ).response,
      'source.opened',
    ) as OpenedSourceDescriptor

    expect(source.source.kind).toBe('geo-zarr-remote')
    expect(source.reader).toMatchObject({
      id: 'purejsimage/geo/geozarr',
      version: '1.0.0',
      format: 'GeoZarr',
    })
    expect(source.datasets[0]?.geo).toMatchObject({
      schemaVersion: 1,
      sampleType: 'uint16',
      primaryLevelId: '0',
      axes: [
        { id: 'time', kind: 'time', length: 2 },
        { id: 'band', kind: 'band', length: 2 },
      ],
      grid: {
        pixelToWorld: [10, 0, 100, 0, -10, 200],
        pixelRegistration: 'pixel-is-area',
      },
      spatialReference: {
        coordinateSystemType: 'geographic',
        authority: 'EPSG',
        code: '4326',
        name: 'WGS 84',
        wkt2: 'GEOGCRS["WGS 84",ID["EPSG",4326]]',
        projJson: { type: 'GeographicCRS', name: 'WGS 84' },
        horizontalUnit: { name: 'degree' },
        formalAxes: [
          { name: 'Geodetic latitude', direction: 'north', order: 0 },
          { name: 'Geodetic longitude', direction: 'east', order: 1 },
        ],
        applicationAxes: {
          x: { name: 'X', formalAxisIndex: 1 },
          y: { name: 'Y', formalAxisIndex: 0 },
        },
        state: 'complete',
      },
    })
    expect(source.datasets[0]?.geoZarrStructure).toMatchObject({
      schemaVersion: 1,
      zarrFormat: 3,
      storeKind: 'http',
      datasets: [
        {
          levels: [
            {
              logicalChunkShape: [1, 1, 2, 2],
              sharded: false,
              codecs: ['bytes'],
            },
          ],
        },
      ],
    })

    const opened = payload(
      (
        await host.handle(
          rpcRequest('open-geozarr-dataset', 'dataset.open', {
            sourceId: source.sourceId,
            documentId: source.documentId,
            datasetId: source.datasets[0]?.id ?? 'missing',
            generation: 1,
          }),
        )
      ).response,
      'dataset.opened',
    ) as OpenedDatasetDescriptor
    const fixedIndices = opened.selection.fixedIndices.map((fixed) => ({
      ...fixed,
      index: fixed.axisId === 'time' || fixed.axisId === 'band' ? 1 : fixed.index,
    }))
    const tile = payload(
      (
        await host.handle(
          rpcRequest('geozarr-tile', 'tile.request', {
            tileId: 'time-1-band-1',
            datasetHandleId: opened.handleId,
            generation: 1,
            displayAxes: opened.selection.displayAxes,
            fixedIndices,
            resolutionLevel: 0,
            component: 0,
            mapping: { mode: 'linear', range: 'auto' },
            region: { x: 0, y: 0, width: 2, height: 2 },
            priority: 'visible',
          }),
        )
      ).response,
      'tile.ready',
    )
    expect([...tile.values]).toEqual([1_100, 1_101, 1_102, 1_103])
    expect(requested.has('/fixture.zarr/c/1/1/0/0')).toBe(true)
    expect([...requested].filter((path) => path.includes('/c/'))).toEqual([
      '/fixture.zarr/c/1/1/0/0',
    ])
    expect(host.diagnostics(source.sourceId).sources[0]?.geoZarrStructure?.io).toMatchObject({
      logicalChunkReads: 1,
      outerShardAccesses: 0,
      shardPayloadRanges: 0,
    })

    await host.handle(
      rpcRequest('close-geozarr', 'source.close', {
        sourceId: source.sourceId,
        generation: 1,
      }),
    )
    expect(host.diagnostics().releases).toEqual({
      documents: 1,
      datasets: 1,
      tiles: 1,
      runtimes: 1,
    })
  })

  it('rejects GeoZarr RPC on the default Science profile', async () => {
    const host = new ImagingWorkerHost({
      fetch: storeFetch('https://fixtures.invalid/fixture.zarr/', multidimensionalGeoZarrFixture()),
    })
    const opened = await host.handle(
      rpcRequest('science-geozarr', 'source.open-geozarr-remote', {
        generation: 1,
        url: 'https://fixtures.invalid/fixture.zarr/',
      }),
    )
    expect(opened.response).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    await host.dispose()
  })
})
