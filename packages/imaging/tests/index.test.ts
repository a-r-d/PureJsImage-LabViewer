import type {
  DatasetHandleId,
  DocumentId,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  RenderTile,
  SourceId,
  WorkerResponse,
} from '@pji-workbench/contracts'
import { rpcRequest } from '@pji-workbench/contracts'
import { encodeGsf } from 'purejsimage/scientific/readers/gsf'
import { describe, expect, it } from 'vitest'

import {
  ImagingWorkerClient,
  ImagingWorkerHost,
  PUREJSIMAGE_PACKAGE_VERSION,
  SUPPORTED_READERS,
} from '../src/index.js'

class FakeWorker extends EventTarget {
  terminated = false
  initialized = 0

  postMessage(message: unknown): void {
    if (
      typeof message === 'object' &&
      message !== null &&
      'kind' in message &&
      message.kind === 'worker.initialize' &&
      'requestId' in message &&
      typeof message.requestId === 'string'
    ) {
      this.initialized += 1
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent('message', {
            data: {
              schemaVersion: 1,
              requestId: message.requestId,
              ok: true,
              kind: 'worker.initialize',
              payload: { readers: SUPPORTED_READERS },
            },
          }),
        ),
      )
    }
  }

  terminate(): void {
    this.terminated = true
  }
}

function payload<Kind extends Extract<WorkerResponse, { ok: true }>['kind']>(
  response: WorkerResponse,
  kind: Kind,
): Extract<WorkerResponse, { kind: Kind }>['payload'] {
  expect(response.ok).toBe(true)
  if (!response.ok) throw new Error(response.error.message)
  expect(response.kind).toBe(kind)
  return response.payload as Extract<WorkerResponse, { kind: Kind }>['payload']
}

async function openGenerated(host: ImagingWorkerHost, generation = 1) {
  const openedResponse = await host.handle(
    rpcRequest('sample-open', 'source.open-sample', { generation }),
  )
  const source = payload(openedResponse.response, 'source.opened') as OpenedSourceDescriptor
  const summary = source.datasets[0]
  if (summary === undefined) throw new Error('Sample did not expose a dataset')
  const datasetResponse = await host.handle(
    rpcRequest('dataset-open', 'dataset.open', {
      documentId: source.documentId,
      datasetId: summary.id,
      generation,
    }),
  )
  const dataset = payload(datasetResponse.response, 'dataset.opened') as OpenedDatasetDescriptor
  return { source, dataset }
}

async function requestTile(
  host: ImagingWorkerHost,
  dataset: OpenedDatasetDescriptor,
  generation = dataset.generation,
): Promise<RenderTile> {
  const result = await host.handle(
    rpcRequest(`tile-${generation}`, 'tile.request', {
      tileId: `tile-${generation}`,
      datasetHandleId: dataset.handleId,
      generation,
      displayAxes: dataset.selection.displayAxes,
      fixedIndices: dataset.selection.fixedIndices,
      resolutionLevel: dataset.selection.resolutionLevel,
      component: 0,
      mapping: { mode: 'linear', range: 'auto' },
      region: { x: 384, y: 256, width: 128, height: 96 },
      priority: 'visible',
    }),
  )
  return payload(result.response, 'tile.ready') as RenderTile
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
        etag: '"generated-gsf-v1"',
      },
    })
  }
}

describe('PureJsImage Worker host', () => {
  it('pins the package and exposes the seven explicit reader descriptors', async () => {
    expect(PUREJSIMAGE_PACKAGE_VERSION).toBe('0.10.0')
    expect(SUPPORTED_READERS.map(({ id }) => id)).toEqual([
      'purejsimage/gsf',
      'purejsimage/envi',
      'purejsimage/fits',
      'purejsimage/mrc',
      'purejsimage/cbf',
      'purejsimage/ome-tiff',
      'purejsimage/aperio-svs',
    ])
    const initialized = await new ImagingWorkerHost().handle(
      rpcRequest('initialize', 'worker.initialize', null),
    )
    expect(payload(initialized.response, 'worker.initialize')).toMatchObject({
      readers: SUPPORTED_READERS,
    })
  })

  it('opens a calibrated sample and returns only a bounded quantitative render tile', async () => {
    const host = new ImagingWorkerHost()
    const { source, dataset } = await openGenerated(host)
    expect(source.reader.id).toBe('purejsimage/gsf')
    expect(dataset.dataset.axes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'x',
          unit: 'nm',
          coordinates: { type: 'linear', step: 0.42, origin: 0 },
        }),
      ]),
    )
    const tile = await requestTile(host, dataset)
    expect(tile).toMatchObject({ width: 128, height: 96, generation: 1 })
    expect(tile.rgba).toHaveLength(128 * 96 * 4)
    expect(tile.values).toHaveLength(128 * 96)
    expect(tile.histogram).toHaveLength(64)
    expect(tile.values.some((value) => value !== tile.values[0])).toBe(true)
    const diagnostics = host.diagnostics()
    expect(diagnostics.tileRuntime).toMatchObject({ enabled: true })
    expect(diagnostics.releases.tiles).toBe(1)
    await host.dispose()
  })

  it('rejects stale IDs, returns structured malformed-message errors, and crashes only on the test hook', async () => {
    const host = new ImagingWorkerHost()
    const { dataset } = await openGenerated(host)
    const stale = await host.handle(
      rpcRequest('stale', 'tile.request', {
        tileId: 'stale',
        datasetHandleId: dataset.handleId,
        generation: 0,
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        resolutionLevel: 0,
        component: 0,
        mapping: { mode: 'linear', range: 'auto' },
        region: { x: 0, y: 0, width: 16, height: 16 },
        priority: 'visible',
      }),
    )
    expect(stale.response).toMatchObject({ ok: false, error: { code: 'STALE_ID' } })
    const malformed = await host.handle({ nonsense: true })
    expect(malformed.response).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } })
    await expect(host.handle(rpcRequest('crash', 'worker.test-crash', null))).rejects.toThrow(
      'Intentional worker crash test',
    )
    await host.dispose()
  })

  it('closes dataset runtime and document handles exactly once', async () => {
    const host = new ImagingWorkerHost()
    const { source, dataset } = await openGenerated(host)
    const datasetClosed = await host.handle(
      rpcRequest('close-dataset', 'dataset.close', {
        handleId: dataset.handleId,
        generation: source.generation,
      }),
    )
    expect(datasetClosed.response).toMatchObject({ ok: true, kind: 'dataset.closed' })
    const sourceClosed = await host.handle(
      rpcRequest('close-source', 'source.close', {
        sourceId: source.sourceId,
        generation: source.generation,
      }),
    )
    expect(sourceClosed.response).toMatchObject({ ok: true, kind: 'source.closed' })
    expect(host.diagnostics().releases).toEqual({
      documents: 1,
      datasets: 1,
      tiles: 0,
      runtimes: 1,
    })
    await host.dispose()
    expect(host.diagnostics().releases).toEqual({
      documents: 1,
      datasets: 1,
      tiles: 0,
      runtimes: 1,
    })
  })

  it('keeps local and HTTP Range tiles identical without fetching the complete source', async () => {
    const width = 1_024
    const height = 1_024
    const values = Float32Array.from({ length: width * height }, (_, index) => index % 997)
    const bytes = encodeGsf({ width, height, values, xyUnit: 'nm', xReal: 512, yReal: 512 })
    const remoteHost = new ImagingWorkerHost({ fetch: rangeFetch(bytes) })
    const openedRemote = await remoteHost.handle(
      rpcRequest('remote-open', 'source.open-remote', {
        generation: 1,
        url: 'https://fixtures.invalid/generated.gsf',
      }),
    )
    const remoteSource = payload(openedRemote.response, 'source.opened') as OpenedSourceDescriptor
    const remoteDatasetResponse = await remoteHost.handle(
      rpcRequest('remote-dataset', 'dataset.open', {
        documentId: remoteSource.documentId as DocumentId,
        datasetId: remoteSource.datasets[0]?.id ?? 'missing',
        generation: 1,
      }),
    )
    const remoteDataset = payload(
      remoteDatasetResponse.response,
      'dataset.opened',
    ) as OpenedDatasetDescriptor
    const remoteTile = await requestTile(remoteHost, remoteDataset)
    const remoteDiagnostics = remoteHost.diagnostics()
    expect(remoteDiagnostics.source?.rangeRequests).toBeGreaterThan(0)
    expect(remoteDiagnostics.source?.rangeBytesFetched).toBeLessThan(bytes.byteLength)

    const localHost = new ImagingWorkerHost()
    const file = new File([bytes.slice().buffer as ArrayBuffer], 'generated.gsf')
    const openedLocal = await localHost.handle(
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
    const localSource = payload(openedLocal.response, 'source.opened') as OpenedSourceDescriptor
    const localDatasetResponse = await localHost.handle(
      rpcRequest('local-dataset', 'dataset.open', {
        documentId: localSource.documentId,
        datasetId: localSource.datasets[0]?.id ?? 'missing',
        generation: 1,
      }),
    )
    const localDataset = payload(
      localDatasetResponse.response,
      'dataset.opened',
    ) as OpenedDatasetDescriptor
    const localTile = await requestTile(localHost, localDataset)
    expect(Array.from(remoteTile.values)).toEqual(Array.from(localTile.values))
    await remoteHost.dispose()
    await localHost.dispose()
  })

  it('returns CORS/range guidance when a remote server ignores ranges', async () => {
    const host = new ImagingWorkerHost({
      fetch: async () => new Response('whole file', { status: 200 }),
    })
    const result = await host.handle(
      rpcRequest('bad-range', 'source.open-remote', {
        generation: 1,
        url: 'https://fixtures.invalid/no-range.mrc',
      }),
    )
    expect(result.response).toMatchObject({
      ok: false,
      error: { code: 'CORS_OR_RANGE_UNAVAILABLE', guidance: expect.stringContaining('Range') },
    })
  })

  it('cancels an in-flight tile through its explicit request ID', async () => {
    const width = 1_024
    const height = 1_024
    const bytes = encodeGsf({
      width,
      height,
      values: Float32Array.from({ length: width * height }, (_, index) => index),
    })
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const fetcher: typeof fetch = async (_input, init) => {
      const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
      if (match === undefined || match === null) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Math.min(Number(match[2]), bytes.byteLength - 1)
      if (start > 2 * 1_024 * 1_024) {
        markStarted?.()
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
      }
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` },
      })
    }
    const host = new ImagingWorkerHost({ fetch: fetcher })
    const sourceResult = await host.handle(
      rpcRequest('open-cancellable', 'source.open-remote', {
        generation: 1,
        url: 'https://fixtures.invalid/cancellable.gsf',
      }),
    )
    const source = payload(sourceResult.response, 'source.opened') as OpenedSourceDescriptor
    const datasetResult = await host.handle(
      rpcRequest('open-cancellable-dataset', 'dataset.open', {
        documentId: source.documentId,
        datasetId: source.datasets[0]?.id ?? 'missing',
        generation: 1,
      }),
    )
    const dataset = payload(datasetResult.response, 'dataset.opened') as OpenedDatasetDescriptor
    const tilePromise = host.handle(
      rpcRequest('slow-tile', 'tile.request', {
        tileId: 'slow-tile',
        datasetHandleId: dataset.handleId,
        generation: 1,
        displayAxes: dataset.selection.displayAxes,
        fixedIndices: dataset.selection.fixedIndices,
        resolutionLevel: 0,
        component: 0,
        mapping: { mode: 'linear', range: 'auto' },
        region: { x: 0, y: 800, width: 128, height: 96 },
        priority: 'visible',
      }),
    )
    await started
    const cancelled = await host.handle(
      rpcRequest('cancel-slow-tile', 'request.cancel', { targetRequestId: 'slow-tile' }),
    )
    expect(cancelled.response).toMatchObject({
      ok: true,
      kind: 'request.cancelled',
      payload: { found: true },
    })
    await expect(tilePromise).resolves.toMatchObject({
      response: { ok: false, error: { code: 'ABORTED' } },
    })
    await host.dispose()
  })

  it('keeps opaque ID types distinct at compile time', () => {
    const ids: readonly [SourceId, DocumentId, DatasetHandleId] = [
      'source' as SourceId,
      'document' as DocumentId,
      'dataset' as DatasetHandleId,
    ]
    expect(ids).toHaveLength(3)
  })

  it('restarts with a new Worker and reinitializes the protocol', async () => {
    const workers: FakeWorker[] = []
    const client = new ImagingWorkerClient(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker as unknown as Worker
    })
    await client.initialize()
    await client.restart()
    expect(workers).toHaveLength(2)
    expect(workers[0]).toMatchObject({ terminated: true, initialized: 1 })
    expect(workers[1]).toMatchObject({ terminated: false, initialized: 1 })
    client.dispose()
  })
})
