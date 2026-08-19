import {
  type AxisDescriptor,
  type DatasetDescriptor,
  normalizeSpatialReference,
  type OpenedSourceDescriptor,
  type PlaneSelection,
  RPC_LIMITS,
  type SpatialReference,
} from '@pji-workbench/contracts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificCoordinateReferenceSystem,
  ScientificDatasetSummary,
  ScientificDocument,
  ScientificMetadataObject,
  ScientificNoData,
  ScientificSpatialReference,
} from 'purejsimage/scientific'

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
      .map(({ id }) => ({ axisId: id, index: 0 })),
    resolutionLevel: descriptor.levels[0]?.level ?? 0,
  }
}

export function openedSourceDescriptor(options: {
  readonly document: ScientificDocument
  readonly sourceId: OpenedSourceDescriptor['sourceId']
  readonly documentId: OpenedSourceDescriptor['documentId']
  readonly generation: number
  readonly kind: OpenedSourceDescriptor['source']['kind']
  readonly name: string
  readonly size: number
  readonly url?: string
}): OpenedSourceDescriptor {
  const identity = options.document.datasets[0]?.identity
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
      id: options.document.reader.id,
      version: options.document.reader.version,
      format: options.document.format,
    },
    metadata: boundedMetadata(options.document.metadata),
    datasets: options.document.datasets.map(datasetDescriptor),
  }
}
