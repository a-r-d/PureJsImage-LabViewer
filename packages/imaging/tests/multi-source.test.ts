import type {
  DatasetHandleId,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  WorkerResponse,
} from '@pji-workbench/contracts'
import { RPC_SCHEMA_VERSION, rpcRequest } from '@pji-workbench/contracts'
import { encodeGsf } from 'purejsimage/scientific/readers/gsf'
import { describe, expect, it } from 'vitest'

import { ImagingWorkerClient, ImagingWorkerHost } from '../src/index.js'
import { northUpGeoTiffFixture, rgbGeoTiffFixture } from './geotiff-fixture.js'

function payload<Kind extends Extract<WorkerResponse, { ok: true }>['kind']>(
  response: WorkerResponse,
  kind: Kind,
): Extract<WorkerResponse, { kind: Kind }>['payload'] {
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
  expect(response.kind).toBe(kind)
  return response.payload as Extract<WorkerResponse, { kind: Kind }>['payload']
}

function rangeFetch(files: Readonly<Record<string, Uint8Array>>): typeof fetch {
  return async (input, init) => {
    const url = String(input)
    const name = decodeURIComponent(url.split('/').at(-1) ?? '')
    const bytes = files[name]
    if (bytes === undefined) return new Response(null, { status: 404 })
    const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
    if (match === undefined || match === null) return new Response(null, { status: 416 })
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: {
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
        etag: `"${name}-v1"`,
      },
    })
  }
}

function pad(bytes: Uint8Array, size = 64 * 1_024): Uint8Array {
  if (bytes.byteLength >= size) return bytes
  const padded = new Uint8Array(size)
  padded.set(bytes)
  return padded
}

function gsfFile(name: string, width: number, height: number, fill: number): File {
  const values = Float32Array.from({ length: width * height }, () => fill)
  const bytes = encodeGsf({ width, height, values, xyUnit: 'nm', xReal: width, yReal: height })
  return new File([bytes.slice().buffer as ArrayBuffer], name)
}

async function openLocal(
  host: ImagingWorkerHost,
  file: File,
  generation = 1,
): Promise<{ source: OpenedSourceDescriptor; dataset: OpenedDatasetDescriptor }> {
  const opened = await host.handle(
    rpcRequest(`local-${file.name}-${generation}`, 'source.open-local', {
      generation,
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
  const source = payload(opened.response, 'source.opened') as OpenedSourceDescriptor
  const dataset = payload(
    (
      await host.handle(
        rpcRequest(`dataset-${source.sourceId}`, 'dataset.open', {
          documentId: source.documentId,
          datasetId: source.datasets[0]?.id ?? 'missing',
          generation: source.generation,
          sourceId: source.sourceId,
        }),
      )
    ).response,
    'dataset.opened',
  ) as OpenedDatasetDescriptor
  return { source, dataset }
}

async function openRemote(
  host: ImagingWorkerHost,
  url: string,
  generation = 1,
): Promise<{ source: OpenedSourceDescriptor; dataset: OpenedDatasetDescriptor }> {
  const opened = await host.handle(
    rpcRequest(`remote-${url}`, 'source.open-remote', { generation, url }),
  )
  const source = payload(opened.response, 'source.opened') as OpenedSourceDescriptor
  const dataset = payload(
    (
      await host.handle(
        rpcRequest(`dataset-${source.sourceId}`, 'dataset.open', {
          documentId: source.documentId,
          datasetId: source.datasets[0]?.id ?? 'missing',
          generation: source.generation,
          sourceId: source.sourceId,
        }),
      )
    ).response,
    'dataset.opened',
  ) as OpenedDatasetDescriptor
  return { source, dataset }
}

async function requestCorner(
  host: ImagingWorkerHost,
  dataset: OpenedDatasetDescriptor,
  requestId: string,
) {
  return host.handle(
    rpcRequest(requestId, 'tile.request', {
      tileId: requestId,
      datasetHandleId: dataset.handleId,
      generation: dataset.generation,
      displayAxes: dataset.selection.displayAxes,
      fixedIndices: dataset.selection.fixedIndices,
      resolutionLevel: 0,
      component: 0,
      mapping: { mode: 'linear', range: 'auto' },
      region: { x: 0, y: 0, width: 1, height: 1 },
      priority: 'visible',
    }),
  )
}

class HostBackedWorker extends EventTarget {
  terminated = false

  constructor(private readonly host: ImagingWorkerHost) {
    super()
  }

  postMessage(message: unknown): void {
    void this.host.handle(message).then(
      ({ response }) => {
        this.dispatchEvent(new MessageEvent('message', { data: response }))
      },
      (error: unknown) => {
        this.dispatchEvent(
          new MessageEvent('message', {
            data: {
              schemaVersion: RPC_SCHEMA_VERSION,
              requestId:
                typeof message === 'object' &&
                message !== null &&
                'requestId' in message &&
                typeof message.requestId === 'string'
                  ? message.requestId
                  : 'unknown',
              ok: false,
              kind: 'error',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : String(error),
                retryable: false,
              },
            },
          }),
        )
      },
    )
  }

  terminate(): void {
    this.terminated = true
    void this.host.dispose()
  }
}

describe('multi-source imaging Worker', () => {
  it('opens two remote sources and renders tiles from both', async () => {
    const files = {
      'north-up.tif': pad(northUpGeoTiffFixture()),
      'rgb.tif': pad(rgbGeoTiffFixture()),
    }
    const host = new ImagingWorkerHost({ fetch: rangeFetch(files) })
    const first = await openRemote(host, 'https://fixtures.invalid/north-up.tif', 1)
    const second = await openRemote(host, 'https://fixtures.invalid/rgb.tif', 1)
    expect(first.source.sourceId).not.toBe(second.source.sourceId)
    expect(first.dataset.sourceId).toBe(first.source.sourceId)
    expect(second.dataset.sourceId).toBe(second.source.sourceId)
    const firstTile = payload(
      (await requestCorner(host, first.dataset, 'a')).response,
      'tile.ready',
    )
    const secondTile = payload(
      (await requestCorner(host, second.dataset, 'b')).response,
      'tile.ready',
    )
    expect(firstTile.datasetHandleId).toBe(first.dataset.handleId)
    expect(secondTile.datasetHandleId).toBe(second.dataset.handleId)
    expect(firstTile.values.some((value) => Number.isFinite(value))).toBe(true)
    expect(secondTile.values.some((value) => Number.isFinite(value))).toBe(true)
    const diagnostics = host.diagnostics()
    expect(diagnostics.sources).toHaveLength(2)
    expect(diagnostics.aggregate.openSources).toBe(2)
    expect(diagnostics.aggregate.openDatasets).toBe(2)
    expect(diagnostics.epoch).toBe(1)
    await host.dispose()
  })

  it('opens two local sources concurrently', async () => {
    const host = new ImagingWorkerHost()
    const first = await openLocal(host, gsfFile('one.gsf', 8, 4, 3), 1)
    const second = await openLocal(host, gsfFile('two.gsf', 8, 4, 9), 1)
    const firstTile = payload(
      (await requestCorner(host, first.dataset, 'a')).response,
      'tile.ready',
    )
    const secondTile = payload(
      (await requestCorner(host, second.dataset, 'b')).response,
      'tile.ready',
    )
    expect(firstTile.values[0]).toBe(3)
    expect(secondTile.values[0]).toBe(9)
    await host.dispose()
  })

  it('leaves the first source readable when a second open fails', async () => {
    const host = new ImagingWorkerHost({
      fetch: async () => new Response(null, { status: 404 }),
    })
    const first = await openLocal(host, gsfFile('kept.gsf', 8, 4, 5), 1)
    const failed = await host.handle(
      rpcRequest('bad-remote', 'source.open-remote', {
        generation: 1,
        url: 'https://fixtures.invalid/missing.tif',
      }),
    )
    expect(failed.response.ok).toBe(false)
    expect(host.diagnostics().aggregate.openSources).toBe(1)
    const tile = payload((await requestCorner(host, first.dataset, 'kept')).response, 'tile.ready')
    expect(tile.values[0]).toBe(5)
    await host.dispose()
  })

  it('keeps the remaining source readable after closing one', async () => {
    const host = new ImagingWorkerHost()
    const first = await openLocal(host, gsfFile('keep.gsf', 8, 4, 2), 1)
    const second = await openLocal(host, gsfFile('drop.gsf', 8, 4, 7), 1)
    const closed = await host.handle(
      rpcRequest('close-second', 'source.close', {
        sourceId: second.source.sourceId,
        generation: second.source.generation,
      }),
    )
    expect(closed.response).toMatchObject({ ok: true, kind: 'source.closed' })
    const stale = await requestCorner(host, second.dataset, 'stale-second')
    expect(stale.response).toMatchObject({ ok: false, error: { code: 'STALE_ID' } })
    const tile = payload((await requestCorner(host, first.dataset, 'kept')).response, 'tile.ready')
    expect(tile.values[0]).toBe(2)
    expect(host.diagnostics().aggregate.openSources).toBe(1)
    await host.dispose()
  })

  it('rejects stale dataset handles without consulting a global active source', async () => {
    const host = new ImagingWorkerHost()
    const first = await openLocal(host, gsfFile('a.gsf', 8, 4, 1), 1)
    await openLocal(host, gsfFile('b.gsf', 8, 4, 2), 1)
    const staleHandle = await host.handle(
      rpcRequest('stale-handle', 'tile.request', {
        tileId: 'stale-handle',
        datasetHandleId: 'dataset-missing' as DatasetHandleId,
        generation: first.dataset.generation,
        displayAxes: first.dataset.selection.displayAxes,
        fixedIndices: first.dataset.selection.fixedIndices,
        resolutionLevel: 0,
        component: 0,
        mapping: { mode: 'linear', range: 'auto' },
        region: { x: 0, y: 0, width: 1, height: 1 },
        priority: 'visible',
      }),
    )
    expect(staleHandle.response).toMatchObject({ ok: false, error: { code: 'STALE_ID' } })
    const wrongGeneration = await requestCorner(
      host,
      {
        ...first.dataset,
        generation: 0,
      },
      'wrong-generation',
    )
    expect(wrongGeneration.response).toMatchObject({ ok: false, error: { code: 'STALE_ID' } })
    await host.dispose()
  })

  it('cancels in-flight work for one source without aborting the other', async () => {
    const files = {
      'slow.tif': pad(northUpGeoTiffFixture()),
      'keep.tif': pad(rgbGeoTiffFixture()),
    }
    let holdSlowTiles = false
    let releaseSlow: () => void = () => undefined
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    const host = new ImagingWorkerHost({
      fetch: async (input, init) => {
        if (holdSlowTiles && String(input).includes('slow.tif')) await slowGate
        return rangeFetch(files)(input, init)
      },
    })
    const first = await openRemote(host, 'https://fixtures.invalid/slow.tif', 1)
    const second = await openRemote(host, 'https://fixtures.invalid/keep.tif', 1)
    holdSlowTiles = true
    const tilePromise = requestCorner(host, first.dataset, 'cancel-me')
    await Promise.resolve()
    const cancelled = await host.handle(
      rpcRequest('cancel', 'request.cancel', { targetRequestId: 'cancel-me' }),
    )
    expect(cancelled.response).toMatchObject({
      ok: true,
      payload: { found: true },
    })
    releaseSlow()
    await expect(tilePromise).resolves.toMatchObject({
      response: { ok: false, error: { code: 'ABORTED' } },
    })
    const kept = payload(
      (await requestCorner(host, second.dataset, 'other')).response,
      'tile.ready',
    )
    expect(kept.values.some((value) => Number.isFinite(value))).toBe(true)
    await host.dispose()
  })

  it('releases every managed source, dataset, runtime, and pending request on dispose', async () => {
    const host = new ImagingWorkerHost()
    const first = await openLocal(host, gsfFile('one.gsf', 8, 4, 1), 1)
    await openLocal(host, gsfFile('two.gsf', 8, 4, 2), 1)
    await requestCorner(host, first.dataset, 'tile')
    await host.dispose()
    expect(host.diagnostics()).toMatchObject({
      epoch: 2,
      aggregate: { openSources: 0, openDatasets: 0, pendingRequests: 0 },
      releases: { documents: 2, datasets: 2, tiles: 1, runtimes: 2 },
    })
    const stale = await requestCorner(host, first.dataset, 'after-dispose')
    expect(stale.response).toMatchObject({ ok: false, error: { code: 'STALE_ID' } })
  })

  it('reports per-source and aggregate range diagnostics', async () => {
    const files = {
      'north-up.tif': pad(northUpGeoTiffFixture()),
      'rgb.tif': pad(rgbGeoTiffFixture()),
    }
    const host = new ImagingWorkerHost({ fetch: rangeFetch(files) })
    const first = await openRemote(host, 'https://fixtures.invalid/north-up.tif')
    await openRemote(host, 'https://fixtures.invalid/rgb.tif')
    await requestCorner(host, first.dataset, 'diag-tile')
    const all = host.diagnostics()
    expect(all.sources).toHaveLength(2)
    expect(all.aggregate.rangeCacheBytes).toBeGreaterThan(0)
    const selected = host.diagnostics(first.source.sourceId)
    expect(selected.sources).toHaveLength(1)
    expect(selected.sources[0]?.id).toBe(first.source.sourceId)
    expect(selected.aggregate.openSources).toBe(2)
    await host.dispose()
  })

  it('refuses another open source instead of silently closing a visible one', async () => {
    const host = new ImagingWorkerHost({ limits: { maxOpenSources: 1 } })
    const first = await openLocal(host, gsfFile('only.gsf', 8, 4, 6), 1)
    const refusedFile = gsfFile('two.gsf', 8, 4, 1)
    const refused = await host.handle(
      rpcRequest('overflow', 'source.open-local', {
        generation: 1,
        primaryId: 'file-0',
        files: [
          {
            id: 'file-0',
            name: refusedFile.name,
            size: refusedFile.size,
            type: refusedFile.type,
            lastModified: refusedFile.lastModified,
            blob: refusedFile,
          },
        ],
      }),
    )
    expect(refused.response).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } })
    const tile = payload((await requestCorner(host, first.dataset, 'only')).response, 'tile.ready')
    expect(tile.values[0]).toBe(6)
    expect(host.diagnostics().aggregate.openSources).toBe(1)
    await host.dispose()
  })

  it('does not install the materials toolbox on the generic imaging host', async () => {
    const host = new ImagingWorkerHost()
    const opened = await openLocal(host, gsfFile('plain.gsf', 4, 4, 1), 1)
    const catalog = payload(
      (
        await host.handle(
          rpcRequest('catalog', 'analysis.catalog', {
            datasetHandleId: opened.dataset.handleId,
            generation: opened.dataset.generation,
          }),
        )
      ).response,
      'analysis.catalog',
    )
    expect(catalog.documentation).toEqual([])
    expect(catalog.presets).toEqual([])
    await host.dispose()
  })

  it('closes the previous science source only after a successful replace-one open', async () => {
    const host = new ImagingWorkerHost()
    const client = new ImagingWorkerClient({
      sourcePolicy: 'replace-one',
      workerFactory: () => new HostBackedWorker(host) as unknown as Worker,
    })
    await client.initialize()
    const first = await client.openSample(1, undefined, 'generated.calibrated-particles')
    const second = await client.openSample(1, undefined, 'generated.touching-particles')
    expect(host.diagnostics().aggregate.openSources).toBe(1)
    expect(host.diagnostics().sources[0]?.id).toBe(second.sourceId)
    await expect(client.closeSource(first.sourceId, first.generation)).rejects.toThrow(/stale/iu)
    client.dispose()
  })
})
