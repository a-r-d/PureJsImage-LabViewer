import type { AnalysisSemanticIdentity } from 'purejsimage/analysis'

import type {
  WorkspaceDatasetReference,
  WorkspaceSelection,
  WorkspaceSnapshot,
  WorkspaceSourceReference,
} from './model.js'
import { deterministicJson } from './serialization.js'
import { semanticIdentityEqual } from './validation.js'

export type SourceIdentityDecision =
  | Readonly<{ kind: 'match' }>
  | Readonly<{
      kind: 'mismatch'
      expected: AnalysisSemanticIdentity
      actual: AnalysisSemanticIdentity
      message: string
    }>

export interface WorkspaceRuntimePort {
  materialize(
    source: WorkspaceSourceReference,
    dataset: WorkspaceDatasetReference,
    selection: WorkspaceSelection,
    signal: AbortSignal,
  ): Promise<AnalysisSemanticIdentity>
  releaseSource(sourceId: WorkspaceSourceReference['id']): Promise<void>
  cancelObsoleteAnalysis(reason: string): Promise<void>
}

export interface WorkspaceRuntimeReconciliation {
  readonly status: 'ready' | 'needs-rebind' | 'identity-mismatch' | 'no-active-dataset'
  readonly identity?: SourceIdentityDecision
  readonly source?: WorkspaceSourceReference
}

export class WorkspaceRuntimeReconciler {
  #controller: AbortController | undefined

  constructor(readonly port: WorkspaceRuntimePort) {}

  async reconcile(
    previous: WorkspaceSnapshot | undefined,
    current: WorkspaceSnapshot,
  ): Promise<WorkspaceRuntimeReconciliation> {
    this.#controller?.abort(new DOMException('Superseded workspace revision', 'AbortError'))
    const controller = new AbortController()
    this.#controller = controller
    const previousGraph =
      previous === undefined ? undefined : deterministicJson(previous.analysis.graph)
    const currentGraph = deterministicJson(current.analysis.graph)
    if (previousGraph !== undefined && previousGraph !== currentGraph) {
      await this.port.cancelObsoleteAnalysis('The semantic analysis graph changed.')
    }
    if (previous !== undefined) {
      const currentSourceIds = new Set(current.sources.map(({ id }) => id))
      for (const source of previous.sources) {
        if (!currentSourceIds.has(source.id)) await this.port.releaseSource(source.id)
      }
    }
    if (current.active === undefined) return { status: 'no-active-dataset' }
    const source = current.sources.find(({ id }) => id === current.active?.sourceId)
    const dataset = current.datasets.find(({ id }) => id === current.active?.datasetReferenceId)
    if (source === undefined || dataset === undefined) return { status: 'no-active-dataset' }
    if (source.locator.kind === 'local' && !source.bound) {
      return { status: 'needs-rebind', source }
    }
    const actual = await this.port.materialize(source, dataset, current.active, controller.signal)
    if (!semanticIdentityEqual(source.identity, actual)) {
      return {
        status: 'identity-mismatch',
        source,
        identity: {
          kind: 'mismatch',
          expected: source.identity,
          actual,
          message: 'The selected source does not match the identity saved with this project.',
        },
      }
    }
    return { status: 'ready', source, identity: { kind: 'match' } }
  }

  cancel(): void {
    this.#controller?.abort(new DOMException('Runtime reconciliation cancelled', 'AbortError'))
    this.#controller = undefined
  }
}
