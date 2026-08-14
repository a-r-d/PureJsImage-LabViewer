import type {
  AxisDescriptor,
  DatasetDescriptor,
  OpenedSourceDescriptor,
  PlaneSelection,
} from '@pji-workbench/contracts'
import { RPC_LIMITS } from '@pji-workbench/contracts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificDatasetSummary,
  ScientificDocument,
  ScientificMetadataObject,
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
  return {
    id: axis.id,
    ...(axis.name === undefined ? {} : { name: axis.name }),
    kind: axis.kind,
    length: axis.length,
    ...(axis.unit === undefined ? {} : { unit: axis.unit }),
    coordinates: boundedValue(axis.coordinates, 0) as AxisDescriptor['coordinates'],
  }
}

export function datasetDescriptor(summary: ScientificDatasetSummary): DatasetDescriptor {
  const descriptor = summary.descriptor
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
    levels: descriptor.levels.map((level) => ({
      level: level.level,
      axisLengths: level.axisLengths.map(({ axisId, length }) => ({ axisId, length })),
    })),
    capabilities: descriptor.capabilities,
    ...(descriptor.metadata === undefined
      ? {}
      : { metadata: boundedMetadata(descriptor.metadata) }),
  }
}

export function defaultPlaneSelection(descriptor: DatasetDescriptor): PlaneSelection {
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
