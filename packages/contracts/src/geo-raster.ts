import type { RpcJsonObject } from './analysis.js'
import type { RasterSampleType } from './geo-analysis.js'

export const GEO_RASTER_DESCRIPTOR_SCHEMA_VERSION = 1 as const

export type GeoRasterRpcSampleType = RasterSampleType | 'float16'
export type GeoNoDataValue = number | string

export interface GeoDiagnosticV1 {
  readonly severity: 'info' | 'warning' | 'error'
  readonly code: string
  readonly message: string
  readonly path?: string
  readonly metadata?: RpcJsonObject
}

export interface GeoUnitDescriptorV1 {
  readonly name: string
  readonly symbol?: string
  readonly conversionToSI?: number
}

export interface GeoSpatialReferenceV1 {
  readonly schemaVersion: 1
  readonly coordinateSystemType:
    | 'projected'
    | 'geographic'
    | 'geocentric'
    | 'vertical'
    | 'compound'
    | 'engineering'
    | 'parametric'
    | 'temporal'
    | 'unknown'
  readonly authority?: string
  readonly code?: number | string
  readonly name?: string
  readonly wkt2?: string
  readonly projJson?: RpcJsonObject
  readonly horizontalUnit?: GeoUnitDescriptorV1
  readonly vertical?: Readonly<{
    authority?: string
    code?: number | string
    name?: string
    wkt2?: string
    unit?: GeoUnitDescriptorV1
  }>
  readonly coordinateEpoch?: number
  readonly formalAxes: readonly Readonly<{
    name: string
    abbreviation?: string
    direction: string
    unit?: GeoUnitDescriptorV1
    order: number
  }>[]
  readonly applicationAxes: Readonly<{
    x: Readonly<{ name: string; formalAxisIndex?: number }>
    y: Readonly<{ name: string; formalAxisIndex?: number }>
  }>
  readonly evidence: readonly Readonly<{
    kind: 'embedded' | 'sidecar' | 'derived' | 'user-supplied' | 'citation'
    sourceId: string
    locator: string
    citation?: string
    metadata?: RpcJsonObject
  }>[]
  readonly state: 'complete' | 'incomplete' | 'unknown'
  readonly confidence?: number
  readonly diagnostics: readonly GeoDiagnosticV1[]
}

export type GeoNoDataV1 =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'scalar'; value: GeoNoDataValue }>
  | Readonly<{ kind: 'components'; values: readonly GeoNoDataValue[] }>

export interface GeoGridGeometryV1 {
  readonly schemaVersion: 1
  readonly width: number
  readonly height: number
  readonly spatialDimensions: Readonly<{
    x: Readonly<{ id: string; name: string; dimensionIndex: number }>
    y: Readonly<{ id: string; name: string; dimensionIndex: number }>
  }>
  readonly pixelToWorld: readonly [number, number, number, number, number, number]
  readonly worldToPixel?: readonly [number, number, number, number, number, number]
  readonly worldBounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>
  readonly wrappedBounds?: Readonly<{
    west: number
    south: number
    east: number
    north: number
    crossesAntimeridian: boolean
  }>
  readonly pixelRegistration: 'pixel-is-area' | 'pixel-is-point' | 'unknown'
  readonly noData: GeoNoDataV1
  readonly warnings: readonly GeoDiagnosticV1[]
}

export interface GeoRasterDescriptorV1 {
  readonly schemaVersion: typeof GEO_RASTER_DESCRIPTOR_SCHEMA_VERSION
  readonly id: string
  readonly title?: string
  readonly shape: readonly number[]
  readonly dimensions: readonly Readonly<{
    id: string
    name?: string
    index: number
    length: number
    kind: 'spatial-x' | 'spatial-y' | 'non-spatial'
  }>[]
  readonly spatialDimensions: GeoGridGeometryV1['spatialDimensions']
  readonly axes: readonly Readonly<{
    id: string
    name?: string
    kind: 'band' | 'time' | 'vertical' | 'depth' | 'ensemble' | 'scenario' | 'other'
    dimensionIndex: number
    length: number
    unit?: string
    coordinates:
      | Readonly<{ kind: 'index' }>
      | Readonly<{ kind: 'linear'; origin: number; step: number }>
      | Readonly<{ kind: 'values'; values: readonly (number | string)[] }>
      | Readonly<{ kind: 'lazy'; valueType: 'number' | 'string' }>
    metadata?: RpcJsonObject
  }>[]
  readonly sampleType: GeoRasterRpcSampleType
  readonly bands: readonly Readonly<{
    sourceComponentIndex: number
    name: string
    commonName?: string
    description?: string
    colorInterpretation:
      | 'undefined'
      | 'gray'
      | 'red'
      | 'green'
      | 'blue'
      | 'alpha'
      | 'palette'
      | 'nir'
      | 'swir'
      | 'thermal'
      | 'elevation'
      | 'mask'
      | 'other'
    wavelength?: Readonly<{ center?: number; min?: number; max?: number; unit: string }>
    unit?: string
    scale?: number
    offset?: number
    noData?: GeoNoDataValue
    validRange?: readonly [GeoNoDataValue, GeoNoDataValue]
    dataType: GeoRasterRpcSampleType
    categorical: boolean
    categories?: readonly Readonly<{
      value: GeoNoDataValue
      label: string
      color?: string
      metadata?: RpcJsonObject
    }>[]
  }>[]
  readonly levels: readonly Readonly<{
    id: string
    arrayPath?: string
    sourcePath?: string
    sourceResolutionLevel: number
    sourceOrder: number
    width: number
    height: number
    geometry: GeoGridGeometryV1
    nominalResolution?: Readonly<{ x: number; y: number; unit?: string }>
    downsample?: Readonly<{ x: number; y: number }>
    storage: Readonly<{
      organization: 'contiguous' | 'stripped' | 'tiled' | 'chunked' | 'unknown'
      chunkShape?: readonly number[]
      compression?: string
      byteOrder?: 'little-endian' | 'big-endian' | 'not-applicable' | 'unknown'
      metadata?: RpcJsonObject
    }>
  }>[]
  readonly primaryLevelId: string
  readonly spatialReference: GeoSpatialReferenceV1
  readonly grid: GeoGridGeometryV1
  readonly capabilities: Readonly<{
    pixelRegionReads: boolean
    worldRegionReads: boolean
    resolutionLevels: boolean
    axisCoordinateReads: boolean
    bandSelection: boolean
  }>
  readonly sourceFormat: Readonly<{ id: string; name?: string; version?: string }>
  readonly formatEvidence?: RpcJsonObject
  readonly diagnostics: readonly GeoDiagnosticV1[]
}

export interface GeoZarrStructuralDiagnosticsV1 {
  readonly schemaVersion: 1
  readonly zarrFormat: 2 | 3
  readonly storeKind: 'http' | 'directory' | 'zip' | 'scientific-context' | 'object-store'
  readonly rootNodeType: 'array' | 'group'
  readonly rootMetadataObject: string
  readonly datasets: readonly Readonly<{
    id: string
    title?: string
    levels: readonly Readonly<{
      id: string
      order: number
      path: string
      shape: readonly number[]
      dimensions: readonly (string | null)[]
      sampleType: GeoRasterRpcSampleType
      logicalChunkShape: readonly number[]
      outerShardShape?: readonly number[]
      sharded: boolean
      codecs: readonly string[]
    }>[]
    diagnostics: readonly GeoDiagnosticV1[]
  }>[]
  readonly io: Readonly<{
    metadataRequests: number
    metadataBytes: number
    chunkRequests: number
    chunkBytes: number
    uniqueBytes: number
    cacheHits: number
    coalescedConsumers: number
    cancelledReads: number
    sourceCacheBytes: number
    logicalChunkReads: number
    outerShardAccesses: number
    uniqueShardObjects: number
    shardIndexReads: number
    shardPayloadRanges: number
  }>
  readonly structuralMetadata: RpcJsonObject
}
