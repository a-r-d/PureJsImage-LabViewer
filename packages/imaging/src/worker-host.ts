import {
  type AnalysisResultHandleId,
  COG_INSPECTION_METADATA_KEY,
  type DatasetHandleId,
  type DisplayStatistics,
  type DocumentId,
  type ImagingResourceLimits,
  type OpenedDatasetDescriptor,
  RPC_LIMITS,
  RPC_SCHEMA_VERSION,
  type RpcJsonObject,
  RpcValidationError,
  type SourceId,
  type SourceRangeDiagnostics,
  type StructuredRpcError,
  validateWorkerRequest,
  type WorkerDiagnostics,
  type WorkerRequest,
  type WorkerResponse,
} from '@pji-workbench/contracts'
import type { ImageSource } from 'purejsimage'
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
import { createExtensionHost, type PureJsImageExtension } from 'purejsimage/extensions'
import {
  createScientificLibrary,
  type NumericTile,
  normalizeScientificRelativeName,
  resolveNumericTileSource,
  type ScientificCompanionResolver,
  type ScientificDocument,
  supportsScientificPlaneRead,
} from 'purejsimage/scientific'
import { createScientificFileContext } from 'purejsimage/scientific/browser'
import { HttpRangeSource } from 'purejsimage/sources/http-range'
import {
  cacheCodecAdapterPlane,
  usesCodecAdapterReader,
  wrapCodecAdapterDataset,
} from './codec-plane-cache.js'
import { wrapFetchToExposeContentRange } from './cors-range-fetch.js'
import {
  datasetDescriptor,
  defaultPlaneSelection,
  geoDatasetDescriptor,
  geoZarrStructuralDiagnostics,
  openedSourceDescriptor,
} from './descriptor.js'
import { omeZarrDirectoryFingerprint } from './ome-zarr-directory.js'
import { composeOmeZarrDisplayTile } from './ome-zarr-display.js'
import { PUREJSIMAGE_PACKAGE_VERSION } from './package-version.js'
import { tiffOpenLimits } from './tiff-open-limits.js'
import { createAnalysisBindings, isScientificDataset } from './worker-host/analysis-rpc.js'
import {
  blobSourceFromFile,
  classifyTiffOpenFailure,
  cogInspectionFromGeoTiffStructure,
  inspectReadableTiff,
  looksLikeTiffName,
  tryInspectTiffSource,
} from './worker-host/cog-inspect.js'
import type {
  BoundDerivedRasterInput,
  DerivedRasterTransformProvider,
} from './worker-host/derived-raster.js'
import {
  computeDisplayStatistics,
  displayStatisticsCacheKey,
  sampleRasterPoint,
} from './worker-host/display-rpc.js'
import {
  directoryMembersForOpen,
  directoryOmeZarrIdentity,
  durableOmeZarrRootUrl,
  filesFromOmeZarrAttachments,
  omeZarrIdentityEvidence,
  omeZarrIdentityMetadata,
  omeZarrNetworkFromStore,
  openOmeZarrHttpDocument,
  openOmeZarrScientificDocument,
  zipOmeZarrIdentity,
} from './worker-host/ome-zarr-rpc.js'
import {
  abortError,
  errorResult,
  structuredError,
  success,
  type WorkerHostResult,
} from './worker-host/protocol.js'
import {
  inFlightAdmissionLimit,
  mergeImagingResourceLimits,
  resolveImagingResourceLimits,
} from './worker-host/resources.js'
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
import {
  mappedDisplayTileTransfer,
  mappedTileTransfer,
  mapTile,
  numericValue,
} from './worker-host/view-rpc.js'
import { loadReadersForSource, SUPPORTED_READERS } from './worker-readers.js'

export type { WorkerHostResult } from './worker-host/protocol.js'

function wrapNumericSource(
  source: ReturnType<typeof resolveNumericTileSource>,
  readerId: string,
): ReturnType<typeof resolveNumericTileSource> {
  return usesCodecAdapterReader(readerId) ? cacheCodecAdapterPlane(source) : source
}

const MAX_SERIES_EXPORT_CELLS = 1_000_000

function derivedRequestDatasetHandles(
  request: WorkerRequest,
): readonly DatasetHandleId[] | undefined {
  switch (request.kind) {
    case 'geo.analysis.dry_run':
    case 'geo.analysis.tile':
    case 'geo.analysis.region_statistics':
    case 'geo.analysis.line_profile':
      return request.payload.inputs.map(({ datasetHandleId }) => datasetHandleId)
    default:
      return undefined
  }
}

function derivedRequestLayerId(request: WorkerRequest): string | undefined {
  switch (request.kind) {
    case 'geo.analysis.dry_run':
    case 'geo.analysis.tile':
    case 'geo.analysis.region_statistics':
    case 'geo.analysis.line_profile':
    case 'geo.analysis.release':
      return request.payload.layerId
    default:
      return undefined
  }
}

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

export interface ImagingAnalysisCatalogExtras {
  readonly documentation: readonly RpcJsonObject[]
  readonly presets: readonly RpcJsonObject[]
}

export interface ImagingWorkerHostOptions {
  readonly fetch?: typeof fetch
  readonly baseUrl?: string
  readonly analysisExtensions?: readonly PureJsImageExtension[]
  readonly analysisCatalog?: ImagingAnalysisCatalogExtras
  readonly limits?: Partial<ImagingResourceLimits>
  readonly rasterTransforms?: DerivedRasterTransformProvider
  /** Geo loads direct GeoTIFF/GeoZarr readers; the default Science profile never does. */
  readonly profile?: 'science' | 'geo'
}

const MiB = 1_024 * 1_024
/** 512 KiB per source forced COG overview/full-res rereads; 16 MiB holds a working set. */
const PREFERRED_RANGE_CACHE_BYTES = 16 * MiB
const MINIMUM_RANGE_CACHE_BYTES = 64 * 1_024
const RANGE_BLOCK_BYTES = 64 * 1_024

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
  readonly #sources = new Map<SourceId, SourceRecord>()
  readonly #datasets = new Map<DatasetHandleId, { sourceId: SourceId; record: DatasetRecord }>()
  readonly #displayStatistics = new Map<
    string,
    Readonly<{
      sourceIdentity: string
      datasetHandleId: DatasetHandleId
      value: DisplayStatistics
    }>
  >()
  #pending = new Map<string, PendingRequest>()
  #nextId = 1
  #epoch = 1
  #limits: ImagingResourceLimits
  #releases = { documents: 0, datasets: 0, tiles: 0, runtimes: 0 }
  readonly #fetch: typeof fetch | undefined
  readonly #baseUrl: string | undefined
  readonly #analysisExtensions: readonly PureJsImageExtension[]
  readonly #catalogExtras: ImagingAnalysisCatalogExtras
  readonly #rasterTransforms: DerivedRasterTransformProvider | undefined
  readonly #profile: 'science' | 'geo'

  constructor(options: Readonly<ImagingWorkerHostOptions> = {}) {
    this.#fetch = options.fetch
    this.#baseUrl =
      options.baseUrl ??
      (typeof globalThis.location === 'undefined'
        ? undefined
        : new URL('/', globalThis.location.href).href)
    this.#analysisExtensions = options.analysisExtensions ?? []
    this.#catalogExtras = options.analysisCatalog ?? { documentation: [], presets: [] }
    this.#rasterTransforms = options.rasterTransforms
    this.#profile = options.profile ?? 'science'
    this.#limits = resolveImagingResourceLimits(options.limits)
  }

  async handle(input: unknown): Promise<WorkerHostResult> {
    let requestId = 'invalid-request'
    try {
      const request = validateWorkerRequest(input)
      requestId = request.requestId
      if (request.kind === 'request.cancel') return this.#cancel(request)
      if (request.kind === 'worker.test-crash') throw new Error('Intentional worker crash test')
      const admissionLimit = inFlightAdmissionLimit(request.kind, this.#limits.maxInFlightRequests)
      if (this.#isBudgetedKind(request.kind) && this.#pending.size >= admissionLimit) {
        return errorResult(requestId, {
          code: 'LIMIT_EXCEEDED',
          message: `In-flight request limit of ${admissionLimit} reached.`,
          retryable: true,
        })
      }
      const controller = new AbortController()
      const datasetHandleId =
        request.payload !== null && 'datasetHandleId' in request.payload
          ? request.payload.datasetHandleId
          : undefined
      const payloadSourceId =
        request.payload !== null && 'sourceId' in request.payload
          ? request.payload.sourceId
          : undefined
      const sourceId =
        payloadSourceId ??
        (datasetHandleId === undefined ? undefined : this.#datasets.get(datasetHandleId)?.sourceId)
      const derivedDatasetHandleIds = derivedRequestDatasetHandles(request)
      const derivedLayerId = derivedRequestLayerId(request)
      this.#pending.set(request.requestId, {
        controller,
        ...(datasetHandleId === undefined ? {} : { datasetHandleId }),
        ...(derivedDatasetHandleIds === undefined
          ? {}
          : { datasetHandleIds: derivedDatasetHandleIds }),
        ...(sourceId === undefined ? {} : { sourceId }),
        ...(derivedLayerId === undefined ? {} : { derivedLayerId }),
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
    this.#displayStatistics.clear()
    await this.#releaseAllSources()
    this.#epoch += 1
  }

  async #dispatch(request: WorkerRequest, signal: AbortSignal): Promise<WorkerHostResult> {
    switch (request.kind) {
      case 'worker.initialize':
        if (request.payload?.limits !== undefined) {
          this.#limits = mergeImagingResourceLimits(this.#limits, request.payload.limits)
        }
        return success(request.requestId, 'worker.initialize', {
          readers: SUPPORTED_READERS,
          epoch: this.#epoch,
          limits: this.#limits,
        })
      case 'source.open-sample':
        return this.#openSample(request, signal)
      case 'source.open-local':
        return this.#openLocal(request, signal)
      case 'source.open-bundled':
        return this.#openBundled(request, signal)
      case 'source.open-remote':
        return this.#openRemote(request, signal)
      case 'source.open-geozarr-remote':
        return this.#openGeoZarrRemote(request, signal)
      case 'source.open-geozarr-bundled':
        return this.#openGeoZarrBundled(request, signal)
      case 'source.open-ome-zarr-remote':
        return this.#openOmeZarrRemote(request, signal)
      case 'source.open-ome-zarr-directory':
        return this.#openOmeZarrDirectory(request, signal)
      case 'source.open-ome-zarr-zip':
        return this.#openOmeZarrZip(request, signal)
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
      case 'display.tile.request':
        return this.#requestDisplayTile(request, signal)
      case 'display.statistics.request':
        return this.#requestDisplayStatistics(request, signal)
      case 'display.statistics.invalidate':
        return this.#invalidateDisplayStatistics(request)
      case 'raster.sample_point':
        return this.#sampleRasterPoint(request, signal)
      case 'geo.analysis.dry_run':
        return this.#dryRunDerivedRaster(request)
      case 'geo.analysis.tile':
        return this.#requestDerivedRasterTile(request, signal)
      case 'geo.analysis.region_statistics':
        return this.#derivedRasterStatistics(request, signal)
      case 'geo.analysis.line_profile':
        return this.#derivedRasterLineProfile(request, signal)
      case 'geo.analysis.release':
        return this.#releaseDerivedRaster(request)
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
        return success(
          request.requestId,
          'diagnostics',
          this.diagnostics(request.payload?.sourceId),
        )
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
      await this.#commitSource(record)
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
      await this.#commitSource(record)
      return success(request.requestId, 'source.opened', this.#describe(record))
    } catch (error) {
      return errorResult(request.requestId, this.#openFailure(error))
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
      await this.#commitSource(record)
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
            sourceId: record.id,
          },
        },
        signal,
      )
      if (!datasetResult.response.ok) {
        await this.#releaseSource(record)
        return datasetResult
      }
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
    const lifetime = new AbortController()
    let document: SourceRecord['document'] | undefined
    try {
      const geoTiff = this.#profile === 'geo' && looksLikeTiffName(primary.name)
      let geoTiffStructure: SourceRecord['geoTiffStructure']
      let cogInspection: Awaited<ReturnType<typeof inspectReadableTiff>>
      if (geoTiff) {
        const { createGeoTiffReader } = await import('purejsimage/geo/readers/geotiff')
        let opened: Awaited<ReturnType<ReturnType<typeof createGeoTiffReader>['open']>>
        try {
          opened = await createGeoTiffReader({ limits: tiffOpenLimits(primary.size) }).open(
            createScientificFileContext(primary, { companions: files, signal }),
          )
        } catch (error) {
          throw await this.#enrichTiffOpenFailure(
            error,
            blobSourceFromFile(primary),
            primary.name,
            signal,
          )
        }
        document = {
          kind: 'geo',
          value: opened,
          identity: {
            kind: 'geo-source',
            reader: opened.reader,
            name: primary.name,
            size: primary.size,
            lastModified: primary.lastModified,
          },
        }
        geoTiffStructure = await opened.inspectStructure()
        cogInspection = cogInspectionFromGeoTiffStructure(geoTiffStructure)
      } else {
        const readers = await loadReadersForSource(primary.name, { maxInputBytes: primary.size })
        try {
          const opened = await createScientificLibrary({ readers }).open(
            createScientificFileContext(primary, { companions: files, signal }),
          )
          document = { kind: 'scientific', value: opened }
        } catch (error) {
          throw await this.#enrichTiffOpenFailure(
            error,
            blobSourceFromFile(primary),
            primary.name,
            signal,
          )
        }
        cogInspection = looksLikeTiffName(primary.name)
          ? await inspectReadableTiff(blobSourceFromFile(primary), signal)
          : undefined
      }
      return {
        id: this.#id('source') as SourceId,
        documentId: this.#id('document') as DocumentId,
        generation,
        kind,
        name: primary.name,
        size: primary.size,
        document,
        rangeSources: [],
        lifetime,
        lastUsedAt: this.#now(),
        ...(cogInspection === undefined ? {} : { cogInspection }),
        ...(geoTiffStructure === undefined ? {} : { geoTiffStructure }),
        datasets: new Map(),
        closed: false,
      }
    } catch (error) {
      lifetime.abort(abortError('Source open failed'))
      if (document !== undefined) await document.value.close?.()
      throw error
    }
  }

  async #openRemote(
    request: Extract<WorkerRequest, { kind: 'source.open-remote' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    const lifetime = new AbortController()
    let document: SourceRecord['document'] | undefined
    try {
      const url = assertRemoteUrl(request.payload.url)
      const maxCacheBytes = this.#rangeCacheBudgetForNewSource()
      const configuredFetch = this.#fetch ?? globalThis.fetch.bind(globalThis)
      const rangeFetch = wrapFetchToExposeContentRange(configuredFetch)
      const rangeOptions = {
        blockBytes: RANGE_BLOCK_BYTES,
        maxCacheBytes,
        openSignal: signal,
        lifetimeSignal: lifetime.signal,
        fetch: rangeFetch,
      }
      const primary = await HttpRangeSource.open(url, rangeOptions)
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
              ...rangeOptions,
              ...(options?.signal === undefined ? {} : { openSignal: options.signal }),
            })
            companions.set(relativeName, source)
            ranges.push(source)
          }
          return { id: `remote-companion:${relativeName}`, name: relativeName, source }
        },
      }
      const name = sourceName(url)
      const context = {
        primary: { id: 'remote-primary', name, source: primary },
        companions: resolver,
        signal,
      }
      const geoTiff = this.#profile === 'geo' && looksLikeTiffName(name)
      let geoTiffStructure: SourceRecord['geoTiffStructure']
      let cogInspection: Awaited<ReturnType<typeof inspectReadableTiff>>
      if (geoTiff) {
        const { createGeoTiffReader } = await import('purejsimage/geo/readers/geotiff')
        let opened: Awaited<ReturnType<ReturnType<typeof createGeoTiffReader>['open']>>
        try {
          opened = await createGeoTiffReader({ limits: tiffOpenLimits(primary.size) }).open(context)
        } catch (error) {
          throw await this.#enrichTiffOpenFailure(error, primary, name, signal)
        }
        document = {
          kind: 'geo',
          value: opened,
          identity: {
            kind: 'geo-source',
            reader: opened.reader,
            url: url.href,
            size: primary.size,
            ...(primary.validator === undefined ? {} : { validator: primary.validator }),
          },
        }
        geoTiffStructure = await opened.inspectStructure()
        cogInspection = cogInspectionFromGeoTiffStructure(geoTiffStructure)
      } else {
        const readers = await loadReadersForSource(name, { maxInputBytes: primary.size })
        try {
          const opened = await createScientificLibrary({ readers }).open(context)
          document = { kind: 'scientific', value: opened }
        } catch (error) {
          throw await this.#enrichTiffOpenFailure(error, primary, name, signal)
        }
        cogInspection = looksLikeTiffName(name)
          ? await inspectReadableTiff(primary, signal)
          : undefined
      }
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
        lifetime,
        lastUsedAt: this.#now(),
        ...(cogInspection === undefined ? {} : { cogInspection }),
        ...(geoTiffStructure === undefined ? {} : { geoTiffStructure }),
        datasets: new Map(),
        closed: false,
      }
      await this.#commitSource(record)
      return success(request.requestId, 'source.opened', this.#describe(record))
    } catch (error) {
      lifetime.abort(abortError('Source open failed'))
      if (document !== undefined) await document.value.close?.()
      return errorResult(request.requestId, this.#openFailure(error))
    }
  }

  async #openOmeZarrRemote(
    request: Extract<WorkerRequest, { kind: 'source.open-ome-zarr-remote' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    const lifetime = new AbortController()
    let document: ScientificDocument | undefined
    let store: SourceRecord['omeZarrHttpStore']
    try {
      const url = assertRemoteUrl(request.payload.url)
      const opened = await openOmeZarrHttpDocument(url.href, {
        ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
        signal,
        maxCacheBytesPerSource: this.#rangeCacheBudgetForNewSource(),
        blockBytes: RANGE_BLOCK_BYTES,
      })
      document = opened.document
      const httpStore = opened.store
      store = httpStore
      const identity = omeZarrIdentityEvidence(httpStore.identitySummary(document))
      const name = sourceName(new URL(durableOmeZarrRootUrl(httpStore.normalized.storeRootUrl)))
      const record: SourceRecord = {
        id: this.#id('source') as SourceId,
        documentId: this.#id('document') as DocumentId,
        generation: request.payload.generation,
        kind: 'ome-zarr-remote',
        name: name.length === 0 ? 'ome-zarr' : name,
        size: identity.rootObjectSize,
        url: durableOmeZarrRootUrl(httpStore.normalized.storeRootUrl),
        document: { kind: 'scientific', value: document },
        rangeSources: [],
        lifetime,
        lastUsedAt: this.#now(),
        omeZarrHttpStore: httpStore,
        omeZarrIdentity: identity,
        omeZarrNetwork: () => omeZarrNetworkFromStore(httpStore),
        datasets: new Map(),
        closed: false,
      }
      await this.#commitSource(record)
      return success(request.requestId, 'source.opened', this.#describe(record))
    } catch (error) {
      lifetime.abort(abortError('Source open failed'))
      store?.close()
      if (document !== undefined) await document.close?.()
      return errorResult(request.requestId, this.#openFailure(error))
    }
  }

  async #openGeoZarrRemote(
    request: Extract<WorkerRequest, { kind: 'source.open-geozarr-remote' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    const lifetime = new AbortController()
    let document: SourceRecord['document'] | undefined
    try {
      if (this.#profile !== 'geo') {
        throw new RpcValidationError(
          'INVALID_PAYLOAD',
          'GeoZarr sources require the Geo imaging Worker profile',
        )
      }
      const url = assertRemoteUrl(request.payload.url)
      const { openGeoZarrHttp } = await import('purejsimage/geo/readers/geozarr')
      const opened = await openGeoZarrHttp(url, {
        signal: AbortSignal.any([signal, lifetime.signal]),
        http: {
          ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
          blockBytes: RANGE_BLOCK_BYTES,
          maxCacheBytesPerSource: this.#rangeCacheBudgetForNewSource(),
        },
      })
      const structure = opened.inspectStructure()
      document = {
        kind: 'geo',
        value: opened,
        identity: {
          kind: 'geo-zarr-source',
          reader: opened.reader,
          rootUrl: url.href,
          rootMetadataObject: structure.rootMetadataObject,
        },
      }
      const record: SourceRecord = {
        id: this.#id('source') as SourceId,
        documentId: this.#id('document') as DocumentId,
        generation: request.payload.generation,
        kind: 'geo-zarr-remote',
        name: sourceName(url) || 'geozarr',
        size: structure.io.metadataBytes,
        url: url.href,
        document,
        rangeSources: [],
        lifetime,
        lastUsedAt: this.#now(),
        geoZarrStructure: structure,
        geoZarrDiagnostics: () => opened.inspectStructure(),
        datasets: new Map(),
        closed: false,
      }
      await this.#commitSource(record)
      return success(request.requestId, 'source.opened', this.#describe(record))
    } catch (error) {
      lifetime.abort(abortError('Source open failed'))
      if (document !== undefined) await document.value.close?.()
      return errorResult(request.requestId, this.#openFailure(error))
    }
  }

  async #openGeoZarrBundled(
    request: Extract<WorkerRequest, { kind: 'source.open-geozarr-bundled' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    const lifetime = new AbortController()
    let document: SourceRecord['document'] | undefined
    try {
      if (this.#profile !== 'geo') {
        throw new RpcValidationError(
          'INVALID_PAYLOAD',
          'GeoZarr sources require the Geo imaging Worker profile',
        )
      }
      const files = filesFromOmeZarrAttachments(request.payload.files)
      const primaryIndex = request.payload.files.findIndex(
        ({ id }) => id === request.payload.primaryId,
      )
      const primary = files[primaryIndex]
      if (primary === undefined)
        throw new RpcValidationError('INVALID_PAYLOAD', 'bundled GeoZarr root metadata is missing')
      const members = new Map(
        files.map((file) => [normalizeScientificRelativeName(file.name), file] as const),
      )
      const objectStore: import('purejsimage/geo/readers/geozarr').GeoZarrObjectStore = {
        resolve: async (relative, readSignal) => {
          readSignal?.throwIfAborted()
          const name = normalizeScientificRelativeName(relative)
          const file = members.get(name)
          return file === undefined
            ? undefined
            : { id: `bundled-geozarr:${name}`, source: blobSourceFromFile(file) }
        },
      }
      const { openGeoZarrObjectStore } = await import('purejsimage/geo/readers/geozarr')
      const opened = await openGeoZarrObjectStore(objectStore, {
        primaryName: normalizeScientificRelativeName(primary.name),
        storeKind: 'object-store',
        signal: AbortSignal.any([signal, lifetime.signal]),
      })
      const structure = opened.inspectStructure()
      document = {
        kind: 'geo',
        value: opened,
        identity: {
          kind: 'geo-zarr-bundled',
          reader: opened.reader,
          primary: primary.name,
          members: files.map((file) => ({ name: file.name, size: file.size })),
        },
      }
      const record: SourceRecord = {
        id: this.#id('source') as SourceId,
        documentId: this.#id('document') as DocumentId,
        generation: request.payload.generation,
        kind: 'geo-zarr-bundled',
        name: primary.name,
        size: files.reduce((total, file) => total + file.size, 0),
        document,
        rangeSources: [],
        lifetime,
        lastUsedAt: this.#now(),
        geoZarrStructure: structure,
        geoZarrDiagnostics: () => opened.inspectStructure(),
        datasets: new Map(),
        closed: false,
      }
      await this.#commitSource(record)
      return success(request.requestId, 'source.opened', this.#describe(record))
    } catch (error) {
      lifetime.abort(abortError('Source open failed'))
      if (document !== undefined) await document.value.close?.()
      return errorResult(request.requestId, this.#openFailure(error))
    }
  }

  async #openOmeZarrDirectory(
    request: Extract<WorkerRequest, { kind: 'source.open-ome-zarr-directory' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    const lifetime = new AbortController()
    let document: ScientificDocument | undefined
    try {
      const files = filesFromOmeZarrAttachments(request.payload.files)
      const selected = directoryMembersForOpen(files, request.payload.storeRoot)
      document = await openOmeZarrScientificDocument(selected.primary, selected.members, signal)
      const fingerprint = await omeZarrDirectoryFingerprint(
        files.map((file) => ({
          relativePath: file.name,
          size: file.size,
        })),
      )
      const identity = directoryOmeZarrIdentity(
        selected.metadataName,
        fingerprint,
        selected.primary.size,
      )
      const record: SourceRecord = {
        id: this.#id('source') as SourceId,
        documentId: this.#id('document') as DocumentId,
        generation: request.payload.generation,
        kind: 'ome-zarr-directory',
        name: selected.root.length === 0 ? selected.metadataName : selected.root,
        size: files.reduce((sum, file) => sum + file.size, 0),
        document: { kind: 'scientific', value: document },
        rangeSources: [],
        lifetime,
        lastUsedAt: this.#now(),
        omeZarrIdentity: identity,
        directoryDisposer: () => undefined,
        datasets: new Map(),
        closed: false,
      }
      await this.#commitSource(record)
      return success(request.requestId, 'source.opened', this.#describe(record))
    } catch (error) {
      lifetime.abort(abortError('Source open failed'))
      if (document !== undefined) await document.close?.()
      return errorResult(request.requestId, this.#openFailure(error))
    }
  }

  async #openOmeZarrZip(
    request: Extract<WorkerRequest, { kind: 'source.open-ome-zarr-zip' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    const lifetime = new AbortController()
    let document: ScientificDocument | undefined
    try {
      const files = filesFromOmeZarrAttachments(request.payload.files)
      const primary = files[0]
      if (primary === undefined)
        throw new RpcValidationError('INVALID_PAYLOAD', 'OME-Zarr ZIP archive is missing')
      const prefix = await primary.slice(0, 4).arrayBuffer()
      const magic = new Uint8Array(prefix)
      if (
        magic.byteLength < 4 ||
        magic[0] !== 0x50 ||
        magic[1] !== 0x4b ||
        !(
          (magic[2] === 0x03 && magic[3] === 0x04) ||
          (magic[2] === 0x05 && magic[3] === 0x06) ||
          (magic[2] === 0x06 && magic[3] === 0x06)
        )
      ) {
        throw new RpcValidationError('INVALID_PAYLOAD', 'OME-Zarr ZIP open requires a ZIP archive.')
      }
      document = await openOmeZarrScientificDocument(primary, [primary], signal)
      const metadataName =
        document.metadata['store'] === 'zip' &&
        typeof document.metadata['primaryMetadataName'] === 'string'
          ? document.metadata['primaryMetadataName']
          : 'zarr.json'
      const identity = zipOmeZarrIdentity(
        metadataName === '.zgroup' || metadataName === '.zattrs' || metadataName === 'zarr.json'
          ? metadataName
          : 'zarr.json',
        primary.size,
      )
      const record: SourceRecord = {
        id: this.#id('source') as SourceId,
        documentId: this.#id('document') as DocumentId,
        generation: request.payload.generation,
        kind: 'ome-zarr-zip',
        name: primary.name,
        size: primary.size,
        document: { kind: 'scientific', value: document },
        rangeSources: [],
        lifetime,
        lastUsedAt: this.#now(),
        omeZarrIdentity: identity,
        datasets: new Map(),
        closed: false,
      }
      await this.#commitSource(record)
      return success(request.requestId, 'source.opened', this.#describe(record))
    } catch (error) {
      lifetime.abort(abortError('Source open failed'))
      if (document !== undefined) await document.close?.()
      return errorResult(request.requestId, this.#openFailure(error))
    }
  }

  async #commitSource(record: SourceRecord): Promise<void> {
    if (this.#sources.size >= this.#limits.maxOpenSources) {
      record.lifetime.abort(abortError('Open source limit reached'))
      record.omeZarrHttpStore?.close()
      record.directoryDisposer?.()
      await record.document.value.close?.()
      throw this.#limitError(`Open source limit of ${this.#limits.maxOpenSources} reached.`)
    }
    this.#sources.set(record.id, record)
    this.#touch(record)
  }

  #describe(record: SourceRecord) {
    const base = openedSourceDescriptor({
      document: record.document,
      sourceId: record.id,
      documentId: record.documentId,
      generation: record.generation,
      kind: record.kind,
      name: record.name,
      size: record.size,
      ...(record.url === undefined ? {} : { url: record.url }),
    })
    const extra = {
      ...omeZarrIdentityMetadata(record.omeZarrIdentity),
      ...(record.cogInspection === undefined
        ? {}
        : { [COG_INSPECTION_METADATA_KEY]: record.cogInspection }),
    }
    const withGeoZarr =
      record.geoZarrStructure === undefined
        ? base
        : {
            ...base,
            datasets: base.datasets.map((dataset) => ({
              ...dataset,
              geoZarrStructure: geoZarrStructuralDiagnostics(
                record.geoZarrStructure as NonNullable<SourceRecord['geoZarrStructure']>,
              ),
            })),
          }
    if (Object.keys(extra).length === 0) return withGeoZarr
    return {
      ...withGeoZarr,
      metadata: {
        ...withGeoZarr.metadata,
        ...extra,
      },
    }
  }

  async #openDataset(
    request: Extract<WorkerRequest, { kind: 'dataset.open' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    try {
      const source = this.#sourceForDocument(
        request.payload.documentId,
        request.payload.generation,
        request.payload.sourceId,
      )
      if (source.datasets.size >= this.#limits.maxDatasetsPerSource) {
        throw this.#limitError(
          `Dataset limit of ${this.#limits.maxDatasetsPerSource} reached for this source.`,
        )
      }
      const summary = source.document.value.datasets.find(
        ({ id }) => id === request.payload.datasetId,
      )
      if (summary === undefined) throw this.#stale('dataset summary')
      const remainingTileBytes = this.#remainingTileRuntimeBytes()
      if (remainingTileBytes < 8 * MiB) {
        throw this.#limitError('Tile-runtime memory budget is exhausted.')
      }
      const managedBytes = Math.min(96 * MiB, Math.max(8 * MiB, remainingTileBytes))
      const openedDataset = await source.document.value.openDataset(summary.id, { signal })
      const geoDataset = source.document.kind === 'geo' ? openedDataset : undefined
      const dataset =
        source.document.kind === 'geo'
          ? (openedDataset as import('purejsimage/geo').GeoRasterDataset).scientificDataset
          : (openedDataset as import('purejsimage/scientific').ScientificDataset)
      const projectedDescriptor =
        source.document.kind === 'geo'
          ? geoDatasetDescriptor(
              summary as import('purejsimage/geo').GeoRasterDatasetSummary,
              source.document.identity,
            )
          : datasetDescriptor(summary as import('purejsimage/scientific').ScientificDatasetSummary)
      const runtime = createTileRuntime({
        limits: {
          maxCacheBytes: Math.min(48 * MiB, managedBytes),
          maxTileBytes: 8 * MiB,
          maxInFlightBytes: Math.min(32 * MiB, managedBytes),
          maxTotalManagedBytes: managedBytes,
          maxConcurrency: 3,
          maxTilePixels: 512 * 512,
        },
        metrics: true,
      })
      try {
        const bundle = createBuiltInAnalysisBundle({ descriptor: dataset.descriptor, runtime })
        const extensionHost = createExtensionHost({
          extensions: [...this.#analysisExtensions],
          operations: bundle.operations.definitions(),
          valueTypes: bundle.valueTypes.definitions(),
          providers: bundle.providers,
        })
        const prepared = await extensionHost.prepare(signal)
        try {
          const analysis = createAnalysisController({
            operations: prepared.operations,
            valueTypes: prepared.valueTypes,
            providers: extensionHost.providers,
            migrations: prepared.analysisMigrations,
            roi: { descriptor: dataset.descriptor },
            library: {
              version: PUREJSIMAGE_PACKAGE_VERSION,
              buildFingerprint: 'pji-workbench-worker-v1',
            },
          })
          const readerId = source.document.value.reader.id
          const numericSource = wrapNumericSource(
            resolveNumericTileSource(dataset, { targetSampleType: 'float32' }),
            readerId,
          )
          const analysisDataset = wrapCodecAdapterDataset(dataset, readerId, numericSource)
          const handleId = this.#id('dataset') as DatasetHandleId
          const record: DatasetRecord = {
            handleId,
            sourceId: source.id,
            summary,
            dataset,
            ...(geoDataset === undefined
              ? {}
              : {
                  geo: {
                    dataset: geoDataset as import('purejsimage/geo').GeoRasterDataset,
                    descriptor: (geoDataset as import('purejsimage/geo').GeoRasterDataset)
                      .descriptor,
                  },
                }),
            analysisDataset,
            readerId,
            runtime,
            tileSource: numericTileSourceToTileSource(numericSource),
            tileIdentity: createTileDatasetIdentityForScientificDataset(dataset, {
              sessionId: handleId,
              generation: source.generation,
              unidentifiedDatasetId: summary.id,
            }),
            analysis,
            disposeExtensions: () => prepared.dispose(),
            results: new Map(),
            selection: defaultPlaneSelection(projectedDescriptor),
            closed: false,
          }
          source.datasets.set(handleId, record)
          this.#datasets.set(handleId, { sourceId: source.id, record })
          this.#touch(source)
          const payload: OpenedDatasetDescriptor = {
            handleId,
            sourceId: source.id,
            generation: source.generation,
            dataset:
              source.geoZarrStructure === undefined
                ? projectedDescriptor
                : {
                    ...projectedDescriptor,
                    geoZarrStructure: geoZarrStructuralDiagnostics(source.geoZarrStructure),
                  },
            selection: record.selection,
          }
          return success(request.requestId, 'dataset.opened', payload)
        } catch (error) {
          await prepared.dispose()
          throw error
        }
      } catch (error) {
        await runtime.dispose()
        throw error
      }
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INTERNAL_ERROR'))
    }
  }

  async #closeSource(
    request: Extract<WorkerRequest, { kind: 'source.close' }>,
  ): Promise<WorkerHostResult> {
    try {
      const source = this.#sourceById(request.payload.sourceId, request.payload.generation)
      await this.#releaseSource(source)
      return success(request.requestId, 'source.closed', { sourceId: request.payload.sourceId })
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'STALE_ID'))
    }
  }

  async #closeDatasetRequest(
    request: Extract<WorkerRequest, { kind: 'dataset.close' }>,
  ): Promise<WorkerHostResult> {
    try {
      const { source, record } = this.#datasetByHandle(
        request.payload.handleId,
        request.payload.generation,
      )
      await this.#releaseDataset(source, record)
      return success(request.requestId, 'dataset.closed', { handleId: request.payload.handleId })
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'STALE_ID'))
    }
  }

  #setPlane(request: Extract<WorkerRequest, { kind: 'plane.set' }>): WorkerHostResult {
    try {
      const { source, record } = this.#datasetByHandle(
        request.payload.handleId,
        request.payload.generation,
      )
      const selection = request.payload.selection
      if (!supportsScientificPlaneRead(record.dataset.descriptor, selection.displayAxes)) {
        throw new RpcValidationError(
          'INVALID_PAYLOAD',
          'The selected display-axis pair is unsupported',
        )
      }
      record.selection = selection
      record.runtime.invalidate({ generation: source.generation, cancelInFlight: true })
      this.#touch(source)
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
      const { source, record } = this.#datasetByHandle(
        request.payload.datasetHandleId,
        request.payload.generation,
      )
      this.#touch(source)
      if (request.payload.mapping.omeZarrChannels !== undefined) {
        const mapped = await composeOmeZarrDisplayTile(record, request.payload, signal)
        const width = request.payload.region.width
        const height = request.payload.region.height
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
            width,
            height,
            ...mapped,
            elapsedMilliseconds: performance.now() - started,
          },
        }
        this.#releases.tiles += 1
        return { response, transfer: mappedTileTransfer(mapped) }
      }
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
      return { response, transfer: mappedTileTransfer(mapped) }
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INTERNAL_ERROR'))
    } finally {
      if (tile !== undefined) {
        tile.release()
        this.#releases.tiles += 1
      }
    }
  }

  async #requestDisplayTile(
    request: Extract<WorkerRequest, { kind: 'display.tile.request' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    const started = performance.now()
    let tile: NumericTile | undefined
    try {
      const { source, record } = this.#datasetByHandle(
        request.payload.datasetHandleId,
        request.payload.generation,
      )
      this.#touch(source)
      if (request.payload.mapping.omeZarrChannels !== undefined) {
        const mapped = await composeOmeZarrDisplayTile(record, request.payload, signal)
        const response: Extract<WorkerResponse, { kind: 'display.tile.ready' }> = {
          schemaVersion: RPC_SCHEMA_VERSION,
          requestId: request.requestId,
          ok: true,
          kind: 'display.tile.ready',
          payload: {
            tileId: request.payload.tileId,
            datasetHandleId: request.payload.datasetHandleId,
            generation: request.payload.generation,
            sourceIdentity: request.payload.sourceIdentity,
            sourceRevision: request.payload.sourceRevision,
            layerId: request.payload.layerId,
            styleRevision: request.payload.styleRevision,
            statisticsRevision: request.payload.statisticsRevision,
            region: request.payload.region,
            overview: request.payload.resolutionLevel,
            width: request.payload.region.width,
            height: request.payload.region.height,
            rgba: mapped.rgba,
            elapsedMilliseconds: performance.now() - started,
          },
        }
        this.#releases.tiles += 1
        return { response, transfer: mappedDisplayTileTransfer(mapped.rgba) }
      }
      tile = await record.runtime.request(record.tileSource, {
        address: {
          cacheClass: 'source',
          namespace: `atlas-display:${record.handleId}`,
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
      const { rgba } = mapTile(tile, request.payload.component, request.payload.mapping)
      const response: Extract<WorkerResponse, { kind: 'display.tile.ready' }> = {
        schemaVersion: RPC_SCHEMA_VERSION,
        requestId: request.requestId,
        ok: true,
        kind: 'display.tile.ready',
        payload: {
          tileId: request.payload.tileId,
          datasetHandleId: request.payload.datasetHandleId,
          generation: request.payload.generation,
          sourceIdentity: request.payload.sourceIdentity,
          sourceRevision: request.payload.sourceRevision,
          layerId: request.payload.layerId,
          styleRevision: request.payload.styleRevision,
          statisticsRevision: request.payload.statisticsRevision,
          region: request.payload.region,
          overview: request.payload.resolutionLevel,
          width: tile.width,
          height: tile.height,
          rgba,
          elapsedMilliseconds: performance.now() - started,
        },
      }
      return { response, transfer: mappedDisplayTileTransfer(rgba) }
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INTERNAL_ERROR'))
    } finally {
      if (tile !== undefined) {
        tile.release()
        this.#releases.tiles += 1
      }
    }
  }

  async #requestDisplayStatistics(
    request: Extract<WorkerRequest, { kind: 'display.statistics.request' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    try {
      const { source, record } = this.#datasetByHandle(
        request.payload.datasetHandleId,
        request.payload.generation,
      )
      this.#touch(source)
      const key = displayStatisticsCacheKey(request.payload)
      const cached = this.#displayStatistics.get(key)
      if (cached !== undefined) {
        this.#displayStatistics.delete(key)
        this.#displayStatistics.set(key, cached)
        return success(request.requestId, 'display.statistics.ready', {
          ...cached.value,
          cached: true,
        })
      }
      const value = await computeDisplayStatistics(record, request.payload, signal)
      this.#releases.tiles += value.sampledTiles
      this.#displayStatistics.set(key, {
        sourceIdentity: request.payload.sourceIdentity,
        datasetHandleId: request.payload.datasetHandleId,
        value,
      })
      while (this.#displayStatistics.size > 128) {
        const oldest = this.#displayStatistics.keys().next().value
        if (oldest === undefined) break
        this.#displayStatistics.delete(oldest)
      }
      return success(request.requestId, 'display.statistics.ready', value)
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INTERNAL_ERROR'))
    }
  }

  #invalidateDisplayStatistics(
    request: Extract<WorkerRequest, { kind: 'display.statistics.invalidate' }>,
  ): WorkerHostResult {
    let removed = 0
    for (const [key, cached] of this.#displayStatistics) {
      if (
        (request.payload.sourceIdentity === undefined ||
          cached.sourceIdentity === request.payload.sourceIdentity) &&
        (request.payload.datasetHandleId === undefined ||
          cached.datasetHandleId === request.payload.datasetHandleId)
      ) {
        this.#displayStatistics.delete(key)
        removed += 1
      }
    }
    return success(request.requestId, 'display.statistics.invalidated', { removed })
  }

  async #sampleRasterPoint(
    request: Extract<WorkerRequest, { kind: 'raster.sample_point' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    try {
      const { source, record } = this.#datasetByHandle(
        request.payload.datasetHandleId,
        request.payload.generation,
      )
      this.#touch(source)
      const sample = await sampleRasterPoint(record, request.payload, signal)
      this.#releases.tiles += 1
      return success(request.requestId, 'raster.point_sampled', sample)
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INTERNAL_ERROR'))
    }
  }

  #derivedBindings(
    payload: Extract<WorkerRequest, { kind: 'geo.analysis.dry_run' }>['payload'],
  ): readonly BoundDerivedRasterInput[] {
    return payload.recipe.inputs.map((recipe, index) => {
      const runtime = payload.inputs[index]
      if (runtime === undefined)
        throw new RpcValidationError('INVALID_PAYLOAD', 'Derived runtime input is missing')
      const { source, record } = this.#datasetByHandle(runtime.datasetHandleId, runtime.generation)
      this.#touch(source)
      return { recipe, runtime, record }
    })
  }

  async #dryRunDerivedRaster(
    request: Extract<WorkerRequest, { kind: 'geo.analysis.dry_run' }>,
  ): Promise<WorkerHostResult> {
    try {
      this.#requireGeoAnalysisProfile()
      const { dryRunDerivedRaster } = await import('./worker-host/derived-raster.js')
      return success(
        request.requestId,
        'geo.analysis.dry_run',
        dryRunDerivedRaster(
          request.payload,
          this.#derivedBindings(request.payload),
          this.#rasterTransforms,
        ),
      )
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INVALID_PAYLOAD'))
    }
  }

  async #requestDerivedRasterTile(
    request: Extract<WorkerRequest, { kind: 'geo.analysis.tile' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    const started = performance.now()
    let tile: NumericTile | undefined
    try {
      this.#requireGeoAnalysisProfile()
      const { derivedRasterCacheKey, evaluateDerivedRasterTile } = await import(
        './worker-host/derived-raster.js'
      )
      tile = await evaluateDerivedRasterTile(
        request.payload,
        this.#derivedBindings(request.payload),
        request.payload.region,
        request.payload.priority,
        signal,
        this.#rasterTransforms,
      )
      signal.throwIfAborted()
      const { rgba } = mapTile(tile, 0, request.payload.mapping)
      const target = request.payload.recipe.targetGrid
      const totalTiles = Math.ceil(target.width / 256) * Math.ceil(target.height / 256)
      const response: Extract<WorkerResponse, { kind: 'geo.analysis.tile' }> = {
        schemaVersion: RPC_SCHEMA_VERSION,
        requestId: request.requestId,
        ok: true,
        kind: 'geo.analysis.tile',
        payload: {
          tileId: request.payload.tileId,
          layerId: request.payload.layerId,
          cacheKey: derivedRasterCacheKey(request.payload, this.#rasterTransforms),
          styleRevision: request.payload.styleRevision,
          statisticsRevision: request.payload.statisticsRevision,
          region: request.payload.region,
          overview: 0,
          width: tile.width,
          height: tile.height,
          rgba,
          elapsedMilliseconds: performance.now() - started,
          progress: { completedTiles: 1, totalTiles },
        },
      }
      return { response, transfer: mappedDisplayTileTransfer(rgba) }
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INTERNAL_ERROR'))
    } finally {
      if (tile !== undefined) {
        tile.release()
        this.#releases.tiles += 1
      }
    }
  }

  async #derivedRasterStatistics(
    request: Extract<WorkerRequest, { kind: 'geo.analysis.region_statistics' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    try {
      this.#requireGeoAnalysisProfile()
      const { computeDerivedRasterStatistics } = await import('./worker-host/derived-raster.js')
      const result = await computeDerivedRasterStatistics(
        request.payload,
        this.#derivedBindings(request.payload),
        signal,
        this.#rasterTransforms,
      )
      return {
        response: {
          schemaVersion: RPC_SCHEMA_VERSION,
          requestId: request.requestId,
          ok: true,
          kind: 'geo.analysis.region_statistics',
          payload: result,
        },
        transfer: result.histogram === undefined ? [] : [result.histogram.counts.buffer],
      }
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INTERNAL_ERROR'))
    }
  }

  async #derivedRasterLineProfile(
    request: Extract<WorkerRequest, { kind: 'geo.analysis.line_profile' }>,
    signal: AbortSignal,
  ): Promise<WorkerHostResult> {
    try {
      this.#requireGeoAnalysisProfile()
      const { sampleDerivedRasterLine } = await import('./worker-host/derived-raster.js')
      const result = await sampleDerivedRasterLine(
        request.payload,
        this.#derivedBindings(request.payload),
        signal,
        this.#rasterTransforms,
      )
      return {
        response: {
          schemaVersion: RPC_SCHEMA_VERSION,
          requestId: request.requestId,
          ok: true,
          kind: 'geo.analysis.line_profile',
          payload: result,
        },
        transfer: [result.distances.buffer, result.values.buffer, result.valid.buffer],
      }
    } catch (error) {
      return errorResult(request.requestId, structuredError(error, 'INTERNAL_ERROR'))
    }
  }

  #releaseDerivedRaster(
    request: Extract<WorkerRequest, { kind: 'geo.analysis.release' }>,
  ): WorkerHostResult {
    if (this.#profile !== 'geo')
      return errorResult(
        request.requestId,
        structuredError(
          new RpcValidationError('INVALID_PAYLOAD', 'Geo analysis requires the Geo Worker profile'),
          'INVALID_PAYLOAD',
        ),
      )
    for (const pending of this.#pending.values()) {
      if (pending.derivedLayerId === request.payload.layerId)
        pending.controller.abort(abortError('Derived raster released'))
    }
    return success(request.requestId, 'geo.analysis.released', {
      layerId: request.payload.layerId,
    })
  }

  #requireGeoAnalysisProfile(): void {
    if (this.#profile !== 'geo')
      throw new RpcValidationError(
        'INVALID_PAYLOAD',
        'Geo analysis requires the Geo Worker profile',
      )
  }

  #analysisRecord(payload: {
    readonly datasetHandleId: DatasetHandleId
    readonly generation: number
  }) {
    const { source, record } = this.#datasetByHandle(payload.datasetHandleId, payload.generation)
    this.#touch(source)
    return record
  }

  #analysisCatalog(
    request: Extract<WorkerRequest, { kind: 'analysis.catalog' }>,
  ): WorkerHostResult {
    try {
      const record = this.#analysisRecord(request.payload)
      return success(request.requestId, 'analysis.catalog', {
        capabilities: record.analysis.capabilities,
        documentation: this.#catalogExtras.documentation,
        presets: this.#catalogExtras.presets,
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
      return { response, transfer: mappedTileTransfer(mapped) }
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

  diagnostics(sourceId?: SourceId): WorkerDiagnostics {
    const sourceRecords = [...this.#sources.values()]
    const allSources = sourceRecords.map((source) => this.#sourceDiagnostics(source))
    const sources =
      sourceId === undefined ? allSources : allSources.filter((source) => source.id === sourceId)
    const tileRuntimes = sourceRecords.flatMap((source) => [...source.datasets.values()])
    const tileRuntimeBytes = tileRuntimes.reduce(
      (sum, dataset) => sum + dataset.runtime.metrics().memory.totalManagedBytes,
      0,
    )
    const rangeCacheBytes = allSources.reduce((sum, source) => sum + source.rangeCacheBytes, 0)
    const firstRuntime = tileRuntimes[0]
    return {
      epoch: this.#epoch,
      sources,
      aggregate: {
        openSources: this.#sources.size,
        openDatasets: this.#datasets.size,
        pendingRequests: this.#pending.size,
        rangeCacheBytes,
        tileRuntimeBytes,
      },
      pendingRequests: this.#pending.size,
      tileRuntime: firstRuntime === undefined ? null : firstRuntime.runtime.metrics(),
      releases: { ...this.#releases },
      limits: this.#limits,
    }
  }

  #sourceDiagnostics(source: SourceRecord): SourceRangeDiagnostics {
    const rangeStats = source.rangeSources.reduce(
      (totals, range) => ({
        requests: totals.requests + range.stats.requests,
        bytesFetched: totals.bytesFetched + range.stats.bytesFetched,
        cacheBytes: totals.cacheBytes + range.stats.cacheBytes,
        cacheHits: totals.cacheHits + range.stats.cacheHits,
        uniqueBytes: totals.uniqueBytes + range.stats.uniqueBytes,
      }),
      { requests: 0, bytesFetched: 0, cacheBytes: 0, cacheHits: 0, uniqueBytes: 0 },
    )
    const rangeRequests = rangeStats.requests
    const rangeCacheHits = rangeStats.cacheHits
    const omeZarrNetwork = source.omeZarrNetwork?.()
    const geoZarrStructure = source.geoZarrDiagnostics?.()
    const geoZarrIo = geoZarrStructure?.io
    const geoZarrRequests =
      geoZarrIo === undefined ? undefined : geoZarrIo.metadataRequests + geoZarrIo.chunkRequests
    return {
      id: source.id,
      kind: source.kind,
      size: source.size,
      revision: source.generation,
      rangeRequests: geoZarrRequests ?? omeZarrNetwork?.rangeRequests ?? rangeRequests,
      rangeBytesFetched:
        geoZarrIo?.metadataBytes === undefined
          ? (omeZarrNetwork?.bytesFetched ?? rangeStats.bytesFetched)
          : geoZarrIo.metadataBytes + geoZarrIo.chunkBytes,
      rangeCacheBytes:
        geoZarrIo?.sourceCacheBytes ?? omeZarrNetwork?.sourceCacheBytes ?? rangeStats.cacheBytes,
      rangeCacheHits: geoZarrIo?.cacheHits ?? omeZarrNetwork?.sourceCacheHits ?? rangeCacheHits,
      rangeCacheMisses: Math.max(
        0,
        (geoZarrRequests ?? omeZarrNetwork?.rangeRequests ?? rangeRequests) -
          (geoZarrIo?.cacheHits ?? omeZarrNetwork?.sourceCacheHits ?? rangeCacheHits),
      ),
      uniqueBytes: geoZarrIo?.uniqueBytes ?? omeZarrNetwork?.uniqueBytes ?? rangeStats.uniqueBytes,
      openDatasets: source.datasets.size,
      ...(omeZarrNetwork === undefined ? {} : { omeZarrNetwork }),
      ...(source.omeZarrIdentity === undefined ? {} : { omeZarrIdentity: source.omeZarrIdentity }),
      ...(geoZarrStructure === undefined
        ? {}
        : { geoZarrStructure: geoZarrStructuralDiagnostics(geoZarrStructure) }),
    }
  }

  #sourceById(sourceId: SourceId, generation: number): SourceRecord {
    const source = this.#sources.get(sourceId)
    if (source === undefined || source.closed || source.generation !== generation) {
      throw this.#stale('source')
    }
    return source
  }

  #sourceForDocument(
    documentId: DocumentId,
    generation: number,
    sourceId: SourceId | undefined,
  ): SourceRecord {
    if (sourceId !== undefined) {
      const source = this.#sourceById(sourceId, generation)
      if (source.documentId !== documentId) throw this.#stale('document')
      return source
    }
    for (const source of this.#sources.values()) {
      if (source.documentId !== documentId || source.closed) continue
      if (source.generation !== generation) throw this.#stale('source generation')
      return source
    }
    throw this.#stale('document')
  }

  #datasetByHandle(
    handleId: DatasetHandleId,
    generation: number,
  ): { source: SourceRecord; record: DatasetRecord } {
    const binding = this.#datasets.get(handleId)
    if (binding === undefined) throw this.#stale('dataset handle')
    const source = this.#sources.get(binding.sourceId)
    if (source === undefined || source.closed) throw this.#stale('dataset handle')
    if (source.generation !== generation) throw this.#stale('source generation')
    if (binding.record.closed) throw this.#stale('dataset handle')
    return { source, record: binding.record }
  }

  #openFailure(error: unknown): StructuredRpcError {
    return structuredError(error, 'SOURCE_OPEN_FAILED')
  }

  async #enrichTiffOpenFailure(
    error: unknown,
    source: ImageSource,
    name: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!looksLikeTiffName(name)) return error
    const inspected = await tryInspectTiffSource(source, signal)
    return (
      classifyTiffOpenFailure(error, inspected.inspection) ??
      (inspected.error === undefined
        ? error
        : (classifyTiffOpenFailure(inspected.error, undefined) ?? error))
    )
  }

  #stale(label: string): StructuredRpcError & Error {
    return Object.assign(new Error(`Unknown or stale ${label}`), {
      code: 'STALE_ID' as const,
      retryable: false,
    })
  }

  async #releaseDataset(source: SourceRecord, record: DatasetRecord): Promise<void> {
    if (record.closed) return
    record.closed = true
    for (const [key, cached] of this.#displayStatistics) {
      if (cached.datasetHandleId === record.handleId) this.#displayStatistics.delete(key)
    }
    for (const pending of this.#pending.values()) {
      if (
        pending.datasetHandleId === record.handleId ||
        pending.datasetHandleIds?.includes(record.handleId) === true
      ) {
        pending.controller.abort(abortError('Dataset closed'))
      }
    }
    for (const result of [...record.results.values()]) await this.#releaseAnalysis(record, result)
    await record.disposeExtensions()
    await record.runtime.dispose()
    this.#releases.runtimes += 1
    this.#releases.datasets += 1
    source.datasets.delete(record.handleId)
    this.#datasets.delete(record.handleId)
  }

  async #releaseSource(record: SourceRecord): Promise<void> {
    if (record.closed) return
    record.closed = true
    record.lifetime.abort(abortError('Source closed'))
    for (const pending of this.#pending.values()) {
      if (pending.sourceId === record.id) pending.controller.abort(abortError('Source closed'))
    }
    for (const dataset of [...record.datasets.values()]) await this.#releaseDataset(record, dataset)
    await record.document.value.close?.()
    record.omeZarrHttpStore?.close()
    record.directoryDisposer?.()
    this.#sources.delete(record.id)
    this.#releases.documents += 1
  }

  async #releaseAllSources(): Promise<void> {
    for (const source of [...this.#sources.values()]) await this.#releaseSource(source)
  }

  #rangeCacheBudgetForNewSource(): number {
    const remaining = this.#remainingRangeCacheBytes()
    if (remaining < MINIMUM_RANGE_CACHE_BYTES) {
      throw this.#limitError('Range-cache budget is exhausted.')
    }
    return Math.min(PREFERRED_RANGE_CACHE_BYTES, remaining)
  }

  #remainingRangeCacheBytes(): number {
    let used = 0
    for (const source of this.#sources.values()) {
      for (const range of source.rangeSources) used += range.stats.cacheBytes
      used += source.omeZarrNetwork?.().sourceCacheBytes ?? 0
    }
    return Math.max(0, this.#limits.maxRangeCacheBytes - used)
  }

  #remainingTileRuntimeBytes(): number {
    let used = 0
    for (const binding of this.#datasets.values()) {
      used += binding.record.runtime.metrics().memory.totalManagedBytes
    }
    return Math.max(0, this.#limits.maxTileRuntimeBytes - used)
  }

  #isBudgetedKind(kind: WorkerRequest['kind']): boolean {
    return (
      kind === 'source.open-sample' ||
      kind === 'source.open-local' ||
      kind === 'source.open-bundled' ||
      kind === 'source.open-remote' ||
      kind === 'source.open-geozarr-remote' ||
      kind === 'source.open-geozarr-bundled' ||
      kind === 'source.open-ome-zarr-remote' ||
      kind === 'source.open-ome-zarr-directory' ||
      kind === 'source.open-ome-zarr-zip' ||
      kind === 'dataset.open' ||
      kind === 'tile.request' ||
      kind === 'display.tile.request' ||
      kind === 'display.statistics.request' ||
      kind === 'raster.sample_point' ||
      kind === 'geo.analysis.dry_run' ||
      kind === 'geo.analysis.tile' ||
      kind === 'geo.analysis.region_statistics' ||
      kind === 'geo.analysis.line_profile' ||
      kind === 'analysis.dry-run' ||
      kind === 'analysis.execute' ||
      kind === 'analysis.overlay-tile' ||
      kind === 'analysis.dataset-tile'
    )
  }

  #touch(source: SourceRecord): void {
    source.lastUsedAt = this.#now()
  }

  #now(): number {
    return performance.now()
  }

  #limitError(message: string): StructuredRpcError & Error {
    return Object.assign(new Error(message), {
      code: 'LIMIT_EXCEEDED' as const,
      retryable: false,
    })
  }

  #id(prefix: string): string {
    const id = `${prefix}-${this.#nextId}`
    this.#nextId += 1
    return id
  }
}
