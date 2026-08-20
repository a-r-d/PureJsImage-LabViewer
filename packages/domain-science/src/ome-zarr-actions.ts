import type { JsonValue } from '@pji-workbench/actions'
import type {
  DisplayMapping,
  OpenedSourceDescriptor,
  SourceRangeDiagnostics,
} from '@pji-workbench/contracts'
import type { WorkspaceSnapshot } from '@pji-workbench/workspace'

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export function omeZarrStoreDescription(
  source: OpenedSourceDescriptor | undefined,
  snapshot: WorkspaceSnapshot,
): JsonValue {
  if (source === undefined) return { available: false }
  return json({
    kind: source.source.kind,
    name: source.source.name,
    reader: source.reader,
    omeNgffVersion: source.metadata['omeNgffVersion'] ?? null,
    zarrFormat: source.metadata['zarrFormat'] ?? null,
    store: source.metadata['store'] ?? null,
    plate: source.metadata['plate'] ?? null,
    bioformats2rawLayout: source.metadata['bioformats2rawLayout'] ?? null,
    seriesCount: source.metadata['seriesCount'] ?? null,
    identity: source.metadata['omeZarrIdentity'] ?? null,
    selectedDatasetId:
      snapshot.datasets.find(({ id }) => id === snapshot.active?.datasetReferenceId)?.datasetId ??
      snapshot.datasets[0]?.datasetId ??
      null,
    untrusted: true,
  })
}

export function omeZarrDatasetList(snapshot: WorkspaceSnapshot): JsonValue {
  return json(
    snapshot.datasets.slice(0, 256).map((dataset) => ({
      id: dataset.datasetId,
      name: dataset.descriptor.name ?? dataset.datasetId,
      kind: dataset.descriptor.metadata?.['kind'] ?? 'image',
      series: dataset.descriptor.metadata?.['series'] ?? null,
      well: dataset.descriptor.metadata?.['well'] ?? null,
      axes: dataset.descriptor.axes.map(({ id, length, unit }) => ({
        id,
        length,
        unit: unit ?? null,
      })),
      levels: dataset.descriptor.levels.length,
      untrusted: true,
    })),
  )
}

export function omeZarrDatasetDescription(
  snapshot: WorkspaceSnapshot,
  datasetId: string | undefined,
): JsonValue {
  const dataset =
    datasetId === undefined
      ? snapshot.datasets.find(({ id }) => id === snapshot.active?.datasetReferenceId)
      : snapshot.datasets.find((entry) => entry.datasetId === datasetId || entry.id === datasetId)
  if (dataset === undefined) return { available: false }
  return json({
    id: dataset.datasetId,
    name: dataset.descriptor.name ?? dataset.datasetId,
    kind: dataset.descriptor.metadata?.['kind'] ?? 'image',
    axes: dataset.descriptor.axes,
    levels: dataset.descriptor.levels.map(({ level, axisLengths }) => ({ level, axisLengths })),
    omeZarrDisplay: dataset.descriptor.metadata?.['omeZarrDisplay'] ?? null,
    omeZarrLevels: dataset.descriptor.metadata?.['omeZarrLevels'] ?? null,
    well: dataset.descriptor.metadata?.['well'] ?? null,
    imageLabel: dataset.descriptor.metadata?.['imageLabel'] ?? null,
    series: dataset.descriptor.metadata?.['series'] ?? null,
    untrusted: true,
  })
}

export function omeZarrStorageDescription(snapshot: WorkspaceSnapshot): JsonValue {
  const dataset = snapshot.datasets.find(({ id }) => id === snapshot.active?.datasetReferenceId)
  return json({
    selectedLevel: snapshot.active?.plane.resolutionLevel ?? 0,
    omeZarrLevels: dataset?.descriptor.metadata?.['omeZarrLevels'] ?? [],
  })
}

export function omeZarrNetworkDescription(
  diagnostics: SourceRangeDiagnostics | undefined,
): JsonValue {
  if (diagnostics === undefined) return { available: false }
  return json({
    objectRequests: diagnostics.omeZarrNetwork?.objectRequests ?? diagnostics.rangeRequests,
    rangeRequests: diagnostics.omeZarrNetwork?.rangeRequests ?? diagnostics.rangeRequests,
    metadataBytes: diagnostics.omeZarrNetwork?.metadataBytesFetched ?? null,
    arrayBytes: diagnostics.omeZarrNetwork?.arrayBytesFetched ?? null,
    uniqueBytes: diagnostics.uniqueBytes ?? diagnostics.omeZarrNetwork?.uniqueBytes ?? null,
    cacheBytes: diagnostics.rangeCacheBytes,
    cacheHits: diagnostics.rangeCacheHits,
    cancelledRequests: diagnostics.omeZarrNetwork?.abortedConsumers ?? null,
    identity: diagnostics.omeZarrIdentity ?? null,
  })
}

export function displayChannelsDescription(mapping: DisplayMapping): JsonValue {
  return json({
    colorModel: mapping.colorModel ?? null,
    channels: mapping.omeZarrChannels ?? [],
  })
}
