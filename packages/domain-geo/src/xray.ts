import {
  COG_INSPECTION_METADATA_KEY,
  type CogDirectoryInspection,
  type CogInspectionReport,
  type DatasetDescriptor,
  type OpenedSourceDescriptor,
  type SpatialReference,
  type WorkerDiagnostics,
} from '@pji-workbench/contracts'

export interface CogXrayReport {
  readonly objectSize: number
  readonly container: 'TIFF' | 'BigTIFF' | 'unknown'
  readonly byteOrder: 'little-endian' | 'big-endian' | 'unknown'
  readonly width: number
  readonly height: number
  readonly tileWidth?: number
  readonly tileHeight?: number
  readonly tiled: boolean
  readonly bandCount: number
  readonly bitsPerSample: readonly number[]
  readonly sampleFormats: readonly number[]
  readonly compression: Readonly<{ id: number; name: string; status: string }> | undefined
  readonly topLevelIfds: number
  readonly subIfdCount: number
  readonly overviewLevels: readonly Readonly<{ level: number; width: number; height: number }>[]
  readonly nodata?: SpatialReference['noData']
  readonly affine?: SpatialReference['pixelToModel']
  readonly crs?: SpatialReference['crs']
  readonly rangeRequests: number
  readonly bytesFetched: number
  readonly cacheHits: number
  readonly cacheMisses: number
  readonly percentFetched: number | undefined
  readonly activeOverview: number
  readonly likelyCog: boolean
  readonly issues: CogInspectionReport['issues']
}

export function cogInspectionFromSource(
  source: OpenedSourceDescriptor,
): CogInspectionReport | undefined {
  const value = source.metadata[COG_INSPECTION_METADATA_KEY]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as CogInspectionReport
  if (candidate.container !== 'TIFF' && candidate.container !== 'BigTIFF') return undefined
  return candidate
}

export function scalarNodata(spatial: SpatialReference | undefined): number | undefined {
  const nodata = spatial?.noData
  if (nodata?.kind !== 'scalar') return undefined
  return typeof nodata.value === 'number' ? nodata.value : undefined
}

export function buildCogXrayReport(input: {
  readonly source: OpenedSourceDescriptor
  readonly dataset: DatasetDescriptor
  readonly diagnostics: WorkerDiagnostics
  readonly activeOverview: number
}): CogXrayReport {
  const inspection = cogInspectionFromSource(input.source)
  const image = primaryDirectory(inspection)
  const spatial = input.dataset.spatialReference
  const width = axisLength(input.dataset, 'x') ?? image?.width ?? 0
  const height = axisLength(input.dataset, 'y') ?? image?.height ?? 0
  const size = input.source.source.size
  const range = input.diagnostics.sources.find((source) => source.id === input.source.sourceId)
  const bytesFetched = range?.rangeBytesFetched ?? 0
  const percentFetchedApplies =
    input.source.source.kind !== 'geo-zarr-remote' &&
    input.source.source.kind !== 'geo-zarr-bundled'
  return {
    objectSize: size,
    container: inspection?.container ?? 'unknown',
    byteOrder: inspection?.byteOrder ?? 'unknown',
    width,
    height,
    ...(image?.tileWidth === undefined ? {} : { tileWidth: image.tileWidth }),
    ...(image?.tileHeight === undefined ? {} : { tileHeight: image.tileHeight }),
    tiled: image?.tiled ?? false,
    bandCount: input.dataset.components.length || (image?.samplesPerPixel ?? 0),
    bitsPerSample: image?.bitsPerSample ?? [],
    sampleFormats: image?.sampleFormats ?? [],
    compression: image?.compression,
    topLevelIfds: inspection?.topLevelDirectoryCount ?? 0,
    subIfdCount: (inspection?.directories ?? []).reduce(
      (sum, directory) => sum + directory.subIfdOffsets.length,
      0,
    ),
    overviewLevels: overviewLevels(input.dataset, inspection),
    ...(spatial?.noData === undefined ? {} : { nodata: spatial.noData }),
    ...(spatial?.pixelToModel === undefined ? {} : { affine: spatial.pixelToModel }),
    ...(spatial?.crs === undefined ? {} : { crs: spatial.crs }),
    rangeRequests: range?.rangeRequests ?? 0,
    bytesFetched,
    cacheHits: range?.rangeCacheHits ?? 0,
    cacheMisses: range?.rangeCacheMisses ?? 0,
    percentFetched:
      percentFetchedApplies && size > 0
        ? (100 * coverageBytes(range?.uniqueBytes, bytesFetched, size)) / size
        : undefined,
    activeOverview: input.activeOverview,
    likelyCog: inspection?.likelyCog ?? false,
    issues: inspection?.issues ?? [],
  }
}

function coverageBytes(
  uniqueBytes: number | undefined,
  bytesFetched: number,
  size: number,
): number {
  if (uniqueBytes !== undefined) return uniqueBytes
  return Math.min(bytesFetched, size)
}

function primaryDirectory(
  inspection: CogInspectionReport | undefined,
): CogDirectoryInspection | undefined {
  return (
    inspection?.directories.find((directory) => directory.role === 'image') ??
    inspection?.directories[0]
  )
}

function axisLength(dataset: DatasetDescriptor, axisId: string): number | undefined {
  return dataset.axes.find((axis) => axis.id === axisId)?.length
}

function overviewLevels(
  dataset: DatasetDescriptor,
  inspection: CogInspectionReport | undefined,
): readonly Readonly<{ level: number; width: number; height: number }>[] {
  if (dataset.levels.length > 0) {
    return dataset.levels.map((level) => ({
      level: level.level,
      width: level.axisLengths.find((axis) => axis.axisId === 'x')?.length ?? 0,
      height: level.axisLengths.find((axis) => axis.axisId === 'y')?.length ?? 0,
    }))
  }
  return (inspection?.directories ?? [])
    .filter((directory) => directory.role === 'overview' || directory.role === 'image')
    .map((directory, index) => ({
      level: index,
      width: directory.width,
      height: directory.height,
    }))
}
