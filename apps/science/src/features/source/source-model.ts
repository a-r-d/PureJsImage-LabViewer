import type { OpenedDatasetDescriptor, OpenedSourceDescriptor } from '@pji-workbench/contracts'

export const RECENT_SOURCE_KEY = 'pji-workbench.recent-source-names.v1'

export function fileSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`
}

export function readRecentSources(storage: Storage): readonly string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(RECENT_SOURCE_KEY) ?? '[]')
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : []
  } catch {
    return []
  }
}

export function axisPairOptions(
  opened: OpenedDatasetDescriptor,
): readonly (readonly [string, string])[] {
  const planeReads = opened.dataset.capabilities.planeReads
  if (planeReads.kind === 'ordered-axis-pairs') return planeReads.pairs
  const axes = opened.dataset.axes
  const pairs: (readonly [string, string])[] = []
  for (let horizontal = 0; horizontal < axes.length; horizontal += 1) {
    for (let vertical = horizontal + 1; vertical < axes.length; vertical += 1) {
      const left = axes[horizontal]
      const right = axes[vertical]
      if (left !== undefined && right !== undefined) pairs.push([left.id, right.id])
    }
  }
  return pairs
}

export function sourceLocatorDetail(kind: string): string {
  if (kind === 'sample') return 'generated'
  if (kind === 'bundled') return 'example'
  if (kind === 'local') return 'local file'
  if (kind === 'remote') return 'remote'
  if (kind === 'ome-zarr-remote') return 'OME-Zarr URL'
  if (kind === 'ome-zarr-directory') return 'OME-Zarr directory'
  if (kind === 'ome-zarr-zip') return 'OME-Zarr ZIP'
  return kind
}

export function datasetNavigatorDetail(
  dataset: Readonly<{
    descriptor: Readonly<{
      axes: readonly unknown[]
      levels: readonly unknown[]
      metadata?: Readonly<Record<string, unknown>>
    }>
  }>,
): string {
  const metadata = dataset.descriptor.metadata
  const kind = metadata?.['kind']
  const series = metadata?.['series']
  const well = metadata?.['well']
  const field =
    typeof well === 'object' && well !== null && 'field' in well
      ? (well as { field?: unknown }).field
      : undefined
  const parts = [
    typeof kind === 'string' ? kind : `${dataset.descriptor.axes.length}D`,
    typeof series === 'number' ? `series ${series}` : undefined,
    typeof field === 'string' ? field : undefined,
    dataset.descriptor.levels.length > 1 ? `${dataset.descriptor.levels.length} levels` : undefined,
  ].filter((part): part is string => typeof part === 'string' && part.length > 0)
  return parts.join(' · ')
}

export function calibrationLabel(opened: OpenedDatasetDescriptor | undefined): string {
  if (opened === undefined) return 'Uncalibrated'
  const axis = opened.dataset.axes.find(
    ({ id, coordinates, unit }) =>
      id === opened.selection.displayAxes[0] && coordinates.type === 'linear' && unit !== undefined,
  )
  if (axis?.coordinates.type !== 'linear' || axis.unit === undefined) return 'Uncalibrated'
  return `${axis.coordinates.step} ${axis.unit}/px`
}

export function sourceSummary(source: OpenedSourceDescriptor | undefined): string {
  return source === undefined
    ? 'No source open'
    : `${source.source.name} · ${sourceLocatorDetail(source.source.kind)}`
}
