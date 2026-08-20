import {
  type ActionAbortSignal,
  type ActionHandler,
  type JsonValue,
  WorkbenchActionHost,
  WorkbenchActionRegistry,
} from '@pji-workbench/actions'
import type {
  DatasetHandleId,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  SourceId,
  WorkerDiagnostics,
} from '@pji-workbench/contracts'
import {
  CATALOG_REGISTRY,
  type CatalogRegistryEntry,
  type CatalogSearchRequest,
  type CatalogService,
  type CatalogSourceCandidate,
  createGeoProject,
  createGeoRasterLayer,
  createGeoRasterSource,
  GEO_PROJECT_LIMITS,
  type GeoActionContext,
  type GeoActionId,
  type GeoBandMetadata,
  type GeoLayer,
  type GeoLayerId,
  type GeoProject,
  type GeoRasterLayer,
  type GeoRasterLocator,
  type GeoRasterSource,
  type GeoSourceId,
  geoActionDefinitions,
  type RasterStyle,
  sameCrs,
} from '@pji-workbench/domain-geo'

import { GeoLocalResourceRegistry } from './resource-registry.js'

export interface GeoImagingRuntime {
  openLocal(
    files: readonly File[],
    primary: File,
    generation: number,
    signal?: AbortSignal,
  ): Promise<OpenedSourceDescriptor>
  openRemote(url: string, generation: number, signal?: AbortSignal): Promise<OpenedSourceDescriptor>
  openDataset(
    documentId: OpenedSourceDescriptor['documentId'],
    datasetId: string,
    generation: number,
    signal?: AbortSignal,
    sourceId?: SourceId,
  ): Promise<OpenedDatasetDescriptor>
  closeDataset(handleId: DatasetHandleId, generation: number): Promise<void>
  closeSource(sourceId: SourceId, generation: number): Promise<void>
  diagnostics(): Promise<WorkerDiagnostics>
  dispose(): void
}

export interface GeoViewportPort {
  read(): JsonValue
  propose(input: JsonValue): Promise<JsonValue> | JsonValue
}

export interface GeoRuntimeBinding {
  readonly semanticSourceId: GeoSourceId
  readonly source: OpenedSourceDescriptor
  readonly dataset: OpenedDatasetDescriptor
  readonly presets: readonly Readonly<{ id: string; label: string; style: RasterStyle }>[]
  readonly activeOverview: number
}

export type GeoControllerErrorCode =
  | 'ABORTED'
  | 'CATALOG_NOT_FOUND'
  | 'CRS_INCOMPATIBLE'
  | 'DEPENDENT_LAYERS'
  | 'INVALID_ACTION_INPUT'
  | 'LOCAL_RESOURCE_MISSING'
  | 'PROJECT_INVALID'
  | 'RUNTIME_OPEN_FAILED'
  | 'SOURCE_LIMIT'
  | 'SOURCE_NOT_FOUND'
  | 'UNAVAILABLE'

export class GeoControllerError extends Error {
  constructor(
    readonly code: GeoControllerErrorCode,
    message: string,
    readonly details: Readonly<Record<string, JsonValue>> = {},
  ) {
    super(message)
    this.name = 'GeoControllerError'
  }

  toJSON(): JsonValue {
    return { code: this.code, message: this.message, details: this.details }
  }
}

export interface GeoControllerSnapshot {
  readonly revision: number
  readonly project: GeoProject
  readonly selectedSourceId?: GeoSourceId
  readonly selectedLayerId?: GeoLayerId
  readonly task: Readonly<{
    kind: 'idle' | 'opening' | 'closing' | 'rehydrating'
    label?: string
  }>
  readonly error?: Readonly<{
    code: GeoControllerErrorCode
    message: string
    details: Readonly<Record<string, JsonValue>>
  }>
}

export interface GeoWorkbenchControllerOptions {
  readonly runtime: GeoImagingRuntime
  readonly catalogService: CatalogService
  readonly catalogs?: readonly CatalogRegistryEntry[]
  readonly resources?: GeoLocalResourceRegistry
  readonly viewport?: GeoViewportPort
  readonly initialProject?: GeoProject
  readonly now?: () => string
  readonly preflightCatalogAsset?: (
    candidate: CatalogSourceCandidate,
    signal?: AbortSignal,
  ) => Promise<void>
}

type Listener = (snapshot: GeoControllerSnapshot) => void

export class GeoWorkbenchController {
  readonly #runtime: GeoImagingRuntime
  readonly #catalogService: CatalogService
  readonly #catalogs: readonly CatalogRegistryEntry[]
  readonly #resources: GeoLocalResourceRegistry
  readonly #viewport: GeoViewportPort | undefined
  readonly #now: () => string
  readonly #preflight: GeoWorkbenchControllerOptions['preflightCatalogAsset']
  readonly #listeners = new Set<Listener>()
  readonly #bindings = new Map<GeoSourceId, GeoRuntimeBinding>()
  readonly #host: WorkbenchActionHost<GeoActionContext>
  #snapshot: GeoControllerSnapshot
  #generation = 0
  #nextSemanticId = 1
  #disposed = false

  constructor(options: GeoWorkbenchControllerOptions) {
    this.#runtime = options.runtime
    this.#catalogService = options.catalogService
    this.#catalogs = options.catalogs ?? CATALOG_REGISTRY
    this.#resources = options.resources ?? new GeoLocalResourceRegistry()
    this.#viewport = options.viewport
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#preflight = options.preflightCatalogAsset
    const project = normalizeProject(options.initialProject ?? emptyProject())
    this.#snapshot = { revision: 0, project, task: { kind: 'idle' } }
    const registry = new WorkbenchActionRegistry<GeoActionContext>(geoActionDefinitions)
    this.#host = new WorkbenchActionHost(registry, this.#createHandlers())
  }

  getSnapshot(): GeoControllerSnapshot {
    return this.#snapshot
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  registerLocalResource(files: readonly File[], primary: File): string {
    this.#assertActive()
    return this.#resources.register(files, primary)
  }

  actionContext(): GeoActionContext {
    return {
      hasSource: this.#snapshot.project.sources.length > 0,
      hasSelection: this.#snapshot.selectedLayerId !== undefined,
      sourceCount: this.#snapshot.project.sources.length,
      sourceLimit: GEO_PROJECT_LIMITS.maxSources,
      hasLocalResources: this.#resources.hasAny(),
      comparisonEnabled:
        this.#snapshot.project.layers.filter(
          (layer): layer is GeoRasterLayer => layer.kind === 'raster' && layer.visible,
        ).length >= 2,
      viewportAvailable: this.#viewport !== undefined,
    }
  }

  actionAvailability(id: GeoActionId): Readonly<{ available: boolean; reason?: string }> {
    return new WorkbenchActionRegistry(geoActionDefinitions).availability(
      id,
      1,
      this.actionContext(),
    )
  }

  async executeAction(
    id: GeoActionId,
    input: unknown,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<JsonValue> {
    this.#assertActive()
    try {
      return await this.#host.execute(id, 1, input, this.actionContext(), signal)
    } catch (error) {
      if (id.startsWith('geo.catalog.')) throw error
      const classified = classifyControllerError(error)
      this.#setError(classified)
      throw classified
    }
  }

  runtimeBindings(): readonly GeoRuntimeBinding[] {
    return [...this.#bindings.values()]
  }

  bindingForSource(sourceId: string | undefined): GeoRuntimeBinding | undefined {
    if (sourceId === undefined) return undefined
    return this.#bindings.get(sourceId as GeoSourceId)
  }

  bindingForLayer(layerId: string | undefined): GeoRuntimeBinding | undefined {
    const layer = this.#snapshot.project.layers.find(({ id }) => id === layerId)
    return layer?.sourceId === undefined ? undefined : this.#bindings.get(layer.sourceId)
  }

  setActiveOverview(sourceId: string, activeOverview: number): void {
    const id = sourceId as GeoSourceId
    const binding = this.#bindings.get(id)
    if (binding === undefined || binding.activeOverview === activeOverview) return
    this.#bindings.set(id, { ...binding, activeOverview })
    this.#emit()
  }

  async openRemote(
    input: Readonly<{
      url: string
      label?: string
      candidate?: CatalogSourceCandidate
      style?: RasterStyle
      presets?: readonly Readonly<{ id: string; label: string; style: RasterStyle }>[]
    }>,
    signal?: AbortSignal,
  ): Promise<GeoSourceId> {
    const locator =
      input.candidate === undefined
        ? ({ kind: 'remote-url', url: input.url } as const)
        : locatorFromCandidate(input.candidate)
    return this.#transactionalOpen(
      () => this.#runtime.openRemote(input.url, this.#nextGeneration(), signal),
      locator,
      input.label ?? remoteName(input.url),
      input.style,
      input.presets ?? [],
      signal,
    )
  }

  async openLocalResource(resourceId: string, signal?: AbortSignal): Promise<GeoSourceId> {
    const resource = this.#resources.get(resourceId)
    if (resource === undefined) {
      throw new GeoControllerError(
        'LOCAL_RESOURCE_MISSING',
        `Local resource ${resourceId} is unavailable.`,
      )
    }
    const primary = resource.primary
    return this.#transactionalOpen(
      () => this.#runtime.openLocal(resource.files, primary, this.#nextGeneration(), signal),
      {
        kind: 'local-file',
        fingerprint: {
          name: primary.name,
          size: primary.size,
          lastModified: primary.lastModified,
          ...(primary.type.length === 0 ? {} : { mediaType: primary.type }),
        },
      },
      primary.name,
      undefined,
      [],
      signal,
    )
  }

  async retrySource(sourceId: string, signal?: AbortSignal): Promise<GeoSourceId> {
    const source = this.#requireSource(sourceId)
    const url = replayUrl(source.locator)
    if (url === undefined) {
      throw new GeoControllerError('UNAVAILABLE', 'This source requires a local rebind.')
    }
    return this.#transactionalRebind(
      source,
      () => this.#runtime.openRemote(url, this.#nextGeneration(), signal),
      source.locator,
      this.#bindings.get(source.id)?.presets ?? [],
      signal,
    )
  }

  async rebindLocalResource(
    sourceId: string,
    resourceId: string,
    signal?: AbortSignal,
  ): Promise<GeoSourceId> {
    const source = this.#requireSource(sourceId)
    if (source.locator.kind !== 'local-file') {
      throw new GeoControllerError('INVALID_ACTION_INPUT', 'Only local sources can be rebound.')
    }
    const resource = this.#resources.get(resourceId)
    if (resource === undefined) {
      throw new GeoControllerError(
        'LOCAL_RESOURCE_MISSING',
        `Local resource ${resourceId} is unavailable.`,
      )
    }
    const { primary } = resource
    const expected = source.locator.fingerprint
    if (
      primary.name !== expected.name ||
      primary.size !== expected.size ||
      primary.lastModified !== expected.lastModified
    ) {
      throw new GeoControllerError(
        'INVALID_ACTION_INPUT',
        'The selected file does not match the persisted source fingerprint.',
      )
    }
    return this.#transactionalRebind(
      source,
      () => this.#runtime.openLocal(resource.files, primary, this.#nextGeneration(), signal),
      source.locator,
      [],
      signal,
    )
  }

  selectLayer(layerId: string): void {
    const layer = this.#requireLayer(layerId)
    this.#setSnapshot({
      ...this.#snapshot,
      selectedLayerId: layer.id,
      ...(layer.sourceId === undefined ? {} : { selectedSourceId: layer.sourceId }),
      task: { kind: 'idle' },
    })
  }

  updateLayer(layerId: string, patch: Partial<GeoRasterLayer>): void {
    const target = this.#requireRasterLayer(layerId)
    const layers = this.#snapshot.project.layers.map((layer) =>
      layer.id === target.id
        ? createGeoRasterLayer({
            id: layer.id,
            sourceId: target.sourceId,
            label: patch.label ?? target.label,
            visible: patch.visible ?? target.visible,
            opacity: patch.opacity ?? target.opacity,
            blendMode: patch.blendMode ?? target.blendMode,
            zIndex: patch.zIndex ?? target.zIndex,
            style: patch.style ?? target.style,
          })
        : layer,
    )
    this.#replaceProject({ layers })
  }

  duplicateLayer(layerId: string): GeoLayerId {
    const selected = this.#requireRasterLayer(layerId)
    const id = this.#uniqueId(
      `${selected.id}-copy`,
      this.#snapshot.project.layers.map(({ id }) => id),
    ) as GeoLayerId
    const zIndex =
      this.#snapshot.project.layers.reduce((max, layer) => Math.max(max, layer.zIndex), -1) + 1
    const copy = createGeoRasterLayer({
      id,
      sourceId: selected.sourceId,
      label: `${selected.label} copy`,
      visible: selected.visible,
      opacity: selected.opacity,
      blendMode: selected.blendMode,
      zIndex,
      style: selected.style,
    })
    this.#replaceProject(
      { layers: [...this.#snapshot.project.layers, copy] },
      { selectedLayerId: id, selectedSourceId: selected.sourceId },
    )
    return id
  }

  removeLayer(layerId: string): void {
    this.#requireLayer(layerId)
    const dependent = this.#snapshot.project.layers.filter(
      (layer) => layer.kind === 'derived' && layer.inputLayerIds.includes(layerId as GeoLayerId),
    )
    if (dependent.length > 0) {
      throw new GeoControllerError('DEPENDENT_LAYERS', 'Remove dependent derived layers first.', {
        layerIds: dependent.map(({ id }) => id),
      })
    }
    const layers = this.#snapshot.project.layers.filter(({ id }) => id !== layerId)
    const fallback = layers.at(-1)
    this.#replaceProject(
      { layers, comparison: { mode: 'single' } },
      fallback === undefined
        ? { selectedLayerId: undefined, selectedSourceId: undefined }
        : { selectedLayerId: fallback.id, selectedSourceId: fallback.sourceId },
    )
  }

  moveLayer(layerId: string, direction: -1 | 1): void {
    const ordered = [...this.#snapshot.project.layers].sort((a, b) => a.zIndex - b.zIndex)
    const index = ordered.findIndex(({ id }) => id === layerId)
    const current = ordered[index]
    const swap = ordered[index + direction]
    if (current === undefined || swap === undefined) return
    this.#replaceProject({
      layers: this.#snapshot.project.layers.map((layer) =>
        layer.id === current.id
          ? { ...layer, zIndex: swap.zIndex }
          : layer.id === swap.id
            ? { ...layer, zIndex: current.zIndex }
            : layer,
      ),
    })
  }

  async closeSource(
    sourceId: string,
    dependentLayers: 'refuse' | 'remove' = 'refuse',
  ): Promise<void> {
    const source = this.#snapshot.project.sources.find(({ id }) => id === sourceId)
    if (source === undefined)
      throw new GeoControllerError('SOURCE_NOT_FOUND', `Source ${sourceId} does not exist.`)
    const layers = this.#snapshot.project.layers.filter(({ sourceId: id }) => id === source.id)
    if (layers.length > 0 && dependentLayers === 'refuse') {
      throw new GeoControllerError('DEPENDENT_LAYERS', 'The source still has dependent layers.', {
        layerIds: layers.map(({ id }) => id),
      })
    }
    this.#patchTask({ kind: 'closing', label: source.label })
    const binding = this.#bindings.get(source.id)
    if (binding !== undefined) await this.#releaseBinding(binding)
    this.#bindings.delete(source.id)
    const layerIds = new Set(layers.map(({ id }) => id))
    const remainingLayers = this.#snapshot.project.layers.filter(
      (layer) =>
        !layerIds.has(layer.id) &&
        !(layer.kind === 'derived' && layer.inputLayerIds.some((id) => layerIds.has(id))),
    )
    const remainingSources = this.#snapshot.project.sources.filter(({ id }) => id !== source.id)
    const fallback = remainingLayers.at(-1)
    this.#replaceProject(
      {
        sources: remainingSources,
        layers: remainingLayers,
        comparison: { mode: 'single' },
        provenance: this.#snapshot.project.provenance.filter(
          (entry) => !entry.sourceIds.includes(source.id),
        ),
      },
      fallback === undefined
        ? { selectedLayerId: undefined, selectedSourceId: remainingSources.at(-1)?.id }
        : { selectedLayerId: fallback.id, selectedSourceId: fallback.sourceId },
    )
  }

  rehydrate(project: GeoProject): void {
    this.#assertActive()
    if (this.#bindings.size > 0) {
      throw new GeoControllerError(
        'UNAVAILABLE',
        'Close runtime-bound sources before rehydrating a project.',
      )
    }
    const normalized = normalizeProject(project)
    this.#snapshot = {
      revision: this.#snapshot.revision + 1,
      project: normalized,
      ...(normalized.sources[0] === undefined
        ? {}
        : { selectedSourceId: normalized.sources[0].id }),
      ...(normalized.layers[0] === undefined ? {} : { selectedLayerId: normalized.layers[0].id }),
      task: { kind: 'idle' },
    }
    this.#emit()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const bindings = [...this.#bindings.values()]
    this.#bindings.clear()
    await Promise.all(
      bindings.map((binding) => this.#releaseBinding(binding).catch(() => undefined)),
    )
    this.#resources.clear()
    this.#listeners.clear()
    this.#runtime.dispose()
  }

  async #transactionalOpen(
    open: () => Promise<OpenedSourceDescriptor>,
    locator: GeoRasterLocator,
    label: string,
    style: RasterStyle | undefined,
    presets: readonly Readonly<{ id: string; label: string; style: RasterStyle }>[],
    signal?: AbortSignal,
  ): Promise<GeoSourceId> {
    this.#assertActive()
    if (this.#snapshot.project.sources.length >= GEO_PROJECT_LIMITS.maxSources) {
      throw new GeoControllerError('SOURCE_LIMIT', 'Close a source before opening another.', {
        limit: GEO_PROJECT_LIMITS.maxSources,
      })
    }
    this.#patchTask({ kind: 'opening', label })
    let opened: OpenedSourceDescriptor | undefined
    let dataset: OpenedDatasetDescriptor | undefined
    try {
      // Validate the durable locator before allocating a Worker resource.
      validateLocator(locator)
      opened = await open()
      signal?.throwIfAborted()
      const descriptor = opened.datasets[0]
      if (descriptor === undefined) throw new Error('The source exposes no raster dataset.')
      dataset = await this.#runtime.openDataset(
        opened.documentId,
        descriptor.id,
        opened.generation,
        signal,
        opened.sourceId,
      )
      signal?.throwIfAborted()
      const spatial = dataset.dataset.spatialReference
      if (spatial?.pixelToModel === undefined)
        throw new Error('The raster has no pixel-to-model affine.')
      const semanticSourceId = this.#uniqueId(
        'geo-source',
        this.#snapshot.project.sources.map(({ id }) => id),
      ) as GeoSourceId
      const candidate =
        locator.kind === 'stac-asset' || locator.kind === 'tnm-product'
          ? locator.catalog
          : undefined
      const bands = bandsForDataset(dataset, locator)
      const source = createGeoRasterSource({
        id: semanticSourceId,
        label,
        width: axisLength(dataset, 'x'),
        height: axisLength(dataset, 'y'),
        componentCount: Math.max(1, dataset.dataset.components.length),
        spatialReference: spatial,
        locator,
        bands,
        ...(candidate === undefined ? {} : { catalog: candidate }),
      })
      const existing = this.#snapshot.project.sources[0]
      if (
        existing !== undefined &&
        !sameCrs(existing.spatialReference.crs, source.spatialReference.crs)
      ) {
        throw new GeoControllerError(
          'CRS_INCOMPATIBLE',
          'This raster cannot be composed in the current native CRS project.',
          {
            proposals: ['replace-project', 'start-separate-project', 'cancel'],
            sourceId: semanticSourceId,
          },
        )
      }
      const layerId = this.#uniqueId(
        `${semanticSourceId}-layer`,
        this.#snapshot.project.layers.map(({ id }) => id),
      ) as GeoLayerId
      const defaultStyle =
        style !== undefined && styleFits(style, source.componentCount)
          ? style
          : defaultStyleFor(dataset)
      const layer = createGeoRasterLayer({
        id: layerId,
        sourceId: semanticSourceId,
        label,
        zIndex:
          this.#snapshot.project.layers.reduce((max, item) => Math.max(max, item.zIndex), -1) + 1,
        style: defaultStyle,
      })
      const project = createGeoProject({
        ...this.#snapshot.project,
        crs: existing?.spatialReference.crs ?? source.spatialReference.crs,
        sources: [...this.#snapshot.project.sources, source],
        layers: [...this.#snapshot.project.layers, layer],
      })
      this.#bindings.set(semanticSourceId, {
        semanticSourceId,
        source: opened,
        dataset,
        presets: presets.filter((preset) => styleFits(preset.style, source.componentCount)),
        activeOverview: 0,
      })
      this.#setSnapshot({
        revision: this.#snapshot.revision + 1,
        project,
        selectedSourceId: semanticSourceId,
        selectedLayerId: layerId,
        task: { kind: 'idle' },
      })
      return semanticSourceId
    } catch (error) {
      if (dataset !== undefined)
        await this.#runtime
          .closeDataset(dataset.handleId, dataset.generation)
          .catch(() => undefined)
      if (opened !== undefined)
        await this.#runtime.closeSource(opened.sourceId, opened.generation).catch(() => undefined)
      const classified = classifyControllerError(error)
      this.#setError(classified)
      throw classified
    }
  }

  async #transactionalRebind(
    existing: GeoRasterSource,
    open: () => Promise<OpenedSourceDescriptor>,
    locator: GeoRasterLocator,
    presets: readonly Readonly<{ id: string; label: string; style: RasterStyle }>[],
    signal?: AbortSignal,
  ): Promise<GeoSourceId> {
    this.#assertActive()
    this.#patchTask({ kind: 'opening', label: existing.label })
    let opened: OpenedSourceDescriptor | undefined
    let dataset: OpenedDatasetDescriptor | undefined
    try {
      validateLocator(locator)
      opened = await open()
      signal?.throwIfAborted()
      const descriptor = opened.datasets[0]
      if (descriptor === undefined) throw new Error('The source exposes no raster dataset.')
      dataset = await this.#runtime.openDataset(
        opened.documentId,
        descriptor.id,
        opened.generation,
        signal,
        opened.sourceId,
      )
      signal?.throwIfAborted()
      const spatial = dataset.dataset.spatialReference
      if (spatial?.pixelToModel === undefined) {
        throw new Error('The raster has no pixel-to-model affine.')
      }
      const replacement = createGeoRasterSource({
        id: existing.id,
        label: existing.label,
        width: axisLength(dataset, 'x'),
        height: axisLength(dataset, 'y'),
        componentCount: Math.max(1, dataset.dataset.components.length),
        spatialReference: spatial,
        locator,
        bands: bandsForDataset(dataset, locator),
        ...(existing.catalog === undefined ? {} : { catalog: existing.catalog }),
      })
      const other = this.#snapshot.project.sources.find(({ id }) => id !== existing.id)
      if (
        other !== undefined &&
        !sameCrs(other.spatialReference.crs, replacement.spatialReference.crs)
      ) {
        throw new GeoControllerError(
          'CRS_INCOMPATIBLE',
          'This raster cannot be composed in the current native CRS project.',
          {
            proposals: ['replace-project', 'start-separate-project', 'cancel'],
            sourceId: existing.id,
          },
        )
      }
      const project = createGeoProject({
        ...this.#snapshot.project,
        crs: other?.spatialReference.crs ?? replacement.spatialReference.crs,
        sources: this.#snapshot.project.sources.map((source) =>
          source.id === existing.id ? replacement : source,
        ),
      })
      const previous = this.#bindings.get(existing.id)
      this.#bindings.set(existing.id, {
        semanticSourceId: existing.id,
        source: opened,
        dataset,
        presets: presets.filter((preset) => styleFits(preset.style, replacement.componentCount)),
        activeOverview: previous?.activeOverview ?? 0,
      })
      this.#setSnapshot({
        ...this.#snapshot,
        revision: this.#snapshot.revision + 1,
        project,
        task: { kind: 'idle' },
      })
      if (previous !== undefined) await this.#releaseBinding(previous).catch(() => undefined)
      return existing.id
    } catch (error) {
      if (dataset !== undefined) {
        await this.#runtime
          .closeDataset(dataset.handleId, dataset.generation)
          .catch(() => undefined)
      }
      if (opened !== undefined) {
        await this.#runtime.closeSource(opened.sourceId, opened.generation).catch(() => undefined)
      }
      const classified = classifyControllerError(error)
      this.#setError(classified)
      throw classified
    }
  }

  #replaceProject(
    patch: Partial<Pick<GeoProject, 'sources' | 'layers' | 'comparison' | 'provenance'>>,
    selection: {
      readonly selectedLayerId?: GeoLayerId | undefined
      readonly selectedSourceId?: GeoSourceId | undefined
    } = {},
  ): void {
    const project = createGeoProject({ ...this.#snapshot.project, ...patch })
    const selectedLayerId =
      'selectedLayerId' in selection ? selection.selectedLayerId : this.#snapshot.selectedLayerId
    const selectedSourceId =
      'selectedSourceId' in selection ? selection.selectedSourceId : this.#snapshot.selectedSourceId
    this.#setSnapshot({
      revision: this.#snapshot.revision + 1,
      project,
      ...(selectedSourceId === undefined ? {} : { selectedSourceId }),
      ...(selectedLayerId === undefined ? {} : { selectedLayerId }),
      task: { kind: 'idle' },
    })
  }

  #createHandlers(): ReadonlyMap<string, ActionHandler<GeoActionContext>> {
    const handlers = new Map<string, ActionHandler<GeoActionContext>>()
    const set = (id: GeoActionId, execute: ActionHandler<GeoActionContext>['execute']): void => {
      handlers.set(`${id}@1`, { execute })
    }
    set('geo.catalog.list', () =>
      json(
        this.#catalogs.map(({ id, title, description, protocol }) => ({
          id,
          title,
          description,
          protocol,
        })),
      ),
    )
    set('geo.catalog.list_collections', async (input, _context, signal) => {
      const entry = this.#catalog(stringField(input, 'catalogId'))
      return json(await this.#catalogService.listCollections(entry, nativeSignal(signal)))
    })
    set('geo.catalog.search', async (input, _context, signal) => {
      const record = recordInput(input)
      const entry = this.#catalog(stringField(record, 'catalogId'))
      return json(
        await this.#catalogService.search(
          entry,
          searchRequest(record['request']),
          nativeSignal(signal),
        ),
      )
    })
    set('geo.catalog.follow', async (input, _context, signal) => {
      const record = recordInput(input)
      const entry = this.#catalog(stringField(record, 'catalogId'))
      return json(
        await this.#catalogService.follow(
          entry,
          recordInput(record['cursor']) as never,
          nativeSignal(signal),
        ),
      )
    })
    const inspectCatalog = async (
      input: JsonValue,
      signal: ActionAbortSignal,
    ): Promise<JsonValue> => {
      const record = recordInput(input)
      const entry = this.#catalog(stringField(record, 'catalogId'))
      const candidate = await this.#catalogService.resolveDeepLink(
        entry,
        recordInput(record['identity']) as never,
        nativeSignal(signal),
      )
      if (candidate === undefined)
        throw new GeoControllerError('CATALOG_NOT_FOUND', 'Catalog asset was not found.')
      return json(candidate)
    }
    set('geo.catalog.inspect_item', (input, _context, signal) => inspectCatalog(input, signal))
    set('geo.catalog.inspect_asset', (input, _context, signal) => inspectCatalog(input, signal))
    set('geo.source.open_catalog_asset', async (input, _context, signal) => {
      const candidate = recordInput(input)['candidate'] as unknown as CatalogSourceCandidate
      if (typeof candidate !== 'object' || candidate === null)
        throw new GeoControllerError('INVALID_ACTION_INPUT', 'candidate is required.')
      await this.#preflight?.(candidate, nativeSignal(signal))
      const presets = Array.isArray(recordInput(input)['presets'])
        ? (recordInput(input)['presets'] as unknown as readonly Readonly<{
            id: string
            label: string
            style: RasterStyle
          }>[])
        : []
      const sourceId = await this.openRemote(
        {
          url: candidate.href,
          label: candidate.label,
          candidate,
          presets,
          ...(candidate.style === undefined ? {} : { style: candidate.style }),
        },
        nativeSignal(signal),
      )
      return { sourceId }
    })
    set('geo.source.open_remote', async (input, _context, signal) => {
      const label = optionalStringField(input, 'label')
      return {
        sourceId: await this.openRemote(
          { url: stringField(input, 'url'), ...(label === undefined ? {} : { label }) },
          nativeSignal(signal),
        ),
      }
    })
    set('geo.source.open_local_resource', async (input, _context, signal) => ({
      sourceId: await this.openLocalResource(
        stringField(input, 'resourceId'),
        nativeSignal(signal),
      ),
    }))
    set('geo.source.list', () => json(this.#snapshot.project.sources))
    set('geo.source.describe', (input) => json(this.#requireSource(stringField(input, 'sourceId'))))
    set('geo.source.close', async (input) => {
      const mode = optionalStringField(input, 'dependentLayers') === 'remove' ? 'remove' : 'refuse'
      await this.closeSource(stringField(input, 'sourceId'), mode)
      return { closed: true }
    })
    set('geo.source.retry', async (input, _context, signal) => ({
      sourceId: await this.retrySource(stringField(input, 'sourceId'), nativeSignal(signal)),
    }))
    set('geo.source.rebind_local', async (input, _context, signal) => ({
      sourceId: await this.rebindLocalResource(
        stringField(input, 'sourceId'),
        stringField(input, 'resourceId'),
        nativeSignal(signal),
      ),
    }))
    set('geo.layer.list', () => json(this.#snapshot.project.layers))
    set('geo.layer.add', (input) => {
      const sourceId = stringField(input, 'sourceId')
      const source = this.#requireSource(sourceId)
      const id = this.#uniqueId(
        `${source.id}-layer`,
        this.#snapshot.project.layers.map(({ id }) => id),
      ) as GeoLayerId
      const layer = createGeoRasterLayer({
        id,
        sourceId: source.id,
        label: optionalStringField(input, 'label') ?? source.label,
        zIndex: this.#snapshot.project.layers.length,
        style: { mapping: { gray: 0 } },
      })
      this.#replaceProject(
        { layers: [...this.#snapshot.project.layers, layer] },
        { selectedLayerId: id, selectedSourceId: source.id },
      )
      return { layerId: id }
    })
    set('geo.layer.remove', (input) => {
      this.removeLayer(stringField(input, 'layerId'))
      return { removed: true }
    })
    set('geo.layer.duplicate', (input) => ({
      layerId: this.duplicateLayer(stringField(input, 'layerId')),
    }))
    set('geo.layer.select', (input) => {
      this.selectLayer(stringField(input, 'layerId'))
      return { selected: true }
    })
    set('geo.layer.set_visibility', (input) => {
      this.updateLayer(stringField(input, 'layerId'), { visible: booleanField(input, 'visible') })
      return { updated: true }
    })
    set('geo.layer.set_opacity', (input) => {
      this.updateLayer(stringField(input, 'layerId'), { opacity: numberField(input, 'opacity') })
      return { updated: true }
    })
    set('geo.layer.set_order', (input) => {
      this.moveLayer(stringField(input, 'layerId'), numberField(input, 'direction') < 0 ? -1 : 1)
      return { updated: true }
    })
    set('geo.layer.set_style', (input) => {
      this.updateLayer(stringField(input, 'layerId'), {
        style: recordInput(input)['style'] as unknown as RasterStyle,
      })
      return { updated: true }
    })
    set('geo.layer.fit', (input) =>
      this.#viewportAction({ kind: 'fit-layer', layerId: stringField(input, 'layerId') }),
    )
    set('geo.comparison.read', () => json(this.#snapshot.project.comparison))
    set('geo.comparison.set_single', () => {
      this.#replaceProject({ comparison: { mode: 'single' } })
      return { updated: true }
    })
    set('geo.comparison.set_overlay', (input) => {
      const record = recordInput(input)
      const layerIds = stringArrayField(record, 'overlayLayerIds') as readonly GeoLayerId[]
      this.#replaceProject({ comparison: { mode: 'overlay', overlayLayerIds: layerIds } })
      return { updated: true }
    })
    set('geo.comparison.set_swipe', (input) => {
      const record = recordInput(input)
      this.#replaceProject({
        comparison: {
          mode: 'swipe',
          leftLayerId: stringField(record, 'leftLayerId') as GeoLayerId,
          rightLayerId: stringField(record, 'rightLayerId') as GeoLayerId,
          swipePosition: numberField(record, 'swipePosition'),
        },
      })
      return { updated: true }
    })
    set('geo.comparison.set_blink', (input) => {
      const record = recordInput(input)
      this.#replaceProject({
        comparison: {
          mode: 'blink',
          firstLayerId: stringField(record, 'firstLayerId') as GeoLayerId,
          secondLayerId: stringField(record, 'secondLayerId') as GeoLayerId,
          intervalMilliseconds: numberField(record, 'intervalMilliseconds'),
        },
      })
      return { updated: true }
    })
    set('geo.viewport.read', () => this.#viewport?.read() ?? unavailableViewport())
    for (const id of [
      'geo.viewport.fit_source',
      'geo.viewport.fit_layer',
      'geo.viewport.fit_bounds',
      'geo.viewport.propose',
    ] as const)
      set(id, (input) => this.#viewportAction(json({ kind: id, input })))
    set('geo.raster.describe_bands', (input) => json(this.#sourceForRasterInput(input).bands))
    set('geo.raster.sample_point', () => {
      throw new GeoControllerError(
        'UNAVAILABLE',
        'Point sampling requires the mounted viewport tile cache.',
      )
    })
    set('geo.raster.describe_statistics', () => {
      throw new GeoControllerError('UNAVAILABLE', 'Statistics are not implemented for Atlas yet.')
    })
    return handlers
  }

  #sourceForRasterInput(input: JsonValue) {
    const sourceId = optionalStringField(input, 'sourceId') ?? this.#snapshot.selectedSourceId
    if (sourceId === undefined)
      throw new GeoControllerError('SOURCE_NOT_FOUND', 'No source is selected.')
    return this.#requireSource(sourceId)
  }

  #viewportAction(input: JsonValue): Promise<JsonValue> | JsonValue {
    if (this.#viewport === undefined)
      throw new GeoControllerError('UNAVAILABLE', 'The viewport is not mounted.')
    return this.#viewport.propose(input)
  }

  #catalog(id: string): CatalogRegistryEntry {
    const entry = this.#catalogs.find((candidate) => candidate.id === id)
    if (entry === undefined)
      throw new GeoControllerError('CATALOG_NOT_FOUND', `Catalog ${id} does not exist.`)
    return entry
  }

  #requireSource(sourceId: string) {
    const source = this.#snapshot.project.sources.find(({ id }) => id === sourceId)
    if (source === undefined)
      throw new GeoControllerError('SOURCE_NOT_FOUND', `Source ${sourceId} does not exist.`)
    return source
  }

  #requireLayer(layerId: string): GeoLayer {
    const layer = this.#snapshot.project.layers.find(({ id }) => id === layerId)
    if (layer === undefined)
      throw new GeoControllerError('PROJECT_INVALID', `Layer ${layerId} does not exist.`)
    return layer
  }

  #requireRasterLayer(layerId: string): GeoRasterLayer {
    const layer = this.#requireLayer(layerId)
    if (layer.kind !== 'raster')
      throw new GeoControllerError('PROJECT_INVALID', `Layer ${layerId} is derived.`)
    return layer
  }

  async #releaseBinding(binding: GeoRuntimeBinding): Promise<void> {
    await this.#runtime
      .closeDataset(binding.dataset.handleId, binding.dataset.generation)
      .catch(() => undefined)
    await this.#runtime.closeSource(binding.source.sourceId, binding.source.generation)
  }

  #nextGeneration(): number {
    this.#generation += 1
    return this.#generation
  }

  #uniqueId(prefix: string, existing: readonly string[]): string {
    const used = new Set(existing)
    let id = `${prefix}-${this.#nextSemanticId}`
    while (used.has(id)) {
      this.#nextSemanticId += 1
      id = `${prefix}-${this.#nextSemanticId}`
    }
    this.#nextSemanticId += 1
    return id
  }

  #patchTask(task: GeoControllerSnapshot['task']): void {
    const { error: _error, ...snapshot } = this.#snapshot
    this.#setSnapshot({ ...snapshot, task })
  }

  #setError(error: GeoControllerError): void {
    this.#setSnapshot({
      ...this.#snapshot,
      task: { kind: 'idle' },
      error: { code: error.code, message: error.message, details: error.details },
    })
  }

  #setSnapshot(snapshot: GeoControllerSnapshot): void {
    this.#snapshot = snapshot
    this.#emit()
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#snapshot)
  }

  #assertActive(): void {
    if (this.#disposed)
      throw new GeoControllerError('UNAVAILABLE', 'Geo workbench controller is disposed.')
  }
}

function emptyProject(): GeoProject {
  return createGeoProject({ title: 'Atlas project', crs: { kind: 'unknown' } })
}

function normalizeProject(project: GeoProject): GeoProject {
  try {
    return createGeoProject(project)
  } catch (error) {
    throw new GeoControllerError(
      'PROJECT_INVALID',
      error instanceof Error ? error.message : 'Invalid geo project.',
    )
  }
}

function locatorFromCandidate(candidate: CatalogSourceCandidate): GeoRasterLocator {
  const catalog = durableCatalog(candidate)
  if (candidate.protocol === 'tnm-access') {
    return {
      kind: 'tnm-product',
      catalog,
      productId: candidate.itemId,
      downloadUrl: durableUrl(candidate.href),
      bands: candidate.bands,
      roles: candidate.roles,
      ...(candidate.datetime === undefined ? {} : { datetime: candidate.datetime }),
      ...(candidate.label.length === 0 ? {} : { title: candidate.label }),
      ...(candidate.mediaType === undefined ? {} : { mediaType: candidate.mediaType }),
      ...(candidate.fileSize === undefined ? {} : { fileSize: candidate.fileSize }),
      ...(candidate.checksum === undefined ? {} : { checksum: candidate.checksum }),
      ...(candidate.validator === undefined ? {} : { validator: candidate.validator }),
      ...(candidate.projection === undefined ? {} : { projection: candidate.projection }),
    }
  }
  return {
    kind: 'stac-asset',
    catalog,
    roles: candidate.roles,
    bands: candidate.bands,
    ...(candidate.datetime === undefined ? {} : { datetime: candidate.datetime }),
    ...(candidate.label.length === 0 ? {} : { title: candidate.label }),
    ...(candidate.mediaType === undefined ? {} : { mediaType: candidate.mediaType }),
    ...(candidate.fileSize === undefined ? {} : { fileSize: candidate.fileSize }),
    ...(candidate.checksum === undefined ? {} : { checksum: candidate.checksum }),
    ...(candidate.validator === undefined ? {} : { validator: candidate.validator }),
    ...(candidate.projection === undefined ? {} : { projection: candidate.projection }),
  }
}

function durableCatalog(candidate: CatalogSourceCandidate) {
  return {
    catalogId: candidate.catalogId,
    catalogTitle: candidate.catalogTitle,
    collectionId: candidate.collectionId,
    itemId: candidate.itemId,
    assetKey: candidate.assetKey,
    href: durableUrl(candidate.href),
    ...(candidate.protocol === undefined ? {} : { protocol: candidate.protocol }),
    ...(candidate.provider === undefined ? {} : { provider: candidate.provider }),
    ...(candidate.license === undefined ? {} : { license: candidate.license }),
    ...(candidate.attribution === undefined ? {} : { attribution: candidate.attribution }),
    ...(candidate.sourceUrl === undefined ? {} : { sourceUrl: durableUrl(candidate.sourceUrl) }),
  }
}

function durableUrl(value: string): string {
  const url = new URL(value)
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:x-amz-|x-goog-|sig(?:nature)?$|token$|access_token$)/iu.test(key))
      url.searchParams.delete(key)
  }
  return url.href
}

function validateLocator(locator: GeoRasterLocator): void {
  createGeoRasterSource({
    id: 'locator-validation',
    label: 'locator validation',
    width: 1,
    height: 1,
    componentCount: 1,
    spatialReference: {
      crs: { kind: 'unknown' },
      pixelInterpretation: 'unspecified',
      pixelToModel: [1, 0, 0, 0, 1, 0],
    },
    locator,
  })
}

function bandsForDataset(
  dataset: OpenedDatasetDescriptor,
  locator: GeoRasterLocator,
): readonly GeoBandMetadata[] {
  const catalogBands =
    locator.kind === 'stac-asset' || locator.kind === 'tnm-product' ? locator.bands : []
  return dataset.dataset.components.map((component, index) => ({
    index,
    ...(component.name === undefined ? {} : { name: component.name }),
    ...(component.unit === undefined ? {} : { unit: component.unit }),
    ...(catalogBands[index] ?? {}),
  }))
}

function defaultStyleFor(dataset: OpenedDatasetDescriptor): RasterStyle {
  return {
    mapping: dataset.dataset.components.length >= 3 ? { red: 0, green: 1, blue: 2 } : { gray: 0 },
    stretch: 'minmax',
    nodataTransparent: true,
  }
}

function styleFits(style: RasterStyle, componentCount: number): boolean {
  return Object.values(style.mapping).every(
    (value) => value === undefined || value < componentCount,
  )
}

function axisLength(dataset: OpenedDatasetDescriptor, id: string): number {
  return dataset.dataset.axes.find((axis) => axis.id === id)?.length ?? 1
}

function remoteName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url)
  } catch {
    return url
  }
}

function replayUrl(locator: GeoRasterLocator): string | undefined {
  if (locator.kind === 'remote-url') return locator.url
  if (locator.kind === 'stac-asset') return locator.catalog.href
  if (locator.kind === 'tnm-product') return locator.downloadUrl
  return undefined
}

function classifyControllerError(error: unknown): GeoControllerError {
  if (error instanceof GeoControllerError) return error
  if (error instanceof DOMException && error.name === 'AbortError')
    return new GeoControllerError('ABORTED', 'Opening was cancelled.')
  return new GeoControllerError(
    'RUNTIME_OPEN_FAILED',
    error instanceof Error ? error.message : 'The raster could not be opened.',
  )
}

function recordInput(value: unknown): Readonly<Record<string, JsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new GeoControllerError('INVALID_ACTION_INPUT', 'Expected an object input.')
  return value as Readonly<Record<string, JsonValue>>
}

function stringField(value: unknown, key: string): string {
  const field = recordInput(value)[key]
  if (typeof field !== 'string' || field.length === 0)
    throw new GeoControllerError('INVALID_ACTION_INPUT', `${key} must be a non-empty string.`)
  return field
}

function optionalStringField(value: unknown, key: string): string | undefined {
  const field = recordInput(value)[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

function stringArrayField(value: unknown, key: string): readonly string[] {
  const field = recordInput(value)[key]
  if (
    !Array.isArray(field) ||
    field.length === 0 ||
    field.some((item) => typeof item !== 'string')
  ) {
    throw new GeoControllerError('INVALID_ACTION_INPUT', `${key} must be a non-empty string array.`)
  }
  return field
}

function numberField(value: unknown, key: string): number {
  const field = recordInput(value)[key]
  if (typeof field !== 'number' || !Number.isFinite(field))
    throw new GeoControllerError('INVALID_ACTION_INPUT', `${key} must be finite.`)
  return field
}

function booleanField(value: unknown, key: string): boolean {
  const field = recordInput(value)[key]
  if (typeof field !== 'boolean')
    throw new GeoControllerError('INVALID_ACTION_INPUT', `${key} must be boolean.`)
  return field
}

function searchRequest(value: JsonValue | undefined): CatalogSearchRequest {
  if (value === undefined) return {}
  return recordInput(value) as unknown as CatalogSearchRequest
}

function nativeSignal(signal: ActionAbortSignal): AbortSignal | undefined {
  return 'addEventListener' in signal ? (signal as AbortSignal) : undefined
}

function json(value: unknown): JsonValue {
  return value as JsonValue
}

function unavailableViewport(): JsonValue {
  throw new GeoControllerError('UNAVAILABLE', 'The viewport is not mounted.')
}
