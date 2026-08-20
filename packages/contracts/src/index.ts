/** Worker RPC envelope version. Multi-source handles and diagnostics require v2. */
export const RPC_SCHEMA_VERSION = 2 as const
export const RPC_LIMITS = Object.freeze({
  maxMessageBytes: 2 * 1_024 * 1_024,
  maxStringLength: 4_096,
  maxItems: 256,
  maxMetadataDepth: 8,
  maxBundledSourceBytes: 8_000_000,
  maxTilePixels: 512 * 512,
  maxTablePageRows: 200,
  maxTablePageColumns: 32,
})

/** Default imaging-Worker resource budgets. Visible sources are never LRU-evicted. */
export const IMAGING_RESOURCE_LIMITS = Object.freeze({
  maxOpenSources: 8,
  maxDatasetsPerSource: 8,
  maxRangeCacheBytes: 32 * 1_024 * 1_024,
  maxTileRuntimeBytes: 192 * 1_024 * 1_024,
  maxInFlightRequests: 32,
})

export type SourceId = string & { readonly __sourceId: unique symbol }
export type DocumentId = string & { readonly __documentId: unique symbol }
export type DatasetHandleId = string & { readonly __datasetHandleId: unique symbol }

import type {
  AnalysisCatalog,
  AnalysisDatasetRequest,
  AnalysisDatasetTileRequest,
  AnalysisDryRunResponse,
  AnalysisExecutionResponse,
  AnalysisGraphRequest,
  AnalysisNormalizeRequest,
  AnalysisNormalizeRoiRequest,
  AnalysisOverlayTile,
  AnalysisOverlayTileRequest,
  AnalysisParameterNormalization,
  AnalysisReleaseRequest,
  AnalysisResultHandleId,
  AnalysisRoiNormalization,
  AnalysisSeriesExport,
  AnalysisSeriesExportRequest,
  AnalysisTablePage,
  AnalysisTablePageRequest,
} from './analysis.js'
import type {
  DerivedDisplayTile,
  DerivedDisplayTileRequest,
  DerivedRasterDryRunReport,
  DerivedRasterDryRunRequest,
  DerivedRasterLineProfileRequest,
  DerivedRasterLineProfileResponse,
  DerivedRasterRecipeV1,
  DerivedRasterReleaseRequest,
  DerivedRasterStatisticsRequest,
  DerivedRasterStatisticsResponse,
} from './geo-analysis.js'
import type { SpatialReference } from './spatial-reference.js'

export * from './analysis.js'
export * from './geo-analysis.js'
export * from './spatial-reference.js'

export type SourceKind = 'bundled' | 'local' | 'remote' | 'sample'
export type TilePriority = 'visible' | 'near-visible' | 'background'
export type DisplayStretch = 'minmax' | 'percentile'

export type DisplayBandMapping = Readonly<{
  gray?: number
  red?: number
  green?: number
  blue?: number
}>

export type DisplayMapping = Readonly<{
  mode: 'linear'
  range: 'auto' | 'manual'
  minimum?: number
  maximum?: number
  stretch?: DisplayStretch
  percentileLow?: number
  percentileHigh?: number
  gamma?: number
  nodata?: number
  nodataTransparent?: boolean
  bands?: DisplayBandMapping
  channelRanges?: Readonly<Record<string, Readonly<{ minimum: number; maximum: number }>>>
  componentTransforms?: Readonly<Record<string, Readonly<{ scale: number; offset: number }>>>
}>

/** JSON-safe PureJsImage `inspectCog` report attached to opened TIFF/COG sources. */
export const COG_INSPECTION_METADATA_KEY = 'purejsimage:cog'

export type CogInspectionSeverity = 'warning' | 'error'

export type CogInspectionIssueCode =
  | 'STRIPED_IMAGE'
  | 'MISSING_INTERNAL_OVERVIEWS'
  | 'MULTIPLE_TOP_LEVEL_IMAGES'
  | 'OVERVIEW_NOT_REDUCED'
  | 'IFD_AFTER_IMAGE_DATA'
  | 'MISSING_TILE_TABLE'
  | 'INVALID_TILE_TABLE'
  | 'NON_MONOTONIC_TILE_OFFSETS'
  | 'UNSUPPORTED_COMPRESSION'

export interface CogInspectionIssue {
  readonly code: CogInspectionIssueCode
  readonly severity: CogInspectionSeverity
  readonly message: string
  readonly directoryOffset?: number
}

export interface CogCompressionInspection {
  readonly id: number
  readonly name: string
  readonly status: string
}

export interface CogDirectoryInspection {
  readonly index: number
  readonly path: string
  readonly role: 'image' | 'overview'
  readonly offset: number
  readonly width: number
  readonly height: number
  readonly subIfdOffsets: readonly number[]
  readonly tiled: boolean
  readonly tileWidth?: number
  readonly tileHeight?: number
  readonly tileCount: number
  readonly firstTileOffset?: number
  readonly lastTileOffset?: number
  readonly compression: CogCompressionInspection
  readonly samplesPerPixel: number
  readonly bitsPerSample: readonly number[]
  readonly sampleFormats: readonly number[]
  readonly planar: boolean
}

export interface CogInspectionReport {
  readonly container: 'TIFF' | 'BigTIFF'
  readonly byteOrder: 'little-endian' | 'big-endian'
  readonly topLevelDirectoryCount: number
  readonly directories: readonly CogDirectoryInspection[]
  readonly issues: readonly CogInspectionIssue[]
  readonly likelyCog: boolean
}

export interface AxisIndex {
  readonly axisId: string
  readonly index: number
}

export interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface AxisCalibrationEvidence {
  readonly kind: string
  readonly resourceId: string
  readonly locator: string
  readonly formula?: string
  readonly note?: string
}

export interface AxisDescriptor {
  readonly id: string
  readonly name?: string
  readonly kind: string
  readonly length: number
  readonly unit?: string
  readonly coordinates:
    | Readonly<{ type: 'index' }>
    | Readonly<{ type: 'linear'; origin: number; step: number }>
    | Readonly<{ type: 'lookup'; values: readonly number[] }>
    | Readonly<{ type: 'labels'; values: readonly string[] }>
  readonly calibration?: AxisCalibrationEvidence | readonly AxisCalibrationEvidence[]
}

export interface ComponentDescriptor {
  readonly id: string
  readonly name?: string
  readonly kind: string
  readonly unit?: string
  readonly color?: number
}

export interface ResolutionLevelDescriptor {
  readonly level: number
  readonly axisLengths: readonly Readonly<{ axisId: string; length: number }>[]
  readonly spatialReference?: SpatialReference
}

export interface DatasetDescriptor {
  readonly id: string
  readonly identity: Readonly<Record<string, unknown>>
  readonly name?: string
  readonly sampleType: string
  readonly axes: readonly AxisDescriptor[]
  readonly components: readonly ComponentDescriptor[]
  readonly levels: readonly ResolutionLevelDescriptor[]
  readonly capabilities: Readonly<{
    regionReads: boolean
    resolutionLevels: boolean
    planeReads:
      | Readonly<{ kind: 'none' }>
      | Readonly<{ kind: 'any-axis-pair' }>
      | Readonly<{
          kind: 'ordered-axis-pairs'
          pairs: readonly (readonly [string, string])[]
        }>
    seriesReads?:
      | Readonly<{ kind: 'any-axis' }>
      | Readonly<{ kind: 'axes'; axes: readonly string[] }>
  }>
  readonly spatialReference?: SpatialReference
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface OpenedSourceDescriptor {
  readonly sourceId: SourceId
  readonly documentId: DocumentId
  readonly generation: number
  readonly identity: Readonly<Record<string, unknown>>
  readonly source: Readonly<{
    kind: SourceKind
    name: string
    size: number
    url?: string
  }>
  readonly reader: Readonly<{ id: string; version: string; format: string }>
  readonly metadata: Readonly<Record<string, unknown>>
  readonly datasets: readonly DatasetDescriptor[]
}

export type ImagingResourceLimits = {
  readonly maxOpenSources: number
  readonly maxDatasetsPerSource: number
  readonly maxRangeCacheBytes: number
  readonly maxTileRuntimeBytes: number
  readonly maxInFlightRequests: number
}

export type WorkerInitializePayload = null | Readonly<{
  readonly limits?: Partial<ImagingResourceLimits>
}>

export interface OpenedDatasetDescriptor {
  readonly handleId: DatasetHandleId
  readonly sourceId: SourceId
  readonly generation: number
  readonly dataset: DatasetDescriptor
  readonly selection: PlaneSelection
}

export interface PlaneSelection {
  readonly displayAxes: readonly [string, string]
  readonly fixedIndices: readonly AxisIndex[]
  readonly resolutionLevel: number
}

export interface RenderTileRequest {
  readonly tileId: string
  readonly datasetHandleId: DatasetHandleId
  readonly generation: number
  readonly displayAxes: readonly [string, string]
  readonly fixedIndices: readonly AxisIndex[]
  readonly resolutionLevel: number
  readonly component: number
  readonly mapping: DisplayMapping
  readonly region: Region
  readonly priority: TilePriority
}

export interface RenderTile {
  readonly tileId: string
  readonly datasetHandleId: DatasetHandleId
  readonly generation: number
  readonly region: Region
  readonly component: number
  readonly width: number
  readonly height: number
  readonly rgba: Uint8ClampedArray
  /** Quantitative source values for this bounded tile, never display-mapped values. */
  readonly values: Float32Array
  /**
   * Raw samples for mapped display bands when more than the primary `values` channel is needed.
   * Index 0 matches `values` (gray or red). Additional entries are green/blue in that order.
   */
  readonly bandValues?: readonly Float32Array[]
  readonly range: Readonly<{ minimum: number; maximum: number; automatic: boolean }>
  readonly histogram: readonly number[]
  readonly elapsedMilliseconds: number
}

export const DISPLAY_STATISTICS_ALGORITHM_VERSION = 'atlas-display-statistics-v1' as const

export interface DisplayStatisticsRequest {
  readonly datasetHandleId: DatasetHandleId
  readonly generation: number
  readonly sourceIdentity: string
  readonly sourceRevision: string
  readonly componentIndices: readonly number[]
  readonly displayAxes: readonly [string, string]
  readonly fixedIndices: readonly AxisIndex[]
  readonly resolutionPolicy: Readonly<{
    readonly kind: 'reduced-overview' | 'level'
    readonly level?: number
  }>
  readonly nodataPolicy: Readonly<{ readonly kind: 'exclude' | 'include'; readonly value?: number }>
  readonly sampleBudget: Readonly<{
    readonly maxSamples: number
    readonly maxBytes: number
    readonly maxTiles: number
  }>
  readonly percentilePolicy: Readonly<{ readonly low: number; readonly high: number }>
  readonly scaleOffsetPolicy: Readonly<{
    readonly kind: 'raw' | 'physical'
    readonly components: readonly Readonly<{ readonly scale: number; readonly offset: number }>[]
  }>
}

export interface DisplayStatisticsComponent {
  readonly component: number
  readonly minimum: number
  readonly maximum: number
  readonly percentileLow: number
  readonly percentileHigh: number
  readonly validSamples: number
  readonly excludedSamples: number
}

export interface DisplayStatistics {
  readonly algorithmVersion: typeof DISPLAY_STATISTICS_ALGORITHM_VERSION
  readonly statisticsRevision: string
  readonly cacheKey: string
  readonly cached: boolean
  readonly sourceIdentity: string
  readonly sourceRevision: string
  readonly datasetHandleId: DatasetHandleId
  readonly overview: number
  readonly sampledTiles: number
  readonly sampledValues: number
  readonly sampleCoverage: number
  readonly components: readonly DisplayStatisticsComponent[]
}

export interface DisplayTileRequest extends RenderTileRequest {
  readonly sourceIdentity: string
  readonly sourceRevision: string
  readonly layerId: string
  readonly styleRevision: string
  readonly statisticsRevision: string
}

/** Display-only tile. Native scientific samples remain in the Worker. */
export interface DisplayTile {
  readonly tileId: string
  readonly datasetHandleId: DatasetHandleId
  readonly generation: number
  readonly sourceIdentity: string
  readonly sourceRevision: string
  readonly layerId: string
  readonly styleRevision: string
  readonly statisticsRevision: string
  readonly region: Region
  readonly overview: number
  readonly width: number
  readonly height: number
  readonly rgba: Uint8ClampedArray
  readonly elapsedMilliseconds: number
}

export interface RasterPointSampleRequest {
  readonly datasetHandleId: DatasetHandleId
  readonly generation: number
  readonly sourceIdentity: string
  readonly layerId: string
  readonly displayAxes: readonly [string, string]
  readonly fixedIndices: readonly AxisIndex[]
  readonly pixel: Readonly<{ readonly x: number; readonly y: number }>
  readonly projectMapCoordinate: Readonly<{ readonly x: number; readonly y: number }>
}

export interface RasterPointSample {
  readonly sourceIdentity: string
  readonly datasetHandleId: DatasetHandleId
  readonly layerId: string
  readonly pixel: Readonly<{ readonly x: number; readonly y: number }>
  readonly sourceMapCoordinate: Readonly<{ readonly x: number; readonly y: number }>
  readonly projectMapCoordinate: Readonly<{ readonly x: number; readonly y: number }>
  readonly nodata: boolean
  readonly components: readonly Readonly<{
    readonly index: number
    readonly name: string
    readonly unit?: string
    readonly value: number | null
    readonly nodata: boolean
  }>[]
}

export interface ReaderDescriptor {
  readonly id: string
  readonly version: string
  readonly format: string
  readonly extensions: readonly string[]
  readonly mediaTypes: readonly string[]
}

export interface SourceRangeDiagnostics {
  readonly id: SourceId
  readonly kind: SourceKind
  readonly size: number
  readonly revision: number
  readonly rangeRequests: number
  readonly rangeBytesFetched: number
  readonly rangeCacheBytes: number
  readonly rangeCacheHits: number
  readonly rangeCacheMisses: number
  readonly uniqueBytes?: number
  readonly openDatasets: number
}

export interface WorkerDiagnostics {
  readonly epoch: number
  readonly sources: readonly SourceRangeDiagnostics[]
  readonly aggregate: Readonly<{
    openSources: number
    openDatasets: number
    pendingRequests: number
    rangeCacheBytes: number
    tileRuntimeBytes: number
  }>
  readonly pendingRequests: number
  readonly tileRuntime: null | Readonly<Record<string, unknown>>
  readonly releases: Readonly<{
    documents: number
    datasets: number
    tiles: number
    runtimes: number
  }>
  readonly limits: ImagingResourceLimits
}

export type RpcErrorCode =
  | 'ABORTED'
  | 'CORS_FAILED'
  | 'CORS_OR_RANGE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'INVALID_MESSAGE'
  | 'INVALID_PAYLOAD'
  | 'LIMIT_EXCEEDED'
  | 'MALFORMED_METADATA'
  | 'RANGE_UNSUPPORTED'
  | 'SOURCE_OPEN_FAILED'
  | 'STALE_ID'
  | 'UNSUPPORTED'
  | 'UNSUPPORTED_COMPRESSION'
  | 'UNSUPPORTED_LAYOUT'
  | 'UNKNOWN_KIND'
  | 'WORKER_CRASHED'

export interface StructuredRpcError {
  readonly code: RpcErrorCode
  readonly message: string
  readonly guidance?: string
  readonly details?: Readonly<Record<string, unknown>>
  readonly retryable: boolean
}

export interface LocalFileAttachment {
  readonly id: string
  readonly name: string
  readonly size: number
  readonly type: string
  readonly lastModified: number
  /** Structured-clone attachment. Live scientific objects are never transported. */
  readonly blob: StructuredCloneBlob
}

/** Minimal browser Blob surface kept framework-neutral for structured-clone transport. */
export interface StructuredCloneBlob {
  readonly size: number
  readonly type: string
  arrayBuffer(): Promise<ArrayBuffer>
  slice(start?: number, end?: number, contentType?: string): StructuredCloneBlob
}

export type WorkerRequest =
  | RpcRequest<'worker.initialize', WorkerInitializePayload>
  | RpcRequest<
      'source.open-sample',
      Readonly<{ generation: number; sampleId?: string | undefined }>
    >
  | RpcRequest<
      'source.open-local',
      Readonly<{ generation: number; primaryId: string; files: readonly LocalFileAttachment[] }>
    >
  | RpcRequest<
      'source.open-bundled',
      Readonly<{
        generation: number
        path: string
        name: string
        size: number
        sha256: string
        mediaType: string
      }>
    >
  | RpcRequest<'source.open-remote', Readonly<{ generation: number; url: string }>>
  | RpcRequest<'source.close', Readonly<{ sourceId: SourceId; generation: number }>>
  | RpcRequest<
      'dataset.open',
      Readonly<{
        documentId: DocumentId
        datasetId: string
        generation: number
        sourceId?: SourceId
      }>
    >
  | RpcRequest<'dataset.close', Readonly<{ handleId: DatasetHandleId; generation: number }>>
  | RpcRequest<
      'plane.set',
      Readonly<{ handleId: DatasetHandleId; generation: number; selection: PlaneSelection }>
    >
  | RpcRequest<'tile.request', RenderTileRequest>
  | RpcRequest<'display.tile.request', DisplayTileRequest>
  | RpcRequest<'display.statistics.request', DisplayStatisticsRequest>
  | RpcRequest<
      'display.statistics.invalidate',
      Readonly<{ sourceIdentity?: string; datasetHandleId?: DatasetHandleId }>
    >
  | RpcRequest<'raster.sample_point', RasterPointSampleRequest>
  | RpcRequest<'geo.analysis.dry_run', DerivedRasterDryRunRequest>
  | RpcRequest<'geo.analysis.tile', DerivedDisplayTileRequest>
  | RpcRequest<'geo.analysis.region_statistics', DerivedRasterStatisticsRequest>
  | RpcRequest<'geo.analysis.line_profile', DerivedRasterLineProfileRequest>
  | RpcRequest<'geo.analysis.release', DerivedRasterReleaseRequest>
  | RpcRequest<'analysis.catalog', AnalysisDatasetRequest>
  | RpcRequest<'analysis.normalize-parameters', AnalysisNormalizeRequest>
  | RpcRequest<'analysis.normalize-roi', AnalysisNormalizeRoiRequest>
  | RpcRequest<'analysis.dry-run', AnalysisGraphRequest>
  | RpcRequest<'analysis.execute', AnalysisGraphRequest>
  | RpcRequest<'analysis.overlay-tile', AnalysisOverlayTileRequest>
  | RpcRequest<'analysis.dataset-tile', AnalysisDatasetTileRequest>
  | RpcRequest<'analysis.table-page', AnalysisTablePageRequest>
  | RpcRequest<'analysis.series-export', AnalysisSeriesExportRequest>
  | RpcRequest<'analysis.release', AnalysisReleaseRequest>
  | RpcRequest<'request.cancel', Readonly<{ targetRequestId: string }>>
  | RpcRequest<'diagnostics.get', null | Readonly<{ sourceId?: SourceId }>>
  | RpcRequest<'worker.test-crash', null>

export interface RpcRequest<Kind extends string, Payload> {
  readonly schemaVersion: typeof RPC_SCHEMA_VERSION
  readonly requestId: string
  readonly kind: Kind
  readonly payload: Payload
}

export type WorkerResponse =
  | RpcSuccess<
      'worker.initialize',
      Readonly<{
        readers: readonly ReaderDescriptor[]
        epoch: number
        limits: ImagingResourceLimits
      }>
    >
  | RpcSuccess<'source.opened', OpenedSourceDescriptor>
  | RpcSuccess<
      'source-bundled.opened',
      Readonly<{ source: OpenedSourceDescriptor; dataset: OpenedDatasetDescriptor }>
    >
  | RpcSuccess<'source.closed', Readonly<{ sourceId: SourceId }>>
  | RpcSuccess<'dataset.opened', OpenedDatasetDescriptor>
  | RpcSuccess<'dataset.closed', Readonly<{ handleId: DatasetHandleId }>>
  | RpcSuccess<'plane.selected', Readonly<{ handleId: DatasetHandleId; selection: PlaneSelection }>>
  | RpcSuccess<'tile.ready', RenderTile>
  | RpcSuccess<'display.tile.ready', DisplayTile>
  | RpcSuccess<'display.statistics.ready', DisplayStatistics>
  | RpcSuccess<'display.statistics.invalidated', Readonly<{ removed: number }>>
  | RpcSuccess<'raster.point_sampled', RasterPointSample>
  | RpcSuccess<'geo.analysis.dry_run', DerivedRasterDryRunReport>
  | RpcSuccess<'geo.analysis.tile', DerivedDisplayTile>
  | RpcSuccess<'geo.analysis.region_statistics', DerivedRasterStatisticsResponse>
  | RpcSuccess<'geo.analysis.line_profile', DerivedRasterLineProfileResponse>
  | RpcSuccess<'geo.analysis.released', Readonly<{ layerId: string }>>
  | RpcSuccess<'analysis.catalog', AnalysisCatalog>
  | RpcSuccess<'analysis.parameters-normalized', AnalysisParameterNormalization>
  | RpcSuccess<'analysis.roi-normalized', AnalysisRoiNormalization>
  | RpcSuccess<'analysis.dry-run', AnalysisDryRunResponse>
  | RpcSuccess<'analysis.executed', AnalysisExecutionResponse>
  | RpcSuccess<'analysis.overlay-tile', AnalysisOverlayTile>
  | RpcSuccess<'analysis.dataset-tile', RenderTile>
  | RpcSuccess<'analysis.table-page', AnalysisTablePage>
  | RpcSuccess<'analysis.series-export', AnalysisSeriesExport>
  | RpcSuccess<'analysis.released', Readonly<{ resultHandleId: AnalysisResultHandleId }>>
  | RpcSuccess<'request.cancelled', Readonly<{ targetRequestId: string; found: boolean }>>
  | RpcSuccess<'diagnostics', WorkerDiagnostics>
  | RpcFailure

export interface RpcSuccess<Kind extends string, Payload> {
  readonly schemaVersion: typeof RPC_SCHEMA_VERSION
  readonly requestId: string
  readonly ok: true
  readonly kind: Kind
  readonly payload: Payload
}

export interface RpcFailure {
  readonly schemaVersion: typeof RPC_SCHEMA_VERSION
  readonly requestId: string
  readonly ok: false
  readonly kind: 'error'
  readonly error: StructuredRpcError
}

const REQUEST_KINDS = new Set<string>([
  'worker.initialize',
  'source.open-sample',
  'source.open-local',
  'source.open-bundled',
  'source.open-remote',
  'source.close',
  'dataset.open',
  'dataset.close',
  'plane.set',
  'tile.request',
  'display.tile.request',
  'display.statistics.request',
  'display.statistics.invalidate',
  'raster.sample_point',
  'geo.analysis.dry_run',
  'geo.analysis.tile',
  'geo.analysis.region_statistics',
  'geo.analysis.line_profile',
  'geo.analysis.release',
  'analysis.catalog',
  'analysis.normalize-parameters',
  'analysis.normalize-roi',
  'analysis.dry-run',
  'analysis.execute',
  'analysis.overlay-tile',
  'analysis.dataset-tile',
  'analysis.table-page',
  'analysis.series-export',
  'analysis.release',
  'request.cancel',
  'diagnostics.get',
  'worker.test-crash',
])

interface Candidate {
  readonly schemaVersion?: unknown
  readonly requestId?: unknown
  readonly kind?: unknown
  readonly payload?: unknown
}

interface PayloadCandidate extends Record<string, unknown> {
  readonly generation?: unknown
  readonly axisId?: unknown
  readonly index?: unknown
  readonly displayAxes?: unknown
  readonly fixedIndices?: unknown
  readonly resolutionLevel?: unknown
  readonly tileId?: unknown
  readonly datasetHandleId?: unknown
  readonly component?: unknown
  readonly mapping?: unknown
  readonly region?: unknown
  readonly priority?: unknown
  readonly url?: unknown
  readonly primaryId?: unknown
  readonly files?: unknown
  readonly id?: unknown
  readonly name?: unknown
  readonly size?: unknown
  readonly type?: unknown
  readonly lastModified?: unknown
  readonly blob?: unknown
  readonly sourceId?: unknown
  readonly documentId?: unknown
  readonly datasetId?: unknown
  readonly handleId?: unknown
  readonly selection?: unknown
  readonly targetRequestId?: unknown
  readonly mode?: unknown
  readonly range?: unknown
  readonly minimum?: unknown
  readonly maximum?: unknown
  readonly stretch?: unknown
  readonly percentileLow?: unknown
  readonly percentileHigh?: unknown
  readonly gamma?: unknown
  readonly nodata?: unknown
  readonly nodataTransparent?: unknown
  readonly bands?: unknown
  readonly gray?: unknown
  readonly red?: unknown
  readonly green?: unknown
  readonly blue?: unknown
  readonly x?: unknown
  readonly y?: unknown
  readonly width?: unknown
  readonly height?: unknown
  readonly graph?: unknown
  readonly roi?: unknown
  readonly operation?: unknown
  readonly parameters?: unknown
  readonly resultHandleId?: unknown
  readonly output?: unknown
  readonly offset?: unknown
  readonly limit?: unknown
  readonly columns?: unknown
  readonly filter?: unknown
  readonly sort?: unknown
  readonly column?: unknown
  readonly direction?: unknown
  readonly version?: unknown
}

export class RpcValidationError extends Error {
  readonly code: 'INVALID_MESSAGE' | 'INVALID_PAYLOAD' | 'LIMIT_EXCEEDED' | 'UNKNOWN_KIND'

  constructor(code: RpcValidationError['code'], message: string) {
    super(message)
    this.name = 'RpcValidationError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStructuredCloneBlob(value: unknown): value is StructuredCloneBlob {
  if (!isRecord(value)) return false
  const candidate = value as {
    readonly arrayBuffer?: unknown
    readonly size?: unknown
    readonly slice?: unknown
  }
  return (
    typeof candidate.arrayBuffer === 'function' &&
    typeof candidate.slice === 'function' &&
    typeof candidate.size === 'number'
  )
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} must be a non-empty string`)
  }
  if (value.length > RPC_LIMITS.maxStringLength) {
    throw new RpcValidationError('LIMIT_EXCEEDED', `${label} exceeds the string limit`)
  }
}

function assertInteger(value: unknown, label: string, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} must be an integer >= ${minimum}`)
  }
}

function assertFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} must be finite`)
  }
}

function assertBasePayload(payload: unknown): asserts payload is PayloadCandidate {
  if (!isRecord(payload))
    throw new RpcValidationError('INVALID_PAYLOAD', 'payload must be an object')
}

function assertGeneration(payload: PayloadCandidate): void {
  assertInteger(payload.generation, 'generation')
}

function assertPositiveLimit(value: unknown, label: string): void {
  assertInteger(value, label, 1)
}

function assertInitializePayload(payload: unknown): void {
  if (payload === null) return
  if (!isRecord(payload))
    throw new RpcValidationError('INVALID_PAYLOAD', 'initialize payload must be null or an object')
  const extra = Object.keys(payload).filter((key) => key !== 'limits')
  if (extra.length > 0)
    throw new RpcValidationError('INVALID_PAYLOAD', 'initialize payload has unknown fields')
  if (payload['limits'] === undefined) return
  if (!isRecord(payload['limits']))
    throw new RpcValidationError('INVALID_PAYLOAD', 'initialize limits must be an object')
  const limits = payload['limits']
  const allowed = new Set([
    'maxOpenSources',
    'maxDatasetsPerSource',
    'maxRangeCacheBytes',
    'maxTileRuntimeBytes',
    'maxInFlightRequests',
  ])
  for (const [key, value] of Object.entries(limits)) {
    if (!allowed.has(key))
      throw new RpcValidationError('INVALID_PAYLOAD', `unknown resource limit '${key}'`)
    assertPositiveLimit(value, key)
  }
}

function assertDiagnosticsPayload(payload: unknown): void {
  if (payload === null) return
  if (!isRecord(payload))
    throw new RpcValidationError('INVALID_PAYLOAD', 'diagnostics payload must be null or an object')
  const extra = Object.keys(payload).filter((key) => key !== 'sourceId')
  if (extra.length > 0)
    throw new RpcValidationError('INVALID_PAYLOAD', 'diagnostics payload has unknown fields')
  if (payload['sourceId'] !== undefined) assertString(payload['sourceId'], 'sourceId')
}

function assertAxisIndices(value: unknown): void {
  if (!Array.isArray(value) || value.length > RPC_LIMITS.maxItems) {
    throw new RpcValidationError('LIMIT_EXCEEDED', 'fixedIndices exceeds the item limit')
  }
  for (const item of value) {
    if (!isRecord(item))
      throw new RpcValidationError('INVALID_PAYLOAD', 'axis index must be an object')
    const candidate = item as PayloadCandidate
    assertString(candidate.axisId, 'axisId')
    assertInteger(candidate.index, 'axis index')
  }
}

function assertPlaneSelection(value: unknown): void {
  if (!isRecord(value))
    throw new RpcValidationError('INVALID_PAYLOAD', 'selection must be an object')
  const candidate = value as PayloadCandidate
  if (!Array.isArray(candidate.displayAxes) || candidate.displayAxes.length !== 2) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'displayAxes must contain exactly two axes')
  }
  assertString(candidate.displayAxes[0], 'horizontal axis')
  assertString(candidate.displayAxes[1], 'vertical axis')
  assertAxisIndices(candidate.fixedIndices)
  assertInteger(candidate.resolutionLevel, 'resolutionLevel')
}

function assertTile(payload: PayloadCandidate): void {
  assertGeneration(payload)
  assertString(payload.tileId, 'tileId')
  assertString(payload.datasetHandleId, 'datasetHandleId')
  assertPlaneSelection(payload)
  assertInteger(payload.component, 'component')
  if (!isRecord(payload.mapping)) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'display mapping is required')
  }
  const mapping = payload.mapping as PayloadCandidate
  if (mapping.mode !== 'linear') {
    throw new RpcValidationError('INVALID_PAYLOAD', 'only linear display mapping is supported')
  }
  if (mapping.range !== 'auto' && mapping.range !== 'manual') {
    throw new RpcValidationError('INVALID_PAYLOAD', 'mapping range must be auto or manual')
  }
  if (mapping.range === 'manual' && mapping['channelRanges'] === undefined) {
    assertFinite(mapping.minimum, 'mapping minimum')
    assertFinite(mapping.maximum, 'mapping maximum')
    if (mapping.maximum <= mapping.minimum) {
      throw new RpcValidationError('INVALID_PAYLOAD', 'mapping maximum must exceed its minimum')
    }
  }
  if (
    mapping.stretch !== undefined &&
    mapping.stretch !== 'minmax' &&
    mapping.stretch !== 'percentile'
  ) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'mapping stretch must be minmax or percentile')
  }
  if (mapping.percentileLow !== undefined) {
    assertFinite(mapping.percentileLow, 'mapping percentileLow')
    if (mapping.percentileLow < 0 || mapping.percentileLow > 100) {
      throw new RpcValidationError(
        'INVALID_PAYLOAD',
        'mapping percentileLow must be between 0 and 100',
      )
    }
  }
  if (mapping.percentileHigh !== undefined) {
    assertFinite(mapping.percentileHigh, 'mapping percentileHigh')
    if (mapping.percentileHigh < 0 || mapping.percentileHigh > 100) {
      throw new RpcValidationError(
        'INVALID_PAYLOAD',
        'mapping percentileHigh must be between 0 and 100',
      )
    }
  }
  if (
    mapping.percentileLow !== undefined &&
    mapping.percentileHigh !== undefined &&
    mapping.percentileHigh <= mapping.percentileLow
  ) {
    throw new RpcValidationError(
      'INVALID_PAYLOAD',
      'mapping percentileHigh must exceed percentileLow',
    )
  }
  if (mapping.gamma !== undefined) {
    assertFinite(mapping.gamma, 'mapping gamma')
    if (mapping.gamma <= 0) {
      throw new RpcValidationError('INVALID_PAYLOAD', 'mapping gamma must be positive')
    }
  }
  if (mapping.nodata !== undefined) assertFinite(mapping.nodata, 'mapping nodata')
  if (mapping.nodataTransparent !== undefined && typeof mapping.nodataTransparent !== 'boolean') {
    throw new RpcValidationError('INVALID_PAYLOAD', 'mapping nodataTransparent must be a boolean')
  }
  if (mapping.bands !== undefined) {
    if (!isRecord(mapping.bands)) {
      throw new RpcValidationError('INVALID_PAYLOAD', 'mapping bands must be an object')
    }
    const bands = mapping.bands as PayloadCandidate
    const gray = bands.gray
    const red = bands.red
    const green = bands.green
    const blue = bands.blue
    if (gray !== undefined) assertInteger(gray, 'mapping gray band')
    if (red !== undefined) assertInteger(red, 'mapping red band')
    if (green !== undefined) assertInteger(green, 'mapping green band')
    if (blue !== undefined) assertInteger(blue, 'mapping blue band')
    const hasGray = gray !== undefined
    const hasRgb = red !== undefined || green !== undefined || blue !== undefined
    if (hasGray && hasRgb) {
      throw new RpcValidationError('INVALID_PAYLOAD', 'mapping bands cannot mix gray and RGB')
    }
    if (!hasGray && !hasRgb) {
      throw new RpcValidationError('INVALID_PAYLOAD', 'mapping bands require gray or RGB channels')
    }
  }
  if (mapping['channelRanges'] !== undefined) {
    if (!isRecord(mapping['channelRanges'])) {
      throw new RpcValidationError('INVALID_PAYLOAD', 'mapping channelRanges must be an object')
    }
    if (Object.keys(mapping['channelRanges']).length === 0) {
      throw new RpcValidationError('INVALID_PAYLOAD', 'mapping channelRanges must not be empty')
    }
    for (const [channel, value] of Object.entries(mapping['channelRanges'])) {
      if (!isRecord(value)) {
        throw new RpcValidationError(
          'INVALID_PAYLOAD',
          `mapping range ${channel} must be an object`,
        )
      }
      assertFinite(value['minimum'], `mapping range ${channel} minimum`)
      assertFinite(value['maximum'], `mapping range ${channel} maximum`)
      if (Number(value['maximum']) <= Number(value['minimum'])) {
        throw new RpcValidationError(
          'INVALID_PAYLOAD',
          `mapping range ${channel} maximum must exceed minimum`,
        )
      }
    }
  }
  if (mapping['componentTransforms'] !== undefined) {
    if (!isRecord(mapping['componentTransforms'])) {
      throw new RpcValidationError(
        'INVALID_PAYLOAD',
        'mapping componentTransforms must be an object',
      )
    }
    for (const [channel, value] of Object.entries(mapping['componentTransforms'])) {
      if (!isRecord(value)) {
        throw new RpcValidationError(
          'INVALID_PAYLOAD',
          `mapping transform ${channel} must be an object`,
        )
      }
      assertFinite(value['scale'], `mapping transform ${channel} scale`)
      assertFinite(value['offset'], `mapping transform ${channel} offset`)
    }
  }
  if (!isRecord(payload.region))
    throw new RpcValidationError('INVALID_PAYLOAD', 'region is required')
  const region = payload.region as PayloadCandidate
  assertInteger(region.x, 'region x')
  assertInteger(region.y, 'region y')
  assertInteger(region.width, 'region width', 1)
  assertInteger(region.height, 'region height', 1)
  if (region.width * region.height > RPC_LIMITS.maxTilePixels) {
    throw new RpcValidationError('LIMIT_EXCEEDED', 'tile exceeds the pixel limit')
  }
  if (!['visible', 'near-visible', 'background'].includes(String(payload.priority))) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'tile priority is invalid')
  }
}

function assertDisplayStatistics(payload: PayloadCandidate): void {
  assertGeneration(payload)
  assertString(payload.datasetHandleId, 'datasetHandleId')
  assertString(payload['sourceIdentity'], 'sourceIdentity')
  assertString(payload['sourceRevision'], 'sourceRevision')
  assertPlaneSelection({ ...payload, resolutionLevel: 0 })
  const componentIndices = payload['componentIndices']
  if (!Array.isArray(componentIndices) || componentIndices.length === 0) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'componentIndices must not be empty')
  }
  if (componentIndices.length > 8) {
    throw new RpcValidationError('LIMIT_EXCEEDED', 'too many display statistics components')
  }
  for (const component of componentIndices) assertInteger(component, 'component index')
  const resolutionPolicy = payload['resolutionPolicy']
  if (!isRecord(resolutionPolicy)) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'resolutionPolicy must be an object')
  }
  if (resolutionPolicy['kind'] !== 'reduced-overview' && resolutionPolicy['kind'] !== 'level') {
    throw new RpcValidationError('INVALID_PAYLOAD', 'resolution policy is invalid')
  }
  if (resolutionPolicy['level'] !== undefined)
    assertInteger(resolutionPolicy['level'], 'statistics resolution level')
  const nodataPolicy = payload['nodataPolicy']
  if (!isRecord(nodataPolicy)) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'nodataPolicy must be an object')
  }
  if (nodataPolicy['kind'] !== 'exclude' && nodataPolicy['kind'] !== 'include') {
    throw new RpcValidationError('INVALID_PAYLOAD', 'nodata policy is invalid')
  }
  if (nodataPolicy['value'] !== undefined) assertFinite(nodataPolicy['value'], 'nodata value')
  const sampleBudget = payload['sampleBudget']
  if (!isRecord(sampleBudget)) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'sampleBudget must be an object')
  }
  assertInteger(sampleBudget['maxSamples'], 'maxSamples', 1)
  assertInteger(sampleBudget['maxBytes'], 'maxBytes', 4)
  assertInteger(sampleBudget['maxTiles'], 'maxTiles', 1)
  if (Number(sampleBudget['maxSamples']) > 262_144) {
    throw new RpcValidationError('LIMIT_EXCEEDED', 'statistics sample budget is too large')
  }
  const percentilePolicy = payload['percentilePolicy']
  if (!isRecord(percentilePolicy)) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'percentilePolicy must be an object')
  }
  assertFinite(percentilePolicy['low'], 'percentile low')
  assertFinite(percentilePolicy['high'], 'percentile high')
  const low = Number(percentilePolicy['low'])
  const high = Number(percentilePolicy['high'])
  if (low < 0 || high > 100 || high <= low) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'statistics percentiles are invalid')
  }
  const scaleOffsetPolicy = payload['scaleOffsetPolicy']
  if (!isRecord(scaleOffsetPolicy)) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'scaleOffsetPolicy must be an object')
  }
  if (scaleOffsetPolicy['kind'] !== 'raw' && scaleOffsetPolicy['kind'] !== 'physical') {
    throw new RpcValidationError('INVALID_PAYLOAD', 'scale/offset policy is invalid')
  }
  const transforms = scaleOffsetPolicy['components']
  if (!Array.isArray(transforms) || transforms.length !== componentIndices.length) {
    throw new RpcValidationError(
      'INVALID_PAYLOAD',
      'scale/offset components must match componentIndices',
    )
  }
  for (const transform of transforms) {
    if (!isRecord(transform)) {
      throw new RpcValidationError('INVALID_PAYLOAD', 'scale/offset component must be an object')
    }
    assertFinite(transform['scale'], 'component scale')
    assertFinite(transform['offset'], 'component offset')
  }
}

function assertRasterPointSample(payload: PayloadCandidate): void {
  assertGeneration(payload)
  assertString(payload.datasetHandleId, 'datasetHandleId')
  assertString(payload['sourceIdentity'], 'sourceIdentity')
  assertString(payload['layerId'], 'layerId')
  assertPlaneSelection({ ...payload, resolutionLevel: 0 })
  for (const [label, point] of [
    ['pixel', payload['pixel']],
    ['projectMapCoordinate', payload['projectMapCoordinate']],
  ] as const) {
    if (!isRecord(point)) {
      throw new RpcValidationError('INVALID_PAYLOAD', `${label} must be an object`)
    }
    assertFinite(point['x'], `${label} x`)
    assertFinite(point['y'], `${label} y`)
  }
}

function assertJsonValue(value: unknown, label: string, depth = 0): void {
  if (depth > RPC_LIMITS.maxMetadataDepth) {
    throw new RpcValidationError('LIMIT_EXCEEDED', `${label} exceeds the nesting limit`)
  }
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    assertFinite(value, label)
    return
  }
  if (typeof value === 'string') {
    if (value.length > RPC_LIMITS.maxStringLength) {
      throw new RpcValidationError('LIMIT_EXCEEDED', `${label} exceeds the string limit`)
    }
    return
  }
  if (Array.isArray(value)) {
    if (value.length > RPC_LIMITS.maxItems) {
      throw new RpcValidationError('LIMIT_EXCEEDED', `${label} exceeds the item limit`)
    }
    for (const item of value) assertJsonValue(item, label, depth + 1)
    return
  }
  if (!isRecord(value)) {
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} must be JSON-safe`)
  }
  const entries = Object.entries(value)
  if (entries.length > RPC_LIMITS.maxItems) {
    throw new RpcValidationError('LIMIT_EXCEEDED', `${label} exceeds the item limit`)
  }
  for (const [key, item] of entries) {
    if (key.length > RPC_LIMITS.maxStringLength) {
      throw new RpcValidationError('LIMIT_EXCEEDED', `${label} contains an oversized key`)
    }
    assertJsonValue(item, label, depth + 1)
  }
}

function assertAnalysisDataset(payload: PayloadCandidate): void {
  assertGeneration(payload)
  assertString(payload.datasetHandleId, 'datasetHandleId')
}

function assertAnalysisOperation(value: unknown): void {
  if (!isRecord(value)) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'operation must be an object')
  }
  const operation = value as PayloadCandidate
  assertString(operation.id, 'operation id')
  assertInteger(operation.version, 'operation version', 1)
}

function assertAnalysisResult(payload: PayloadCandidate): void {
  assertAnalysisDataset(payload)
  assertString(payload.resultHandleId, 'resultHandleId')
}

function assertAnalysisTablePage(payload: PayloadCandidate): void {
  assertAnalysisResult(payload)
  assertString(payload.output, 'output')
  assertInteger(payload.offset, 'offset')
  assertInteger(payload.limit, 'limit', 1)
  if ((payload.limit as number) > RPC_LIMITS.maxTablePageRows) {
    throw new RpcValidationError('LIMIT_EXCEEDED', 'table page exceeds the row limit')
  }
  if (payload.columns !== undefined) {
    if (
      !Array.isArray(payload.columns) ||
      payload.columns.length > RPC_LIMITS.maxTablePageColumns
    ) {
      throw new RpcValidationError('LIMIT_EXCEEDED', 'table page exceeds the column limit')
    }
    for (const column of payload.columns) assertString(column, 'column')
  }
  if (payload.filter !== undefined) {
    if (!isRecord(payload.filter)) {
      throw new RpcValidationError('INVALID_PAYLOAD', 'filter must be an object')
    }
    const filter = payload.filter as PayloadCandidate
    assertString(filter.column, 'filter column')
    if (filter.minimum !== undefined) assertFinite(filter.minimum, 'filter minimum')
    if (filter.maximum !== undefined) assertFinite(filter.maximum, 'filter maximum')
    if (filter.minimum === undefined && filter.maximum === undefined) {
      throw new RpcValidationError('INVALID_PAYLOAD', 'filter requires a minimum or maximum')
    }
  }
  if (payload.sort !== undefined) {
    if (!isRecord(payload.sort)) {
      throw new RpcValidationError('INVALID_PAYLOAD', 'sort must be an object')
    }
    const sort = payload.sort as PayloadCandidate
    assertString(sort.column, 'sort column')
    if (sort.direction !== 'ascending' && sort.direction !== 'descending') {
      throw new RpcValidationError('INVALID_PAYLOAD', 'sort direction is invalid')
    }
  }
}

function assertAnalysisCalibration(value: unknown): void {
  if (!isRecord(value))
    throw new RpcValidationError('INVALID_PAYLOAD', 'calibration must be an object')
  const candidate = value as PayloadCandidate
  if (!Array.isArray(candidate['axisIds']) || candidate['axisIds'].length !== 2)
    throw new RpcValidationError('INVALID_PAYLOAD', 'calibration needs two axis IDs')
  candidate['axisIds'].forEach((axisId) => {
    assertString(axisId, 'calibration axis ID')
  })
  if (!Array.isArray(candidate['unitsPerPixel']) || candidate['unitsPerPixel'].length !== 2)
    throw new RpcValidationError('INVALID_PAYLOAD', 'calibration needs two axis spacings')
  candidate['unitsPerPixel'].forEach((spacing) => {
    if (typeof spacing !== 'number' || !Number.isFinite(spacing) || spacing <= 0)
      throw new RpcValidationError('INVALID_PAYLOAD', 'calibration spacing must be positive')
  })
  assertString(candidate['unit'], 'calibration unit')
}

function assertRasterNoData(value: unknown, label: string): void {
  if (!isRecord(value))
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} must be an object`)
  if (value['kind'] === 'none' || value['kind'] === 'nan') return
  if (value['kind'] !== 'value')
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} kind is invalid`)
  assertFinite(value['value'], `${label} value`)
}

function assertRasterGrid(value: unknown, label: string): void {
  if (!isRecord(value))
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} must be an object`)
  if (value['schemaVersion'] !== 1)
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} schema version is invalid`)
  assertString(value['crs'], `${label} CRS`)
  assertInteger(value['width'], `${label} width`, 1)
  assertInteger(value['height'], `${label} height`, 1)
  if (!Array.isArray(value['affine']) || value['affine'].length !== 6)
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} affine must contain six values`)
  for (const entry of value['affine']) assertFinite(entry, `${label} affine value`)
  const affine = value['affine'] as readonly number[]
  if ((affine[0] ?? 0) * (affine[4] ?? 0) - (affine[1] ?? 0) * (affine[3] ?? 0) === 0)
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} affine must be invertible`)
  if (!Array.isArray(value['extent']) || value['extent'].length !== 4)
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} extent must contain four values`)
  for (const entry of value['extent']) assertFinite(entry, `${label} extent value`)
  const extent = value['extent'] as readonly number[]
  if ((extent[2] ?? 0) <= (extent[0] ?? 0) || (extent[3] ?? 0) <= (extent[1] ?? 0))
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} extent must be ordered`)
  if (value['pixelInterpretation'] !== 'area' && value['pixelInterpretation'] !== 'point')
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} pixel interpretation is invalid`)
  if (value['resampling'] !== 'nearest' && value['resampling'] !== 'bilinear')
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} resampling is invalid`)
  if (
    ![
      'uint8',
      'uint16',
      'uint32',
      'uint64',
      'int8',
      'int16',
      'int32',
      'float32',
      'float64',
    ].includes(String(value['sampleType']))
  )
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} sample type is invalid`)
  assertRasterNoData(value['noData'], `${label} nodata`)
}

function assertTransformDescriptor(value: unknown, label: string): void {
  if (!isRecord(value))
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} must be an object`)
  assertString(value['id'], `${label} id`)
  assertString(value['version'], `${label} version`)
  const accuracy = value['accuracy']
  if (!isRecord(accuracy))
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} accuracy must be an object`)
  if (accuracy['kind'] === 'exact') return
  if (accuracy['kind'] !== 'estimated')
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} accuracy is invalid`)
  assertFinite(accuracy['maximumError'], `${label} maximum error`)
  if (Number(accuracy['maximumError']) < 0)
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} maximum error must be non-negative`)
  assertString(accuracy['unit'], `${label} accuracy unit`)
}

export function assertDerivedRasterRecipe(value: unknown): asserts value is DerivedRasterRecipeV1 {
  const recipe = value
  if (!isRecord(recipe))
    throw new RpcValidationError('INVALID_PAYLOAD', 'derived recipe must be an object')
  assertJsonValue(recipe, 'derived recipe')
  if (recipe['schemaVersion'] !== 1)
    throw new RpcValidationError('INVALID_PAYLOAD', 'derived recipe schema version is invalid')
  if (recipe['operationVersion'] !== 1)
    throw new RpcValidationError('INVALID_PAYLOAD', 'derived operation version is invalid')
  if (recipe['alignment'] !== 'exact' && recipe['alignment'] !== 'resample')
    throw new RpcValidationError('INVALID_PAYLOAD', 'derived alignment policy is invalid')
  assertRasterGrid(recipe['targetGrid'], 'derived target grid')
  assertRasterNoData(recipe['outputNoData'], 'derived output nodata')
  assertFinite(recipe['minimumValidWeight'], 'minimumValidWeight')
  if (Number(recipe['minimumValidWeight']) <= 0 || Number(recipe['minimumValidWeight']) > 1)
    throw new RpcValidationError('INVALID_PAYLOAD', 'minimumValidWeight must be in (0, 1]')
  const recipeInputs = recipe['inputs']
  if (!Array.isArray(recipeInputs) || recipeInputs.length < 1)
    throw new RpcValidationError('INVALID_PAYLOAD', 'derived recipe requires inputs')
  if (recipeInputs.length > 16)
    throw new RpcValidationError('LIMIT_EXCEEDED', 'derived recipe exceeds the input limit')
  const inputNames = new Set<string>()
  for (const input of recipeInputs) {
    if (!isRecord(input))
      throw new RpcValidationError('INVALID_PAYLOAD', 'derived recipe input is invalid')
    assertString(input['name'], 'derived input name')
    if (inputNames.has(input['name'] as string))
      throw new RpcValidationError('INVALID_PAYLOAD', 'derived input names must be unique')
    inputNames.add(input['name'] as string)
    assertString(input['layerId'], 'derived input layerId')
    assertInteger(input['component'], 'derived input component')
    if (input['valueMode'] !== 'raw' && input['valueMode'] !== 'scaled')
      throw new RpcValidationError('INVALID_PAYLOAD', 'derived input value mode is invalid')
    assertFinite(input['scale'], 'derived input scale')
    assertFinite(input['offset'], 'derived input offset')
    assertRasterNoData(input['noData'], 'derived input nodata')
    if (input['transform'] !== undefined)
      assertTransformDescriptor(input['transform'], 'derived input transform')
  }
  const limits = recipe['limits']
  if (!isRecord(limits))
    throw new RpcValidationError('INVALID_PAYLOAD', 'derived limits must be an object')
  assertInteger(limits['maxTilePixels'], 'derived maxTilePixels', 1)
  assertInteger(limits['maxOutputBytes'], 'derived maxOutputBytes', 1)
  assertInteger(limits['maxWorkingBytes'], 'derived maxWorkingBytes', 1)
  assertDerivedRasterOperation(recipe['operation'], inputNames)
}

function assertDerivedRasterOperation(value: unknown, inputNames: ReadonlySet<string>): void {
  if (!isRecord(value))
    throw new RpcValidationError('INVALID_PAYLOAD', 'derived operation must be an object')
  const requireInput = (name: unknown, label: string): void => {
    assertString(name, label)
    if (!inputNames.has(name as string))
      throw new RpcValidationError('INVALID_PAYLOAD', `${label} does not name an input`)
  }
  switch (value['kind']) {
    case 'band-math': {
      assertString(value['expression'], 'band-math expression')
      if (value['divideByZero'] !== 'nodata' && value['divideByZero'] !== 'zero')
        throw new RpcValidationError('INVALID_PAYLOAD', 'band-math divideByZero is invalid')
      if (value['nonFinite'] !== 'nodata' && value['nonFinite'] !== 'allow')
        throw new RpcValidationError('INVALID_PAYLOAD', 'band-math nonFinite is invalid')
      const clamp = value['clamp']
      if (clamp !== undefined) {
        if (!Array.isArray(clamp) || clamp.length !== 2)
          throw new RpcValidationError('INVALID_PAYLOAD', 'band-math clamp is invalid')
        assertFinite(clamp[0], 'band-math clamp minimum')
        assertFinite(clamp[1], 'band-math clamp maximum')
        if (Number(clamp[1]) < Number(clamp[0]))
          throw new RpcValidationError('INVALID_PAYLOAD', 'band-math clamp is reversed')
      }
      return
    }
    case 'normalized-difference':
      requireInput(value['left'], 'normalized-difference left')
      requireInput(value['right'], 'normalized-difference right')
      return
    case 'linear-combination': {
      const terms = value['terms']
      if (!Array.isArray(terms) || terms.length < 1 || terms.length > 16)
        throw new RpcValidationError('INVALID_PAYLOAD', 'linear-combination terms are invalid')
      for (const term of terms) {
        if (!isRecord(term))
          throw new RpcValidationError('INVALID_PAYLOAD', 'linear-combination term is invalid')
        requireInput(term['input'], 'linear-combination input')
        assertFinite(term['coefficient'], 'linear-combination coefficient')
      }
      assertFinite(value['constant'], 'linear-combination constant')
      return
    }
    case 'raster-difference':
      requireInput(value['minuend'], 'raster-difference minuend')
      requireInput(value['subtrahend'], 'raster-difference subtrahend')
      return
    case 'virtual-band-stack': {
      const bands = value['bands']
      if (!Array.isArray(bands) || bands.length < 1 || bands.length > 16)
        throw new RpcValidationError('INVALID_PAYLOAD', 'virtual stack bands are invalid')
      for (const band of bands) requireInput(band, 'virtual stack band')
      return
    }
    case 'terrain':
      requireInput(value['input'], 'terrain input')
      if (!['hillshade', 'slope', 'aspect'].includes(String(value['operation'])))
        throw new RpcValidationError('INVALID_PAYLOAD', 'terrain operation is invalid')
      for (const name of ['xSpacing', 'ySpacing', 'azimuthDegrees', 'altitudeDegrees'] as const)
        assertFinite(value[name], `terrain ${name}`)
      if (Number(value['xSpacing']) <= 0 || Number(value['ySpacing']) <= 0)
        throw new RpcValidationError('INVALID_PAYLOAD', 'terrain spacing must be positive')
      for (const name of ['xUnit', 'yUnit', 'verticalUnit'] as const) {
        assertRasterLengthUnit(value[name], `terrain ${name}`)
      }
      if (value['rowDirection'] !== 'north' && value['rowDirection'] !== 'south')
        throw new RpcValidationError('INVALID_PAYLOAD', 'terrain rowDirection is invalid')
      if (value['edge'] !== 'clamp' && value['edge'] !== 'nodata')
        throw new RpcValidationError('INVALID_PAYLOAD', 'terrain edge is invalid')
      if (!['degrees', 'radians', 'percent'].includes(String(value['slopeUnit'])))
        throw new RpcValidationError('INVALID_PAYLOAD', 'terrain slopeUnit is invalid')
      return
    default:
      throw new RpcValidationError('INVALID_PAYLOAD', 'derived operation kind is invalid')
  }
}

function assertRasterLengthUnit(value: unknown, label: string): void {
  if (!isRecord(value)) throw new RpcValidationError('INVALID_PAYLOAD', `${label} is invalid`)
  if (
    value['kind'] === 'metre' ||
    value['kind'] === 'international-foot' ||
    value['kind'] === 'us-survey-foot'
  )
    return
  if (value['kind'] !== 'custom')
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} kind is invalid`)
  assertString(value['name'], `${label} name`)
  assertFinite(value['metresPerUnit'], `${label} metresPerUnit`)
  if (Number(value['metresPerUnit']) <= 0)
    throw new RpcValidationError('INVALID_PAYLOAD', `${label} metresPerUnit must be positive`)
}

function assertDerivedRasterBase(payload: PayloadCandidate): void {
  assertString(payload['layerId'], 'layerId')
  const recipe = payload['recipe']
  assertDerivedRasterRecipe(recipe)
  const recipeInputs = recipe.inputs
  const runtimeInputs = payload['inputs']
  if (!Array.isArray(runtimeInputs) || runtimeInputs.length !== recipeInputs.length)
    throw new RpcValidationError(
      'INVALID_PAYLOAD',
      'derived runtime inputs must match the recipe inputs',
    )
  for (const input of runtimeInputs) {
    if (!isRecord(input))
      throw new RpcValidationError('INVALID_PAYLOAD', 'derived runtime input is invalid')
    assertString(input['layerId'], 'derived runtime layerId')
    assertString(input['datasetHandleId'], 'derived runtime datasetHandleId')
    assertInteger(input['generation'], 'derived runtime generation')
    assertString(input['sourceIdentity'], 'derived source identity')
    assertString(input['sourceRevision'], 'derived source revision')
    assertRasterGrid(input['grid'], 'derived source grid')
  }
}

function assertDerivedRegion(payload: PayloadCandidate): void {
  if (!isRecord(payload['region']))
    throw new RpcValidationError('INVALID_PAYLOAD', 'derived region is required')
  const region = payload['region'] as PayloadCandidate
  assertInteger(region.x, 'derived region x')
  assertInteger(region.y, 'derived region y')
  assertInteger(region.width, 'derived region width', 1)
  assertInteger(region.height, 'derived region height', 1)
  if (Number(region.width) * Number(region.height) > RPC_LIMITS.maxTilePixels)
    throw new RpcValidationError('LIMIT_EXCEEDED', 'derived region exceeds the tile limit')
}

function utf8Bytes(value: string): number {
  let bytes = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
  }
  return bytes
}

function jsonMessageBytes(value: Candidate): number {
  const payload =
    value.kind === 'source.open-local' && isRecord(value.payload)
      ? { ...value.payload, files: '[structured-clone attachments]' }
      : value.payload
  try {
    return utf8Bytes(
      JSON.stringify({
        schemaVersion: value.schemaVersion,
        requestId: value.requestId,
        kind: value.kind,
        payload,
      }),
    )
  } catch {
    throw new RpcValidationError(
      'INVALID_MESSAGE',
      'message must have a serializable control plane',
    )
  }
}

export function validateWorkerRequest(value: unknown): WorkerRequest {
  if (!isRecord(value)) throw new RpcValidationError('INVALID_MESSAGE', 'message must be an object')
  const candidate = value as Candidate
  if (candidate.schemaVersion !== RPC_SCHEMA_VERSION) {
    throw new RpcValidationError('INVALID_MESSAGE', 'unsupported RPC schema version')
  }
  assertString(candidate.requestId, 'requestId')
  assertString(candidate.kind, 'kind')
  if (!REQUEST_KINDS.has(candidate.kind)) {
    throw new RpcValidationError('UNKNOWN_KIND', `unknown RPC kind: ${candidate.kind}`)
  }
  if (jsonMessageBytes(candidate) > RPC_LIMITS.maxMessageBytes) {
    throw new RpcValidationError('LIMIT_EXCEEDED', 'message exceeds the byte limit')
  }

  const { kind, payload } = candidate
  if (kind === 'worker.test-crash') {
    if (payload !== null)
      throw new RpcValidationError('INVALID_PAYLOAD', `${kind} payload must be null`)
  } else if (kind === 'worker.initialize') {
    assertInitializePayload(payload)
  } else if (kind === 'diagnostics.get') {
    assertDiagnosticsPayload(payload)
  } else {
    assertBasePayload(payload)
    if (kind === 'source.open-sample') {
      assertGeneration(payload)
      if (payload['sampleId'] !== undefined) assertString(payload['sampleId'], 'sampleId')
    }
    if (kind === 'source.open-remote') {
      assertGeneration(payload)
      assertString(payload.url, 'url')
    }
    if (kind === 'source.open-bundled') {
      assertGeneration(payload)
      assertString(payload['path'], 'bundled path')
      assertString(payload['name'], 'bundled name')
      assertInteger(payload['size'], 'bundled size', 1)
      if (payload['size'] > RPC_LIMITS.maxBundledSourceBytes)
        throw new RpcValidationError('LIMIT_EXCEEDED', 'bundled source exceeds the byte limit')
      assertString(payload['sha256'], 'bundled SHA-256')
      assertString(payload['mediaType'], 'bundled media type')
      if (
        !payload['path'].startsWith('examples/') ||
        payload['path'].startsWith('/') ||
        payload['path'].includes('..') ||
        payload['path'].includes('\\')
      )
        throw new RpcValidationError('INVALID_PAYLOAD', 'bundled path is outside examples/')
      if (!/^[a-f0-9]{64}$/u.test(payload['sha256']))
        throw new RpcValidationError('INVALID_PAYLOAD', 'bundled SHA-256 must be lowercase hex')
    }
    if (kind === 'source.open-local') {
      assertGeneration(payload)
      assertString(payload.primaryId, 'primaryId')
      if (!Array.isArray(payload.files) || payload.files.length === 0) {
        throw new RpcValidationError('INVALID_PAYLOAD', 'at least one local file is required')
      }
      if (payload.files.length > RPC_LIMITS.maxItems) {
        throw new RpcValidationError('LIMIT_EXCEEDED', 'too many local files')
      }
      for (const file of payload.files) {
        if (!isRecord(file))
          throw new RpcValidationError('INVALID_PAYLOAD', 'invalid file attachment')
        const fileCandidate = file as PayloadCandidate
        assertString(fileCandidate.id, 'file id')
        assertString(fileCandidate.name, 'file name')
        assertInteger(fileCandidate.size, 'file size')
        assertInteger(fileCandidate.lastModified, 'lastModified')
        const blob = fileCandidate.blob
        if (typeof fileCandidate.type !== 'string' || !isStructuredCloneBlob(blob)) {
          throw new RpcValidationError('INVALID_PAYLOAD', 'invalid Blob attachment')
        }
        if (blob.size !== fileCandidate.size) {
          throw new RpcValidationError('INVALID_PAYLOAD', 'Blob attachment size does not match')
        }
      }
    }
    if (kind === 'source.close') {
      assertGeneration(payload)
      assertString(payload.sourceId, 'sourceId')
    }
    if (kind === 'dataset.open') {
      assertGeneration(payload)
      assertString(payload.documentId, 'documentId')
      assertString(payload.datasetId, 'datasetId')
      if (payload.sourceId !== undefined) assertString(payload.sourceId, 'sourceId')
    }
    if (kind === 'dataset.close') {
      assertGeneration(payload)
      assertString(payload.handleId, 'handleId')
    }
    if (kind === 'plane.set') {
      assertGeneration(payload)
      assertString(payload.handleId, 'handleId')
      assertPlaneSelection(payload.selection)
    }
    if (kind === 'tile.request' || kind === 'display.tile.request') {
      assertTile(payload)
      if (kind === 'display.tile.request') {
        assertString(payload['sourceIdentity'], 'sourceIdentity')
        assertString(payload['sourceRevision'], 'sourceRevision')
        assertString(payload['layerId'], 'layerId')
        assertString(payload['styleRevision'], 'styleRevision')
        assertString(payload['statisticsRevision'], 'statisticsRevision')
      }
    }
    if (kind === 'display.statistics.request') assertDisplayStatistics(payload)
    if (kind === 'display.statistics.invalidate') {
      if (payload['sourceIdentity'] !== undefined)
        assertString(payload['sourceIdentity'], 'sourceIdentity')
      if (payload['datasetHandleId'] !== undefined)
        assertString(payload['datasetHandleId'], 'datasetHandleId')
    }
    if (kind === 'raster.sample_point') assertRasterPointSample(payload)
    if (
      kind === 'geo.analysis.dry_run' ||
      kind === 'geo.analysis.tile' ||
      kind === 'geo.analysis.region_statistics' ||
      kind === 'geo.analysis.line_profile'
    ) {
      assertDerivedRasterBase(payload)
    }
    if (kind === 'geo.analysis.tile') {
      assertDerivedRegion(payload)
      assertString(payload['tileId'], 'derived tileId')
      assertString(payload['styleRevision'], 'derived styleRevision')
      assertString(payload['statisticsRevision'], 'derived statisticsRevision')
      const runtimeInputs = payload['inputs'] as readonly Record<string, unknown>[]
      const first = runtimeInputs[0]
      assertTile({
        ...payload,
        generation: first?.['generation'],
        datasetHandleId: first?.['datasetHandleId'],
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        resolutionLevel: 0,
        component: 0,
      })
    }
    if (kind === 'geo.analysis.region_statistics') {
      assertDerivedRegion(payload)
      assertInteger(payload['component'], 'derived statistics component')
      const mask = payload['mask']
      if (mask !== undefined) assertDerivedPolygonMask(mask)
      const histogram = payload['histogram']
      if (histogram !== undefined) {
        if (!isRecord(histogram))
          throw new RpcValidationError('INVALID_PAYLOAD', 'derived histogram is invalid')
        assertInteger(histogram['bins'], 'derived histogram bins', 1)
        if (Number(histogram['bins']) > 4_096)
          throw new RpcValidationError('LIMIT_EXCEEDED', 'derived histogram exceeds 4096 bins')
        assertFinite(histogram['minimum'], 'derived histogram minimum')
        assertFinite(histogram['maximum'], 'derived histogram maximum')
        if (Number(histogram['maximum']) <= Number(histogram['minimum']))
          throw new RpcValidationError(
            'INVALID_PAYLOAD',
            'derived histogram maximum must exceed minimum',
          )
      }
    }
    if (kind === 'geo.analysis.line_profile') {
      for (const name of ['start', 'end'] as const) {
        const point = payload[name]
        if (!isRecord(point))
          throw new RpcValidationError('INVALID_PAYLOAD', `derived ${name} point is invalid`)
        assertFinite(point['x'], `derived ${name} x`)
        assertFinite(point['y'], `derived ${name} y`)
      }
      assertInteger(payload['sampleCount'], 'derived line sampleCount', 1)
      if (Number(payload['sampleCount']) > 100_000)
        throw new RpcValidationError('LIMIT_EXCEEDED', 'derived line sampleCount exceeds 100000')
      assertInteger(payload['component'], 'derived line component')
      if (payload['resampling'] !== 'nearest' && payload['resampling'] !== 'bilinear')
        throw new RpcValidationError('INVALID_PAYLOAD', 'derived line resampling is invalid')
    }
    if (kind === 'geo.analysis.release') assertString(payload['layerId'], 'layerId')
    if (kind === 'analysis.catalog') assertAnalysisDataset(payload)
    if (kind === 'analysis.normalize-parameters') {
      assertAnalysisDataset(payload)
      assertAnalysisOperation(payload.operation)
      assertJsonValue(payload.parameters, 'parameters')
    }
    if (kind === 'analysis.normalize-roi') {
      assertAnalysisDataset(payload)
      if (!isRecord(payload.roi)) {
        throw new RpcValidationError('INVALID_PAYLOAD', 'roi must be an object')
      }
      assertJsonValue(payload.roi, 'roi')
    }
    if (kind === 'analysis.dry-run' || kind === 'analysis.execute') {
      assertAnalysisDataset(payload)
      if (!isRecord(payload.graph)) {
        throw new RpcValidationError('INVALID_PAYLOAD', 'graph must be an object')
      }
      assertJsonValue(payload.graph, 'graph')
      if (payload['calibration'] !== undefined) assertAnalysisCalibration(payload['calibration'])
      if (payload.roi !== undefined) {
        if (!isRecord(payload.roi)) {
          throw new RpcValidationError('INVALID_PAYLOAD', 'roi must be an object')
        }
        assertJsonValue(payload.roi, 'roi')
      }
    }
    if (kind === 'analysis.overlay-tile') {
      assertAnalysisResult(payload)
      assertString(payload.output, 'output')
      assertString(payload.tileId, 'tileId')
      assertPlaneSelection(payload.selection)
      const overlaySelection = payload.selection as PayloadCandidate
      assertInteger(payload.component, 'component')
      if (
        payload['view'] !== undefined &&
        !['labels', 'mask', 'outline', 'numbered', 'centroids', 'ellipses'].includes(
          String(payload['view']),
        )
      )
        throw new RpcValidationError('INVALID_PAYLOAD', 'overlay view is invalid')
      if (payload['tableOutput'] !== undefined) assertString(payload['tableOutput'], 'tableOutput')
      assertTile({
        ...payload,
        mapping: { mode: 'linear', range: 'auto' },
        priority: 'visible',
        displayAxes: overlaySelection.displayAxes,
        fixedIndices: overlaySelection.fixedIndices,
        resolutionLevel: overlaySelection.resolutionLevel,
      })
    }
    if (kind === 'analysis.dataset-tile') {
      assertAnalysisResult(payload)
      assertString(payload.output, 'output')
      assertTile(payload)
    }
    if (kind === 'analysis.table-page') assertAnalysisTablePage(payload)
    if (kind === 'analysis.series-export') {
      assertAnalysisResult(payload)
      assertString(payload.output, 'output')
      assertInteger(payload['maxRows'], 'maxRows')
      if ((payload['maxRows'] as number) < 1 || (payload['maxRows'] as number) > 100_000)
        throw new RpcValidationError('LIMIT_EXCEEDED', 'series export row limit is invalid')
    }
    if (kind === 'analysis.release') assertAnalysisResult(payload)
    if (kind === 'request.cancel') assertString(payload.targetRequestId, 'targetRequestId')
  }
  return value as unknown as WorkerRequest
}

function assertDerivedPolygonMask(value: unknown): void {
  if (!isRecord(value))
    throw new RpcValidationError('INVALID_PAYLOAD', 'derived polygon mask must be an object')
  if (
    value['pixelInterpretation'] !== 'pixel-is-area' &&
    value['pixelInterpretation'] !== 'pixel-is-point'
  )
    throw new RpcValidationError(
      'INVALID_PAYLOAD',
      'derived polygon mask pixel interpretation is invalid',
    )
  const polygons = value['polygons']
  if (!Array.isArray(polygons) || polygons.length === 0 || polygons.length > RPC_LIMITS.maxItems)
    throw new RpcValidationError('LIMIT_EXCEEDED', 'derived polygon mask polygon count is invalid')
  let coordinateCount = 0
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0 || polygon.length > RPC_LIMITS.maxItems)
      throw new RpcValidationError('INVALID_PAYLOAD', 'derived polygon mask requires bounded rings')
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4)
        throw new RpcValidationError('INVALID_PAYLOAD', 'derived polygon mask ring is invalid')
      coordinateCount += ring.length
      if (coordinateCount > 100_000)
        throw new RpcValidationError(
          'LIMIT_EXCEEDED',
          'derived polygon mask has too many coordinates',
        )
      for (const point of ring) {
        if (!isRecord(point))
          throw new RpcValidationError('INVALID_PAYLOAD', 'derived polygon mask point is invalid')
        assertFinite(point['x'], 'derived polygon mask x')
        assertFinite(point['y'], 'derived polygon mask y')
      }
      const first = ring[0] as Readonly<Record<string, unknown>> | undefined
      const last = ring.at(-1) as Readonly<Record<string, unknown>> | undefined
      if (first?.['x'] !== last?.['x'] || first?.['y'] !== last?.['y'])
        throw new RpcValidationError('INVALID_PAYLOAD', 'derived polygon mask ring must be closed')
    }
  }
}

export function isRpcEnvelope(value: unknown): value is WorkerRequest {
  try {
    validateWorkerRequest(value)
    return true
  } catch {
    return false
  }
}

export function rpcRequest<Kind extends WorkerRequest['kind']>(
  requestId: string,
  kind: Kind,
  payload: Extract<WorkerRequest, { readonly kind: Kind }>['payload'],
): Extract<WorkerRequest, { readonly kind: Kind }> {
  return { schemaVersion: RPC_SCHEMA_VERSION, requestId, kind, payload } as Extract<
    WorkerRequest,
    { readonly kind: Kind }
  >
}
