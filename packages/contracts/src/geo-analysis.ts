import type { DatasetHandleId, DisplayMapping, Region, TilePriority } from './index.js'

export const GEO_DERIVED_RASTER_SCHEMA_VERSION = 1 as const
export const GEO_DERIVED_RASTER_TILE_SIZE = 256 as const

export type RasterSampleType =
  | 'uint8'
  | 'uint16'
  | 'uint32'
  | 'uint64'
  | 'int8'
  | 'int16'
  | 'int32'
  | 'float32'
  | 'float64'

export type RasterNoDataPolicy =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'nan' }>
  | Readonly<{ kind: 'value'; value: number }>

export interface RasterTargetGridV1 {
  readonly schemaVersion: 1
  readonly crs: string
  readonly width: number
  readonly height: number
  readonly affine: readonly [number, number, number, number, number, number]
  readonly pixelInterpretation: 'area' | 'point'
  readonly extent: readonly [number, number, number, number]
  readonly sampleType: RasterSampleType
  readonly noData: RasterNoDataPolicy
  readonly resampling: 'nearest' | 'bilinear'
}

export type RasterTransformAccuracyV1 =
  | Readonly<{ kind: 'exact' }>
  | Readonly<{ kind: 'estimated'; maximumError: number; unit: string }>

export interface RasterTransformDescriptorV1 {
  readonly id: string
  readonly version: string
  readonly accuracy: RasterTransformAccuracyV1
}

export interface DerivedRasterRecipeInputV1 {
  readonly name: string
  readonly layerId: string
  readonly component: number
  readonly valueMode: 'raw' | 'scaled'
  readonly scale: number
  readonly offset: number
  readonly noData: RasterNoDataPolicy
  readonly transform?: RasterTransformDescriptorV1
}

export type RasterLengthUnitV1 =
  | Readonly<{ kind: 'metre' }>
  | Readonly<{ kind: 'international-foot' }>
  | Readonly<{ kind: 'us-survey-foot' }>
  | Readonly<{ kind: 'custom'; name: string; metresPerUnit: number }>

export type DerivedRasterOperationV1 =
  | Readonly<{
      kind: 'band-math'
      expression: string
      divideByZero: 'nodata' | 'zero'
      nonFinite: 'nodata' | 'allow'
      clamp?: readonly [number, number]
    }>
  | Readonly<{ kind: 'normalized-difference'; left: string; right: string }>
  | Readonly<{
      kind: 'linear-combination'
      terms: readonly Readonly<{ input: string; coefficient: number }>[]
      constant: number
    }>
  | Readonly<{ kind: 'raster-difference'; minuend: string; subtrahend: string }>
  | Readonly<{ kind: 'virtual-band-stack'; bands: readonly string[] }>
  | Readonly<{
      kind: 'terrain'
      operation: 'hillshade' | 'slope' | 'aspect'
      input: string
      xSpacing: number
      ySpacing: number
      xUnit: RasterLengthUnitV1
      yUnit: RasterLengthUnitV1
      verticalUnit: RasterLengthUnitV1
      rowDirection: 'north' | 'south'
      edge: 'clamp' | 'nodata'
      slopeUnit: 'degrees' | 'radians' | 'percent'
      azimuthDegrees: number
      altitudeDegrees: number
    }>

export interface DerivedRasterRecipeV1 {
  readonly schemaVersion: typeof GEO_DERIVED_RASTER_SCHEMA_VERSION
  /** Version of the LabViewer orchestration semantics; PureJsImage plans add algorithm versions. */
  readonly operationVersion: 1
  readonly operation: DerivedRasterOperationV1
  readonly inputs: readonly DerivedRasterRecipeInputV1[]
  readonly targetGrid: RasterTargetGridV1
  readonly alignment: 'exact' | 'resample'
  readonly outputNoData: RasterNoDataPolicy
  readonly minimumValidWeight: number
  readonly limits: Readonly<{
    maxTilePixels: number
    maxOutputBytes: number
    maxWorkingBytes: number
  }>
}

export interface DerivedRasterRuntimeInputV1 {
  readonly layerId: string
  readonly datasetHandleId: DatasetHandleId
  readonly generation: number
  readonly sourceIdentity: string
  readonly sourceRevision: string
  readonly grid: RasterTargetGridV1
}

export interface DerivedRasterRequestBase {
  readonly layerId: string
  readonly recipe: DerivedRasterRecipeV1
  readonly inputs: readonly DerivedRasterRuntimeInputV1[]
}

export interface DerivedRasterDryRunRequest extends DerivedRasterRequestBase {}

export interface DerivedRasterDryRunReport {
  readonly valid: boolean
  readonly cacheKey: string
  readonly sources: readonly Readonly<{
    layerId: string
    sourceIdentity: string
    sourceRevision: string
    grid: RasterTargetGridV1
  }>[]
  readonly targetGrid: RasterTargetGridV1
  readonly estimatedTiles: number
  readonly estimatedTransferredBytes: number
  readonly estimatedManagedMemory: number
  readonly transformRequirements: readonly Readonly<{
    layerId: string
    sourceCrs: string
    targetCrs: string
    descriptor: RasterTransformDescriptorV1
  }>[]
  readonly resampling: 'nearest' | 'bilinear'
  readonly nodataPolicy: RasterNoDataPolicy
  readonly expectedOutput: Readonly<{
    sampleType: RasterSampleType
    componentCount: number
  }>
  readonly warnings: readonly string[]
}

export interface DerivedDisplayTileRequest extends DerivedRasterRequestBase {
  readonly tileId: string
  readonly styleRevision: string
  readonly statisticsRevision: string
  readonly region: Region
  readonly priority: TilePriority
  readonly mapping: DisplayMapping
}

export interface DerivedDisplayTile {
  readonly tileId: string
  readonly layerId: string
  readonly cacheKey: string
  readonly styleRevision: string
  readonly statisticsRevision: string
  readonly region: Region
  readonly overview: 0
  readonly width: number
  readonly height: number
  readonly rgba: Uint8ClampedArray
  readonly elapsedMilliseconds: number
  readonly progress: Readonly<{ completedTiles: number; totalTiles: number }>
}

export interface DerivedRasterStatisticsRequest extends DerivedRasterRequestBase {
  readonly region: Region
  readonly component: number
  readonly histogram?: Readonly<{ bins: number; minimum: number; maximum: number }>
}

export interface DerivedRasterStatisticsResponse {
  readonly cacheKey: string
  readonly count: number
  readonly invalidCount: number
  readonly minimum: number | null
  readonly maximum: number | null
  readonly mean: number | null
  readonly variance: number | null
  readonly histogram?: Readonly<{
    minimum: number
    maximum: number
    counts: Uint32Array
    underflow: number
    overflow: number
  }>
}

export interface DerivedRasterLineProfileRequest extends DerivedRasterRequestBase {
  readonly start: Readonly<{ x: number; y: number }>
  readonly end: Readonly<{ x: number; y: number }>
  readonly sampleCount: number
  readonly component: number
  readonly resampling: 'nearest' | 'bilinear'
}

export interface DerivedRasterLineProfileResponse {
  readonly cacheKey: string
  readonly distances: Float64Array
  readonly values: Float64Array
  readonly valid: Uint8Array
}

export interface DerivedRasterReleaseRequest {
  readonly layerId: string
}
