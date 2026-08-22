import {
  type AxisDescriptor,
  type DatasetDescriptor,
  type GeoGridGeometryV1,
  type GeoRasterDescriptorV1,
  type GeoZarrStructuralDiagnosticsV1,
  normalizeSpatialReference,
  type OpenedSourceDescriptor,
  type PlaneSelection,
  RPC_LIMITS,
  type SpatialReference,
} from '@pji-workbench/contracts'
import type { GeoRasterDatasetSummary, GeoRasterDescriptor } from 'purejsimage/geo'
import type { GeoZarrStructuralReport } from 'purejsimage/geo/readers/geozarr'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificCoordinateReferenceSystem,
  ScientificDatasetSummary,
  ScientificDocument,
  ScientificMetadataObject,
  ScientificNoData,
  ScientificSpatialReference,
} from 'purejsimage/scientific'

type ImagingDocument =
  | Readonly<{ kind: 'scientific'; value: ScientificDocument }>
  | Readonly<{
      kind: 'geo'
      value: import('purejsimage/geo').GeoRasterDocument
      identity: Readonly<Record<string, unknown>>
    }>

function boundedValue(value: unknown, depth: number): unknown {
  if (depth > RPC_LIMITS.maxMetadataDepth) return '[depth limit]'
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, RPC_LIMITS.maxStringLength)
  if (Array.isArray(value)) {
    return value.slice(0, RPC_LIMITS.maxItems).map((item) => boundedValue(item, depth + 1))
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, RPC_LIMITS.maxItems)
        .map(([key, item]) => [
          key.slice(0, RPC_LIMITS.maxStringLength),
          boundedValue(item, depth + 1),
        ]),
    )
  }
  return String(value).slice(0, RPC_LIMITS.maxStringLength)
}

export function boundedMetadata(
  metadata: ScientificMetadataObject,
): Readonly<Record<string, unknown>> {
  return boundedValue(metadata, 0) as Readonly<Record<string, unknown>>
}

function axisDescriptor(
  axis: NormalizedScientificDatasetDescriptor['axes'][number],
): AxisDescriptor {
  const descriptor: AxisDescriptor = {
    id: axis.id,
    ...(axis.name === undefined ? {} : { name: axis.name }),
    kind: axis.kind,
    length: axis.length,
    ...(axis.unit === undefined ? {} : { unit: axis.unit }),
    coordinates: boundedValue(axis.coordinates, 0) as AxisDescriptor['coordinates'],
  }
  if (axis.calibration === undefined) return descriptor
  return {
    ...descriptor,
    calibration: boundedValue(axis.calibration, 0) as NonNullable<AxisDescriptor['calibration']>,
  }
}

function datasetCapabilities(
  capabilities: NormalizedScientificDatasetDescriptor['capabilities'],
): DatasetDescriptor['capabilities'] {
  const mapped: DatasetDescriptor['capabilities'] = {
    regionReads: capabilities.regionReads,
    resolutionLevels: capabilities.resolutionLevels,
    planeReads: capabilities.planeReads,
  }
  if (capabilities.seriesReads === undefined) return mapped
  return { ...mapped, seriesReads: capabilities.seriesReads }
}

function jsonSafeScalar(value: number | string): number | string {
  if (typeof value === 'string') return value
  if (Number.isFinite(value)) return value
  if (Number.isNaN(value)) return 'NaN'
  return value > 0 ? 'Infinity' : '-Infinity'
}

function crsFromScientific(crs: ScientificCoordinateReferenceSystem): SpatialReference['crs'] {
  switch (crs.kind) {
    case 'projected':
    case 'geographic':
    case 'unknown':
      return {
        kind: crs.kind,
        ...(crs.authority === undefined ? {} : { authority: crs.authority }),
        ...(crs.code === undefined ? {} : { code: crs.code }),
        ...(crs.name === undefined ? {} : { name: crs.name }),
      }
    default: {
      const unexpected: never = crs.kind
      throw new Error(`Unsupported CRS kind: ${String(unexpected)}`)
    }
  }
}

function pixelInterpretationFromScientific(
  value: ScientificSpatialReference['pixelInterpretation'],
): SpatialReference['pixelInterpretation'] {
  switch (value) {
    case 'pixel-is-area':
    case 'pixel-is-point':
    case 'unspecified':
      return value
    default: {
      const unexpected: never = value
      throw new Error(`Unsupported pixel interpretation: ${String(unexpected)}`)
    }
  }
}

function affineFromScientific(
  values: NonNullable<ScientificSpatialReference['pixelToModel']>,
): NonNullable<SpatialReference['pixelToModel']> {
  if (values.length !== 6) {
    throw new Error('Spatial affine must contain exactly six values')
  }
  return [values[0], values[1], values[2], values[3], values[4], values[5]]
}

function noDataFromScientific(noData: ScientificNoData): SpatialReference['noData'] {
  switch (noData.kind) {
    case 'scalar':
      return { kind: 'scalar', value: jsonSafeScalar(noData.value) }
    case 'components':
      return {
        kind: 'components',
        values: noData.values.map((value) => jsonSafeScalar(value)),
      }
    default: {
      const unexpected: never = noData
      throw new Error(`Unsupported NoData kind: ${JSON.stringify(unexpected)}`)
    }
  }
}

function spatialReferenceFromScientific(
  value: ScientificSpatialReference,
  componentCount: number,
): SpatialReference {
  const mapped = {
    crs: crsFromScientific(value.crs),
    pixelInterpretation: pixelInterpretationFromScientific(value.pixelInterpretation),
    ...(value.pixelToModel === undefined
      ? {}
      : { pixelToModel: affineFromScientific(value.pixelToModel) }),
    ...(value.modelToPixel === undefined
      ? {}
      : { modelToPixel: affineFromScientific(value.modelToPixel) }),
    ...(value.bounds === undefined
      ? {}
      : {
          bounds: {
            minX: value.bounds.minX,
            minY: value.bounds.minY,
            maxX: value.bounds.maxX,
            maxY: value.bounds.maxY,
          },
        }),
    ...(value.noData === undefined ? {} : { noData: noDataFromScientific(value.noData) }),
    ...(value.metadata === undefined ? {} : { metadata: boundedMetadata(value.metadata) }),
  }
  return normalizeSpatialReference(mapped, { componentCount })
}

function resolutionLevelDescriptor(
  level: NormalizedScientificDatasetDescriptor['levels'][number],
  componentCount: number,
): DatasetDescriptor['levels'][number] {
  const descriptor: DatasetDescriptor['levels'][number] = {
    level: level.level,
    axisLengths: level.axisLengths.map(({ axisId, length }) => ({ axisId, length })),
  }
  if (level.spatialReference === undefined) return descriptor
  return {
    ...descriptor,
    spatialReference: spatialReferenceFromScientific(level.spatialReference, componentCount),
  }
}

export function datasetDescriptor(summary: ScientificDatasetSummary): DatasetDescriptor {
  const descriptor = summary.descriptor
  const componentCount = descriptor.components.length
  return {
    id: summary.id,
    identity: summary.identity as unknown as Readonly<Record<string, unknown>>,
    ...(summary.name === undefined ? {} : { name: summary.name }),
    sampleType: descriptor.sampleType,
    axes: descriptor.axes.map(axisDescriptor),
    components: descriptor.components.map((component) => ({
      id: component.id,
      ...(component.name === undefined ? {} : { name: component.name }),
      kind: component.kind,
      ...(component.unit === undefined ? {} : { unit: component.unit }),
      ...(component.color === undefined ? {} : { color: component.color }),
    })),
    levels: descriptor.levels.map((level) => resolutionLevelDescriptor(level, componentCount)),
    capabilities: datasetCapabilities(descriptor.capabilities),
    ...(descriptor.spatialReference === undefined
      ? {}
      : {
          spatialReference: spatialReferenceFromScientific(
            descriptor.spatialReference,
            componentCount,
          ),
        }),
    ...(descriptor.metadata === undefined
      ? {}
      : { metadata: boundedMetadata(descriptor.metadata) }),
  }
}

function geoGridGeometry(value: GeoRasterDescriptor['grid']): GeoGridGeometryV1 {
  return boundedValue(value, 0) as GeoGridGeometryV1
}

export function geoRasterDescriptor(value: GeoRasterDescriptor): GeoRasterDescriptorV1 {
  const projected = {
    schemaVersion: 1,
    id: value.id,
    ...(value.title === undefined ? {} : { title: value.title }),
    shape: [...value.shape],
    dimensions: value.dimensions.map((dimension) => ({ ...dimension })),
    spatialDimensions: {
      x: { ...value.spatialDimensions.x },
      y: { ...value.spatialDimensions.y },
    },
    axes: value.axes.map((axis) => ({
      ...axis,
      coordinates: boundedValue(
        axis.coordinates,
        0,
      ) as GeoRasterDescriptorV1['axes'][number]['coordinates'],
      ...(axis.metadata === undefined
        ? {}
        : {
            metadata: boundedMetadata(
              axis.metadata,
            ) as GeoRasterDescriptorV1['axes'][number]['metadata'],
          }),
    })),
    sampleType: value.sampleType,
    bands: value.bands.map((band) => ({
      ...band,
      ...(band.categories === undefined
        ? {}
        : {
            categories: band.categories.map((category) => ({
              ...category,
              ...(category.metadata === undefined
                ? {}
                : { metadata: boundedMetadata(category.metadata) }),
            })),
          }),
    })),
    levels: value.levels.map((level) => ({
      ...level,
      geometry: geoGridGeometry(level.geometry),
      storage: {
        ...level.storage,
        ...(level.storage.metadata === undefined
          ? {}
          : { metadata: boundedMetadata(level.storage.metadata) }),
      },
    })),
    primaryLevelId: value.primaryLevelId,
    spatialReference: boundedValue(
      value.spatialReference,
      0,
    ) as GeoRasterDescriptorV1['spatialReference'],
    grid: geoGridGeometry(value.grid),
    capabilities: { ...value.capabilities },
    sourceFormat: { ...value.sourceFormat },
    ...(value.formatEvidence === undefined
      ? {}
      : { formatEvidence: boundedMetadata(value.formatEvidence) }),
    diagnostics: boundedValue(value.diagnostics, 0) as GeoRasterDescriptorV1['diagnostics'],
  }
  return projected as unknown as GeoRasterDescriptorV1
}

function geoCompatibilitySpatialReference(value: GeoRasterDescriptor): SpatialReference {
  const crsKind =
    value.spatialReference.coordinateSystemType === 'projected' ||
    value.spatialReference.coordinateSystemType === 'geographic'
      ? value.spatialReference.coordinateSystemType
      : 'unknown'
  return normalizeSpatialReference(
    {
      crs: {
        kind: crsKind,
        ...(value.spatialReference.authority === undefined
          ? {}
          : { authority: value.spatialReference.authority }),
        ...(value.spatialReference.code === undefined ? {} : { code: value.spatialReference.code }),
        ...(value.spatialReference.name === undefined ? {} : { name: value.spatialReference.name }),
      },
      pixelInterpretation:
        value.grid.pixelRegistration === 'unknown' ? 'unspecified' : value.grid.pixelRegistration,
      pixelToModel: [...value.grid.pixelToWorld],
      ...(value.grid.worldToPixel === undefined
        ? {}
        : { modelToPixel: [...value.grid.worldToPixel] }),
      bounds: { ...value.grid.worldBounds },
      ...(value.grid.noData.kind === 'none'
        ? {}
        : value.grid.noData.kind === 'scalar'
          ? { noData: { kind: 'scalar' as const, value: value.grid.noData.value } }
          : { noData: { kind: 'components' as const, values: [...value.grid.noData.values] } }),
    },
    { componentCount: Math.max(1, value.bands.length) },
  )
}

export function geoDatasetDescriptor(
  summary: GeoRasterDatasetSummary,
  identity: Readonly<Record<string, unknown>>,
): DatasetDescriptor {
  const descriptor = summary.descriptor
  const spatialAxes = [
    descriptor.spatialDimensions.x.id,
    descriptor.spatialDimensions.y.id,
  ] as const
  const geoAxisByDimension = new Map(descriptor.axes.map((axis) => [axis.dimensionIndex, axis]))
  return {
    id: summary.id,
    identity,
    ...(summary.name === undefined ? {} : { name: summary.name }),
    sampleType: descriptor.sampleType,
    axes: descriptor.dimensions.map((dimension) => {
      const geoAxis = geoAxisByDimension.get(dimension.index)
      return {
        id: dimension.id,
        ...(dimension.name === undefined ? {} : { name: dimension.name }),
        kind: geoAxis?.kind ?? dimension.kind,
        length: dimension.length,
        ...(geoAxis?.unit === undefined ? {} : { unit: geoAxis.unit }),
        coordinates:
          geoAxis === undefined
            ? ({ type: 'index' } as const)
            : geoAxis.coordinates.kind === 'linear'
              ? ({
                  type: 'linear',
                  origin: geoAxis.coordinates.origin,
                  step: geoAxis.coordinates.step,
                } as const)
              : geoAxis.coordinates.kind === 'values'
                ? geoAxis.coordinates.values.every((entry) => typeof entry === 'number')
                  ? ({
                      type: 'lookup',
                      values: geoAxis.coordinates.values as readonly number[],
                    } as const)
                  : ({ type: 'labels', values: geoAxis.coordinates.values.map(String) } as const)
                : ({ type: 'index' } as const),
      }
    }),
    components: descriptor.bands.map((band, index) => ({
      id: `band-${index}`,
      name: band.name,
      kind: band.colorInterpretation,
      ...(band.unit === undefined ? {} : { unit: band.unit }),
    })),
    levels: descriptor.levels.map((level) => ({
      level: level.sourceResolutionLevel,
      axisLengths: descriptor.dimensions.map((dimension) => ({
        axisId: dimension.id,
        length:
          dimension.id === spatialAxes[0]
            ? level.width
            : dimension.id === spatialAxes[1]
              ? level.height
              : dimension.length,
      })),
      spatialReference: geoCompatibilitySpatialReference({ ...descriptor, grid: level.geometry }),
    })),
    capabilities: {
      regionReads: descriptor.capabilities.pixelRegionReads,
      resolutionLevels: descriptor.capabilities.resolutionLevels,
      planeReads: { kind: 'ordered-axis-pairs', pairs: [spatialAxes] },
    },
    spatialReference: geoCompatibilitySpatialReference(descriptor),
    geo: geoRasterDescriptor(descriptor),
  }
}

export function geoZarrStructuralDiagnostics(
  report: GeoZarrStructuralReport,
): GeoZarrStructuralDiagnosticsV1 {
  return {
    schemaVersion: 1,
    zarrFormat: report.zarrFormat,
    storeKind: report.storeKind,
    rootNodeType: report.rootNodeType,
    rootMetadataObject: report.rootMetadataObject,
    datasets: report.datasets.map((dataset) => ({
      id: dataset.id,
      ...(dataset.title === undefined ? {} : { title: dataset.title }),
      levels: dataset.levels.map((level) => ({
        id: level.id,
        order: level.order,
        path: level.array.path,
        shape: [...level.array.shape],
        dimensions: [...level.array.dimensions],
        sampleType: level.array.sampleType,
        logicalChunkShape: [...level.array.logicalChunkShape],
        ...(level.array.outerShardShape === undefined
          ? {}
          : { outerShardShape: [...level.array.outerShardShape] }),
        sharded: level.array.sharded,
        codecs: [...level.array.codecs],
      })),
      diagnostics: boundedValue(
        dataset.diagnostics,
        0,
      ) as GeoZarrStructuralDiagnosticsV1['datasets'][number]['diagnostics'],
    })),
    io: { ...report.io },
    structuralMetadata: boundedValue(
      {
        conventions: report.conventions,
        store: report.store,
        compatibilityWarnings: report.compatibilityWarnings,
      },
      0,
    ) as GeoZarrStructuralDiagnosticsV1['structuralMetadata'],
  }
}

export function defaultPlaneSelection(descriptor: DatasetDescriptor): PlaneSelection {
  if (descriptor.capabilities.planeReads.kind === 'none') {
    throw new Error(
      'This dataset is one-dimensional. The workbench currently displays two-dimensional planes only.',
    )
  }
  const firstAxis = descriptor.axes[0]
  const secondAxis = descriptor.axes[1]
  const pair =
    descriptor.capabilities.planeReads.kind === 'ordered-axis-pairs'
      ? descriptor.capabilities.planeReads.pairs[0]
      : descriptor.axes.some(({ id }) => id === 'x') && descriptor.axes.some(({ id }) => id === 'y')
        ? (['x', 'y'] as const)
        : firstAxis !== undefined && secondAxis !== undefined
          ? ([firstAxis.id, secondAxis.id] as const)
          : undefined
  if (pair?.[0] === undefined || pair[1] === undefined) {
    throw new Error('The dataset does not expose a two-dimensional plane')
  }
  return {
    displayAxes: pair,
    fixedIndices: descriptor.axes
      .filter(({ id }) => id !== pair[0] && id !== pair[1])
      .map((axis) => ({ axisId: axis.id, index: defaultFixedIndex(descriptor, axis) })),
    resolutionLevel: descriptor.levels[0]?.level ?? 0,
  }
}

function defaultFixedIndex(descriptor: DatasetDescriptor, axis: AxisDescriptor): number {
  const display = descriptor.metadata?.['omeZarrDisplay']
  const rdefs =
    typeof display === 'object' && display !== null && !Array.isArray(display)
      ? (display as Readonly<Record<string, unknown>>)['rdefs']
      : undefined
  const defaults =
    typeof rdefs === 'object' && rdefs !== null && !Array.isArray(rdefs)
      ? (rdefs as Readonly<Record<string, unknown>>)
      : undefined
  const authored =
    axis.kind === 'time' || axis.id === 't' || axis.id === 'T'
      ? defaults?.['defaultT']
      : axis.id === 'z' || axis.id === 'Z'
        ? defaults?.['defaultZ']
        : undefined
  const index = typeof authored === 'number' && Number.isInteger(authored) ? authored : 0
  return Math.min(Math.max(0, index), Math.max(0, axis.length - 1))
}

export function openedSourceDescriptor(options: {
  readonly document: ImagingDocument
  readonly sourceId: OpenedSourceDescriptor['sourceId']
  readonly documentId: OpenedSourceDescriptor['documentId']
  readonly generation: number
  readonly kind: OpenedSourceDescriptor['source']['kind']
  readonly name: string
  readonly size: number
  readonly url?: string
}): OpenedSourceDescriptor {
  const document = options.document.value
  const identity =
    options.document.kind === 'scientific'
      ? options.document.value.datasets[0]?.identity
      : options.document.identity
  if (identity === undefined) throw new Error('The document does not expose a semantic identity')
  return {
    sourceId: options.sourceId,
    documentId: options.documentId,
    generation: options.generation,
    identity: identity as unknown as Readonly<Record<string, unknown>>,
    source: {
      kind: options.kind,
      name: options.name.slice(0, RPC_LIMITS.maxStringLength),
      size: options.size,
      ...(options.url === undefined ? {} : { url: options.url }),
    },
    reader: {
      id: document.reader.id,
      version: document.reader.version,
      format: document.format,
    },
    metadata: boundedMetadata(document.metadata),
    datasets:
      options.document.kind === 'scientific'
        ? options.document.value.datasets.map(datasetDescriptor)
        : options.document.value.datasets.map((summary) =>
            geoDatasetDescriptor(summary, identity as Readonly<Record<string, unknown>>),
          ),
  }
}
