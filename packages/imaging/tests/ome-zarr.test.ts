import type {
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  WorkerResponse,
} from '@pji-workbench/contracts'
import { rpcRequest } from '@pji-workbench/contracts'
import { describe, expect, it } from 'vitest'

import { ImagingWorkerHost, PUREJSIMAGE_PACKAGE_VERSION, SUPPORTED_READERS } from '../src/index.js'
import { readerKeysForSource } from '../src/worker-readers.js'
import {
  malformedOmeZarrStore,
  storeFetch,
  storeFiles,
  tinyOmeZarrBioformatsStore,
  tinyOmeZarrLabelStore,
  tinyOmeZarrPlateStore,
  tinyOmeZarrShardedV3Store,
  tinyOmeZarrV2Store,
  tinyOmeZarrV3Store,
  unsupportedCodecOmeZarrV2Store,
  zipStore,
} from './ome-zarr-fixtures.js'

function payload<Kind extends Extract<WorkerResponse, { ok: true }>['kind']>(
  response: WorkerResponse,
  kind: Kind,
): Extract<WorkerResponse, { kind: Kind }>['payload'] {
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
  expect(response.kind).toBe(kind)
  return response.payload as Extract<WorkerResponse, { kind: Kind }>['payload']
}

function attachments(files: readonly File[]) {
  return files.map((file, index) => ({
    id: `file-${index}`,
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    relativePath: file.name,
    blob: file,
  }))
}

async function openDirectory(
  host: ImagingWorkerHost,
  files: readonly File[],
  storeRoot = '',
  generation = 1,
): Promise<OpenedSourceDescriptor> {
  return payload(
    (
      await host.handle(
        rpcRequest('open-directory', 'source.open-ome-zarr-directory', {
          generation,
          primaryId: 'file-0',
          storeRoot,
          files: attachments(files),
        }),
      )
    ).response,
    'source.opened',
  ) as OpenedSourceDescriptor
}

async function openZip(
  host: ImagingWorkerHost,
  archive: Uint8Array,
  name = 'store.ome.zarr.zip',
): Promise<OpenedSourceDescriptor> {
  const file = new File([archive.slice().buffer as ArrayBuffer], name, {
    type: 'application/zip',
    lastModified: 0,
  })
  return payload(
    (
      await host.handle(
        rpcRequest('open-zip', 'source.open-ome-zarr-zip', {
          generation: 1,
          primaryId: 'file-0',
          files: attachments([file]),
        }),
      )
    ).response,
    'source.opened',
  ) as OpenedSourceDescriptor
}

async function openRemote(host: ImagingWorkerHost, url: string): Promise<OpenedSourceDescriptor> {
  return payload(
    (
      await host.handle(
        rpcRequest('open-remote', 'source.open-ome-zarr-remote', { generation: 1, url }),
      )
    ).response,
    'source.opened',
  ) as OpenedSourceDescriptor
}

async function openDataset(
  host: ImagingWorkerHost,
  source: OpenedSourceDescriptor,
  datasetId = source.datasets[0]?.id,
): Promise<OpenedDatasetDescriptor> {
  if (datasetId === undefined) throw new Error('fixture has no dataset')
  return payload(
    (
      await host.handle(
        rpcRequest('open-dataset', 'dataset.open', {
          documentId: source.documentId,
          datasetId,
          generation: source.generation,
          sourceId: source.sourceId,
        }),
      )
    ).response,
    'dataset.opened',
  ) as OpenedDatasetDescriptor
}

async function requestPlane(
  host: ImagingWorkerHost,
  dataset: OpenedDatasetDescriptor,
  tileId: string,
  selection = dataset.selection,
) {
  return payload(
    (
      await host.handle(
        rpcRequest(tileId, 'tile.request', {
          tileId,
          datasetHandleId: dataset.handleId,
          generation: dataset.generation,
          displayAxes: selection.displayAxes,
          fixedIndices: selection.fixedIndices,
          resolutionLevel: selection.resolutionLevel,
          component: 0,
          mapping: { mode: 'linear', range: 'auto' },
          region: { x: 0, y: 0, width: 8, height: 8 },
          priority: 'visible',
        }),
      )
    ).response,
    'tile.ready',
  )
}

describe('OME-Zarr imaging worker', () => {
  it('does not select the OME-Zarr reader from ordinary file extensions', () => {
    expect(readerKeysForSource('store.zarr')).not.toContain('ome-zarr')
    expect(readerKeysForSource('unknown.bin')).not.toContain('ome-zarr')
    expect(SUPPORTED_READERS.some(({ id }) => id === 'purejsimage/ome-zarr')).toBe(true)
  })

  it('opens a tiny NGFF 0.4 / Zarr v2 store and uses authored Z defaults', async () => {
    const host = new ImagingWorkerHost()
    const source = await openDirectory(host, storeFiles(tinyOmeZarrV2Store()))
    expect(source.reader.id).toBe('purejsimage/ome-zarr')
    expect(source.source.kind).toBe('ome-zarr-directory')
    expect(source.metadata['omeNgffVersion']).toBe('0.4')
    expect(source.metadata['zarrFormat']).toBe(2)
    const dataset = await openDataset(host, source)
    const z = dataset.selection.fixedIndices.find((fixed) => fixed.axisId === 'z')
    expect(z?.index).toBe(1)
    const tile = await requestPlane(host, dataset, 'v2')
    expect(tile.values[0]).toBe(22)
    await host.dispose()
  })

  it('opens a tiny NGFF 0.5 / Zarr v3 store with authored channels', async () => {
    const host = new ImagingWorkerHost()
    const source = await openDirectory(host, storeFiles(tinyOmeZarrV3Store()))
    expect(source.metadata['omeNgffVersion']).toBe('0.5')
    expect(source.metadata['zarrFormat']).toBe(3)
    const dataset = await openDataset(host, source)
    const display = dataset.dataset.metadata?.['omeZarrDisplay'] as
      | Readonly<Record<string, unknown>>
      | undefined
    const channels = display?.['channels'] as readonly Readonly<Record<string, unknown>>[]
    expect(channels[0]?.['color']).toBe(0xff0000)
    expect(channels[0]?.['window']).toMatchObject({ start: 10, end: 200 })
    const tile = await requestPlane(host, dataset, 'v3')
    expect(tile.values[0]).toBe(22)
    await host.dispose()
  })

  it('exposes logical chunks versus outer shards on a sharded v3 store', async () => {
    const host = new ImagingWorkerHost()
    const source = await openDirectory(host, storeFiles(tinyOmeZarrShardedV3Store()))
    const dataset = await openDataset(host, source)
    const levels = dataset.dataset.metadata?.['omeZarrLevels'] as
      | readonly Readonly<Record<string, unknown>>[]
      | undefined
    expect(levels?.[0]).toMatchObject({
      sharded: true,
      logicalChunkShape: [4, 4],
      storageChunkShape: [8, 8],
      shardIndexLocation: 'end',
    })
    const tile = await requestPlane(host, dataset, 'shard')
    expect(tile.values[0]).toBe(30)
    await host.dispose()
  })

  it('lists a label dataset and its source relationship', async () => {
    const host = new ImagingWorkerHost()
    const source = await openDirectory(host, storeFiles(tinyOmeZarrLabelStore()))
    const kinds = source.datasets.map((dataset) => dataset.metadata?.['kind'])
    expect(kinds).toContain('image')
    expect(kinds).toContain('label')
    const label = source.datasets.find((dataset) => dataset.metadata?.['kind'] === 'label')
    expect(label?.metadata?.['imageLabel']).toBeDefined()
    await host.dispose()
  })

  it('opens a plate field with acquisition metadata', async () => {
    const host = new ImagingWorkerHost()
    const source = await openDirectory(host, storeFiles(tinyOmeZarrPlateStore()))
    expect(source.metadata['plate']).toMatchObject({ name: 'plate-1', wellCount: 1 })
    const field = source.datasets[0]
    expect(field?.metadata?.['well']).toMatchObject({
      path: 'A/1',
      field: 'A/1/0',
      acquisition: 0,
    })
    await host.dispose()
  })

  it('opens a bioformats2raw series root', async () => {
    const host = new ImagingWorkerHost()
    const source = await openDirectory(host, storeFiles(tinyOmeZarrBioformatsStore()))
    expect(source.metadata['bioformats2rawLayout']).toBe(3)
    expect(source.metadata['seriesCount']).toBe(1)
    expect(source.datasets[0]?.metadata?.['series']).toBe(0)
    await host.dispose()
  })

  it('opens a nested ZIP archive through the published reader path', async () => {
    const host = new ImagingWorkerHost()
    const source = await openZip(host, zipStore(tinyOmeZarrV3Store(), 'nested'))
    expect(source.source.kind).toBe('ome-zarr-zip')
    expect(source.metadata['store']).toBe('zip')
    await openDataset(host, source)
    await host.dispose()
  })

  it('rejects ambiguous directory roots unless one root is selected', async () => {
    const host = new ImagingWorkerHost()
    const files = [
      ...storeFiles(tinyOmeZarrV2Store(), 'one'),
      ...storeFiles(tinyOmeZarrV3Store(), 'two'),
    ]
    const failed = await host.handle(
      rpcRequest('ambiguous', 'source.open-ome-zarr-directory', {
        generation: 1,
        primaryId: 'file-0',
        storeRoot: '',
        files: attachments(files),
      }),
    )
    expect(failed.response).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    })
    const selected = await openDirectory(host, files, 'two')
    expect(selected.metadata['zarrFormat']).toBe(3)
    await host.dispose()
  })

  it('opens a remote Range store and closes the HTTP store without affecting others', async () => {
    const v2 = tinyOmeZarrV2Store()
    const v3 = tinyOmeZarrV3Store()
    const host = new ImagingWorkerHost({
      fetch: async (input, init) => {
        const url = String(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        )
        if (url.includes('/v2/')) return storeFetch('https://fixtures.invalid/v2/', v2)(input, init)
        return storeFetch('https://fixtures.invalid/v3/', v3)(input, init)
      },
    })
    const first = await openRemote(host, 'https://fixtures.invalid/v2/')
    const second = await openRemote(host, 'https://fixtures.invalid/v3/zarr.json')
    expect(first.source.kind).toBe('ome-zarr-remote')
    expect(second.metadata['zarrFormat']).toBe(3)
    const firstDataset = await openDataset(host, first)
    await host.handle(
      rpcRequest('close-second', 'source.close', {
        sourceId: second.sourceId,
        generation: second.generation,
      }),
    )
    const diagnostics = host.diagnostics()
    expect(diagnostics.aggregate.openSources).toBe(1)
    expect(diagnostics.sources[0]?.omeZarrNetwork).toBeDefined()
    const tile = await requestPlane(host, firstDataset, 'kept-remote')
    expect(tile.values[0]).toBe(22)
    await host.dispose()
    expect(host.diagnostics().aggregate.openSources).toBe(0)
  })

  it('opens a remote store when Content-Range is hidden from JavaScript', async () => {
    const files = tinyOmeZarrV3Store()
    const host = new ImagingWorkerHost({
      fetch: storeFetch('https://fixtures.invalid/hidden/', files, { hideContentRange: true }),
    })
    const source = await openRemote(host, 'https://fixtures.invalid/hidden/')
    expect(source.metadata['zarrFormat']).toBe(3)
    await host.dispose()
  })

  it('cancels a remote OME-Zarr open', async () => {
    const controller = new AbortController()
    const host = new ImagingWorkerHost({
      fetch: async () => {
        controller.abort()
        await new Promise((resolve) => setTimeout(resolve, 50))
        return new Response(null, { status: 200 })
      },
    })
    const opened = host.handle(
      rpcRequest('cancel-open', 'source.open-ome-zarr-remote', {
        generation: 1,
        url: 'https://fixtures.invalid/slow/',
      }),
    )
    const cancelled = await host.handle(
      rpcRequest('cancel', 'request.cancel', { targetRequestId: 'cancel-open' }),
    )
    expect(payload(cancelled.response, 'request.cancelled').found).toBe(true)
    const result = await opened
    expect(result.response.ok).toBe(false)
    if (result.response.ok) throw new Error('expected cancellation')
    expect(result.response.error.code).toBe('ABORTED')
    await host.dispose()
  })

  it('refuses an unsupported codec', async () => {
    const host = new ImagingWorkerHost()
    const failed = await host.handle(
      rpcRequest('gzip', 'source.open-ome-zarr-directory', {
        generation: 1,
        primaryId: 'file-0',
        storeRoot: '',
        files: attachments(storeFiles(unsupportedCodecOmeZarrV2Store())),
      }),
    )
    expect(failed.response).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } })
    await host.dispose()
  })

  it('rejects malformed NGFF metadata', async () => {
    const host = new ImagingWorkerHost()
    const failed = await host.handle(
      rpcRequest('malformed', 'source.open-ome-zarr-directory', {
        generation: 1,
        primaryId: 'file-0',
        storeRoot: '',
        files: attachments(storeFiles(malformedOmeZarrStore())),
      }),
    )
    expect(failed.response).toMatchObject({ ok: false, error: { code: 'MALFORMED_METADATA' } })
    await host.dispose()
  })

  it('composes authored OMERO channels in the worker', async () => {
    const host = new ImagingWorkerHost()
    const source = await openDirectory(host, storeFiles(tinyOmeZarrV3Store()))
    const dataset = await openDataset(host, source)
    const tile = payload(
      (
        await host.handle(
          rpcRequest('compose', 'tile.request', {
            tileId: 'compose',
            datasetHandleId: dataset.handleId,
            generation: dataset.generation,
            displayAxes: dataset.selection.displayAxes,
            fixedIndices: dataset.selection.fixedIndices,
            resolutionLevel: 0,
            component: 0,
            mapping: {
              mode: 'linear',
              range: 'manual',
              minimum: 0,
              maximum: 255,
              colorModel: 'color',
              omeZarrChannels: [
                {
                  index: 0,
                  active: true,
                  color: 0xff0000,
                  window: { start: 0, end: 255 },
                },
                {
                  index: 1,
                  active: true,
                  color: 0x00ff00,
                  window: { start: 0, end: 255 },
                },
              ],
            },
            region: { x: 0, y: 0, width: 8, height: 8 },
            priority: 'visible',
          }),
        )
      ).response,
      'tile.ready',
    )
    expect(tile.rgba[0]).toBeGreaterThan(0)
    expect(tile.rgba[1]).toBeGreaterThan(0)
    expect(tile.rgba[3]).toBe(255)
    await host.dispose()
  })

  it('pins the published 0.16.0 package', async () => {
    const { readFile } = await import('node:fs/promises')
    const imaging = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: { purejsimage: string } }
    expect(PUREJSIMAGE_PACKAGE_VERSION).toBe('0.16.0')
    expect(imaging.dependencies.purejsimage).toBe('0.16.0')
  })
})

describe.skipIf(process.env['PJI_OME_ZARR_PUBLIC'] !== '1')(
  'optional public OME-Zarr smoke',
  () => {
    it('opens a pinned public NGFF store identity', async () => {
      const url = 'https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0062A/6001240.zarr'
      const host = new ImagingWorkerHost()
      const source = await openRemote(host, url)
      expect(source.reader.id).toBe('purejsimage/ome-zarr')
      expect(source.source.kind).toBe('ome-zarr-remote')
      expect(typeof source.metadata['omeNgffVersion']).toBe('string')
      await host.dispose()
    })
  },
)
