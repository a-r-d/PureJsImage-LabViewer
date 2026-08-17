import {
  type AnalysisResultHandleId,
  type DatasetHandleId,
  type DocumentId,
  type OpenedDatasetDescriptor,
  RPC_LIMITS,
  RPC_SCHEMA_VERSION,
  RpcValidationError,
  type SourceId,
  type StructuredRpcError,
  validateWorkerRequest,
  type WorkerDiagnostics,
  type WorkerRequest,
  type WorkerResponse,
} from '@pji-workbench/contracts'
import {
  createMaterialsAnalysisExtension,
  TOOLBOX_DOCUMENTATION,
  TOOLBOX_PRESETS,
} from '@pji-workbench/materials-analysis'
import {
  type AnalysisExecutionResult,
  createAnalysisController,
  createBuiltInAnalysisBundle,
  type PreparedAnalysisPlan,
} from 'purejsimage/analysis'
import {
  summarizeResult,
  type TableResult,
  validateAnalysisResult,
  validateTableResult,
} from 'purejsimage/analysis/results'
import { normalizeRoi } from 'purejsimage/analysis/roi'
import {
  createTileDatasetIdentityForScientificDataset,
  createTileRuntime,
  numericTileSourceToTileSource,
} from 'purejsimage/analysis/runtime'
import { createExtensionHost } from 'purejsimage/extensions'
import {
  createScientificLibrary,
  type NumericTile,
  normalizeScientificRelativeName,
  resolveNumericTileSource,
  type ScientificCompanionResolver,
  supportsScientificPlaneRead,
} from 'purejsimage/scientific'
import { createScientificFileContext } from 'purejsimage/scientific/browser'
import { HttpRangeSource } from 'purejsimage/sources/http-range'
import { cacheCodecAdapterPlane, usesCodecAdapterReader } from './codec-plane-cache.js'
import { datasetDescriptor, defaultPlaneSelection, openedSourceDescriptor } from './descriptor.js'
import { PUREJSIMAGE_PACKAGE_VERSION } from './package-version.js'
import { createAnalysisBindings, isScientificDataset } from './worker-host/analysis-rpc.js'
import {
  abortError,
  errorResult,
  structuredError,
  success,
  type WorkerHostResult,
} from './worker-host/protocol.js'
import { tablePage } from './worker-host/result-rpc.js'
import type {
  AnalysisExecutionRecord,
  DatasetRecord,
  PendingRequest,
  SourceRecord,
} from './worker-host/runtime.js'
import {
  assertRemoteUrl,
  encodeNrrdStack,
  generatedSampleDefinition,
  sampleStackValues,
  sampleValues,
  sourceName,
} from './worker-host/source-rpc.js'
import { mapTile, numericValue } from './worker-host/view-rpc.js'
import { loadReadersForSource, SUPPORTED_READERS } from './worker-readers.js'

export type { WorkerHostResult } from './worker-host/protocol.js'

function wrapNumericSource(
  source: ReturnType<typeof resolveNumericTileSource>,
  readerId: string,
): ReturnType<typeof resolveNumericTileSource> {
  return usesCodecAdapterReader(readerId) ? cacheCodecAdapterPlane(source) : source
}

const MAX_SERIES_EXPORT_CELLS = 1_000_000

function boundedSeriesRows(requested: number, available: number, columns: number): number {
  if (columns < 1 || columns > RPC_LIMITS.maxTablePageColumns)
    throw new RpcValidationError('LIMIT_EXCEEDED', 'Series export exceeds the column limit')
  return Math.min(requested, available, Math.floor(MAX_SERIES_EXPORT_CELLS / columns))
}

type TableNumericValues = Extract<TableResult['columns'][number], { kind: 'numeric' }>['values']

function tableNumbers(table: TableResult, name: string): TableNumericValues | undefined {
  const column = table.columns.find((candidate) => candidate.name === name)
  return column?.kind === 'numeric' ? column.values : undefined
}

function finiteTableNumber(
  values: TableNumericValues | undefined,
  row: number,
): number | undefined {
  const value = values?.[row]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function overlayAnnotations(
  table: TableResult,
  region: Readonly<{ x: number; y: number; width: number; height: number }>,
) {
  const annotations: Array<{
    label: number
    x: number
    y: number
    majorAxis?: number
    minorAxis?: number
    orientationRadians?: number
  }> = []
  const labels = tableNumbers(table, 'label')
  const centroidXs = tableNumbers(table, 'centroidX')
  const centroidYs = tableNumbers(table, 'centroidY')
  const majorAxes = tableNumbers(table, 'pixelMajorAxis') ?? tableNumbers(table, 'boundingWidth')
  const minorAxes = tableNumbers(table, 'pixelMinorAxis') ?? tableNumbers(table, 'boundingHeight')
  const orientations =
    tableNumbers(table, 'pixelOrientationRadians') ?? tableNumbers(table, 'orientationRadians')
  for (let row = 0; row < table.rowCount; row += 1) {
    const label = finiteTableNumber(labels, row)
    const x = finiteTableNumber(centroidXs, row)
    const y = finiteTableNumber(centroidYs, row)
    if (
      label === undefined ||
      x === undefined ||
      y === undefined ||
      x < region.x ||
      y < region.y ||
      x >= region.x + region.width ||
      y >= region.y + region.height
    )
      continue
    if (annotations.length >= 2_048)
      throw new RpcValidationError('LIMIT_EXCEEDED', 'Overlay annotation tile exceeds its limit')
    const majorAxis = finiteTableNumber(majorAxes, row)
    const minorAxis = finiteTableNumber(minorAxes, row)
    const orientationRadians = finiteTableNumber(orientations, row)
    annotations.push({
      label,
      x,
      y,
      ...(majorAxis === undefined ? {} : { majorAxis }),
      ...(minorAxis === undefined ? {} : { minorAxis }),
      ...(orientationRadians === undefined ? {} : { orientationRadians }),
    })
  }
  return annotations
}

export interface ImagingWorkerHostOptions {
  readonly fetch?: typeof fetch
  readonly baseUrl?: string
}

const MiB = 1_024 * 1_024

async function readExactResponse(
  response: Response,
  expectedBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) !== expectedBytes)
    throw new RpcValidationError('INVALID_PAYLOAD', 'Bundled source size does not match its record')
  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== expectedBytes)
      throw new RpcValidationError(
        'INVALID_PAYLOAD',
        'Bundled source size does not match its record',
      )
    return bytes
  }

  const bytes = new Uint8Array(expectedBytes)
  const reader = response.body.getReader()
  let offset = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      if (value.byteLength > expectedBytes - offset) {
        await reader.cancel().catch(() => undefined)
        throw new RpcValidationError('LIMIT_EXCEEDED', 'Bundled source exceeds its byte budget')
      }
      bytes.set(value, offset)
      offset += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  if (offset !== expectedBytes)
    throw new RpcValidationError('INVALID_PAYLOAD', 'Bundled source size does not match its record')
  return bytes
}

export class ImagingWorkerHost {
  #active: SourceRecord | undefined
  #pending = new Map<string, PendingRequest>()
  #nextId = 1
  #releases = { documents: 0, datasets: 0, tiles: 0, runtimes: 0 }
  readonly #fetch: typeof fetch | undefined
  readonly #baseUrl: string | undefined

  constructor(options: Readonly<ImagingWorkerHostOptions> = {}) {
    this.#fetch = options.fetch
    this.#baseUrl =
      options.baseUrl ??
      (typeof globalThis.location === 'undefined'
        ? undefined
        : new URL('/', globalThis.location.href).href)
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
        request.payload !== null && 'datasetHandleId' in request.payload
          ? request.payload.datasetHandleId
          : undefined
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
      case 'source.open-bundled':
        return this.#openBundled(request, signal)
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
      case 'analysis.catalog':
        return this.#analysisCatalog(request)
      case 'analysis.normalize-parameters':
        return this.#normalizeAnalysisParameters(request)
      case 'analysis.normalize-roi':
        return this.#normalizeAnalysisRoi(request)
      case 'analysis.dry-run':
        return this.#dryRunAnalysis(request, signal)
      case 'analysis.execute':
        return this.#executeAnalysis(request, signal)
      case 'analysis.overlay-tile':
        return this.#analysisOverlayTile(request, signal)
      case 'analysis.dataset-tile':
        return this.#analysisDatasetTile(request, signal)
      case 'analysis.table-page':
        return this.#analysisTablePage(request)
      case 'analysis.series-export':
        return this.#analysisSeriesExport(request)
      case 'analysis.release':
        return this.#releaseAnalysisRequest(request)
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
      const sample = generatedSampleDefinition(request.payload.sampleId)
      const { width, height } = sample
      const frames = sample.frames
      const bytes =
        frames === undefined
          ? encodeGsf({
              width,
              height,
              values: sampleValues(width, height, sample.id),
              xyUnit: sample.xyUnit,
              xReal: sample.xReal,
              yReal: sample.yReal,
              valueUnit: sample.valueUnit,
              metadata: { Title: sample.title, CorpusScenario: sample.id },
            })
          : encodeNrrdStack(width, height, frames, sampleStackValues(width, height, frames), {
              xStep: sample.xReal / width,
              yStep: sample.yReal / height,
              zStep: (sample.zReal ?? frames) / frames,
              unit: sample.xyUnit,
            })
      const file = new File([bytes.slice().buffer as ArrayBuffer], sample.filename, {
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

  async #openBundled(
    request: Extract<WorkerRequest, { kind: 'source.open-bundled' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    try {
      if (this.#baseUrl === undefined)
        throw new RpcValidationError('INVALID_PAYLOAD', 'Bundled source base URL is unavailable')
      const url = new URL(request.payload.path, this.#baseUrl)
      if (url.origin !== new URL(this.#baseUrl).origin)
        throw new RpcValidationError(
          'INVALID_PAYLOAD',
          'Bundled source must resolve to the application origin',
        )
      const response = await (this.#fetch ?? globalThis.fetch)(url, {
        credentials: 'same-origin',
        signal,
      })
      if (!response.ok)
        throw new RpcValidationError(
          'INVALID_PAYLOAD',
          `Bundled source returned HTTP ${response.status}`,
        )
      const bytes = await readExactResponse(response, request.payload.size, signal)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const sha256 = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
      if (sha256 !== request.payload.sha256)
        throw new RpcValidationError(
          'INVALID_PAYLOAD',
          'Bundled source failed its SHA-256 integrity check',
        )
      const file = new File([bytes.slice().buffer as ArrayBuffer], request.payload.name, {
        type: request.payload.mediaType,
        lastModified: 0,
      })
      const record = await this.#openFileDocument(
        file,
        [file],
        request.payload.generation,
        'bundled',
        signal,
      )
      await this.#activate(record)
      const source = this.#describe(record)
      const summary = source.datasets[0]
      if (summary === undefined)
        throw new RpcValidationError('INVALID_PAYLOAD', 'Bundled document has no datasets')
      const datasetResult = await this.#openDataset(
        {
          schemaVersion: RPC_SCHEMA_VERSION,
          requestId: request.requestId,
          kind: 'dataset.open',
          payload: {
            documentId: source.documentId,
            datasetId: summary.id,
            generation: request.payload.generation,
          },
        },
        signal,
      )
      if (!datasetResult.response.ok) return datasetResult
      if (datasetResult.response.kind !== 'dataset.opened')
        throw new Error('Bundled dataset open returned an unexpected response')
      return success(request.requestId, 'source-bundled.opened', {
        source,
        dataset: datasetResult.response.payload,
      })
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'SOURCE_OPEN_FAILED'))
    }
  }

  async #openFileDocument(
    primary: File,
    files: readonly File[],
    generation: number,
    kind: 'bundled' | 'local' | 'sample',
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
      const extensions = createExtensionHost({
        extensions: [createMaterialsAnalysisExtension()],
        operations: bundle.operations.definitions(),
        valueTypes: bundle.valueTypes.definitions(),
        providers: bundle.providers,
      })
      const analysis = createAnalysisController({
        operations: extensions.operations,
        valueTypes: extensions.valueTypes,
        providers: extensions.providers,
        roi: { descriptor: dataset.descriptor },
        library: {
          version: PUREJSIMAGE_PACKAGE_VERSION,
          buildFingerprint: 'pji-workbench-worker-v1',
        },
      })
      const handleId = this.#id('dataset') as DatasetHandleId
      const record: DatasetRecord = {
        handleId,
        summary,
        dataset,
        readerId: active.document.reader.id,
        runtime,
        tileSource: numericTileSourceToTileSource(
          wrapNumericSource(
            resolveNumericTileSource(dataset, { targetSampleType: 'float32' }),
            active.document.reader.id,
          ),
        ),
        tileIdentity: createTileDatasetIdentityForScientificDataset(dataset, {
          sessionId: handleId,
          generation: active.generation,
          unidentifiedDatasetId: summary.id,
        }),
        analysis,
        results: new Map(),
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

  #analysisRecord(payload: {
    readonly datasetHandleId: DatasetHandleId
    readonly generation: number
  }) {
    const active = this.#assertActive(payload.generation)
    const record = active.datasets.get(payload.datasetHandleId)
    if (record === undefined) throw this.#stale('dataset handle')
    return record
  }

  #analysisCatalog(
    request: Extract<WorkerRequest, { kind: 'analysis.catalog' }>,
  ): WorkerHostResult {
    try {
      const record = this.#analysisRecord(request.payload)
      return success(request.requestId, 'analysis.catalog', {
        capabilities: record.analysis.capabilities,
        documentation: TOOLBOX_DOCUMENTATION,
        presets: TOOLBOX_PRESETS,
      })
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INVALID_PAYLOAD'))
    }
  }

  #normalizeAnalysisParameters(
    request: Extract<WorkerRequest, { kind: 'analysis.normalize-parameters' }>,
  ): WorkerHostResult {
    try {
      const record = this.#analysisRecord(request.payload)
      const normalized = record.analysis.normalizeOperationParameters(
        request.payload.operation.id,
        request.payload.operation.version,
        request.payload.parameters,
      )
      return success(request.requestId, 'analysis.parameters-normalized', {
        valid: normalized.valid,
        issues: normalized.issues,
        ...(normalized.value === undefined ? {} : { parameters: normalized.value }),
      })
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INVALID_PAYLOAD'))
    }
  }

  #normalizeAnalysisRoi(
    request: Extract<WorkerRequest, { kind: 'analysis.normalize-roi' }>,
  ): WorkerHostResult {
    try {
      const record = this.#analysisRecord(request.payload)
      const roi = normalizeRoi(request.payload.roi, record.dataset.descriptor)
      return success(request.requestId, 'analysis.roi-normalized', {
        valid: true,
        issues: [],
        roi,
      })
    } catch (error) {
      return success(request.requestId, 'analysis.roi-normalized', {
        valid: false,
        issues: [
          {
            code: 'invalid-roi',
            path: '',
            message: error instanceof Error ? error.message : 'The ROI is invalid.',
          },
        ],
      })
    }
  }

  async #dryRunAnalysis(
    request: Extract<WorkerRequest, { kind: 'analysis.dry-run' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    try {
      const record = this.#analysisRecord(request.payload)
      const dryRun = await record.analysis.dryRun(request.payload.graph, {
        bindings: await createAnalysisBindings(
          record,
          request.payload.roi,
          request.payload.calibration,
        ),
        policy: {
          mode: 'reference-only',
        },
        signal,
      })
      signal.throwIfAborted()
      return success(request.requestId, 'analysis.dry-run', dryRun)
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INVALID_PAYLOAD'))
    }
  }

  async #executeAnalysis(
    request: Extract<WorkerRequest, { kind: 'analysis.execute' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    const started = performance.now()
    let plan: PreparedAnalysisPlan | undefined
    let execution: AnalysisExecutionResult | undefined
    try {
      const record = this.#analysisRecord(request.payload)
      const options = {
        bindings: await createAnalysisBindings(
          record,
          request.payload.roi,
          request.payload.calibration,
        ),
        policy: {
          mode: 'reference-only' as const,
        },
        signal,
      }
      const dryRun = await record.analysis.dryRun(request.payload.graph, options)
      signal.throwIfAborted()
      if (!dryRun.valid) {
        throw new RpcValidationError('INVALID_PAYLOAD', JSON.stringify(dryRun.issues))
      }
      plan = await record.analysis.planGraph(request.payload.graph, options)
      signal.throwIfAborted()
      execution = await record.analysis.executeGraph(plan, { signal }).result
      signal.throwIfAborted()
      const id = this.#id('analysis-result') as AnalysisResultHandleId
      const outputs = []
      for (const [name, output] of execution.outputs.entries()) {
        try {
          outputs.push({
            kind: 'result' as const,
            name,
            summary: summarizeResult(validateAnalysisResult(output), { maxPreviewValues: 16 }),
          })
        } catch {
          if (isScientificDataset(output)) {
            outputs.push({
              kind: 'dataset' as const,
              name,
              descriptor: output.descriptor,
            })
          }
        }
      }
      const retained: AnalysisExecutionRecord = { id, plan, execution, closed: false }
      record.results.set(id, retained)
      plan = undefined
      execution = undefined
      return success(request.requestId, 'analysis.executed', {
        resultHandleId: id,
        outputs,
        provenance: retained.execution.provenance,
        elapsedMilliseconds: performance.now() - started,
      })
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INTERNAL_ERROR'))
    } finally {
      if (execution !== undefined) await execution.release()
      if (plan !== undefined) await plan.dispose()
    }
  }

  #analysisExecution(record: DatasetRecord, resultHandleId: AnalysisResultHandleId) {
    const result = record.results.get(resultHandleId)
    if (result === undefined || result.closed) throw this.#stale('analysis result')
    return result
  }

  #analysisSeriesExport(
    request: Extract<WorkerRequest, { kind: 'analysis.series-export' }>,
  ): WorkerHostResult {
    try {
      const record = this.#analysisRecord(request.payload)
      const execution = this.#analysisExecution(record, request.payload.resultHandleId)
      const result = validateAnalysisResult(execution.execution.outputs.get(request.payload.output))
      const limit = request.payload.maxRows
      const numeric = (value: number | bigint): number | null => {
        if (typeof value === 'number') return Number.isFinite(value) ? value : null
        const converted = Number(value)
        return Number.isSafeInteger(converted) ? converted : null
      }
      if (result.kind === 'histogram') {
        const rowCount = boundedSeriesRows(limit, result.counts.length, 3)
        return success(request.requestId, 'analysis.series-export', {
          rowCount,
          truncated: rowCount < result.counts.length,
          columns: [
            {
              name: 'binMinimum',
              ...(result.unit === undefined ? {} : { unit: result.unit }),
              values: Array.from(result.binEdges.slice(0, rowCount), numeric),
            },
            {
              name: 'binMaximum',
              ...(result.unit === undefined ? {} : { unit: result.unit }),
              values: Array.from(result.binEdges.slice(1, rowCount + 1), numeric),
            },
            { name: 'count', values: Array.from(result.counts.slice(0, rowCount), numeric) },
          ],
        })
      }
      if (result.kind === 'profile') {
        const rowCount = boundedSeriesRows(
          limit,
          result.axis.values.length,
          result.series.length + 1,
        )
        return success(request.requestId, 'analysis.series-export', {
          rowCount,
          truncated: rowCount < result.axis.values.length,
          columns: [
            {
              name: result.axis.name,
              ...(result.axis.unit === undefined ? {} : { unit: result.axis.unit }),
              values: Array.from(result.axis.values.slice(0, rowCount), numeric),
            },
            ...result.series.map((series) => ({
              name: series.name,
              ...(series.unit === undefined ? {} : { unit: series.unit }),
              values: Array.from(series.values.slice(0, rowCount), numeric),
            })),
          ],
        })
      }
      if (result.kind === 'scalar') {
        return success(request.requestId, 'analysis.series-export', {
          rowCount: 1,
          truncated: false,
          columns: [
            {
              name: 'value',
              ...(result.unit === undefined ? {} : { unit: result.unit }),
              values: [numeric(result.value)],
            },
          ],
        })
      }
      throw new RpcValidationError(
        'INVALID_PAYLOAD',
        'Only scalar, histogram, and profile outputs use series export.',
      )
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INVALID_PAYLOAD'))
    }
  }

  async #analysisOverlayTile(
    request: Extract<WorkerRequest, { kind: 'analysis.overlay-tile' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    try {
      const record = this.#analysisRecord(request.payload)
      const result = this.#analysisExecution(record, request.payload.resultHandleId)
      const output = result.execution.outputs.get(request.payload.output)
      if (!isScientificDataset(output)) {
        throw new RpcValidationError('INVALID_PAYLOAD', 'The selected output is not a dataset')
      }
      const { region, selection } = request.payload
      const view = request.payload.view ?? 'labels'
      const horizontalLength =
        output.descriptor.levels
          .find(({ level }) => level === selection.resolutionLevel)
          ?.axisLengths.find(({ axisId }) => axisId === selection.displayAxes[0])?.length ??
        output.descriptor.axes.find(({ id }) => id === selection.displayAxes[0])?.length
      const verticalLength =
        output.descriptor.levels
          .find(({ level }) => level === selection.resolutionLevel)
          ?.axisLengths.find(({ axisId }) => axisId === selection.displayAxes[1])?.length ??
        output.descriptor.axes.find(({ id }) => id === selection.displayAxes[1])?.length
      if (horizontalLength === undefined || verticalLength === undefined)
        throw new RpcValidationError('INVALID_PAYLOAD', 'Overlay axes are unavailable')
      const readRegion =
        view === 'outline'
          ? {
              x: Math.max(0, region.x - 1),
              y: Math.max(0, region.y - 1),
              width:
                Math.min(horizontalLength, region.x + region.width + 1) - Math.max(0, region.x - 1),
              height:
                Math.min(verticalLength, region.y + region.height + 1) - Math.max(0, region.y - 1),
            }
          : region
      const readLabels = new Uint32Array(readRegion.width * readRegion.height)
      const source = resolveNumericTileSource(output, { targetSampleType: 'float32' })
      for await (const tile of source.readNumericTiles({
        displayAxes: selection.displayAxes,
        fixedIndices: selection.fixedIndices,
        resolutionLevel: selection.resolutionLevel,
        ...readRegion,
        signal,
      })) {
        try {
          const xStart = Math.max(readRegion.x, tile.x)
          const yStart = Math.max(readRegion.y, tile.y)
          const xEnd = Math.min(readRegion.x + readRegion.width, tile.x + tile.width)
          const yEnd = Math.min(readRegion.y + readRegion.height, tile.y + tile.height)
          for (let y = yStart; y < yEnd; y += 1) {
            for (let x = xStart; x < xEnd; x += 1) {
              const value = numericValue(tile, x - tile.x, y - tile.y, request.payload.component)
              readLabels[(y - readRegion.y) * readRegion.width + x - readRegion.x] =
                Number.isFinite(value) && value > 0 ? Math.round(value) : 0
            }
          }
        } finally {
          tile.release()
          this.#releases.tiles += 1
        }
      }
      const labels = new Uint32Array(region.width * region.height)
      for (let y = 0; y < region.height; y += 1) {
        for (let x = 0; x < region.width; x += 1) {
          labels[y * region.width + x] =
            readLabels[
              (region.y + y - readRegion.y) * readRegion.width + region.x + x - readRegion.x
            ] ?? 0
        }
      }
      const rgba = new Uint8ClampedArray(labels.length * 4)
      for (let index = 0; index < labels.length; index += 1) {
        const label = labels[index] ?? 0
        if (label === 0) continue
        const x = index % region.width
        const y = Math.floor(index / region.width)
        if (view === 'outline') {
          const sourceX = region.x + x - readRegion.x
          const sourceY = region.y + y - readRegion.y
          const at = (candidateX: number, candidateY: number) =>
            candidateX < 0 ||
            candidateY < 0 ||
            candidateX >= readRegion.width ||
            candidateY >= readRegion.height
              ? 0
              : (readLabels[candidateY * readRegion.width + candidateX] ?? 0)
          if (
            at(sourceX - 1, sourceY) === label &&
            at(sourceX + 1, sourceY) === label &&
            at(sourceX, sourceY - 1) === label &&
            at(sourceX, sourceY + 1) === label
          )
            continue
        }
        if (view === 'centroids' || view === 'ellipses') continue
        const offset = index * 4
        if (view === 'mask') {
          rgba[offset] = 76
          rgba[offset + 1] = 201
          rgba[offset + 2] = 240
          rgba[offset + 3] = 132
        } else {
          rgba[offset] = (label * 47 + 223) % 256
          rgba[offset + 1] = (label * 89 + 104) % 256
          rgba[offset + 2] = (label * 131 + 31) % 256
          rgba[offset + 3] = view === 'outline' ? 230 : 138
        }
      }
      let annotations: ReturnType<typeof overlayAnnotations> = []
      if (
        request.payload.tableOutput !== undefined &&
        (view === 'numbered' || view === 'centroids' || view === 'ellipses')
      ) {
        const table = validateTableResult(result.execution.outputs.get(request.payload.tableOutput))
        annotations = overlayAnnotations(table, region)
      }
      return {
        response: {
          schemaVersion: RPC_SCHEMA_VERSION,
          requestId: request.requestId,
          ok: true,
          kind: 'analysis.overlay-tile',
          payload: {
            tileId: request.payload.tileId,
            resultHandleId: result.id,
            output: request.payload.output,
            view,
            region,
            width: region.width,
            height: region.height,
            rgba,
            labels,
            annotations,
          },
        },
        transfer: [rgba.buffer, labels.buffer],
      }
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INTERNAL_ERROR'))
    }
  }

  async #analysisDatasetTile(
    request: Extract<WorkerRequest, { kind: 'analysis.dataset-tile' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    const started = performance.now()
    try {
      const record = this.#analysisRecord(request.payload)
      const result = this.#analysisExecution(record, request.payload.resultHandleId)
      const output = result.execution.outputs.get(request.payload.output)
      if (!isScientificDataset(output))
        throw new RpcValidationError('INVALID_PAYLOAD', 'The selected output is not a dataset')
      const source = resolveNumericTileSource(output, { targetSampleType: 'float32' })
      const { region } = request.payload
      const componentCount = output.descriptor.components.length
      const data = new Float32Array(region.width * region.height * componentCount)
      data.fill(Number.NaN)
      let emitted = 0
      for await (const candidate of source.readNumericTiles({
        displayAxes: request.payload.displayAxes,
        fixedIndices: request.payload.fixedIndices,
        resolutionLevel: request.payload.resolutionLevel,
        ...request.payload.region,
        signal,
      })) {
        try {
          emitted += 1
          const xStart = Math.max(region.x, candidate.x)
          const yStart = Math.max(region.y, candidate.y)
          const xEnd = Math.min(region.x + region.width, candidate.x + candidate.width)
          const yEnd = Math.min(region.y + region.height, candidate.y + candidate.height)
          for (let y = yStart; y < yEnd; y += 1)
            for (let x = xStart; x < xEnd; x += 1)
              for (let component = 0; component < componentCount; component += 1)
                data[((y - region.y) * region.width + x - region.x) * componentCount + component] =
                  numericValue(candidate, x - candidate.x, y - candidate.y, component)
        } finally {
          candidate.release()
          this.#releases.tiles += 1
        }
      }
      if (emitted === 0) throw new Error('The derived dataset returned no tile.')
      signal.throwIfAborted()
      const tile: NumericTile = {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        sampleType: 'float32',
        componentCount,
        layout: 'interleaved',
        rowStrideElements: region.width * componentCount,
        data,
        release: () => undefined,
      }
      const mapped = mapTile(tile, request.payload.component, request.payload.mapping)
      const response: Extract<WorkerResponse, { kind: 'analysis.dataset-tile' }> = {
        schemaVersion: RPC_SCHEMA_VERSION,
        requestId: request.requestId,
        ok: true,
        kind: 'analysis.dataset-tile',
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
    }
  }

  #analysisTablePage(
    request: Extract<WorkerRequest, { kind: 'analysis.table-page' }>,
  ): WorkerHostResult {
    try {
      const record = this.#analysisRecord(request.payload)
      const result = this.#analysisExecution(record, request.payload.resultHandleId)
      const table = validateTableResult(result.execution.outputs.get(request.payload.output))
      return success(request.requestId, 'analysis.table-page', tablePage(table, request.payload))
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INVALID_PAYLOAD'))
    }
  }

  async #releaseAnalysisRequest(
    request: Extract<WorkerRequest, { kind: 'analysis.release' }>,
  ): Promise<WorkerHostResult> {
    try {
      const record = this.#analysisRecord(request.payload)
      const result = this.#analysisExecution(record, request.payload.resultHandleId)
      await this.#releaseAnalysis(record, result)
      return success(request.requestId, 'analysis.released', {
        resultHandleId: request.payload.resultHandleId,
      })
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'STALE_ID'))
    }
  }

  async #releaseAnalysis(record: DatasetRecord, result: AnalysisExecutionRecord): Promise<void> {
    if (result.closed) return
    result.closed = true
    try {
      await result.execution.release()
    } finally {
      await result.plan.dispose()
      record.results.delete(result.id)
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
    for (const result of [...record.results.values()]) await this.#releaseAnalysis(record, result)
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
