import {
  type DatasetHandleId,
  type DocumentId,
  type OpenedDatasetDescriptor,
  type PlaneSelection,
  RPC_SCHEMA_VERSION,
  RpcValidationError,
  type SourceId,
  type StructuredRpcError,
  validateWorkerRequest,
  type WorkerDiagnostics,
  type WorkerRequest,
  type WorkerResponse,
} from '@pji-workbench/contracts'
import { createAnalysisController, createBuiltInAnalysisBundle } from 'purejsimage/analysis'
import {
  createTileDatasetIdentityForScientificDataset,
  createTileRuntime,
  numericTileSourceToTileSource,
  type TileRuntime,
  type TileSource,
} from 'purejsimage/analysis/runtime'
import {
  createScientificLibrary,
  type NumericTile,
  normalizeScientificRelativeName,
  numericTileSampleOffset,
  resolveNumericTileSource,
  type ScientificCompanionResolver,
  type ScientificDataset,
  type ScientificDatasetSummary,
  type ScientificDocument,
  supportsScientificPlaneRead,
} from 'purejsimage/scientific'
import { createScientificFileContext } from 'purejsimage/scientific/browser'
import { HttpRangeSource } from 'purejsimage/sources/http-range'

import { datasetDescriptor, defaultPlaneSelection, openedSourceDescriptor } from './descriptor.js'
import { loadReadersForSource, SUPPORTED_READERS } from './worker-readers.js'

interface SourceRecord {
  readonly id: SourceId
  readonly documentId: DocumentId
  readonly generation: number
  readonly kind: 'local' | 'remote' | 'sample'
  readonly name: string
  readonly size: number
  readonly url?: string
  readonly document: ScientificDocument
  readonly rangeSources: readonly HttpRangeSource[]
  readonly datasets: Map<DatasetHandleId, DatasetRecord>
  closed: boolean
}

interface DatasetRecord {
  readonly handleId: DatasetHandleId
  readonly summary: ScientificDatasetSummary
  readonly dataset: ScientificDataset
  readonly runtime: TileRuntime
  readonly tileSource: TileSource
  readonly tileIdentity: ReturnType<typeof createTileDatasetIdentityForScientificDataset>
  selection: PlaneSelection
  closed: boolean
}

interface PendingRequest {
  readonly controller: AbortController
  readonly datasetHandleId?: DatasetHandleId
}

export interface WorkerHostResult {
  readonly response: WorkerResponse
  readonly transfer: readonly Transferable[]
}

export interface ImagingWorkerHostOptions {
  readonly fetch?: typeof fetch
}

const MiB = 1_024 * 1_024

function success<Kind extends WorkerResponse extends infer _Response ? string : never>(
  requestId: string,
  kind: Kind,
  payload: unknown,
): WorkerHostResult {
  return {
    response: {
      schemaVersion: RPC_SCHEMA_VERSION,
      requestId,
      ok: true,
      kind,
      payload,
    } as WorkerResponse,
    transfer: [],
  }
}

function errorResult(requestId: string, error: StructuredRpcError): WorkerHostResult {
  return {
    response: {
      schemaVersion: RPC_SCHEMA_VERSION,
      requestId,
      ok: false,
      kind: 'error',
      error,
    },
    transfer: [],
  }
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError')
}

function structuredError(error: unknown, fallback: StructuredRpcError['code']): StructuredRpcError {
  if (error instanceof RpcValidationError) {
    return { code: error.code, message: error.message, retryable: false }
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      code: 'ABORTED',
      message: error.message || 'The request was cancelled.',
      retryable: true,
    }
  }
  const record =
    typeof error === 'object' && error !== null ? (error as { readonly code?: unknown }) : {}
  const code = typeof record.code === 'string' ? record.code : undefined
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown worker error'
  if (
    fallback === 'SOURCE_OPEN_FAILED' &&
    (error instanceof TypeError || /cors|range|fetch|network|content-range|206/iu.test(message))
  ) {
    return {
      code: 'CORS_OR_RANGE_UNAVAILABLE',
      message,
      guidance:
        'Confirm the server allows this origin, supports byte Range requests, and exposes Content-Range.',
      retryable: true,
    }
  }
  if (code === 'LIMIT_EXCEEDED') {
    return { code: 'LIMIT_EXCEEDED', message, retryable: false }
  }
  if (code === 'STALE_ID') return { code: 'STALE_ID', message, retryable: false }
  if (code === 'UNSUPPORTED_FORMAT' || code === 'UNSUPPORTED_FEATURE') {
    return { code: 'UNSUPPORTED', message, retryable: false }
  }
  return { code: fallback, message, retryable: fallback !== 'INVALID_PAYLOAD' }
}

function assertRemoteUrl(input: string): URL {
  const url = new URL(input)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new RpcValidationError(
      'INVALID_PAYLOAD',
      'Remote sources must use HTTPS; HTTP is allowed only for localhost development.',
    )
  }
  url.username = ''
  url.password = ''
  return url
}

function sourceName(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).at(-1)
  return decodeURIComponent(last ?? 'remote-image')
}

function sampleValues(width: number, height: number): Float32Array {
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const wave = 38 * Math.sin(x / 29) + 27 * Math.cos(y / 23)
      const particle = (x * 17 + y * 31) % 137 < 5 ? 105 : 0
      values[y * width + x] = 92 + wave + particle + ((x * 13 + y * 7) % 17)
    }
  }
  return values
}

function numericValue(tile: NumericTile, x: number, y: number, component: number): number {
  const offset = numericTileSampleOffset(tile, x, y, component)
  return Number(tile.data[offset])
}

function mapTile(
  tile: NumericTile,
  component: number,
  mapping: Extract<WorkerRequest, { kind: 'tile.request' }>['payload']['mapping'],
): Pick<
  Extract<WorkerResponse, { kind: 'tile.ready' }>['payload'],
  'rgba' | 'values' | 'range' | 'histogram'
> {
  if (component >= tile.componentCount) throw new RangeError('Selected component is unavailable')
  const length = tile.width * tile.height
  const values = new Float32Array(length)
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const value = numericValue(tile, x, y, component)
      values[y * tile.width + x] = value
      if (Number.isFinite(value)) {
        minimum = Math.min(minimum, value)
        maximum = Math.max(maximum, value)
      }
    }
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    minimum = 0
    maximum = 1
  }
  const automatic = mapping.range === 'auto'
  const low = mapping.minimum ?? minimum
  const highCandidate = mapping.maximum ?? maximum
  const high = highCandidate > low ? highCandidate : low + 1
  const histogram = Array.from({ length: 64 }, () => 0)
  const rgba = new Uint8ClampedArray(length * 4)
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? Number.NaN
    const normalized = Number.isFinite(value)
      ? Math.max(0, Math.min(1, (value - low) / (high - low)))
      : 0
    const display = Math.round(normalized * 255)
    const rgbaOffset = index * 4
    rgba[rgbaOffset] = display
    rgba[rgbaOffset + 1] = display
    rgba[rgbaOffset + 2] = display
    rgba[rgbaOffset + 3] = 255
    if (Number.isFinite(value)) {
      const bin = Math.min(
        63,
        Math.max(0, Math.floor(((value - minimum) / Math.max(1e-12, maximum - minimum)) * 63)),
      )
      histogram[bin] = (histogram[bin] ?? 0) + 1
    }
  }
  return {
    rgba,
    values,
    range: { minimum: low, maximum: high, automatic },
    histogram,
  }
}

export class ImagingWorkerHost {
  #active: SourceRecord | undefined
  #pending = new Map<string, PendingRequest>()
  #nextId = 1
  #releases = { documents: 0, datasets: 0, tiles: 0, runtimes: 0 }
  readonly #fetch: typeof fetch | undefined

  constructor(options: Readonly<ImagingWorkerHostOptions> = {}) {
    this.#fetch = options.fetch
  }

  async handle(input: unknown): Promise<WorkerHostResult> {
    let requestId = 'invalid-request'
    try {
      const request = validateWorkerRequest(input)
      requestId = request.requestId
      if (request.kind === 'request.cancel') return this.#cancel(request)
      if (request.kind === 'worker.test-crash') throw new Error('Intentional worker crash test')
      const controller = new AbortController()
      const datasetHandleId =
        request.kind === 'tile.request' ? request.payload.datasetHandleId : undefined
      this.#pending.set(request.requestId, {
        controller,
        ...(datasetHandleId === undefined ? {} : { datasetHandleId }),
      })
      try {
        return await this.#dispatch(request, controller.signal)
      } finally {
        this.#pending.delete(request.requestId)
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Intentional worker crash test') throw error
      return errorResult(requestId, structuredError(error, 'INTERNAL_ERROR'))
    }
  }

  async dispose(): Promise<void> {
    for (const { controller } of this.#pending.values())
      controller.abort(abortError('Worker disposed'))
    this.#pending.clear()
    await this.#releaseActive()
  }

  async #dispatch(request: WorkerRequest, signal: AbortSignal): Promise<WorkerHostResult> {
    switch (request.kind) {
      case 'worker.initialize':
        return success(request.requestId, 'worker.initialize', { readers: SUPPORTED_READERS })
      case 'source.open-sample':
        return this.#openSample(request, signal)
      case 'source.open-local':
        return this.#openLocal(request, signal)
      case 'source.open-remote':
        return this.#openRemote(request, signal)
      case 'source.close':
        return this.#closeSource(request)
      case 'dataset.open':
        return this.#openDataset(request, signal)
      case 'dataset.close':
        return this.#closeDatasetRequest(request)
      case 'plane.set':
        return this.#setPlane(request)
      case 'tile.request':
        return this.#requestTile(request, signal)
      case 'diagnostics.get':
        return success(request.requestId, 'diagnostics', this.diagnostics())
      case 'request.cancel':
        return this.#cancel(request)
      case 'worker.test-crash':
        throw new Error('Intentional worker crash test')
    }
    const exhaustive: never = request
    throw new Error(`Unhandled request: ${String(exhaustive)}`)
  }

  async #openSample(
    request: Extract<WorkerRequest, { kind: 'source.open-sample' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    try {
      const { encodeGsf } = await import('purejsimage/scientific/readers/gsf')
      const width = 2_048
      const height = 1_536
      const bytes = encodeGsf({
        width,
        height,
        values: sampleValues(width, height),
        xyUnit: 'nm',
        xReal: width * 0.42,
        yReal: height * 0.42,
        valueUnit: 'a.u.',
        metadata: { Title: 'Generated calibrated SEM-like surface' },
      })
      const file = new File([bytes.slice().buffer as ArrayBuffer], 'sample-sem.gsf', {
        type: 'application/octet-stream',
        lastModified: 0,
      })
      const record = await this.#openFileDocument(
        file,
        [file],
        request.payload.generation,
        'sample',
        signal,
      )
      await this.#activate(record)
      return success(request.requestId, 'source.opened', this.#describe(record))
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'SOURCE_OPEN_FAILED'))
    }
  }

  async #openLocal(
    request: Extract<WorkerRequest, { kind: 'source.open-local' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    try {
      const files = request.payload.files.map(
        (attachment) =>
          new File([attachment.blob as Blob], attachment.name, {
            type: attachment.type,
            lastModified: attachment.lastModified,
          }),
      )
      const primaryIndex = request.payload.files.findIndex(
        ({ id }) => id === request.payload.primaryId,
      )
      const primary = files[primaryIndex]
      if (primary === undefined)
        throw new RpcValidationError('INVALID_PAYLOAD', 'primary file is missing')
      const record = await this.#openFileDocument(
        primary,
        files,
        request.payload.generation,
        'local',
        signal,
      )
      await this.#activate(record)
      return success(request.requestId, 'source.opened', this.#describe(record))
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'SOURCE_OPEN_FAILED'))
    }
  }

  async #openFileDocument(
    primary: File,
    files: readonly File[],
    generation: number,
    kind: 'local' | 'sample',
    signal: AbortSignal,
  ): Promise<SourceRecord> {
    const readers = await loadReadersForSource(primary.name)
    const document = await createScientificLibrary({ readers }).open(
      createScientificFileContext(primary, { companions: files, signal }),
    )
    return {
      id: this.#id('source') as SourceId,
      documentId: this.#id('document') as DocumentId,
      generation,
      kind,
      name: primary.name,
      size: primary.size,
      document,
      rangeSources: [],
      datasets: new Map(),
      closed: false,
    }
  }

  async #openRemote(
    request: Extract<WorkerRequest, { kind: 'source.open-remote' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    try {
      const url = assertRemoteUrl(request.payload.url)
      const primary = await HttpRangeSource.open(url, {
        blockBytes: 64 * 1_024,
        maxCacheBytes: 512 * 1_024,
        signal,
        ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
      })
      const ranges = [primary]
      const companions = new Map<string, HttpRangeSource>()
      const resolver: ScientificCompanionResolver = {
        resolve: async (companionRequest, options) => {
          const relativeName =
            companionRequest.kind === 'relative-name'
              ? normalizeScientificRelativeName(companionRequest.name)
              : companionRequest.relativeName === undefined
                ? undefined
                : normalizeScientificRelativeName(companionRequest.relativeName)
          if (relativeName === undefined) return undefined
          const companionUrl = new URL(relativeName, url)
          if (companionUrl.origin !== url.origin) return undefined
          let source = companions.get(relativeName)
          if (source === undefined) {
            source = await HttpRangeSource.open(companionUrl, {
              blockBytes: 64 * 1_024,
              maxCacheBytes: 512 * 1_024,
              ...(options?.signal === undefined ? {} : { signal: options.signal }),
              ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
            })
            companions.set(relativeName, source)
            ranges.push(source)
          }
          return { id: `remote-companion:${relativeName}`, name: relativeName, source }
        },
      }
      const name = sourceName(url)
      const readers = await loadReadersForSource(name)
      const document = await createScientificLibrary({ readers }).open({
        primary: { id: 'remote-primary', name, source: primary },
        companions: resolver,
        signal,
      })
      const record: SourceRecord = {
        id: this.#id('source') as SourceId,
        documentId: this.#id('document') as DocumentId,
        generation: request.payload.generation,
        kind: 'remote',
        name,
        size: primary.size,
        url: url.href,
        document,
        rangeSources: ranges,
        datasets: new Map(),
        closed: false,
      }
      await this.#activate(record)
      return success(request.requestId, 'source.opened', this.#describe(record))
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'SOURCE_OPEN_FAILED'))
    }
  }

  async #activate(record: SourceRecord): Promise<void> {
    const previous = this.#active
    this.#active = record
    if (previous !== undefined) await this.#releaseSource(previous)
  }

  #describe(record: SourceRecord) {
    return openedSourceDescriptor({
      document: record.document,
      sourceId: record.id,
      documentId: record.documentId,
      generation: record.generation,
      kind: record.kind,
      name: record.name,
      size: record.size,
      ...(record.url === undefined ? {} : { url: record.url }),
    })
  }

  async #openDataset(
    request: Extract<WorkerRequest, { kind: 'dataset.open' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    try {
      const active = this.#assertActive(request.payload.generation)
      if (active.documentId !== request.payload.documentId) throw this.#stale('document')
      const summary = active.document.datasets.find(({ id }) => id === request.payload.datasetId)
      if (summary === undefined) throw this.#stale('dataset summary')
      const dataset = await active.document.openDataset(summary.id, { signal })
      const runtime = createTileRuntime({
        limits: {
          maxCacheBytes: 48 * MiB,
          maxTileBytes: 8 * MiB,
          maxInFlightBytes: 32 * MiB,
          maxTotalManagedBytes: 96 * MiB,
          maxConcurrency: 3,
          maxTilePixels: 512 * 512,
        },
        metrics: true,
      })
      const bundle = createBuiltInAnalysisBundle({ descriptor: dataset.descriptor, runtime })
      createAnalysisController({
        ...bundle,
        library: { version: '0.10.0', buildFingerprint: 'pji-workbench-worker-v1' },
      })
      const handleId = this.#id('dataset') as DatasetHandleId
      const record: DatasetRecord = {
        handleId,
        summary,
        dataset,
        runtime,
        tileSource: numericTileSourceToTileSource(
          resolveNumericTileSource(dataset, { targetSampleType: 'float32' }),
        ),
        tileIdentity: createTileDatasetIdentityForScientificDataset(dataset, {
          sessionId: handleId,
          generation: active.generation,
          unidentifiedDatasetId: summary.id,
        }),
        selection: defaultPlaneSelection(datasetDescriptor(summary)),
        closed: false,
      }
      active.datasets.set(handleId, record)
      const payload: OpenedDatasetDescriptor = {
        handleId,
        generation: active.generation,
        dataset: datasetDescriptor(summary),
        selection: record.selection,
      }
      return success(request.requestId, 'dataset.opened', payload)
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INTERNAL_ERROR'))
    }
  }

  async #closeSource(
    request: Extract<WorkerRequest, { kind: 'source.close' }>,
  ): Promise<WorkerHostResult> {
    try {
      const active = this.#assertActive(request.payload.generation)
      if (active.id !== request.payload.sourceId) throw this.#stale('source')
      await this.#releaseActive()
      return success(request.requestId, 'source.closed', { sourceId: request.payload.sourceId })
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'STALE_ID'))
    }
  }

  async #closeDatasetRequest(
    request: Extract<WorkerRequest, { kind: 'dataset.close' }>,
  ): Promise<WorkerHostResult> {
    try {
      const active = this.#assertActive(request.payload.generation)
      const record = active.datasets.get(request.payload.handleId)
      if (record === undefined) throw this.#stale('dataset handle')
      await this.#releaseDataset(active, record)
      return success(request.requestId, 'dataset.closed', { handleId: request.payload.handleId })
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'STALE_ID'))
    }
  }

  #setPlane(request: Extract<WorkerRequest, { kind: 'plane.set' }>): WorkerHostResult {
    try {
      const active = this.#assertActive(request.payload.generation)
      const record = active.datasets.get(request.payload.handleId)
      if (record === undefined) throw this.#stale('dataset handle')
      const selection = request.payload.selection
      if (!supportsScientificPlaneRead(record.dataset.descriptor, selection.displayAxes)) {
        throw new RpcValidationError(
          'INVALID_PAYLOAD',
          'The selected display-axis pair is unsupported',
        )
      }
      record.selection = selection
      record.runtime.invalidate({ generation: active.generation, cancelInFlight: true })
      return success(request.requestId, 'plane.selected', {
        handleId: record.handleId,
        selection,
      })
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INVALID_PAYLOAD'))
    }
  }

  async #requestTile(
    request: Extract<WorkerRequest, { kind: 'tile.request' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    const started = performance.now()
    let tile: NumericTile | undefined
    try {
      const active = this.#assertActive(request.payload.generation)
      const record = active.datasets.get(request.payload.datasetHandleId)
      if (record === undefined) throw this.#stale('dataset handle')
      tile = await record.runtime.request(record.tileSource, {
        address: {
          cacheClass: 'source',
          namespace: `viewport:${record.handleId}`,
          dataset: record.tileIdentity,
          displayAxes: request.payload.displayAxes,
          fixedIndices: request.payload.fixedIndices,
          resolutionLevel: request.payload.resolutionLevel,
          ...request.payload.region,
        },
        priority: request.payload.priority,
        signal,
        target: { sampleType: 'float32' },
      })
      signal.throwIfAborted()
      const mapped = mapTile(tile, request.payload.component, request.payload.mapping)
      const response: Extract<WorkerResponse, { kind: 'tile.ready' }> = {
        schemaVersion: RPC_SCHEMA_VERSION,
        requestId: request.requestId,
        ok: true,
        kind: 'tile.ready',
        payload: {
          tileId: request.payload.tileId,
          datasetHandleId: request.payload.datasetHandleId,
          generation: request.payload.generation,
          region: request.payload.region,
          component: request.payload.component,
          width: tile.width,
          height: tile.height,
          ...mapped,
          elapsedMilliseconds: performance.now() - started,
        },
      }
      return { response, transfer: [mapped.rgba.buffer, mapped.values.buffer] }
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INTERNAL_ERROR'))
    } finally {
      if (tile !== undefined) {
        tile.release()
        this.#releases.tiles += 1
      }
    }
  }

  #cancel(request: Extract<WorkerRequest, { kind: 'request.cancel' }>): WorkerHostResult {
    const pending = this.#pending.get(request.payload.targetRequestId)
    pending?.controller.abort(abortError('Request cancelled by the main thread'))
    return success(request.requestId, 'request.cancelled', {
      targetRequestId: request.payload.targetRequestId,
      found: pending !== undefined,
    })
  }

  diagnostics(): WorkerDiagnostics {
    const active = this.#active
    const rangeStats = active?.rangeSources.reduce(
      (totals, source) => ({
        requests: totals.requests + source.stats.requests,
        bytesFetched: totals.bytesFetched + source.stats.bytesFetched,
        cacheBytes: totals.cacheBytes + source.stats.cacheBytes,
      }),
      { requests: 0, bytesFetched: 0, cacheBytes: 0 },
    )
    const runtime = active?.datasets.values().next().value as DatasetRecord | undefined
    return {
      generation: active?.generation ?? 0,
      source:
        active === undefined
          ? null
          : {
              id: active.id,
              kind: active.kind,
              size: active.size,
              rangeRequests: rangeStats?.requests ?? 0,
              rangeBytesFetched: rangeStats?.bytesFetched ?? 0,
              rangeCacheBytes: rangeStats?.cacheBytes ?? 0,
            },
      openDatasets: active?.datasets.size ?? 0,
      pendingRequests: this.#pending.size,
      tileRuntime: runtime === undefined ? null : runtime.runtime.metrics(),
      releases: { ...this.#releases },
    }
  }

  #assertActive(generation: number): SourceRecord {
    const active = this.#active
    if (active === undefined || active.closed || active.generation !== generation) {
      throw this.#stale('source generation')
    }
    return active
  }

  #stale(label: string): StructuredRpcError & Error {
    return Object.assign(new Error(`Unknown or stale ${label}`), {
      code: 'STALE_ID' as const,
      retryable: false,
    })
  }

  async #releaseDataset(active: SourceRecord, record: DatasetRecord): Promise<void> {
    if (record.closed) return
    record.closed = true
    for (const pending of this.#pending.values()) {
      if (pending.datasetHandleId === record.handleId) {
        pending.controller.abort(abortError('Dataset closed'))
      }
    }
    await record.runtime.dispose()
    this.#releases.runtimes += 1
    this.#releases.datasets += 1
    active.datasets.delete(record.handleId)
  }

  async #releaseSource(record: SourceRecord): Promise<void> {
    if (record.closed) return
    record.closed = true
    for (const dataset of [...record.datasets.values()]) await this.#releaseDataset(record, dataset)
    await record.document.close?.()
    this.#releases.documents += 1
  }

  async #releaseActive(): Promise<void> {
    const active = this.#active
    this.#active = undefined
    if (active !== undefined) await this.#releaseSource(active)
  }

  #id(prefix: string): string {
    const id = `${prefix}-${this.#nextId}`
    this.#nextId += 1
    return id
  }
}
