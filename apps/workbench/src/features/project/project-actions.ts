import type { OpenedSourceDescriptor } from '@pji-workbench/contracts'
import { PUREJSIMAGE_PACKAGE_VERSION } from '@pji-workbench/imaging'
import {
  createEmptyWorkspace,
  type DisplayLayerState,
  datasetReferenceId,
  type LayerId,
  type ProjectId,
  type SemanticSourceId,
  serializeWorkspaceProject,
  validateSemanticIdentity,
  type WorkspaceDatasetReference,
  type WorkspaceMutation,
  type WorkspaceSnapshot,
  type WorkspaceSourceReference,
} from '@pji-workbench/workspace'

export const LAST_PROJECT_KEY = 'pji-workbench.last-project-id.v1'

export function createProject(title = 'Untitled microscopy project'): WorkspaceSnapshot {
  return createEmptyWorkspace(title, {
    projectId: crypto.randomUUID() as ProjectId,
    now: new Date().toISOString(),
    appVersion: '0.0.0',
    pureJsImageVersion: PUREJSIMAGE_PACKAGE_VERSION,
  })
}

const EMPTY_ANALYSIS_GRAPH = {
  schemaVersion: 1 as const,
  inputs: [],
  nodes: [],
  outputs: [],
}

export function mutationsToReplaceOpenSource(
  snapshot: WorkspaceSnapshot,
): readonly WorkspaceMutation[] {
  const mutations: WorkspaceMutation[] = []
  for (const binding of snapshot.analysis.bindings) {
    mutations.push({ kind: 'analysis.remove-binding', input: binding.input })
  }
  if (
    snapshot.analysis.graph.nodes.length > 0 ||
    snapshot.analysis.graph.inputs.length > 0 ||
    snapshot.analysis.graph.outputs.length > 0
  ) {
    mutations.push({ kind: 'analysis.set-graph', graph: EMPTY_ANALYSIS_GRAPH })
  }
  for (const source of snapshot.sources) {
    mutations.push({ kind: 'source.remove', sourceId: source.id })
  }
  return mutations
}

export function snapshotWithVisibleWorkflow(
  snapshot: WorkspaceSnapshot,
  workflow: Pick<WorkspaceSnapshot['workflow'], 'inspector' | 'bottom'>,
): WorkspaceSnapshot {
  if (
    snapshot.workflow.inspector === workflow.inspector &&
    snapshot.workflow.bottom === workflow.bottom
  ) {
    return snapshot
  }
  return {
    ...snapshot,
    workflow: {
      ...snapshot.workflow,
      inspector: workflow.inspector,
      bottom: workflow.bottom,
    },
  }
}

export function projectSourceMutation(
  nextSource: OpenedSourceDescriptor,
  locator: WorkspaceSourceReference['locator'],
): Extract<WorkspaceMutation, { readonly kind: 'source.add' }> {
  const sourceId = `source-${crypto.randomUUID()}` as SemanticSourceId
  const source: WorkspaceSourceReference = {
    id: sourceId,
    label: nextSource.source.name,
    locator,
    identity: validateSemanticIdentity(nextSource.identity),
    reader: nextSource.reader,
    bound: true,
  }
  const datasets: readonly WorkspaceDatasetReference[] = nextSource.datasets.map((descriptor) => ({
    id: datasetReferenceId(sourceId, descriptor.id),
    sourceId,
    datasetId: descriptor.id,
    identity: validateSemanticIdentity(descriptor.identity),
    descriptor,
  }))
  const first = datasets[0]
  return {
    kind: 'source.add',
    source,
    datasets,
    ...(first === undefined
      ? {}
      : {
          layers: [
            {
              id: `layer-${crypto.randomUUID()}` as LayerId,
              datasetReferenceId: first.id,
              label: first.descriptor.name ?? first.datasetId,
              visible: true,
              opacity: 1,
              mapping: { mode: 'linear', range: 'auto' },
              palette: 'gray',
            } satisfies DisplayLayerState,
          ],
        }),
  }
}

export function downloadProject(snapshot: WorkspaceSnapshot): void {
  const blob = new Blob([serializeWorkspaceProject(snapshot)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${snapshot.project.title.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase() || 'project'}.pji-lab.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
