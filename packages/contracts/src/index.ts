export const RPC_SCHEMA_VERSION = 1 as const
export const RPC_LIMITS = Object.freeze({
  maxMessageBytes: 2 * 1_024 * 1_024,
  maxStringLength: 4_096,
  maxItems: 256,
  maxMetadataDepth: 8,
  maxTilePixels: 512 * 512,
})

export type SourceId = string & { readonly __sourceId: unique symbol }
export type DocumentId = string & { readonly __documentId: unique symbol }
export type DatasetHandleId = string & { readonly __datasetHandleId: unique symbol }

export type SourceKind = 'local' | 'remote' | 'sample'
export type TilePriority = 'visible' | 'near-visible' | 'background'
export type DisplayMapping = Readonly<{
  mode: 'linear'
  range: 'auto' | 'manual'
  minimum?: number
  maximum?: number
}>

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
      | Readonly<{ kind: 'any-axis-pair' }>
      | Readonly<{
          kind: 'ordered-axis-pairs'
          pairs: readonly (readonly [string, string])[]
        }>
  }>
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

export interface OpenedDatasetDescriptor {
  readonly handleId: DatasetHandleId
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
  readonly range: Readonly<{ minimum: number; maximum: number; automatic: boolean }>
  readonly histogram: readonly number[]
  readonly elapsedMilliseconds: number
}

export interface ReaderDescriptor {
  readonly id: string
  readonly version: string
  readonly format: string
  readonly extensions: readonly string[]
  readonly mediaTypes: readonly string[]
}

export interface WorkerDiagnostics {
  readonly generation: number
  readonly source: null | Readonly<{
    id: SourceId
    kind: SourceKind
    size: number
    rangeRequests: number
    rangeBytesFetched: number
    rangeCacheBytes: number
  }>
  readonly openDatasets: number
  readonly pendingRequests: number
  readonly tileRuntime: null | Readonly<Record<string, unknown>>
  readonly releases: Readonly<{
    documents: number
    datasets: number
    tiles: number
    runtimes: number
  }>
}

export type RpcErrorCode =
  | 'ABORTED'
  | 'CORS_OR_RANGE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'INVALID_MESSAGE'
  | 'INVALID_PAYLOAD'
  | 'LIMIT_EXCEEDED'
  | 'SOURCE_OPEN_FAILED'
  | 'STALE_ID'
  | 'UNSUPPORTED'
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
  | RpcRequest<'worker.initialize', null>
  | RpcRequest<'source.open-sample', Readonly<{ generation: number }>>
  | RpcRequest<
      'source.open-local',
      Readonly<{ generation: number; primaryId: string; files: readonly LocalFileAttachment[] }>
    >
  | RpcRequest<'source.open-remote', Readonly<{ generation: number; url: string }>>
  | RpcRequest<'source.close', Readonly<{ sourceId: SourceId; generation: number }>>
  | RpcRequest<
      'dataset.open',
      Readonly<{ documentId: DocumentId; datasetId: string; generation: number }>
    >
  | RpcRequest<'dataset.close', Readonly<{ handleId: DatasetHandleId; generation: number }>>
  | RpcRequest<
      'plane.set',
      Readonly<{ handleId: DatasetHandleId; generation: number; selection: PlaneSelection }>
    >
  | RpcRequest<'tile.request', RenderTileRequest>
  | RpcRequest<'request.cancel', Readonly<{ targetRequestId: string }>>
  | RpcRequest<'diagnostics.get', null>
  | RpcRequest<'worker.test-crash', null>

export interface RpcRequest<Kind extends string, Payload> {
  readonly schemaVersion: typeof RPC_SCHEMA_VERSION
  readonly requestId: string
  readonly kind: Kind
  readonly payload: Payload
}

export type WorkerResponse =
  | RpcSuccess<'worker.initialize', Readonly<{ readers: readonly ReaderDescriptor[] }>>
  | RpcSuccess<'source.opened', OpenedSourceDescriptor>
  | RpcSuccess<'source.closed', Readonly<{ sourceId: SourceId }>>
  | RpcSuccess<'dataset.opened', OpenedDatasetDescriptor>
  | RpcSuccess<'dataset.closed', Readonly<{ handleId: DatasetHandleId }>>
  | RpcSuccess<'plane.selected', Readonly<{ handleId: DatasetHandleId; selection: PlaneSelection }>>
  | RpcSuccess<'tile.ready', RenderTile>
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
  'source.open-remote',
  'source.close',
  'dataset.open',
  'dataset.close',
  'plane.set',
  'tile.request',
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
  readonly x?: unknown
  readonly y?: unknown
  readonly width?: unknown
  readonly height?: unknown
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
  if (mapping.range === 'manual') {
    assertFinite(mapping.minimum, 'mapping minimum')
    assertFinite(mapping.maximum, 'mapping maximum')
    if (mapping.maximum <= mapping.minimum) {
      throw new RpcValidationError('INVALID_PAYLOAD', 'mapping maximum must exceed its minimum')
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
  if (kind === 'worker.initialize' || kind === 'diagnostics.get' || kind === 'worker.test-crash') {
    if (payload !== null)
      throw new RpcValidationError('INVALID_PAYLOAD', `${kind} payload must be null`)
  } else {
    assertBasePayload(payload)
    if (kind === 'source.open-sample') assertGeneration(payload)
    if (kind === 'source.open-remote') {
      assertGeneration(payload)
      assertString(payload.url, 'url')
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
    if (kind === 'tile.request') assertTile(payload)
    if (kind === 'request.cancel') assertString(payload.targetRequestId, 'targetRequestId')
  }
  return value as unknown as WorkerRequest
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
