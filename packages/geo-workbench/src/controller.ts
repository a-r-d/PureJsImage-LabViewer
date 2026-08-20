import {
  type ActionAbortSignal,
  type ActionHandler,
  type JsonValue,
  WorkbenchActionHost,
  WorkbenchActionRegistry,
} from '@pji-workbench/actions'
import type {
  DatasetHandleId,
  DerivedRasterDryRunReport,
  DerivedRasterDryRunRequest,
  DerivedRasterLineProfileRequest,
  DerivedRasterLineProfileResponse,
  DerivedRasterRecipeV1,
  DerivedRasterStatisticsRequest,
  DerivedRasterStatisticsResponse,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  RasterPointSample,
  RasterPointSampleRequest,
  RasterSampleType,
  SourceId,
  SpatialReference,
  WorkerDiagnostics,
} from '@pji-workbench/contracts'
import { assertDerivedRasterRecipe } from '@pji-workbench/contracts'
import {
  CATALOG_REGISTRY,
  type CatalogAssetIdentity,
  type CatalogRegistryEntry,
  type CatalogSearchRequest,
  type CatalogService,
  type CatalogSourceCandidate,
  CrsTransformError,
  createDerivedGeoRasterLayer,
  createGeoMapRoi,
  createGeoProject,
  createGeoRasterLayer,
  createGeoRasterSource,
  crsKey,
  type DerivedGeoRasterLayer,
  exportGeoJson,
  exportGeoProjectDocument,
  GEO_PROJECT_LIMITS,
  type GeoActionContext,
  type GeoActionId,
  type GeoBandMetadata,
  type GeoLayer,
  type GeoLayerId,
  type GeoMapGeometry,
  type GeoMapPoint,
  type GeoMapRoi,
  GeoMeasurementError,
  type GeoProject,
  type GeoProjectViewport,
  type GeoProvenanceId,
  type GeoRasterLayer,
  type GeoRasterLocator,
  type GeoRasterSource,
  type GeoRoiId,
  type GeoSourceId,
  GeoValidationError,
  type GeoWorkflowProvenanceRecord,
  geoActionDefinitions,
  importGeoProjectDocument,
  measureGeoArea,
  measureGeoDistance,
  parseGeoJson,
  type RasterStyle,
  sameCrs,
  scalarNodata,
  transformGeoMapGeometry,
  transformMapPoint,
} from '@pji-workbench/domain-geo'
import { type GeoProjectStore, MemoryGeoProjectStore } from './project-store.js'
import {
  catalogRehydrationEntry,
  finalizeGeoProjectRehydrationPlan,
  type GeoProjectRehydrationPlan,
  type GeoRemoteSourceProbe,
  type GeoSourceRehydrationEntry,
  initialGeoProjectRehydrationPlan,
  localRehydrationEntry,
  remoteRehydrationEntry,
} from './rehydration.js'
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
  dryRunDerivedRaster(
    request: DerivedRasterDryRunRequest,
    signal?: AbortSignal,
  ): Promise<DerivedRasterDryRunReport>
  requestDerivedStatistics(
    request: DerivedRasterStatisticsRequest,
    signal?: AbortSignal,
  ): Promise<DerivedRasterStatisticsResponse>
  requestDerivedLineProfile(
    request: DerivedRasterLineProfileRequest,
    signal?: AbortSignal,
  ): Promise<DerivedRasterLineProfileResponse>
  sampleRasterPoint(
    request: RasterPointSampleRequest,
    signal?: AbortSignal,
  ): Promise<RasterPointSample>
  releaseDerivedRaster(request: Readonly<{ layerId: string }>): Promise<void>
  dispose(): void
}

export interface GeoViewportPort {
  read(): JsonValue
  propose(input: JsonValue, signal?: AbortSignal): Promise<JsonValue> | JsonValue
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
  readonly selectedRoiId?: GeoRoiId
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
  readonly projectStore?: GeoProjectStore
  readonly projectVersions?: Readonly<{ appVersion: string; pureJsImageVersion: string }>
  readonly probeRemoteSource?: (url: string, signal?: AbortSignal) => Promise<GeoRemoteSourceProbe>
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
  readonly #projectStore: GeoProjectStore
  readonly #registry: WorkbenchActionRegistry<GeoActionContext>
  readonly #projectVersions: Readonly<{ appVersion: string; pureJsImageVersion: string }>
  readonly #probeRemoteSource: GeoWorkbenchControllerOptions['probeRemoteSource']
  readonly #listeners = new Set<Listener>()
  readonly #bindings = new Map<GeoSourceId, GeoRuntimeBinding>()
  readonly #host: WorkbenchActionHost<GeoActionContext>
  #snapshot: GeoControllerSnapshot
  #generation = 0
  #nextSemanticId = 1
  #pendingProjectLoad:
    | {
        readonly project: GeoProject
        readonly entries: Map<GeoSourceId, GeoSourceRehydrationEntry>
        readonly localResourceIds: Map<GeoSourceId, string>
      }
    | undefined
  #disposed = false

  constructor(options: GeoWorkbenchControllerOptions) {
    this.#runtime = options.runtime
    this.#catalogService = options.catalogService
    this.#catalogs = options.catalogs ?? CATALOG_REGISTRY
    this.#resources = options.resources ?? new GeoLocalResourceRegistry()
    this.#viewport = options.viewport
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#preflight = options.preflightCatalogAsset
    this.#projectVersions = options.projectVersions ?? {
      appVersion: '0.0.0',
      pureJsImageVersion: '0.14.0',
    }
    this.#projectStore = options.projectStore ?? new MemoryGeoProjectStore(this.#projectVersions)
    this.#probeRemoteSource = options.probeRemoteSource
    const project = normalizeProject(options.initialProject ?? emptyProject(this.#now()))
    this.#snapshot = { revision: 0, project, task: { kind: 'idle' } }
    this.#registry = new WorkbenchActionRegistry<GeoActionContext>(geoActionDefinitions)
    this.#host = new WorkbenchActionHost(this.#registry, this.#createHandlers())
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
      hasRoi: this.#snapshot.project.rois.length > 0,
    }
  }

  actionAvailability(id: GeoActionId): Readonly<{ available: boolean; reason?: string }> {
    return this.#registry.availability(id, 1, this.actionContext())
  }

  actionCapabilities() {
    const context = this.actionContext()
    return this.#registry.list().map((descriptor) => ({
      descriptor,
      availability: this.#registry.availability(descriptor.id, descriptor.version, context),
    }))
  }

  planAction(id: string, version: number, input: unknown) {
    this.#assertActive()
    return this.#host.plan(id, version, input, this.actionContext())
  }

  async executeAction(
    id: GeoActionId,
    input: unknown,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<JsonValue> {
    return this.executeVersionedAction(id, 1, input, signal)
  }

  async executeVersionedAction(
    id: string,
    version: number,
    input: unknown,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<JsonValue> {
    this.#assertActive()
    try {
      return await this.#host.execute(id, version, input, this.actionContext(), signal)
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
    const probe =
      input.candidate === undefined && this.#probeRemoteSource !== undefined
        ? await this.#probeRemoteSource(input.url, signal).catch(() => undefined)
        : undefined
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
      input.candidate,
      probe,
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
          companionNames: resource.files
            .filter((file) => file !== primary)
            .map(({ name }) => name)
            .sort(),
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
    let locator = source.locator
    let candidate: CatalogSourceCandidate | undefined
    if (locator.kind === 'stac-asset' || locator.kind === 'tnm-product') {
      candidate = await this.#catalogService.resolveDeepLink(
        this.#catalog(locator.catalog.catalogId),
        {
          catalogId: locator.catalog.catalogId,
          collectionId: locator.catalog.collectionId,
          itemId: locator.catalog.itemId,
          assetKey: locator.catalog.assetKey,
        },
        signal,
      )
      if (candidate === undefined)
        throw new GeoControllerError('CATALOG_NOT_FOUND', 'Catalog asset was not found.')
      locator = locatorFromCandidate(candidate)
    }
    const url = candidate?.href ?? replayUrl(locator)
    if (url === undefined) {
      throw new GeoControllerError('UNAVAILABLE', 'This source requires a local rebind.')
    }
    return this.#transactionalRebind(
      source,
      () => this.#runtime.openRemote(url, this.#nextGeneration(), signal),
      locator,
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

  selectInspector(inspector: NonNullable<GeoProject['selection']['inspector']>): void {
    const project = createGeoProject({
      ...this.#snapshot.project,
      selection: { ...this.#snapshot.project.selection, inspector },
    })
    this.#setSnapshot({ ...this.#snapshot, project })
  }

  updateLayer(
    layerId: string,
    patch: Partial<
      Pick<GeoLayer, 'label' | 'visible' | 'opacity' | 'blendMode' | 'zIndex' | 'style'>
    >,
  ): void {
    const target = this.#requireLayer(layerId)
    const layers = this.#snapshot.project.layers.map((layer) =>
      layer.id === target.id
        ? target.kind === 'raster'
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
          : createDerivedGeoRasterLayer({
              id: layer.id,
              ...(target.sourceId === undefined ? {} : { sourceId: target.sourceId }),
              inputLayerIds: target.inputLayerIds,
              label: patch.label ?? target.label,
              visible: patch.visible ?? target.visible,
              opacity: patch.opacity ?? target.opacity,
              blendMode: patch.blendMode ?? target.blendMode,
              zIndex: patch.zIndex ?? target.zIndex,
              style: patch.style ?? target.style,
              recipe: target.recipe,
              provenance: target.provenance,
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
    const removed = this.#requireLayer(layerId)
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
      {
        layers,
        comparison: { mode: 'single' },
        provenance:
          removed.kind === 'derived'
            ? this.#snapshot.project.provenance.filter(({ id }) => id !== removed.provenance.id)
            : this.#snapshot.project.provenance,
        workflowRuns: this.#snapshot.project.workflowRuns.filter(
          ({ outputLayerIds }) => !outputLayerIds.includes(removed.id),
        ),
      },
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
        workflowRuns: this.#snapshot.project.workflowRuns.filter(
          (run) =>
            !run.sourceIds.includes(source.id) &&
            run.outputLayerIds.every((id) => remainingLayers.some((layer) => layer.id === id)),
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
    candidate?: CatalogSourceCandidate,
    probe?: GeoRemoteSourceProbe,
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
        ...(candidate === undefined
          ? {
              ...(probe === undefined ? {} : { validators: probe.validators }),
              lastKnownMetadata: { bands },
            }
          : sourceMetadataFromCandidate(candidate, bands)),
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
        ...(existing.validators === undefined ? {} : { validators: existing.validators }),
        ...(existing.lastKnownMetadata === undefined
          ? {}
          : { lastKnownMetadata: existing.lastKnownMetadata }),
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

  #derivedRequest(recipeValue: unknown, layerId: string): DerivedRasterDryRunRequest {
    assertDerivedRasterRecipe(recipeValue)
    const recipe = recipeValue
    const inputs = recipe.inputs.map((input) => {
      const layer = this.#requireRasterLayer(input.layerId)
      const source = this.#requireSource(layer.sourceId)
      const binding = this.#bindings.get(source.id)
      if (binding === undefined) {
        throw new GeoControllerError(
          'UNAVAILABLE',
          `Source ${source.id} must be open before running analysis.`,
        )
      }
      if (input.component >= source.componentCount) {
        throw new GeoControllerError(
          'INVALID_ACTION_INPUT',
          `Input ${input.name} selects unavailable band ${input.component}.`,
        )
      }
      return {
        layerId: layer.id,
        datasetHandleId: binding.dataset.handleId,
        generation: binding.dataset.generation,
        sourceIdentity: JSON.stringify(binding.source.identity),
        sourceRevision: sourceRevision(source),
        grid: targetGridForSource(source, binding.dataset.dataset.sampleType),
      }
    })
    return { layerId, recipe, inputs }
  }

  async #createDerivedLayer(
    recipeValue: unknown,
    operationKind: DerivedRasterRecipeV1['operation']['kind'],
    terrainOperation: 'hillshade' | 'slope' | 'aspect' | undefined,
    label: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<GeoLayerId> {
    const id = this.#uniqueId(
      `geo-${operationKind}`,
      this.#snapshot.project.layers.map(({ id }) => id),
    ) as GeoLayerId
    const request = this.#derivedRequest(recipeValue, id)
    if (request.recipe.operation.kind !== operationKind) {
      throw new GeoControllerError(
        'INVALID_ACTION_INPUT',
        `Action requires a ${operationKind} recipe.`,
      )
    }
    if (
      terrainOperation !== undefined &&
      (request.recipe.operation.kind !== 'terrain' ||
        request.recipe.operation.operation !== terrainOperation)
    ) {
      throw new GeoControllerError(
        'INVALID_ACTION_INPUT',
        `Action requires a ${terrainOperation} terrain recipe.`,
      )
    }
    await this.#runtime.dryRunDerivedRaster(request, signal)
    signal?.throwIfAborted()
    const inputLayers = request.recipe.inputs.map((input) =>
      this.#requireRasterLayer(input.layerId),
    )
    const sourceIds = [...new Set(inputLayers.map(({ sourceId }) => sourceId))]
    const provenance = {
      id: this.#uniqueId(
        `${id}-provenance`,
        this.#snapshot.project.provenance.map(({ id }) => id),
      ) as GeoProvenanceId,
      sourceIds,
      recipe: { recipeId: `geo.analysis.${operationKind}`, recipeVersion: '1' },
      createdAt: this.#now(),
    }
    const derived = createDerivedGeoRasterLayer({
      id,
      inputLayerIds: request.recipe.inputs.map(({ layerId }) => layerId),
      label: label ?? derivedLayerLabel(operationKind),
      zIndex:
        this.#snapshot.project.layers.reduce((max, layer) => Math.max(max, layer.zIndex), -1) + 1,
      style: derivedLayerStyle(request.recipe.operation),
      recipe: request.recipe,
      provenance,
    })
    this.#replaceProject(
      {
        layers: [...this.#snapshot.project.layers, derived],
        provenance: [...this.#snapshot.project.provenance, provenance],
      },
      { selectedLayerId: id, selectedSourceId: sourceIds[0] },
    )
    return id
  }

  #requireDerivedLayer(layerId: string): DerivedGeoRasterLayer {
    const layer = this.#requireLayer(layerId)
    if (layer.kind !== 'derived')
      throw new GeoControllerError('PROJECT_INVALID', `Layer ${layerId} is not derived.`)
    return layer
  }

  #replaceProject(
    patch: Partial<
      Pick<GeoProject, 'sources' | 'layers' | 'comparison' | 'rois' | 'provenance' | 'workflowRuns'>
    >,
    selection: {
      readonly selectedLayerId?: GeoLayerId | undefined
      readonly selectedSourceId?: GeoSourceId | undefined
      readonly selectedRoiId?: GeoRoiId | undefined
    } = {},
  ): void {
    const selectedLayerId =
      'selectedLayerId' in selection ? selection.selectedLayerId : this.#snapshot.selectedLayerId
    const selectedSourceId =
      'selectedSourceId' in selection ? selection.selectedSourceId : this.#snapshot.selectedSourceId
    const selectedRoiId =
      'selectedRoiId' in selection ? selection.selectedRoiId : this.#snapshot.selectedRoiId
    const project = createGeoProject({
      ...this.#snapshot.project,
      ...patch,
      selection: {
        ...(selectedSourceId === undefined ? {} : { sourceId: selectedSourceId }),
        ...(selectedLayerId === undefined ? {} : { layerId: selectedLayerId }),
        ...(selectedRoiId === undefined ? {} : { roiId: selectedRoiId }),
        ...(this.#snapshot.project.selection.inspector === undefined
          ? {}
          : { inspector: this.#snapshot.project.selection.inspector }),
      },
    })
    this.#setSnapshot({
      revision: this.#snapshot.revision + 1,
      project,
      ...(selectedSourceId === undefined ? {} : { selectedSourceId }),
      ...(selectedLayerId === undefined ? {} : { selectedLayerId }),
      ...(selectedRoiId === undefined ? {} : { selectedRoiId }),
      task: { kind: 'idle' },
    })
  }

  #projectWithCurrentState(): GeoProject {
    const viewport = this.#viewport?.read()
    const persistedViewport = isProjectViewport(viewport)
      ? viewport
      : this.#snapshot.project.viewport
    return createGeoProject({
      ...this.#snapshot.project,
      updatedAt: this.#now(),
      viewport: persistedViewport,
      selection: {
        ...(this.#snapshot.selectedSourceId === undefined
          ? {}
          : { sourceId: this.#snapshot.selectedSourceId }),
        ...(this.#snapshot.selectedLayerId === undefined
          ? {}
          : { layerId: this.#snapshot.selectedLayerId }),
        ...(this.#snapshot.selectedRoiId === undefined
          ? {}
          : { roiId: this.#snapshot.selectedRoiId }),
        ...(this.#snapshot.project.selection.inspector === undefined
          ? {}
          : { inspector: this.#snapshot.project.selection.inspector }),
      },
    })
  }

  async #stageProject(
    project: GeoProject,
    signal?: AbortSignal,
  ): Promise<GeoProjectRehydrationPlan> {
    const normalized = normalizeProject(project)
    const initial = initialGeoProjectRehydrationPlan(normalized)
    const entries = new Map(initial.entries.map((entry) => [entry.sourceId, entry]))
    this.#pendingProjectLoad = {
      project: normalized,
      entries,
      localResourceIds: new Map(),
    }
    for (const source of normalized.sources) {
      signal?.throwIfAborted()
      if (source.locator.kind === 'stac-asset' || source.locator.kind === 'tnm-product') {
        const catalog = this.#catalog(source.locator.catalog.catalogId)
        const identity: CatalogAssetIdentity = {
          catalogId: source.locator.catalog.catalogId,
          collectionId: source.locator.catalog.collectionId,
          itemId: source.locator.catalog.itemId,
          assetKey: source.locator.catalog.assetKey,
        }
        const candidate = await this.#catalogService.resolveDeepLink(catalog, identity, signal)
        entries.set(source.id, catalogRehydrationEntry(source, candidate))
      } else if (source.locator.kind === 'remote-url') {
        const probe = this.#probeRemoteSource
          ? await this.#probeRemoteSource(source.locator.url, signal)
          : {
              status: 'unchanged' as const,
              validators: source.validators ?? {},
              url: source.locator.url,
              compatible: true,
            }
        entries.set(source.id, remoteRehydrationEntry(source, probe))
      } else if (source.locator.kind === 'bundled-example') {
        entries.set(source.id, {
          sourceId: source.id,
          label: source.label,
          locatorKind: source.locator.kind,
          status: 'unavailable',
          differences: ['Bundled examples require an explicit runtime resolver.'],
        })
      }
    }
    return this.#pendingPlan()
  }

  #pendingPlan(): GeoProjectRehydrationPlan {
    const pending = this.#pendingProjectLoad
    if (pending === undefined)
      throw new GeoControllerError('UNAVAILABLE', 'No Atlas project is staged for rehydration.')
    return finalizeGeoProjectRehydrationPlan(pending.project, [...pending.entries.values()])
  }

  async #commitPendingProject(confirmChanged: boolean, signal?: AbortSignal): Promise<GeoProject> {
    const pending = this.#pendingProjectLoad
    if (pending === undefined)
      throw new GeoControllerError('UNAVAILABLE', 'No Atlas project is staged for rehydration.')
    const plan = this.#pendingPlan()
    if (!plan.readyToCommit)
      throw new GeoControllerError('UNAVAILABLE', 'Resolve or rebind every project source first.', {
        statuses: plan.entries.map(({ sourceId, status }) => ({ sourceId, status })),
      })
    if (plan.requiresConfirmation && !confirmChanged)
      throw new GeoControllerError(
        'UNAVAILABLE',
        'Changed source content requires explicit confirmation before opening.',
        { invalidatedDerivedLayerIds: plan.invalidatedDerivedLayerIds },
      )
    this.#patchTask({ kind: 'rehydrating', label: pending.project.title })
    const prepared = new Map<GeoSourceId, GeoRuntimeBinding>()
    const refreshedSources: GeoRasterSource[] = []
    try {
      for (const source of pending.project.sources) {
        signal?.throwIfAborted()
        const entry = pending.entries.get(source.id)
        if (entry === undefined) throw new Error(`Missing rehydration entry for ${source.id}`)
        const resourceId = pending.localResourceIds.get(source.id)
        const result = await this.#prepareProjectSource(source, entry, resourceId, signal)
        prepared.set(source.id, result.binding)
        refreshedSources.push(result.source)
      }
      signal?.throwIfAborted()
      const project = createGeoProject({
        ...pending.project,
        sources: refreshedSources,
        updatedAt: this.#now(),
      })
      const previousBindings = [...this.#bindings.values()]
      this.#bindings.clear()
      for (const [id, binding] of prepared) this.#bindings.set(id, binding)
      this.#pendingProjectLoad = undefined
      this.#setSnapshot({
        revision: this.#snapshot.revision + 1,
        project,
        ...(project.selection.sourceId === undefined
          ? {}
          : { selectedSourceId: project.selection.sourceId }),
        ...(project.selection.layerId === undefined
          ? {}
          : { selectedLayerId: project.selection.layerId }),
        ...(project.selection.roiId === undefined
          ? {}
          : { selectedRoiId: project.selection.roiId }),
        task: { kind: 'idle' },
      })
      await Promise.all(
        previousBindings.map((binding) => this.#releaseBinding(binding).catch(() => undefined)),
      )
      for (const layerId of plan.invalidatedDerivedLayerIds)
        await this.#runtime.releaseDerivedRaster({ layerId }).catch(() => undefined)
      return project
    } catch (error) {
      await Promise.all(
        [...prepared.values()].map((binding) =>
          this.#releaseBinding(binding).catch(() => undefined),
        ),
      )
      const classified = classifyControllerError(error)
      this.#setError(classified)
      throw classified
    }
  }

  async #prepareProjectSource(
    saved: GeoRasterSource,
    entry: GeoSourceRehydrationEntry,
    resourceId: string | undefined,
    signal?: AbortSignal,
  ): Promise<Readonly<{ source: GeoRasterSource; binding: GeoRuntimeBinding }>> {
    let opened: OpenedSourceDescriptor | undefined
    let dataset: OpenedDatasetDescriptor | undefined
    let localFiles: readonly File[] | undefined
    let localPrimary: File | undefined
    try {
      if (saved.locator.kind === 'local-file') {
        const resource = resourceId === undefined ? undefined : this.#resources.get(resourceId)
        if (resource === undefined)
          throw new GeoControllerError('LOCAL_RESOURCE_MISSING', `${saved.label} must be rebound.`)
        localFiles = resource.files
        localPrimary = resource.primary
        opened = await this.#runtime.openLocal(
          resource.files,
          resource.primary,
          this.#nextGeneration(),
          signal,
        )
      } else {
        const url =
          entry.refreshedUrl ??
          (saved.locator.kind === 'remote-url' ? saved.locator.url : undefined)
        if (url === undefined)
          throw new GeoControllerError('UNAVAILABLE', `${saved.label} has no refreshed URL.`)
        opened = await this.#runtime.openRemote(url, this.#nextGeneration(), signal)
      }
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
      if (!sameCrs(spatial.crs, saved.spatialReference.crs))
        throw new GeoControllerError(
          'CRS_INCOMPATIBLE',
          `${saved.label} no longer has its saved CRS.`,
        )
      const candidate = entry.refreshedCandidate
      const locator: GeoRasterLocator =
        candidate !== undefined
          ? locatorFromCandidate(candidate)
          : saved.locator.kind === 'local-file' &&
              localPrimary !== undefined &&
              localFiles !== undefined
            ? {
                kind: 'local-file',
                fingerprint: {
                  name: localPrimary.name,
                  size: localPrimary.size,
                  lastModified: localPrimary.lastModified,
                  ...(localPrimary.type.length === 0 ? {} : { mediaType: localPrimary.type }),
                  ...(entry.differences.length === 0 &&
                  saved.locator.fingerprint.digest !== undefined
                    ? { digest: saved.locator.fingerprint.digest }
                    : {}),
                  ...(localFiles.length <= 1
                    ? {}
                    : {
                        companionNames: localFiles
                          .filter((file) => file !== localPrimary)
                          .map(({ name }) => name),
                      }),
                },
              }
            : saved.locator
      const bands = bandsForDataset(dataset, locator)
      const source = createGeoRasterSource({
        ...saved,
        width: axisLength(dataset, 'x'),
        height: axisLength(dataset, 'y'),
        componentCount: Math.max(1, dataset.dataset.components.length),
        spatialReference: spatial,
        locator,
        bands,
        ...(entry.refreshedValidators === undefined
          ? {}
          : { validators: entry.refreshedValidators }),
        ...(candidate === undefined
          ? {
              lastKnownMetadata: {
                ...saved.lastKnownMetadata,
                bands,
              },
            }
          : sourceMetadataFromCandidate(candidate, bands)),
      })
      return {
        source,
        binding: {
          semanticSourceId: saved.id,
          source: opened,
          dataset,
          presets: [],
          activeOverview: 0,
        },
      }
    } catch (error) {
      if (dataset !== undefined)
        await this.#runtime
          .closeDataset(dataset.handleId, dataset.generation)
          .catch(() => undefined)
      if (opened !== undefined)
        await this.#runtime.closeSource(opened.sourceId, opened.generation).catch(() => undefined)
      throw error
    }
  }

  #createHandlers(): ReadonlyMap<string, ActionHandler<GeoActionContext>> {
    const handlers = new Map<string, ActionHandler<GeoActionContext>>()
    const set = (id: GeoActionId, execute: ActionHandler<GeoActionContext>['execute']): void => {
      handlers.set(`${id}@1`, { execute })
    }
    set('geo.project.new', async (input) => {
      const record = recordInput(input)
      const now = this.#now()
      const project = createGeoProject({
        id: optionalStringField(record, 'id') ?? `geo-project-${Date.parse(now) || 0}`,
        title: optionalStringField(record, 'title') ?? 'Atlas project',
        crs: { kind: 'unknown' },
        createdAt: now,
        updatedAt: now,
      })
      const previous = [...this.#bindings.values()]
      this.#bindings.clear()
      await Promise.all(
        previous.map((binding) => this.#releaseBinding(binding).catch(() => undefined)),
      )
      this.#pendingProjectLoad = undefined
      this.#setSnapshot({ revision: this.#snapshot.revision + 1, project, task: { kind: 'idle' } })
      return json(project)
    })
    set('geo.project.describe', () =>
      json({
        project: this.#projectWithCurrentState(),
        runtimeBoundSourceIds: [...this.#bindings.keys()],
      }),
    )
    set('geo.project.save', async () => {
      const project = this.#projectWithCurrentState()
      const saved = await this.#projectStore.save(project)
      this.#setSnapshot({ ...this.#snapshot, project })
      return json(saved)
    })
    set('geo.project.list', async () => json(await this.#projectStore.list()))
    set('geo.project.delete', async (input) => {
      await this.#projectStore.delete(stringField(input, 'projectId'))
      return { deleted: true }
    })
    set('geo.project.export', async (input) => {
      const projectId = optionalStringField(input, 'projectId')
      if (projectId === undefined) {
        const exported = exportGeoProjectDocument(
          this.#projectWithCurrentState(),
          this.#projectVersions,
        )
        return { text: exported.text, bytes: exported.bytes }
      }
      const stored = await this.#projectStore.load(projectId)
      if (stored === undefined)
        throw new GeoControllerError('PROJECT_INVALID', `Saved project ${projectId} was not found.`)
      return { text: stored.text, bytes: stored.bytes }
    })
    set('geo.project.import', async (input, _context, signal) => {
      const imported = importGeoProjectDocument(stringField(input, 'document'))
      const plan = await this.#stageProject(imported.project, nativeSignal(signal))
      return json({
        plan,
        migrations: imported.migrations,
        checksumVerified: imported.checksumVerified,
      })
    })
    set('geo.project.rehydration_plan', async (input, _context, signal) => {
      const record = recordInput(input)
      const document = optionalStringField(record, 'document')
      const projectId = optionalStringField(record, 'projectId')
      if (document !== undefined)
        return json(
          await this.#stageProject(
            importGeoProjectDocument(document).project,
            nativeSignal(signal),
          ),
        )
      if (projectId !== undefined) {
        const stored = await this.#projectStore.load(projectId)
        if (stored === undefined)
          throw new GeoControllerError(
            'PROJECT_INVALID',
            `Saved project ${projectId} was not found.`,
          )
        return json(
          await this.#stageProject(
            importGeoProjectDocument(stored.text).project,
            nativeSignal(signal),
          ),
        )
      }
      return json(this.#pendingPlan())
    })
    set('geo.project.resolve_catalog_source', async (input, _context, signal) => {
      const pending = this.#pendingProjectLoad
      if (pending === undefined)
        throw new GeoControllerError('UNAVAILABLE', 'No Atlas project is staged.')
      const source = pending.project.sources.find(({ id }) => id === stringField(input, 'sourceId'))
      if (
        source === undefined ||
        (source.locator.kind !== 'stac-asset' && source.locator.kind !== 'tnm-product')
      )
        throw new GeoControllerError('SOURCE_NOT_FOUND', 'The staged catalog source was not found.')
      const catalog = this.#catalog(source.locator.catalog.catalogId)
      const candidate = await this.#catalogService.resolveDeepLink(
        catalog,
        {
          catalogId: source.locator.catalog.catalogId,
          collectionId: source.locator.catalog.collectionId,
          itemId: source.locator.catalog.itemId,
          assetKey: source.locator.catalog.assetKey,
        },
        nativeSignal(signal),
      )
      pending.entries.set(source.id, catalogRehydrationEntry(source, candidate))
      return json(this.#pendingPlan())
    })
    set('geo.project.rebind_source', (input) => {
      const pending = this.#pendingProjectLoad
      if (pending === undefined)
        throw new GeoControllerError('UNAVAILABLE', 'No Atlas project is staged.')
      const sourceId = stringField(input, 'sourceId') as GeoSourceId
      const resourceId = stringField(input, 'resourceId')
      const source = pending.project.sources.find(({ id }) => id === sourceId)
      const resource = this.#resources.get(resourceId)
      if (source === undefined || resource === undefined)
        throw new GeoControllerError(
          'LOCAL_RESOURCE_MISSING',
          'The source or selected file is unavailable.',
        )
      const companions = resource.files.filter((file) => file !== resource.primary)
      const entry = localRehydrationEntry(source, resource.primary, companions)
      pending.localResourceIds.set(sourceId, resourceId)
      pending.entries.set(sourceId, entry)
      return json(this.#pendingPlan())
    })
    set('geo.project.open', async (input, _context, signal) => {
      const record = recordInput(input)
      const projectId = optionalStringField(record, 'projectId')
      const document = optionalStringField(record, 'document')
      if (projectId !== undefined || document !== undefined) {
        const text = document ?? (await this.#projectStore.load(projectId as string))?.text
        if (text === undefined)
          throw new GeoControllerError(
            'PROJECT_INVALID',
            `Saved project ${projectId ?? ''} was not found.`,
          )
        const plan = await this.#stageProject(
          importGeoProjectDocument(text).project,
          nativeSignal(signal),
        )
        if (!plan.readyToCommit || (plan.requiresConfirmation && record['confirmChanged'] !== true))
          return json({ committed: false, plan })
      }
      const project = await this.#commitPendingProject(
        record['confirmChanged'] === true,
        nativeSignal(signal),
      )
      return json({ committed: true, projectId: project.id })
    })
    set('geo.workflow.record', (input) => {
      const record = recordInput(input)['record'] as unknown as GeoWorkflowProvenanceRecord
      this.#replaceProject({ workflowRuns: [...this.#snapshot.project.workflowRuns, record] })
      return { recorded: true, runId: record.id }
    })
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
    set('geo.roi.list', () => json(this.#snapshot.project.rois))
    set('geo.roi.create', (input) => {
      if (this.#snapshot.project.rois.length >= GEO_PROJECT_LIMITS.maxRois)
        throw new GeoControllerError('PROJECT_INVALID', 'The project ROI limit has been reached.')
      const record = recordInput(input)
      const geometry = geometryField(record['geometry'])
      const crs = crsField(record['crs'] ?? this.#snapshot.project.crs)
      const id =
        optionalStringField(record, 'id') ??
        this.#uniqueId(
          'roi',
          this.#snapshot.project.rois.map(({ id }) => id),
        )
      const name = optionalStringField(record, 'name')
      const tool = drawingTool(record['tool'], geometry)
      const roi = createGeoMapRoi({
        id,
        ...(name === undefined ? {} : { name }),
        crs,
        geometry,
        provenance: { kind: 'drawn', tool },
        createdAt: this.#now(),
        ...(record['properties'] === undefined
          ? {}
          : { properties: jsonRecordField(record['properties'], 'properties') }),
      })
      this.#replaceProject(
        { rois: [...this.#snapshot.project.rois, roi] },
        { selectedRoiId: roi.id },
      )
      return json(roi)
    })
    set('geo.roi.update', (input) => {
      const record = recordInput(input)
      const current = this.#requireRoi(stringField(record, 'roiId'))
      const name = optionalStringField(record, 'name') ?? current.name
      const properties =
        record['properties'] === undefined
          ? current.properties
          : jsonRecordField(record['properties'], 'properties')
      const next = createGeoMapRoi({
        id: current.id,
        ...(name === undefined ? {} : { name }),
        crs: record['crs'] === undefined ? current.crs : crsField(record['crs']),
        geometry:
          record['geometry'] === undefined ? current.geometry : geometryField(record['geometry']),
        provenance: current.provenance,
        createdAt: current.createdAt,
        ...(properties === undefined ? {} : { properties }),
      })
      this.#replaceProject({
        rois: this.#snapshot.project.rois.map((roi) => (roi.id === current.id ? next : roi)),
      })
      return json(next)
    })
    set('geo.roi.remove', (input) => {
      const roi = this.#requireRoi(stringField(input, 'roiId'))
      const rois = this.#snapshot.project.rois.filter(({ id }) => id !== roi.id)
      this.#replaceProject({ rois }, { selectedRoiId: rois.at(-1)?.id })
      return { removed: true }
    })
    set('geo.roi.select', (input) => {
      const roi = this.#requireRoi(stringField(input, 'roiId'))
      this.#replaceProject({}, { selectedRoiId: roi.id })
      return { selected: true }
    })
    set('geo.roi.import_geojson', (input) => {
      const record = recordInput(input)
      const document = record['document']
      if (typeof document !== 'string')
        throw new GeoControllerError('INVALID_ACTION_INPUT', 'GeoJSON document must be a string.')
      const legacyDefinition =
        record['legacyCrs'] === undefined ? undefined : crsField(record['legacyCrs'])
      const sourceName = optionalStringField(record, 'sourceName')
      const existingIds = this.#snapshot.project.rois.map(({ id }) => id)
      const result = parseGeoJson(document, {
        now: this.#now,
        ...(sourceName === undefined ? {} : { sourceName }),
        idFactory: (index) => this.#uniqueId(`roi-import-${index + 1}`, existingIds),
        ...(record['legacyCrsConfirmed'] === true
          ? {
              legacyCrs: {
                confirmed: true,
                ...(legacyDefinition === undefined ? {} : { definition: legacyDefinition }),
              },
            }
          : {}),
      })
      if (result.issues.some(({ severity }) => severity === 'error') || result.requiresConfirmation)
        return json(result)
      if (this.#snapshot.project.rois.length + result.rois.length > GEO_PROJECT_LIMITS.maxRois)
        throw new GeoControllerError(
          'PROJECT_INVALID',
          'Imported GeoJSON exceeds the project ROI limit.',
        )
      const usedIds = new Set(this.#snapshot.project.rois.map(({ id }) => id))
      const importedRois = result.rois.map((roi) => {
        const id = usedIds.has(roi.id) ? this.#uniqueId('roi-import', [...usedIds]) : roi.id
        usedIds.add(id as GeoRoiId)
        return id === roi.id
          ? roi
          : createGeoMapRoi({
              id,
              ...(roi.name === undefined ? {} : { name: roi.name }),
              crs: roi.crs,
              geometry: roi.geometry,
              provenance: roi.provenance,
              createdAt: roi.createdAt,
              ...(roi.properties === undefined ? {} : { properties: roi.properties }),
            })
      })
      this.#replaceProject(
        { rois: [...this.#snapshot.project.rois, ...importedRois] },
        { selectedRoiId: importedRois.at(-1)?.id },
      )
      return json({ ...result, rois: importedRois })
    })
    set('geo.roi.export_geojson', (input) => {
      const record = recordInput(input)
      const ids = optionalStringArrayField(record, 'roiIds')
      const rois =
        ids === undefined ? this.#snapshot.project.rois : ids.map((id) => this.#requireRoi(id))
      const transformNote = optionalStringField(record, 'transformNote')
      return json(
        exportGeoJson(rois, {
          nativeCrs: record['nativeCrs'] === true,
          ...(record['includeProperties'] === false ? { includeProperties: false } : {}),
          ...(record['transformApproximate'] === true
            ? {
                transformAccuracy: {
                  kind: 'approximate',
                  ...(transformNote === undefined ? {} : { note: transformNote }),
                },
              }
            : {}),
        }),
      )
    })
    for (const id of ['geo.measure.distance', 'geo.measure.area'] as const) {
      set(id, (input) => {
        const record = recordInput(input)
        const roi = this.#requireRoi(optionalStringField(record, 'roiId') ?? this.#selectedRoiId())
        const planarUnit = planarUnitField(record['planarUnit'])
        return json(
          id === 'geo.measure.distance'
            ? measureGeoDistance(
                roi.geometry,
                roi.crs,
                planarUnit === undefined ? {} : { planarUnit },
              )
            : measureGeoArea(roi.geometry, roi.crs, planarUnit === undefined ? {} : { planarUnit }),
        )
      })
    }
    set('geo.raster.describe_bands', (input) => json(this.#sourceForRasterInput(input).bands))
    const samplePoints = async (
      input: JsonValue,
      signal: ActionAbortSignal,
    ): Promise<JsonValue> => {
      const record = recordInput(input)
      const layer = this.#rasterLayerForInput(record)
      const source = this.#requireSource(layer.sourceId)
      const binding = this.#bindings.get(source.id)
      if (binding === undefined)
        throw new GeoControllerError('UNAVAILABLE', 'Raster source is not open.')
      const roiId = optionalStringField(record, 'roiId')
      const roi = roiId === undefined ? undefined : this.#requireRoi(roiId)
      const roiPointValues =
        roi?.geometry.kind === 'point'
          ? [{ x: roi.geometry.x, y: roi.geometry.y }]
          : roi?.geometry.kind === 'multi-point'
            ? roi.geometry.points
            : undefined
      const pointValues = Array.isArray(record['points'])
        ? record['points']
        : record['point'] !== undefined
          ? [record['point']]
          : (roiPointValues ?? [])
      if (pointValues.length === 0 || pointValues.length > 2_000)
        throw new GeoControllerError(
          'INVALID_ACTION_INPUT',
          'Point sampling requires 1 to 2000 points.',
        )
      const inputCrs =
        record['crs'] === undefined
          ? (roi?.crs ?? this.#snapshot.project.crs)
          : crsField(record['crs'])
      const valuePolicy = record['valuePolicy'] === 'scaled' ? 'scaled' : 'raw'
      const samples = []
      for (const [index, value] of pointValues.entries()) {
        if (nativeSignal(signal)?.aborted) throw new DOMException('Action aborted', 'AbortError')
        const projectPoint = pointFieldValue(value, `points[${index}]`)
        const sourcePoint = sameCrs(inputCrs, source.spatialReference.crs)
          ? projectPoint
          : transformMapPoint(projectPoint, inputCrs, source.spatialReference.crs)
        const pixel = mapToPixel(sourcePoint, source.spatialReference)
        const sample = await this.#runtime.sampleRasterPoint(
          {
            datasetHandleId: binding.dataset.handleId,
            generation: binding.dataset.generation,
            sourceIdentity: JSON.stringify(binding.source.identity),
            layerId: layer.id,
            displayAxes: binding.dataset.selection.displayAxes,
            fixedIndices: binding.dataset.selection.fixedIndices,
            pixel,
            projectMapCoordinate: projectPoint,
          },
          nativeSignal(signal),
        )
        samples.push({
          ...sample,
          valuePolicy,
          components: scaleSampleComponents(sample, source, valuePolicy),
        })
      }
      return json({
        samples,
        validSampleCount: samples.filter(({ nodata }) => !nodata).length,
        nodataCount: samples.filter(({ nodata }) => nodata).length,
        valuePolicy,
      })
    }
    set('geo.raster.sample_point', (input, _context, signal) => samplePoints(input, signal))
    set('geo.raster.sample_points', (input, _context, signal) => samplePoints(input, signal))
    set('geo.raster.describe_statistics', () => {
      throw new GeoControllerError('UNAVAILABLE', 'Statistics are not implemented for Atlas yet.')
    })
    set('geo.analysis.describe', (input) => {
      const layer = this.#requireDerivedLayer(stringField(input, 'layerId'))
      return json({ recipe: layer.recipe, provenance: layer.provenance })
    })
    set('geo.analysis.dry_run', async (input, _context, signal) => {
      const record = recordInput(input)
      return json(
        await this.#runtime.dryRunDerivedRaster(
          this.#derivedRequest(record['recipe'], 'geo-analysis-dry-run'),
          nativeSignal(signal),
        ),
      )
    })
    const createAnalysis = (
      id: GeoActionId,
      kind: DerivedRasterRecipeV1['operation']['kind'],
      terrainOperation?: 'hillshade' | 'slope' | 'aspect',
    ): void => {
      set(id, async (input, _context, signal) => {
        const record = recordInput(input)
        const layerId = await this.#createDerivedLayer(
          record['recipe'],
          kind,
          terrainOperation,
          optionalStringField(record, 'label'),
          nativeSignal(signal),
        )
        return { layerId }
      })
    }
    createAnalysis('geo.analysis.band_math', 'band-math')
    createAnalysis('geo.analysis.normalized_difference', 'normalized-difference')
    createAnalysis('geo.analysis.virtual_band_stack', 'virtual-band-stack')
    createAnalysis('geo.analysis.raster_difference', 'raster-difference')
    createAnalysis('geo.analysis.hillshade', 'terrain', 'hillshade')
    createAnalysis('geo.analysis.slope', 'terrain', 'slope')
    createAnalysis('geo.analysis.aspect', 'terrain', 'aspect')
    set('geo.analysis.region_statistics', async (input, _context, signal) => {
      const record = recordInput(input)
      const recipeValue = record['recipe']
      const request =
        recipeValue === undefined
          ? this.#derivedRequest(
              this.#requireDerivedLayer(stringField(record, 'layerId')).recipe,
              stringField(record, 'layerId'),
            )
          : this.#derivedRequest(recipeValue, 'geo-region-statistics')
      const histogramValue = record['histogram']
      const histogram =
        histogramValue === undefined
          ? undefined
          : {
              bins: integerField(histogramValue, 'bins'),
              minimum: numberField(histogramValue, 'minimum'),
              maximum: numberField(histogramValue, 'maximum'),
            }
      const result = await this.#runtime.requestDerivedStatistics(
        {
          ...request,
          region: regionField(record, 'region'),
          component: optionalIntegerField(record, 'component') ?? 0,
          ...(histogram === undefined ? {} : { histogram }),
        },
        nativeSignal(signal),
      )
      return json({
        ...result,
        ...(result.histogram === undefined
          ? {}
          : { histogram: { ...result.histogram, counts: [...result.histogram.counts] } }),
      })
    })
    set('geo.analysis.line_profile', async (input, _context, signal) => {
      const record = recordInput(input)
      const roiId = optionalStringField(record, 'roiId')
      if (roiId !== undefined) {
        const roi = this.#requireRoi(roiId)
        const points = linePoints(roi.geometry)
        const layer = this.#rasterLayerForInput(record)
        const source = this.#requireSource(layer.sourceId)
        const component = optionalIntegerField(record, 'component') ?? 0
        const valuePolicy = record['valuePolicy'] === 'scaled' ? 'scaled' : 'raw'
        const pixelPoints = points.map((point) =>
          mapToPixel(
            sameCrs(roi.crs, source.spatialReference.crs)
              ? point
              : transformMapPoint(point, roi.crs, source.spatialReference.crs),
            source.spatialReference,
          ),
        )
        if (pixelPoints.length < 2)
          throw new GeoControllerError('INVALID_ACTION_INPUT', 'Line ROI has no points.')
        const recipe = identityRasterRecipe(
          layer,
          source,
          component,
          valuePolicy,
          this.bindingForLayer(layer.id),
        )
        const requestedCount = optionalIntegerField(record, 'sampleCount')
        if (requestedCount !== undefined && (requestedCount < 2 || requestedCount > 100_000))
          throw new GeoControllerError(
            'INVALID_ACTION_INPUT',
            'Line profile sampleCount must be between 2 and 100000.',
          )
        const totalLength = polylinePixelLength(pixelPoints)
        const profileCount = requestedCount ?? Math.min(100_000, Math.ceil(totalLength) + 1)
        const distances: number[] = []
        const values: number[] = []
        const valid: number[] = []
        const cacheKeys: string[] = []
        let distanceOffset = 0
        for (let index = 1; index < pixelPoints.length; index += 1) {
          const start = pixelPoints[index - 1]
          const end = pixelPoints[index]
          if (start === undefined || end === undefined) continue
          const segmentLength = Math.hypot(end.x - start.x, end.y - start.y)
          const sampleCount = Math.max(
            2,
            Math.round((profileCount * segmentLength) / Math.max(totalLength, 1)),
          )
          const segment = await this.#runtime.requestDerivedLineProfile(
            {
              ...this.#derivedRequest(recipe, `geo-line-profile-${roi.id}-${index}`),
              start,
              end,
              sampleCount,
              component: 0,
              resampling: record['resampling'] === 'bilinear' ? 'bilinear' : 'nearest',
            },
            nativeSignal(signal),
          )
          cacheKeys.push(segment.cacheKey)
          const skip = index === 1 ? 0 : 1
          for (let sampleIndex = skip; sampleIndex < segment.distances.length; sampleIndex += 1) {
            distances.push(distanceOffset + (segment.distances[sampleIndex] ?? 0))
            values.push(segment.values[sampleIndex] ?? Number.NaN)
            valid.push(segment.valid[sampleIndex] ?? 0)
          }
          distanceOffset += segment.distances.at(-1) ?? segmentLength
        }
        return json({
          cacheKeys,
          distances,
          values,
          valid,
          validSampleCount: valid.filter(Boolean).length,
          nodataCount: valid.filter((value) => value === 0).length,
          valuePolicy,
          provenance: analysisTransformProvenance(roi, source),
        })
      }
      const recipeValue = record['recipe']
      const request =
        recipeValue === undefined
          ? this.#derivedRequest(
              this.#requireDerivedLayer(stringField(record, 'layerId')).recipe,
              stringField(record, 'layerId'),
            )
          : this.#derivedRequest(recipeValue, 'geo-line-profile')
      const result = await this.#runtime.requestDerivedLineProfile(
        {
          ...request,
          start: pointField(record, 'start'),
          end: pointField(record, 'end'),
          sampleCount: integerField(record, 'sampleCount'),
          component: optionalIntegerField(record, 'component') ?? 0,
          resampling: record['resampling'] === 'bilinear' ? 'bilinear' : 'nearest',
        },
        nativeSignal(signal),
      )
      return json({
        cacheKey: result.cacheKey,
        distances: [...result.distances],
        values: [...result.values],
        valid: [...result.valid],
      })
    })
    set('geo.analysis.zonal_statistics', async (input, _context, signal) => {
      const record = recordInput(input)
      const roi = this.#requireRoi(optionalStringField(record, 'roiId') ?? this.#selectedRoiId())
      const layer = this.#rasterLayerForInput(record)
      const source = this.#requireSource(layer.sourceId)
      const valuePolicy = record['valuePolicy'] === 'scaled' ? 'scaled' : 'raw'
      const transformed = sameCrs(roi.crs, source.spatialReference.crs)
        ? roi.geometry
        : transformGeoMapGeometry(roi.geometry, roi.crs, source.spatialReference.crs)
      const mask = pixelMask(transformed, source.spatialReference)
      const region = maskRegion(mask, source.width, source.height)
      const requestedComponents = Array.isArray(record['components'])
        ? integerArrayField(record, 'components')
        : Array.from({ length: source.componentCount }, (_, index) => index)
      for (const component of requestedComponents) {
        if (component < 0 || component >= source.componentCount)
          throw new GeoControllerError(
            'INVALID_ACTION_INPUT',
            `Band ${component} is outside the raster.`,
          )
      }
      const gridTiles = alignedTileCount(region, 256)
      const estimatedTiles = gridTiles * requestedComponents.length
      const provenance = analysisTransformProvenance(roi, source)
      if (record['dryRun'] === true) {
        return json({
          valid: true,
          estimatedTiles,
          gridTiles,
          bandCount: requestedComponents.length,
          estimatedPixels: region.width * region.height,
          estimatedSampleVisits: region.width * region.height * requestedComponents.length,
          region,
          valuePolicy,
          pixelInterpretation: source.pixelInterpretation,
          transform: provenance.transform,
        })
      }
      const histogramValue = record['histogram']
      const histogram =
        histogramValue === undefined
          ? undefined
          : {
              bins: integerField(histogramValue, 'bins'),
              minimum: numberField(histogramValue, 'minimum'),
              maximum: numberField(histogramValue, 'maximum'),
            }
      const bands = []
      for (const component of requestedComponents) {
        if (nativeSignal(signal)?.aborted) throw new DOMException('Action aborted', 'AbortError')
        const recipe = identityRasterRecipe(
          layer,
          source,
          component,
          valuePolicy,
          this.bindingForLayer(layer.id),
        )
        const result = await this.#runtime.requestDerivedStatistics(
          {
            ...this.#derivedRequest(recipe, `geo-zonal-${roi.id}-${component}`),
            region,
            component: 0,
            mask,
            ...(histogram === undefined ? {} : { histogram }),
          },
          nativeSignal(signal),
        )
        bands.push({
          component,
          name: source.bands[component]?.name ?? `Band ${component + 1}`,
          ...result,
          ...(result.histogram === undefined
            ? {}
            : { histogram: { ...result.histogram, counts: [...result.histogram.counts] } }),
        })
      }
      return json({
        roiId: roi.id,
        layerId: layer.id,
        bands,
        validSampleCount: bands.reduce((sum, band) => sum + band.count, 0),
        nodataCount: bands.reduce((sum, band) => sum + band.invalidCount, 0),
        estimatedTiles,
        valuePolicy,
        pixelInterpretation: source.pixelInterpretation,
        provenance,
      })
    })
    for (const id of ['geo.analysis.cancel', 'geo.analysis.release'] as const) {
      set(id, async (input) => {
        const layerId = stringField(input, 'layerId')
        this.#requireDerivedLayer(layerId)
        await this.#runtime.releaseDerivedRaster({ layerId })
        return { released: true }
      })
    }
    set('geo.derived_layer.remove', async (input) => {
      const layerId = stringField(input, 'layerId')
      this.#requireDerivedLayer(layerId)
      await this.#runtime.releaseDerivedRaster({ layerId })
      this.removeLayer(layerId)
      return { removed: true }
    })
    set('geo.preview.create', async (input, _context, signal) => {
      const record = recordInput(input)
      const scope = stringField(record, 'scope')
      if (scope !== 'layer' && scope !== 'viewport' && scope !== 'screen')
        throw new GeoControllerError('INVALID_ACTION_INPUT', 'Preview scope is invalid.')
      const layerId = optionalStringField(record, 'layerId')
      const layer =
        scope === 'layer'
          ? this.#requireRasterLayer(
              layerId ??
                this.#snapshot.selectedLayerId ??
                this.#snapshot.project.layers[0]?.id ??
                '',
            )
          : undefined
      const width = integerField(record, 'width')
      const height = integerField(record, 'height')
      if (width > 1_024 || height > 1_024 || width * height > 786_432)
        throw new GeoControllerError(
          'INVALID_ACTION_INPUT',
          'Model preview dimensions exceed the 786,432-pixel limit.',
        )
      const requestedStyle = record['style']
      if (requestedStyle !== undefined && layer === undefined)
        throw new GeoControllerError(
          'INVALID_ACTION_INPUT',
          'A selected style requires a layer preview.',
        )
      if (
        requestedStyle !== undefined &&
        layer !== undefined &&
        JSON.stringify(requestedStyle) !== JSON.stringify(layer.style)
      )
        throw new GeoControllerError(
          'INVALID_ACTION_INPUT',
          'Model previews use the layer styling currently rendered in Atlas.',
        )
      const attribution =
        scope === 'screen'
          ? ['User-approved browser screen capture']
          : this.#snapshot.project.sources.flatMap((source) => source.catalog?.attribution ?? [])
      const preview = await this.#viewportAction(
        json({
          kind: scope === 'screen' ? 'create-agent-screen-preview' : 'create-agent-preview',
          scope,
          ...(layer === undefined ? {} : { layerId: layer.id, style: layer.style }),
          width,
          height,
          maxBytes: 2 * 1_024 * 1_024,
          includeRoiOverlay: record['includeOverlays'] === true,
          attribution,
          layerTitles:
            layer === undefined
              ? this.#snapshot.project.layers
                  .filter(({ visible }) => visible)
                  .map(({ label }) => label)
              : [layer.label],
          crsNote:
            crsKey(this.#snapshot.project.crs) ??
            this.#snapshot.project.crs.name ??
            this.#snapshot.project.crs.kind,
          projectRevision: this.#snapshot.revision,
        }),
        signal,
      )
      const previewRecord = recordInput(preview)
      const artifactAttribution = Array.isArray(previewRecord['attribution'])
        ? previewRecord['attribution']
            .filter((value): value is string => typeof value === 'string')
            .slice(0, 32)
        : attribution
      return json({
        scope,
        ...(layer === undefined ? {} : { layerId: layer.id }),
        layerTitles: previewRecord['layerTitles'] ?? [],
        crsNote: previewRecord['crsNote'] ?? null,
        agentArtifact: {
          kind: 'image',
          mimeType: stringField(previewRecord, 'mimeType'),
          width: integerField(previewRecord, 'width'),
          height: integerField(previewRecord, 'height'),
          bytes: integerField(previewRecord, 'bytes'),
          dataUrl: stringField(previewRecord, 'dataUrl'),
          attribution: artifactAttribution,
          projectRevision: this.#snapshot.revision,
        },
      })
    })
    set('geo.export.rendered_image', async (input) => {
      const record = recordInput(input)
      const width = optionalIntegerField(record, 'width') ?? 1_920
      const height = optionalIntegerField(record, 'height') ?? 1_080
      if (width < 1 || height < 1 || width > 8_192 || height > 8_192 || width * height > 16_777_216)
        throw new GeoControllerError(
          'INVALID_ACTION_INPUT',
          'Rendered export dimensions exceed the 16.8 megapixel limit.',
        )
      return this.#viewportAction(
        json({
          kind: 'export-rendered-image',
          width,
          height,
          maxBytes: Math.min(
            optionalIntegerField(record, 'maxBytes') ?? 32 * 1_024 * 1_024,
            32 * 1_024 * 1_024,
          ),
          includeRoiOverlay: record['includeRoiOverlay'] !== false,
          attribution: this.#snapshot.project.sources.flatMap(
            (source) => source.catalog?.attribution ?? [],
          ),
          crsNote:
            crsKey(this.#snapshot.project.crs) ??
            this.#snapshot.project.crs.name ??
            this.#snapshot.project.crs.kind,
          layerTitles: this.#snapshot.project.layers
            .filter(({ visible }) => visible)
            .map(({ label }) => label),
          rois: this.#snapshot.project.rois,
        }),
      )
    })
    return handlers
  }

  #sourceForRasterInput(input: JsonValue) {
    const sourceId = optionalStringField(input, 'sourceId') ?? this.#snapshot.selectedSourceId
    if (sourceId === undefined)
      throw new GeoControllerError('SOURCE_NOT_FOUND', 'No source is selected.')
    return this.#requireSource(sourceId)
  }

  #viewportAction(input: JsonValue, signal?: ActionAbortSignal): Promise<JsonValue> | JsonValue {
    if (this.#viewport === undefined)
      throw new GeoControllerError('UNAVAILABLE', 'The viewport is not mounted.')
    signal?.throwIfAborted()
    return this.#viewport.propose(input, signal === undefined ? undefined : nativeSignal(signal))
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

  #requireRoi(roiId: string): GeoMapRoi {
    const roi = this.#snapshot.project.rois.find(({ id }) => id === roiId)
    if (roi === undefined)
      throw new GeoControllerError('PROJECT_INVALID', `ROI ${roiId} does not exist.`)
    return roi
  }

  #selectedRoiId(): string {
    const id = this.#snapshot.selectedRoiId ?? this.#snapshot.project.rois.at(-1)?.id
    if (id === undefined) throw new GeoControllerError('PROJECT_INVALID', 'No ROI is selected.')
    return id
  }

  #rasterLayerForInput(input: Readonly<Record<string, JsonValue>>): GeoRasterLayer {
    const layerId = optionalStringField(input, 'layerId') ?? this.#snapshot.selectedLayerId
    if (layerId === undefined)
      throw new GeoControllerError('PROJECT_INVALID', 'No raster layer is selected.')
    return this.#requireRasterLayer(layerId)
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

function emptyProject(now: string): GeoProject {
  return createGeoProject({
    title: 'Atlas project',
    crs: { kind: 'unknown' },
    createdAt: now,
    updatedAt: now,
  })
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
    ...(candidate.protocol === undefined ? {} : { protocol: candidate.protocol }),
    ...(candidate.provider === undefined ? {} : { provider: candidate.provider }),
    ...(candidate.license === undefined ? {} : { license: candidate.license }),
    ...(candidate.attribution === undefined ? {} : { attribution: candidate.attribution }),
    ...(candidate.sourceUrl === undefined ? {} : { sourceUrl: durableUrl(candidate.sourceUrl) }),
  }
}

function sourceMetadataFromCandidate(
  candidate: CatalogSourceCandidate,
  bands: readonly GeoBandMetadata[] = candidate.bands,
) {
  return {
    catalog: durableCatalog(candidate),
    validators: {
      ...(candidate.validator === undefined ? {} : { etag: candidate.validator }),
      ...(candidate.fileSize === undefined ? {} : { size: candidate.fileSize }),
      ...(candidate.checksum === undefined ? {} : { checksum: candidate.checksum }),
    },
    lastKnownMetadata: {
      ...(candidate.provider === undefined ? {} : { provider: candidate.provider }),
      ...(candidate.license === undefined ? {} : { license: candidate.license }),
      ...(candidate.attribution === undefined ? {} : { attribution: candidate.attribution }),
      ...(candidate.datetime === undefined ? {} : { datetime: candidate.datetime }),
      ...(candidate.label.length === 0 ? {} : { title: candidate.label }),
      ...(candidate.projection === undefined ? {} : { projection: candidate.projection }),
      bands,
    },
  }
}

function isProjectViewport(value: JsonValue | undefined): value is GeoProjectViewport {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Readonly<Record<string, JsonValue>>
  if (record['kind'] === 'auto') return true
  return (
    record['kind'] === 'map' &&
    typeof record['centerX'] === 'number' &&
    Number.isFinite(record['centerX']) &&
    typeof record['centerY'] === 'number' &&
    Number.isFinite(record['centerY']) &&
    typeof record['zoom'] === 'number' &&
    Number.isFinite(record['zoom'])
  )
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

function targetGridForSource(
  source: GeoRasterSource,
  sampleType: OpenedDatasetDescriptor['dataset']['sampleType'],
): DerivedRasterRecipeV1['targetGrid'] {
  const affine = source.spatialReference.pixelToModel
  const crs = crsKey(source.spatialReference.crs)
  if (affine === undefined || crs === undefined)
    throw new GeoControllerError(
      'CRS_INCOMPATIBLE',
      `Source ${source.id} needs an identified CRS and affine grid for analysis.`,
    )
  const corners = [
    modelPoint(affine, 0, 0),
    modelPoint(affine, source.width, 0),
    modelPoint(affine, source.width, source.height),
    modelPoint(affine, 0, source.height),
  ]
  const xs = corners.map(({ x }) => x)
  const ys = corners.map(({ y }) => y)
  const nodata = scalarNodata(source.spatialReference)
  return {
    schemaVersion: 1,
    crs,
    width: source.width,
    height: source.height,
    affine,
    pixelInterpretation:
      source.spatialReference.pixelInterpretation === 'pixel-is-point' ? 'point' : 'area',
    extent: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    sampleType: rasterSampleType(sampleType),
    noData: nodata === undefined ? { kind: 'none' } : { kind: 'value', value: nodata },
    resampling: 'nearest',
  }
}

function rasterSampleType(value: string): RasterSampleType {
  const supported = new Set<RasterSampleType>([
    'uint8',
    'uint16',
    'uint32',
    'uint64',
    'int8',
    'int16',
    'int32',
    'float32',
    'float64',
  ])
  if (!supported.has(value as RasterSampleType))
    throw new GeoControllerError(
      'INVALID_ACTION_INPUT',
      `Raster sample type ${value} is unsupported for analysis.`,
    )
  return value as RasterSampleType
}

function modelPoint(
  affine: readonly [number, number, number, number, number, number],
  column: number,
  row: number,
): Readonly<{ x: number; y: number }> {
  return {
    x: affine[0] * column + affine[1] * row + affine[2],
    y: affine[3] * column + affine[4] * row + affine[5],
  }
}

function sourceRevision(source: GeoRasterSource): string {
  const locator = source.locator
  if (locator.kind === 'stac-asset' || locator.kind === 'tnm-product')
    return locator.checksum ?? locator.validator ?? JSON.stringify(locator.catalog)
  if (locator.kind === 'local-file') return JSON.stringify(locator.fingerprint)
  if (locator.kind === 'bundled-example') return `${locator.scenarioId}:${locator.assetId ?? ''}`
  return locator.url
}

function derivedLayerLabel(kind: DerivedRasterRecipeV1['operation']['kind']): string {
  return kind
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}

function derivedLayerStyle(operation: DerivedRasterRecipeV1['operation']): RasterStyle {
  if (operation.kind === 'virtual-band-stack') {
    return {
      mapping:
        operation.bands.length >= 3
          ? { red: 0, green: 1, blue: 2 }
          : operation.bands.length === 2
            ? { red: 0, green: 1, blue: 1 }
            : { gray: 0 },
      stretch: 'percentile',
      rangeMode: 'viewport-local',
      nodataTransparent: true,
    }
  }
  if (operation.kind === 'normalized-difference')
    return { mapping: { gray: 0 }, minimum: -1, maximum: 1, nodataTransparent: true }
  if (operation.kind === 'terrain') {
    const range =
      operation.operation === 'hillshade'
        ? ([0, 255] as const)
        : operation.operation === 'aspect'
          ? ([0, 360] as const)
          : ([0, operation.slopeUnit === 'percent' ? 100 : 90] as const)
    return {
      mapping: { gray: 0 },
      minimum: range[0],
      maximum: range[1],
      nodataTransparent: true,
    }
  }
  return {
    mapping: { gray: 0 },
    stretch: 'percentile',
    rangeMode: 'viewport-local',
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

function geometryField(value: unknown): GeoMapGeometry {
  const geometry = recordInput(value)
  const kind = geometry['kind']
  const points = (input: JsonValue | undefined, label: string): readonly GeoMapPoint[] => {
    if (!Array.isArray(input))
      throw new GeoControllerError('INVALID_ACTION_INPUT', `${label} must be an array.`)
    return input.map((point, index) => pointFieldValue(point, `${label}[${index}]`))
  }
  const rings = (input: JsonValue | undefined, label: string) => {
    if (!Array.isArray(input))
      throw new GeoControllerError('INVALID_ACTION_INPUT', `${label} must be an array.`)
    return input.map((ring, index) => points(ring, `${label}[${index}]`))
  }
  if (kind === 'point')
    return { kind, x: numberField(geometry, 'x'), y: numberField(geometry, 'y') }
  if (kind === 'multi-point') return { kind, points: points(geometry['points'], 'points') }
  if (kind === 'rectangle')
    return {
      kind,
      minX: numberField(geometry, 'minX'),
      minY: numberField(geometry, 'minY'),
      maxX: numberField(geometry, 'maxX'),
      maxY: numberField(geometry, 'maxY'),
    }
  if (kind === 'line') return { kind, points: points(geometry['points'], 'points') }
  if (kind === 'multi-line') {
    const lines = geometry['lines']
    if (!Array.isArray(lines))
      throw new GeoControllerError('INVALID_ACTION_INPUT', 'lines must be an array.')
    return { kind, lines: lines.map((line, index) => points(line, `lines[${index}]`)) }
  }
  if (kind === 'polygon') return { kind, rings: rings(geometry['rings'], 'rings') }
  if (kind === 'multi-polygon') {
    const polygons = geometry['polygons']
    if (!Array.isArray(polygons))
      throw new GeoControllerError('INVALID_ACTION_INPUT', 'polygons must be an array.')
    return {
      kind,
      polygons: polygons.map((polygon, index) => rings(polygon, `polygons[${index}]`)),
    }
  }
  throw new GeoControllerError('INVALID_ACTION_INPUT', `Unsupported ROI geometry ${String(kind)}.`)
}

function crsField(value: unknown): GeoMapRoi['crs'] {
  const crs = recordInput(value)
  const kind = crs['kind']
  if (kind !== 'projected' && kind !== 'geographic' && kind !== 'unknown')
    throw new GeoControllerError('INVALID_ACTION_INPUT', 'CRS kind is invalid.')
  const authority = optionalStringField(crs, 'authority')
  const code = crs['code']
  if (code !== undefined && typeof code !== 'string' && typeof code !== 'number')
    throw new GeoControllerError('INVALID_ACTION_INPUT', 'CRS code must be a string or number.')
  const name = optionalStringField(crs, 'name')
  return {
    kind,
    ...(authority === undefined ? {} : { authority }),
    ...(code === undefined ? {} : { code }),
    ...(name === undefined ? {} : { name }),
  }
}

function pointFieldValue(value: unknown, label: string): GeoMapPoint {
  try {
    return { x: numberField(value, 'x'), y: numberField(value, 'y') }
  } catch {
    throw new GeoControllerError('INVALID_ACTION_INPUT', `${label} must contain finite x and y.`)
  }
}

function jsonRecordField(value: unknown, label: string): Readonly<Record<string, JsonValue>> {
  try {
    return recordInput(value)
  } catch {
    throw new GeoControllerError('INVALID_ACTION_INPUT', `${label} must be a JSON object.`)
  }
}

function drawingTool(
  value: JsonValue | undefined,
  geometry: GeoMapGeometry,
): 'point' | 'line' | 'rectangle' | 'polygon' {
  if (value === 'point' || value === 'line' || value === 'rectangle' || value === 'polygon')
    return value
  if (geometry.kind === 'point' || geometry.kind === 'multi-point') return 'point'
  if (geometry.kind === 'line' || geometry.kind === 'multi-line') return 'line'
  if (geometry.kind === 'rectangle') return 'rectangle'
  return 'polygon'
}

function optionalStringArrayField(
  value: Readonly<Record<string, JsonValue>>,
  key: string,
): readonly string[] | undefined {
  return value[key] === undefined ? undefined : stringArrayField(value, key)
}

function integerArrayField(value: unknown, key: string): readonly number[] {
  const field = recordInput(value)[key]
  if (!Array.isArray(field) || field.length === 0 || field.length > 32)
    throw new GeoControllerError('INVALID_ACTION_INPUT', `${key} must be a bounded integer array.`)
  return field.map((item, index) => {
    if (typeof item !== 'number' || !Number.isInteger(item))
      throw new GeoControllerError('INVALID_ACTION_INPUT', `${key}[${index}] must be an integer.`)
    return item
  })
}

function planarUnitField(value: JsonValue | undefined) {
  if (value === undefined) return undefined
  if (value === 'metre' || value === 'international-foot' || value === 'us-survey-foot')
    return value
  throw new GeoControllerError(
    'INVALID_ACTION_INPUT',
    'planarUnit must be metre, international-foot, or us-survey-foot.',
  )
}

function mapToPixel(point: GeoMapPoint, spatial: SpatialReference): GeoMapPoint {
  if (spatial.modelToPixel !== undefined) return modelPoint(spatial.modelToPixel, point.x, point.y)
  const affine = spatial.pixelToModel
  if (affine === undefined)
    throw new GeoControllerError('CRS_INCOMPATIBLE', 'Raster has no pixel-to-model affine.')
  const [a, b, c, d, e, f] = affine
  const determinant = a * e - b * d
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-15)
    throw new GeoControllerError('CRS_INCOMPATIBLE', 'Raster affine is not invertible.')
  return {
    x: (e * (point.x - c) - b * (point.y - f)) / determinant,
    y: (-d * (point.x - c) + a * (point.y - f)) / determinant,
  }
}

function pixelMask(
  geometry: GeoMapGeometry,
  spatial: SpatialReference,
): NonNullable<DerivedRasterStatisticsRequest['mask']> {
  const convertRing = (ring: readonly GeoMapPoint[]) =>
    ring.map((point) => mapToPixel(point, spatial))
  const polygons =
    geometry.kind === 'polygon'
      ? [geometry.rings.map(convertRing)]
      : geometry.kind === 'multi-polygon'
        ? geometry.polygons.map((polygon) => polygon.map(convertRing))
        : geometry.kind === 'rectangle'
          ? [
              [
                convertRing([
                  { x: geometry.minX, y: geometry.minY },
                  { x: geometry.maxX, y: geometry.minY },
                  { x: geometry.maxX, y: geometry.maxY },
                  { x: geometry.minX, y: geometry.maxY },
                  { x: geometry.minX, y: geometry.minY },
                ]),
              ],
            ]
          : undefined
  if (polygons === undefined)
    throw new GeoControllerError(
      'INVALID_ACTION_INPUT',
      'Zonal statistics require a polygon, multipolygon, or rectangle ROI.',
    )
  return {
    polygons,
    pixelInterpretation:
      spatial.pixelInterpretation === 'pixel-is-point' ? 'pixel-is-point' : 'pixel-is-area',
  }
}

function maskRegion(
  mask: NonNullable<DerivedRasterStatisticsRequest['mask']>,
  width: number,
  height: number,
): Readonly<{ x: number; y: number; width: number; height: number }> {
  const coordinates = mask.polygons.flat(2)
  const xs = coordinates.map(({ x }) => x)
  const ys = coordinates.map(({ y }) => y)
  const x = Math.max(0, Math.floor(Math.min(...xs)))
  const y = Math.max(0, Math.floor(Math.min(...ys)))
  const maximumX = Math.min(width, Math.ceil(Math.max(...xs)))
  const maximumY = Math.min(height, Math.ceil(Math.max(...ys)))
  if (maximumX <= x || maximumY <= y)
    throw new GeoControllerError('INVALID_ACTION_INPUT', 'ROI does not intersect the raster grid.')
  return { x, y, width: maximumX - x, height: maximumY - y }
}

function alignedTileCount(
  region: Readonly<{ x: number; y: number; width: number; height: number }>,
  size: number,
): number {
  const columns = Math.ceil((region.x + region.width) / size) - Math.floor(region.x / size)
  const rows = Math.ceil((region.y + region.height) / size) - Math.floor(region.y / size)
  return columns * rows
}

function identityRasterRecipe(
  layer: GeoRasterLayer,
  source: GeoRasterSource,
  component: number,
  valuePolicy: 'raw' | 'scaled',
  binding: GeoRuntimeBinding | undefined,
): DerivedRasterRecipeV1 {
  if (binding === undefined)
    throw new GeoControllerError('UNAVAILABLE', 'Raster source is not open.')
  const targetGrid = targetGridForSource(source, binding.dataset.dataset.sampleType)
  const band = source.bands[component]
  const noData =
    band?.nodata === undefined ? targetGrid.noData : { kind: 'value' as const, value: band.nodata }
  const input = {
    name: 'source',
    layerId: layer.id,
    component,
    valueMode: valuePolicy,
    scale: band?.scale ?? 1,
    offset: band?.offset ?? 0,
    noData,
  } as const
  return {
    schemaVersion: 1,
    operationVersion: 1,
    operation: {
      kind: 'linear-combination',
      terms: [{ input: 'source', coefficient: 1 }],
      constant: 0,
    },
    inputs: [input],
    targetGrid,
    alignment: 'exact',
    outputNoData: noData,
    minimumValidWeight: 0.5,
    limits: {
      maxTilePixels: 256 * 256,
      maxOutputBytes: 4 * 1_024 * 1_024,
      maxWorkingBytes: 16 * 1_024 * 1_024,
    },
  }
}

function linePoints(geometry: GeoMapGeometry): readonly GeoMapPoint[] {
  if (geometry.kind === 'line') return geometry.points
  if (geometry.kind === 'multi-line' && geometry.lines.length === 1) return geometry.lines[0] ?? []
  throw new GeoControllerError(
    'INVALID_ACTION_INPUT',
    'Line profile requires a single LineString ROI.',
  )
}

function polylinePixelLength(points: readonly GeoMapPoint[]): number {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]
    const right = points[index]
    if (left !== undefined && right !== undefined)
      length += Math.hypot(right.x - left.x, right.y - left.y)
  }
  return length
}

function analysisTransformProvenance(roi: GeoMapRoi, source: GeoRasterSource) {
  const from = crsKey(roi.crs) ?? roi.crs.name ?? roi.crs.kind
  const to =
    crsKey(source.spatialReference.crs) ??
    source.spatialReference.crs.name ??
    source.spatialReference.crs.kind
  return {
    roiId: roi.id,
    originalCrs: from,
    gridCrs: to,
    transform: {
      id: sameCrs(roi.crs, source.spatialReference.crs) ? 'identity' : `proj4:${from}->${to}`,
      accuracy: sameCrs(roi.crs, source.spatialReference.crs) ? 'exact' : 'estimated',
    },
    originalGeometryPreserved: true,
  }
}

function scaleSampleComponents(
  sample: RasterPointSample,
  source: GeoRasterSource,
  policy: 'raw' | 'scaled',
) {
  return sample.components.map((component) => {
    const band = source.bands[component.index]
    const value =
      component.value === null || policy === 'raw'
        ? component.value
        : component.value * (band?.scale ?? 1) + (band?.offset ?? 0)
    return {
      ...component,
      value,
      ...(band?.unit === undefined ? {} : { unit: band.unit }),
    }
  })
}

function replayUrl(locator: GeoRasterLocator): string | undefined {
  if (locator.kind === 'remote-url') return locator.url
  if (locator.kind === 'stac-asset') return locator.catalog.href
  if (locator.kind === 'tnm-product') return locator.downloadUrl
  return undefined
}

function classifyControllerError(error: unknown): GeoControllerError {
  if (error instanceof GeoControllerError) return error
  if (error instanceof CrsTransformError)
    return new GeoControllerError('CRS_INCOMPATIBLE', error.message, { transformCode: error.code })
  if (error instanceof GeoMeasurementError)
    return new GeoControllerError('INVALID_ACTION_INPUT', error.message, {
      measurementCode: error.code,
    })
  if (error instanceof GeoValidationError)
    return new GeoControllerError('PROJECT_INVALID', error.message, { validationCode: error.code })
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

function integerField(value: unknown, key: string): number {
  const number = numberField(value, key)
  if (!Number.isInteger(number))
    throw new GeoControllerError('INVALID_ACTION_INPUT', `${key} must be an integer.`)
  return number
}

function optionalIntegerField(value: unknown, key: string): number | undefined {
  const field = recordInput(value)[key]
  return field === undefined ? undefined : integerField(value, key)
}

function pointField(value: unknown, key: string): Readonly<{ x: number; y: number }> {
  const point = recordInput(value)[key]
  return { x: numberField(point, 'x'), y: numberField(point, 'y') }
}

function regionField(
  value: unknown,
  key: string,
): Readonly<{ x: number; y: number; width: number; height: number }> {
  const region = recordInput(value)[key]
  return {
    x: integerField(region, 'x'),
    y: integerField(region, 'y'),
    width: integerField(region, 'width'),
    height: integerField(region, 'height'),
  }
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
