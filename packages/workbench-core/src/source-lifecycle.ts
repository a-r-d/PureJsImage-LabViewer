import type {
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  PlaneSelection,
} from '@pji-workbench/contracts'
import {
  datasetReferenceId,
  type SemanticSourceId,
  validateSemanticIdentity,
  type WorkspaceDatasetReference,
  type WorkspaceMutation,
  type WorkspaceSnapshot,
  type WorkspaceSourceReference,
} from '@pji-workbench/workspace'

import { mutationsToReplaceOpenSource, projectSourceMutation } from './project-lifecycle.js'

export interface LocalFileRef {
  readonly name: string
  readonly size: number
  readonly lastModified: number
}

export function sampleSourceLocator(
  sampleId: string,
): Extract<WorkspaceSourceReference['locator'], { readonly kind: 'sample' }> {
  return { kind: 'sample', sampleId }
}

export function remoteSourceLocator(
  url: string,
): Extract<WorkspaceSourceReference['locator'], { readonly kind: 'remote' }> {
  return { kind: 'remote', url }
}

export function localSourceLocator(
  files: readonly LocalFileRef[],
): Extract<WorkspaceSourceReference['locator'], { readonly kind: 'local' }> {
  const primary = files[0]
  if (primary === undefined) throw new Error('A local source requires at least one file.')
  return {
    kind: 'local',
    name: primary.name,
    size: primary.size,
    lastModified: primary.lastModified,
    companionNames: files.slice(1).map(({ name }) => name),
  }
}

export interface SourceOpenWorkspacePorts {
  currentSnapshot(): WorkspaceSnapshot
  applyMutation(mutation: WorkspaceMutation): void
}

export function commitOpenedSource(
  ports: SourceOpenWorkspacePorts,
  nextSource: OpenedSourceDescriptor,
  locator: WorkspaceSourceReference['locator'],
  nextDataset: OpenedDatasetDescriptor,
): Extract<WorkspaceMutation, { readonly kind: 'source.add' }> {
  if (nextSource.datasets[0] === undefined)
    throw new Error('The document contains no scientific datasets.')
  const sourceMutation = projectSourceMutation(nextSource, locator)
  const dataset = sourceMutation.datasets[0]
  if (dataset === undefined) throw new Error('The document contains no scientific datasets.')
  const previous = ports.currentSnapshot()
  const leftoverRois = previous.analysis.roiSet.rois
  for (const leftover of mutationsToReplaceOpenSource(previous)) {
    ports.applyMutation(leftover)
  }
  const mutation: WorkspaceMutation = {
    ...sourceMutation,
    activate: {
      sourceId: sourceMutation.source.id,
      datasetReferenceId: dataset.id,
      plane: nextDataset.selection,
      component: 0,
    },
  }
  ports.applyMutation(mutation)
  for (const roi of leftoverRois) ports.applyMutation({ kind: 'roi.remove', roiId: roi.id })
  if (leftoverRois.length > 0 || ports.currentSnapshot().workflow.selectedRoiId !== undefined)
    ports.applyMutation({ kind: 'roi.select' })
  return sourceMutation
}

export function datasetSelectMutation(
  sourceId: SemanticSourceId,
  datasetReferenceIdValue: WorkspaceDatasetReference['id'],
  plane: PlaneSelection,
  component = 0,
): WorkspaceMutation {
  return {
    kind: 'dataset.select',
    selection: {
      sourceId,
      datasetReferenceId: datasetReferenceIdValue,
      plane,
      component,
    },
  }
}

export function sourceRebindMutation(
  sourceId: SemanticSourceId,
  files: readonly LocalFileRef[],
  nextSource: OpenedSourceDescriptor,
): Extract<WorkspaceMutation, { readonly kind: 'source.rebind' }> {
  const datasets: readonly WorkspaceDatasetReference[] = nextSource.datasets.map((descriptor) => ({
    id: datasetReferenceId(sourceId, descriptor.id),
    sourceId,
    datasetId: descriptor.id,
    identity: validateSemanticIdentity(descriptor.identity),
    descriptor,
  }))
  return {
    kind: 'source.rebind',
    sourceId,
    locator: localSourceLocator(files),
    identity: validateSemanticIdentity(nextSource.identity),
    bound: true,
    datasets,
  }
}

export function formatOpenSourceError(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    'detail' in error &&
    typeof error.detail === 'object' &&
    error.detail !== null &&
    'guidance' in error.detail
  ) {
    const guidance = error.detail.guidance
    return `${error.message}${typeof guidance === 'string' ? ` ${guidance}` : ''}`
  }
  if (error instanceof Error) return error.message
  return 'Unable to open the source.'
}
