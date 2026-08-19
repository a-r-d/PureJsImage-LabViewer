import type { OpenedDatasetDescriptor, OpenedSourceDescriptor } from '@pji-workbench/contracts'
import type { ImagingWorkerClient } from '@pji-workbench/imaging'
import type {
  SemanticSourceId,
  WorkspaceDatasetReference,
  WorkspaceRuntimePort,
  WorkspaceSelection,
  WorkspaceSourceReference,
} from '@pji-workbench/workspace'
import { semanticIdentityEqual, validateSemanticIdentity } from '@pji-workbench/workspace'

export interface RuntimeMaterialization {
  readonly semanticSourceId: SemanticSourceId
  readonly source: OpenedSourceDescriptor
  readonly dataset: OpenedDatasetDescriptor
}

export class WorkbenchWorkspaceRuntime implements WorkspaceRuntimePort {
  readonly #localBindings = new Map<SemanticSourceId, readonly File[]>()
  #materialization: RuntimeMaterialization | undefined
  #generation = 0
  #analysisController: AbortController | undefined

  constructor(readonly client: ImagingWorkerClient) {}

  get current(): RuntimeMaterialization | undefined {
    return this.#materialization
  }

  bindLocalFiles(sourceId: SemanticSourceId, files: readonly File[]): void {
    this.#localBindings.set(sourceId, files)
  }

  adopt(
    semanticSourceId: SemanticSourceId,
    source: OpenedSourceDescriptor,
    dataset: OpenedDatasetDescriptor,
  ): void {
    this.#generation = Math.max(this.#generation, source.generation)
    this.#materialization = { semanticSourceId, source, dataset }
  }

  clearRuntime(): void {
    this.#materialization = undefined
  }

  async materialize(
    source: WorkspaceSourceReference,
    dataset: WorkspaceDatasetReference,
    selection: WorkspaceSelection,
    signal: AbortSignal,
  ) {
    const cached = this.#materialization
    if (cached?.semanticSourceId === source.id && cached.dataset.dataset.id === dataset.datasetId) {
      const actual = validateSemanticIdentity(cached.source.identity)
      if (semanticIdentityEqual(source.identity, actual)) {
        if (JSON.stringify(cached.dataset.selection) !== JSON.stringify(selection.plane)) {
          await this.client.setPlane(
            cached.dataset.handleId,
            cached.dataset.generation,
            selection.plane,
          )
          this.#materialization = {
            ...cached,
            dataset: { ...cached.dataset, selection: selection.plane },
          }
        }
        return actual
      }
    }
    const generation = this.#generation + 1
    let openedSource: OpenedSourceDescriptor
    let openedDataset: OpenedDatasetDescriptor | undefined
    if (source.locator.kind === 'sample') {
      openedSource = await this.client.openSample(generation, signal, source.locator.sampleId)
    } else if (source.locator.kind === 'bundled') {
      const bundled = await this.client.openBundled(source.locator, generation, signal)
      openedSource = bundled.source
      openedDataset = bundled.dataset
    } else if (source.locator.kind === 'remote') {
      openedSource = await this.client.openRemote(source.locator.url, generation, signal)
    } else {
      const locator = source.locator
      const files = this.#localBindings.get(source.id)
      const primary = files?.find(({ name }) => name === locator.name)
      if (files === undefined || primary === undefined) {
        throw new Error(`Local source ${source.label} must be rebound before it can be replayed.`)
      }
      openedSource = await this.client.openLocal(files, primary, generation, signal)
    }
    openedDataset ??= await this.client.openDataset(
      openedSource.documentId,
      dataset.datasetId,
      generation,
      signal,
    )
    await this.client.setPlane(openedDataset.handleId, generation, selection.plane)
    this.#generation = generation
    this.#materialization = {
      semanticSourceId: source.id,
      source: openedSource,
      dataset: { ...openedDataset, selection: selection.plane },
    }
    return validateSemanticIdentity(openedSource.identity)
  }

  async releaseSource(sourceId: SemanticSourceId): Promise<void> {
    if (this.#materialization?.semanticSourceId !== sourceId) return
    const { source } = this.#materialization
    this.#materialization = undefined
    await this.client.closeSource(source.sourceId, source.generation)
  }

  async cancelObsoleteAnalysis(reason: string): Promise<void> {
    this.#analysisController?.abort(new DOMException(reason, 'AbortError'))
    this.#analysisController = new AbortController()
  }
}
