import type { JsonValue } from '@pji-workbench/actions'
import type {
  CoordinateReferenceSystem,
  DerivedRasterRecipeV1,
  PixelInterpretation,
  SpatialReference,
} from '@pji-workbench/contracts'
import { assertDerivedRasterRecipe } from '@pji-workbench/contracts'

export const GEO_PROJECT_SCHEMA_VERSION = 2 as const

export const GEO_PROJECT_LIMITS = Object.freeze({
  maxStringLength: 4_096,
  maxSources: 32,
  maxLayers: 128,
  maxRois: 256,
  maxRoiPoints: 4_096,
  maxRoiPropertyBytes: 32 * 1_024,
  maxProvenance: 128,
  maxWorkflowRuns: 128,
  maxInputLayers: 16,
})

export type GeoProjectId = string & { readonly __geoProjectId: unique symbol }
export type GeoSourceId = string & { readonly __geoSourceId: unique symbol }
export type GeoLayerId = string & { readonly __geoLayerId: unique symbol }
export type GeoRoiId = string & { readonly __geoRoiId: unique symbol }
export type GeoProvenanceId = string & { readonly __geoProvenanceId: unique symbol }

/** Stable CRS identity used by sources, the project, and map-coordinate ROIs. */
export type CrsReference = CoordinateReferenceSystem

export type GeoBlendMode = 'normal' | 'multiply' | 'screen' | 'lighten' | 'darken'

export interface GeoMapPoint {
  readonly x: number
  readonly y: number
}

export interface BandMapping {
  readonly gray?: number
  readonly red?: number
  readonly green?: number
  readonly blue?: number
}

export type RasterStretch = 'minmax' | 'percentile'

export interface RasterStyle {
  readonly mapping: BandMapping
  readonly minimum?: number
  readonly maximum?: number
  readonly stretch?: RasterStretch
  readonly percentileLow?: number
  readonly percentileHigh?: number
  readonly gamma?: number
  readonly nodataTransparent?: boolean
  readonly resample?: 'nearest' | 'bilinear'
  /** Stable uses deterministic layer statistics; viewport-local is explicitly exploratory. */
  readonly rangeMode?: 'stable' | 'viewport-local'
  readonly valueMode?: 'raw' | 'physical'
}

export interface GeoCatalogReference {
  readonly catalogId: string
  readonly catalogTitle: string
  readonly collectionId: string
  readonly itemId: string
  readonly assetKey: string
  /** Session hint only. Project serialization removes it and re-resolves the stable identity. */
  readonly href?: string
  readonly protocol?: string
  readonly provider?: string
  readonly license?: string
  readonly attribution?: string
  readonly sourceUrl?: string
}

export interface GeoBandMetadata {
  readonly index: number
  readonly name?: string
  readonly commonName?: string
  readonly description?: string
  readonly dataType?: string
  readonly nodata?: number
  readonly scale?: number
  readonly offset?: number
  readonly unit?: string
  readonly wavelength?: number
  readonly colorInterpretation?: string
}

export interface LocalFileFingerprint {
  readonly name: string
  readonly size: number
  readonly lastModified: number
  readonly mediaType?: string
  readonly digest?: Readonly<{ algorithm: 'sha256'; value: string }>
  readonly companionNames?: readonly string[]
}

/** Durable, JSON-safe source identity. Live URLs with expiring credentials are refused. */
export type GeoRasterLocator =
  | Readonly<{ kind: 'remote-url'; url: string }>
  | Readonly<{
      kind: 'stac-asset'
      catalog: GeoCatalogReference
      datetime?: string
      title?: string
      roles: readonly string[]
      bands: readonly GeoBandMetadata[]
      mediaType?: string
      fileSize?: number
      checksum?: string
      validator?: string
      projection?: string
    }>
  | Readonly<{
      kind: 'tnm-product'
      catalog: GeoCatalogReference
      productId: string
      /** Session hint only. Project serialization removes it. */
      downloadUrl?: string
      bands: readonly GeoBandMetadata[]
      datetime?: string
      title?: string
      roles: readonly string[]
      mediaType?: string
      fileSize?: number
      checksum?: string
      validator?: string
      projection?: string
    }>
  | Readonly<{ kind: 'local-file'; fingerprint: LocalFileFingerprint }>
  | Readonly<{ kind: 'bundled-example'; scenarioId: string; assetId?: string }>

export interface GeoRasterSource {
  readonly id: GeoSourceId
  readonly label: string
  readonly width: number
  readonly height: number
  readonly componentCount: number
  readonly spatialReference: SpatialReference
  readonly pixelInterpretation: PixelInterpretation
  readonly locator: GeoRasterLocator
  readonly bands: readonly GeoBandMetadata[]
  readonly catalog?: GeoCatalogReference
  readonly validators?: GeoSourceValidators
  readonly lastKnownMetadata?: GeoSourceLastKnownMetadata
}

export interface GeoSourceValidators {
  readonly etag?: string
  readonly versionId?: string
  readonly lastModified?: string
  readonly size?: number
  readonly checksum?: string
}

export interface GeoSourceLastKnownMetadata {
  readonly provider?: string
  readonly license?: string
  readonly attribution?: string
  readonly datetime?: string
  readonly title?: string
  readonly projection?: string
  readonly bands: readonly GeoBandMetadata[]
}

export interface GeoRasterLayer {
  readonly kind: 'raster'
  readonly id: GeoLayerId
  readonly sourceId: GeoSourceId
  readonly label: string
  readonly visible: boolean
  readonly opacity: number
  readonly blendMode: GeoBlendMode
  readonly zIndex: number
  readonly style: RasterStyle
}

export interface GeoRecipeReference {
  readonly recipeId: string
  readonly recipeVersion?: string
}

export interface GeoProvenanceReference {
  readonly id: GeoProvenanceId
  readonly sourceIds: readonly GeoSourceId[]
  readonly recipe?: GeoRecipeReference
  readonly createdAt: string
  readonly note?: string
  readonly execution?: import('@pji-workbench/contracts').DerivedRasterGeoExecutionProvenanceV1
}

export interface GeoWorkflowProvenanceRecord {
  readonly schemaVersion: 1
  readonly id: string
  readonly workflowId: string
  readonly workflowVersion: number
  readonly parameters: Readonly<Record<string, JsonValue>>
  readonly decisions: Readonly<Record<string, readonly string[]>>
  readonly selectedAssets: readonly Readonly<{
    catalogId: string
    collectionId: string
    itemId: string
    assetKey: string
  }>[]
  readonly actions: readonly Readonly<{
    sequence: number
    stepId: string
    actionId: string
    input: JsonValue
    result: JsonValue
  }>[]
  readonly sourceIds: readonly GeoSourceId[]
  readonly outputLayerIds: readonly GeoLayerId[]
  readonly completedOutputs: readonly Readonly<{
    id: string
    title: string
    kind: 'layer' | 'table' | 'report'
    reference?: string
  }>[]
  readonly attribution: readonly string[]
  readonly startedAt: string
  readonly completedAt: string
}

export interface DerivedGeoRasterLayer {
  readonly kind: 'derived'
  readonly id: GeoLayerId
  readonly sourceId?: GeoSourceId
  readonly inputLayerIds: readonly GeoLayerId[]
  readonly label: string
  readonly visible: boolean
  readonly opacity: number
  readonly blendMode: GeoBlendMode
  readonly zIndex: number
  readonly style: RasterStyle
  readonly recipe: DerivedRasterRecipeV1
  readonly provenance: GeoProvenanceReference
}

export type GeoLayer = GeoRasterLayer | DerivedGeoRasterLayer

export type GeoComparisonMode = 'single' | 'swipe' | 'overlay' | 'blink'

export type GeoComparisonState =
  | Readonly<{ mode: 'single' }>
  | Readonly<{
      mode: 'swipe'
      leftLayerId: GeoLayerId
      rightLayerId: GeoLayerId
      swipePosition: number
    }>
  | Readonly<{
      mode: 'overlay'
      overlayLayerIds: readonly GeoLayerId[]
    }>
  | Readonly<{
      mode: 'blink'
      firstLayerId: GeoLayerId
      secondLayerId: GeoLayerId
      intervalMilliseconds: number
    }>

export type GeoMapGeometry =
  | Readonly<{ kind: 'point'; x: number; y: number }>
  | Readonly<{ kind: 'multi-point'; points: readonly GeoMapPoint[] }>
  | Readonly<{ kind: 'rectangle'; minX: number; minY: number; maxX: number; maxY: number }>
  | Readonly<{ kind: 'line'; points: readonly GeoMapPoint[] }>
  | Readonly<{ kind: 'multi-line'; lines: readonly (readonly GeoMapPoint[])[] }>
  | Readonly<{ kind: 'polygon'; rings: readonly (readonly GeoMapPoint[])[] }>
  | Readonly<{
      kind: 'multi-polygon'
      polygons: readonly (readonly (readonly GeoMapPoint[])[])[]
    }>

export type GeoRoiProvenance =
  | Readonly<{ kind: 'drawn'; tool: 'point' | 'line' | 'rectangle' | 'polygon' }>
  | Readonly<{
      kind: 'imported'
      format: 'RFC7946-GeoJSON' | 'legacy-crs-GeoJSON' | 'native-crs-GeoJSON'
      sourceName?: string
      legacyCrs?: string
      interpretationConfirmed?: boolean
    }>
  | Readonly<{ kind: 'action'; actionId: string; note?: string }>

export interface GeoMapRoi {
  readonly id: GeoRoiId
  readonly name?: string
  readonly coordinateSpace: 'map'
  readonly crs: CrsReference
  readonly geometry: GeoMapGeometry
  readonly provenance: GeoRoiProvenance
  readonly createdAt: string
  readonly properties?: Readonly<Record<string, JsonValue>>
}

export interface GeoProject {
  readonly schemaVersion: typeof GEO_PROJECT_SCHEMA_VERSION
  readonly id: GeoProjectId
  readonly title: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly crs: CrsReference
  readonly viewport: GeoProjectViewport
  readonly sources: readonly GeoRasterSource[]
  readonly layers: readonly GeoLayer[]
  readonly comparison: GeoComparisonState
  readonly rois: readonly GeoMapRoi[]
  readonly provenance: readonly GeoProvenanceReference[]
  readonly workflowRuns: readonly GeoWorkflowProvenanceRecord[]
  readonly selection: GeoProjectSelection
}

export type GeoProjectViewport =
  | Readonly<{ kind: 'auto' }>
  | Readonly<{ kind: 'map'; centerX: number; centerY: number; zoom: number }>

export interface GeoProjectSelection {
  readonly sourceId?: GeoSourceId
  readonly layerId?: GeoLayerId
  readonly roiId?: GeoRoiId
  readonly inspector?: 'project' | 'agent' | 'catalog' | 'layers' | 'workflows' | 'vectors' | 'cog'
}

export class GeoValidationError extends Error {
  constructor(
    readonly code: 'INVALID_PROJECT' | 'LIMIT_EXCEEDED',
    message: string,
  ) {
    super(message)
    this.name = 'GeoValidationError'
  }
}

export interface CreateGeoRasterSourceInput {
  readonly id: string
  readonly label: string
  readonly width: number
  readonly height: number
  readonly componentCount: number
  readonly spatialReference: SpatialReference
  readonly locator: GeoRasterLocator
  readonly bands?: readonly GeoBandMetadata[]
  readonly catalog?: GeoCatalogReference
  readonly validators?: GeoSourceValidators
  readonly lastKnownMetadata?: GeoSourceLastKnownMetadata
}

export interface CreateGeoRasterLayerInput {
  readonly id: string
  readonly sourceId: string
  readonly label: string
  readonly visible?: boolean
  readonly opacity?: number
  readonly blendMode?: GeoBlendMode
  readonly zIndex?: number
  readonly style?: RasterStyle
}

export interface CreateDerivedGeoRasterLayerInput {
  readonly id: string
  readonly sourceId?: string
  readonly inputLayerIds: readonly string[]
  readonly label: string
  readonly visible?: boolean
  readonly opacity?: number
  readonly blendMode?: GeoBlendMode
  readonly zIndex?: number
  readonly style?: RasterStyle
  readonly recipe: DerivedRasterRecipeV1
  readonly provenance: GeoProvenanceReference
}

export interface CreateGeoMapRoiInput {
  readonly id: string
  readonly name?: string
  readonly crs: CrsReference
  readonly geometry: GeoMapGeometry
  readonly provenance?: GeoRoiProvenance
  readonly createdAt?: string
  readonly properties?: Readonly<Record<string, JsonValue>>
}

export interface CreateGeoProjectInput {
  readonly id?: string
  readonly title: string
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly crs: CrsReference
  readonly viewport?: GeoProjectViewport
  readonly sources?: readonly GeoRasterSource[]
  readonly layers?: readonly GeoLayer[]
  readonly comparison?: GeoComparisonState
  readonly rois?: readonly GeoMapRoi[]
  readonly provenance?: readonly GeoProvenanceReference[]
  readonly workflowRuns?: readonly GeoWorkflowProvenanceRecord[]
  readonly selection?: GeoProjectSelection
}

const BLEND_MODES = new Set<GeoBlendMode>(['normal', 'multiply', 'screen', 'lighten', 'darken'])

export function createGeoRasterSource(input: CreateGeoRasterSourceInput): GeoRasterSource {
  const spatialReference = input.spatialReference
  if (spatialReference.pixelToModel === undefined) {
    throw new GeoValidationError(
      'INVALID_PROJECT',
      'A geo raster source requires a pixel-to-model affine',
    )
  }
  const componentCount = positiveInteger(input.componentCount, 'component count')
  const bands = normalizeBands(input.bands ?? [], componentCount)
  const locator = normalizeLocator(input.locator)
  const catalog =
    input.catalog ??
    (locator.kind === 'stac-asset' || locator.kind === 'tnm-product' ? locator.catalog : undefined)
  return {
    id: boundedId(input.id, 'source id') as GeoSourceId,
    label: boundedString(input.label, 'source label'),
    width: positiveInteger(input.width, 'source width'),
    height: positiveInteger(input.height, 'source height'),
    componentCount,
    spatialReference,
    pixelInterpretation: spatialReference.pixelInterpretation,
    locator,
    bands,
    ...(catalog === undefined ? {} : { catalog: normalizeCatalogReference(catalog) }),
    ...(input.validators === undefined
      ? {}
      : { validators: normalizeSourceValidators(input.validators) }),
    ...(input.lastKnownMetadata === undefined
      ? {}
      : { lastKnownMetadata: normalizeLastKnownMetadata(input.lastKnownMetadata, componentCount) }),
  }
}

export function createGeoRasterLayer(input: CreateGeoRasterLayerInput): GeoRasterLayer {
  return {
    kind: 'raster',
    id: boundedId(input.id, 'layer id') as GeoLayerId,
    sourceId: boundedId(input.sourceId, 'source id') as GeoSourceId,
    label: boundedString(input.label, 'layer label'),
    visible: input.visible ?? true,
    opacity: unitInterval(input.opacity ?? 1, 'layer opacity'),
    blendMode: blendMode(input.blendMode ?? 'normal'),
    zIndex: finiteNumber(input.zIndex ?? 0, 'layer zIndex'),
    style: normalizeRasterStyle(input.style ?? { mapping: { gray: 0 } }),
  }
}

export function createDerivedGeoRasterLayer(
  input: CreateDerivedGeoRasterLayerInput,
): DerivedGeoRasterLayer {
  if (input.inputLayerIds.length === 0) {
    throw new GeoValidationError('INVALID_PROJECT', 'A derived layer requires at least one input')
  }
  if (input.inputLayerIds.length > GEO_PROJECT_LIMITS.maxInputLayers) {
    throw new GeoValidationError('LIMIT_EXCEEDED', 'A derived layer exceeds the input-layer limit')
  }
  assertDerivedRasterRecipe(input.recipe)
  return {
    kind: 'derived',
    id: boundedId(input.id, 'layer id') as GeoLayerId,
    ...(input.sourceId === undefined
      ? {}
      : { sourceId: boundedId(input.sourceId, 'source id') as GeoSourceId }),
    inputLayerIds: uniqueIds(input.inputLayerIds, 'input layer id').map((id) => id as GeoLayerId),
    label: boundedString(input.label, 'layer label'),
    visible: input.visible ?? true,
    opacity: unitInterval(input.opacity ?? 1, 'layer opacity'),
    blendMode: blendMode(input.blendMode ?? 'normal'),
    zIndex: finiteNumber(input.zIndex ?? 0, 'layer zIndex'),
    style: normalizeRasterStyle(input.style ?? { mapping: { gray: 0 } }),
    recipe: input.recipe,
    provenance: normalizeProvenance(input.provenance),
  }
}

export function createGeoMapRoi(input: CreateGeoMapRoiInput): GeoMapRoi {
  const properties =
    input.properties === undefined ? undefined : normalizeRoiProperties(input.properties)
  return {
    id: boundedId(input.id, 'ROI id') as GeoRoiId,
    ...(input.name === undefined ? {} : { name: boundedString(input.name, 'ROI name') }),
    coordinateSpace: 'map',
    crs: input.crs,
    geometry: normalizeGeometry(input.geometry),
    provenance: normalizeRoiProvenance(input.provenance ?? { kind: 'action', actionId: 'legacy' }),
    createdAt: normalizedDate(input.createdAt ?? new Date().toISOString(), 'ROI createdAt'),
    ...(properties === undefined ? {} : { properties }),
  }
}

export function createGeoProject(input: CreateGeoProjectInput): GeoProject {
  const sources = (input.sources ?? []).map((source) =>
    createGeoRasterSource({
      id: source.id,
      label: source.label,
      width: source.width,
      height: source.height,
      componentCount: source.componentCount,
      spatialReference: source.spatialReference,
      locator: source.locator,
      bands: source.bands,
      ...(source.catalog === undefined ? {} : { catalog: source.catalog }),
      ...(source.validators === undefined ? {} : { validators: source.validators }),
      ...(source.lastKnownMetadata === undefined
        ? {}
        : { lastKnownMetadata: source.lastKnownMetadata }),
    }),
  )
  const layers = input.layers ?? []
  const rois = (input.rois ?? []).map((roi) =>
    createGeoMapRoi({
      id: roi.id,
      ...(roi.name === undefined ? {} : { name: roi.name }),
      crs: roi.crs,
      geometry: roi.geometry,
      provenance: roi.provenance ?? { kind: 'action', actionId: 'legacy-project' },
      createdAt: roi.createdAt ?? '1970-01-01T00:00:00.000Z',
      ...(roi.properties === undefined ? {} : { properties: roi.properties }),
    }),
  )
  const provenance = input.provenance ?? []
  const workflowRuns = input.workflowRuns ?? []
  if (sources.length > GEO_PROJECT_LIMITS.maxSources) {
    throw new GeoValidationError('LIMIT_EXCEEDED', 'The project exceeds the source limit')
  }
  if (layers.length > GEO_PROJECT_LIMITS.maxLayers) {
    throw new GeoValidationError('LIMIT_EXCEEDED', 'The project exceeds the layer limit')
  }
  if (rois.length > GEO_PROJECT_LIMITS.maxRois) {
    throw new GeoValidationError('LIMIT_EXCEEDED', 'The project exceeds the ROI limit')
  }
  if (provenance.length > GEO_PROJECT_LIMITS.maxProvenance) {
    throw new GeoValidationError('LIMIT_EXCEEDED', 'The project exceeds the provenance limit')
  }
  if (workflowRuns.length > GEO_PROJECT_LIMITS.maxWorkflowRuns) {
    throw new GeoValidationError('LIMIT_EXCEEDED', 'The project exceeds the workflow-run limit')
  }
  uniqueIds(
    sources.map(({ id }) => id),
    'source id',
  )
  uniqueIds(
    workflowRuns.map(({ id }) => id),
    'workflow run id',
  )
  uniqueIds(
    layers.map(({ id }) => id),
    'layer id',
  )
  uniqueIds(
    rois.map(({ id }) => id),
    'ROI id',
  )
  const sourceIds = new Set(sources.map(({ id }) => id))
  const layerIds = new Set(layers.map(({ id }) => id))
  if (
    sources.length > 1 &&
    sources.some((source) => !sameKnownCrs(source.spatialReference.crs, input.crs))
  ) {
    throw new GeoValidationError(
      'INVALID_PROJECT',
      'Every source in a multi-source project must share the same identified CRS',
    )
  }
  for (const layer of layers) {
    if (layer.kind === 'raster' && !sourceIds.has(layer.sourceId)) {
      throw new GeoValidationError(
        'INVALID_PROJECT',
        `Layer ${layer.id} references missing source ${layer.sourceId}`,
      )
    }
    if (layer.kind === 'derived') {
      assertDerivedRasterRecipe(layer.recipe)
      if (
        layer.recipe.inputs.length !== layer.inputLayerIds.length ||
        layer.recipe.inputs.some((input, index) => input.layerId !== layer.inputLayerIds[index])
      ) {
        throw new GeoValidationError(
          'INVALID_PROJECT',
          `Layer ${layer.id} recipe inputs do not match its input layers`,
        )
      }
      if (layer.sourceId !== undefined && !sourceIds.has(layer.sourceId)) {
        throw new GeoValidationError(
          'INVALID_PROJECT',
          `Layer ${layer.id} references missing source ${layer.sourceId}`,
        )
      }
      for (const inputLayerId of layer.inputLayerIds) {
        if (inputLayerId === layer.id) {
          throw new GeoValidationError(
            'INVALID_PROJECT',
            `Layer ${layer.id} cannot derive from itself`,
          )
        }
        if (!layerIds.has(inputLayerId)) {
          throw new GeoValidationError(
            'INVALID_PROJECT',
            `Layer ${layer.id} references missing input ${inputLayerId}`,
          )
        }
      }
      for (const sourceId of layer.provenance.sourceIds) {
        if (!sourceIds.has(sourceId)) {
          throw new GeoValidationError(
            'INVALID_PROJECT',
            `Layer ${layer.id} provenance references missing source ${sourceId}`,
          )
        }
      }
    }
    validateLayerBandMapping(layer, sources)
  }
  validateDerivedLayerCycles(layers)
  const comparison = input.comparison ?? { mode: 'single' }
  validateComparison(comparison, layers, sources)
  for (const roi of rois) {
    if (roi.coordinateSpace !== 'map') {
      throw new GeoValidationError('INVALID_PROJECT', 'Geo ROIs must use map coordinates')
    }
  }
  return {
    schemaVersion: GEO_PROJECT_SCHEMA_VERSION,
    id: boundedId(input.id ?? 'geo-project', 'project id') as GeoProjectId,
    title: boundedString(input.title, 'project title'),
    createdAt: normalizedDate(input.createdAt ?? '1970-01-01T00:00:00.000Z', 'project createdAt'),
    updatedAt: normalizedDate(input.updatedAt ?? '1970-01-01T00:00:00.000Z', 'project updatedAt'),
    crs: input.crs,
    viewport: normalizeProjectViewport(input.viewport ?? { kind: 'auto' }),
    sources,
    layers,
    comparison,
    rois,
    provenance: provenance.map((entry) => {
      const normalized = normalizeProvenance(entry)
      for (const sourceId of normalized.sourceIds) {
        if (!sourceIds.has(sourceId)) {
          throw new GeoValidationError(
            'INVALID_PROJECT',
            `Provenance ${normalized.id} references missing source ${sourceId}`,
          )
        }
      }
      return normalized
    }),
    workflowRuns: workflowRuns.map((record) => normalizeWorkflowRun(record, sourceIds, layerIds)),
    selection: normalizeProjectSelection(input.selection ?? {}, sourceIds, layerIds, rois),
  }
}

function normalizeWorkflowRun(
  record: GeoWorkflowProvenanceRecord,
  sourceIds: ReadonlySet<GeoSourceId>,
  layerIds: ReadonlySet<GeoLayerId>,
): GeoWorkflowProvenanceRecord {
  if (record.schemaVersion !== 1 || !Number.isInteger(record.workflowVersion)) {
    throw new GeoValidationError('INVALID_PROJECT', 'Workflow provenance version is invalid')
  }
  boundedId(record.id, 'workflow run id')
  boundedId(record.workflowId, 'workflow id')
  if (record.actions.length > 256 || record.selectedAssets.length > 64) {
    throw new GeoValidationError('LIMIT_EXCEEDED', 'Workflow provenance exceeds its item limit')
  }
  for (const sourceId of record.sourceIds) {
    if (!sourceIds.has(sourceId))
      throw new GeoValidationError(
        'INVALID_PROJECT',
        `Workflow ${record.id} references missing source ${sourceId}`,
      )
  }
  for (const layerId of record.outputLayerIds) {
    if (!layerIds.has(layerId))
      throw new GeoValidationError(
        'INVALID_PROJECT',
        `Workflow ${record.id} references missing layer ${layerId}`,
      )
  }
  const serialized = JSON.stringify(record)
  if (serialized.length > 256 * 1024)
    throw new GeoValidationError('LIMIT_EXCEEDED', 'Workflow provenance exceeds 256 KiB')
  return JSON.parse(serialized) as GeoWorkflowProvenanceRecord
}

function normalizeProjectViewport(value: GeoProjectViewport): GeoProjectViewport {
  if (value.kind === 'auto') return { kind: 'auto' }
  return {
    kind: 'map',
    centerX: finiteNumber(value.centerX, 'viewport centerX'),
    centerY: finiteNumber(value.centerY, 'viewport centerY'),
    zoom: positiveNumber(value.zoom, 'viewport zoom'),
  }
}

function normalizeProjectSelection(
  value: GeoProjectSelection,
  sourceIds: ReadonlySet<GeoSourceId>,
  layerIds: ReadonlySet<GeoLayerId>,
  rois: readonly GeoMapRoi[],
): GeoProjectSelection {
  const sourceId = value.sourceId
  const layerId = value.layerId
  const roiId = value.roiId
  const inspector = value.inspector
  if (sourceId !== undefined && !sourceIds.has(sourceId))
    throw new GeoValidationError('INVALID_PROJECT', 'Selected source does not exist')
  if (layerId !== undefined && !layerIds.has(layerId))
    throw new GeoValidationError('INVALID_PROJECT', 'Selected layer does not exist')
  if (roiId !== undefined && !rois.some(({ id }) => id === roiId))
    throw new GeoValidationError('INVALID_PROJECT', 'Selected ROI does not exist')
  if (
    inspector !== undefined &&
    inspector !== 'project' &&
    inspector !== 'agent' &&
    inspector !== 'catalog' &&
    inspector !== 'layers' &&
    inspector !== 'workflows' &&
    inspector !== 'vectors' &&
    inspector !== 'cog'
  )
    throw new GeoValidationError('INVALID_PROJECT', 'Selected inspector does not exist')
  return {
    ...(sourceId === undefined ? {} : { sourceId }),
    ...(layerId === undefined ? {} : { layerId }),
    ...(roiId === undefined ? {} : { roiId }),
    ...(inspector === undefined ? {} : { inspector }),
  }
}

function sameKnownCrs(left: CrsReference, right: CrsReference): boolean {
  if (left.authority === undefined || left.code === undefined) return false
  if (right.authority === undefined || right.code === undefined) return false
  return (
    left.authority.trim().toUpperCase() === right.authority.trim().toUpperCase() &&
    String(left.code).trim() === String(right.code).trim()
  )
}

function validateComparison(
  comparison: GeoComparisonState,
  layers: readonly GeoLayer[],
  sources: readonly GeoRasterSource[],
): void {
  const layerIds = new Set(layers.map(({ id }) => id))
  switch (comparison.mode) {
    case 'single':
      return
    case 'swipe':
      requireLayer(comparison.leftLayerId, layerIds, 'swipe left layer')
      requireLayer(comparison.rightLayerId, layerIds, 'swipe right layer')
      requireVisibleLayer(comparison.leftLayerId, layers, 'swipe left layer')
      requireVisibleLayer(comparison.rightLayerId, layers, 'swipe right layer')
      if (comparison.leftLayerId === comparison.rightLayerId) {
        throw new GeoValidationError('INVALID_PROJECT', 'Swipe comparison requires two layers')
      }
      requireComparisonCrs(comparison.leftLayerId, comparison.rightLayerId, layers, sources)
      unitInterval(comparison.swipePosition, 'swipe position')
      return
    case 'overlay':
      if (comparison.overlayLayerIds.length === 0) {
        throw new GeoValidationError('INVALID_PROJECT', 'Overlay comparison requires layers')
      }
      for (const layerId of comparison.overlayLayerIds)
        requireVisibleLayer(layerId, layers, 'overlay layer')
      uniqueIds(comparison.overlayLayerIds, 'overlay layer id')
      for (const layerId of comparison.overlayLayerIds.slice(1)) {
        const first = comparison.overlayLayerIds[0]
        if (first !== undefined) requireComparisonCrs(first, layerId, layers, sources)
      }
      return
    case 'blink':
      requireVisibleLayer(comparison.firstLayerId, layers, 'blink first layer')
      requireVisibleLayer(comparison.secondLayerId, layers, 'blink second layer')
      if (comparison.firstLayerId === comparison.secondLayerId) {
        throw new GeoValidationError('INVALID_PROJECT', 'Blink comparison requires two layers')
      }
      if (
        !Number.isFinite(comparison.intervalMilliseconds) ||
        comparison.intervalMilliseconds < 100 ||
        comparison.intervalMilliseconds > 10_000
      ) {
        throw new GeoValidationError(
          'INVALID_PROJECT',
          'Blink interval must be between 100 and 10000 milliseconds',
        )
      }
      requireComparisonCrs(comparison.firstLayerId, comparison.secondLayerId, layers, sources)
      return
    default: {
      const unexpected: never = comparison
      throw new GeoValidationError(
        'INVALID_PROJECT',
        `Unsupported comparison ${(unexpected as GeoComparisonState).mode}`,
      )
    }
  }
}

function requireComparisonCrs(
  leftLayerId: GeoLayerId,
  rightLayerId: GeoLayerId,
  layers: readonly GeoLayer[],
  sources: readonly GeoRasterSource[],
): void {
  const leftLayer = layers.find(({ id }) => id === leftLayerId)
  const rightLayer = layers.find(({ id }) => id === rightLayerId)
  const left = sources.find(({ id }) => id === leftLayer?.sourceId)
  const right = sources.find(({ id }) => id === rightLayer?.sourceId)
  if (
    left === undefined ||
    right === undefined ||
    !sameKnownCrs(left.spatialReference.crs, right.spatialReference.crs)
  ) {
    throw new GeoValidationError(
      'INVALID_PROJECT',
      'Comparison requires two sources with the same known CRS',
    )
  }
}

function requireVisibleLayer(id: string, layers: readonly GeoLayer[], label: string): void {
  const layer = layers.find((candidate) => candidate.id === id)
  if (layer === undefined) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} ${id} is not in the project`)
  }
  if (!layer.visible || layer.opacity <= 0) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} ${id} must be visible`)
  }
}

function validateLayerBandMapping(layer: GeoLayer, sources: readonly GeoRasterSource[]): void {
  if (layer.sourceId === undefined) return
  const source = sources.find((candidate) => candidate.id === layer.sourceId)
  if (source === undefined) return
  const indices = Object.values(layer.style.mapping).filter(
    (value): value is number => typeof value === 'number',
  )
  if (indices.some((index) => index >= source.componentCount)) {
    throw new GeoValidationError(
      'INVALID_PROJECT',
      `Layer ${layer.id} maps a band outside source ${source.id}`,
    )
  }
}

function validateDerivedLayerCycles(layers: readonly GeoLayer[]): void {
  const derived = new Map(
    layers
      .filter((layer): layer is DerivedGeoRasterLayer => layer.kind === 'derived')
      .map((layer) => [layer.id, layer.inputLayerIds] as const),
  )
  const visiting = new Set<GeoLayerId>()
  const visited = new Set<GeoLayerId>()
  const visit = (id: GeoLayerId): void => {
    if (visiting.has(id)) {
      throw new GeoValidationError('INVALID_PROJECT', `Derived layer cycle includes ${id}`)
    }
    if (visited.has(id)) return
    visiting.add(id)
    for (const input of derived.get(id) ?? []) visit(input)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of derived.keys()) visit(id)
}

function requireLayer(id: string, layerIds: ReadonlySet<string>, label: string): void {
  if (!layerIds.has(id)) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} ${id} is not in the project`)
  }
}

function normalizeRasterStyle(style: RasterStyle): RasterStyle {
  const mapping = normalizeBandMapping(style.mapping)
  const resample = style.resample ?? 'nearest'
  if (resample !== 'nearest' && resample !== 'bilinear') {
    throw new GeoValidationError('INVALID_PROJECT', 'Style resample must be nearest or bilinear')
  }
  const rangeMode = style.rangeMode ?? 'stable'
  if (rangeMode !== 'stable' && rangeMode !== 'viewport-local') {
    throw new GeoValidationError(
      'INVALID_PROJECT',
      'Style rangeMode must be stable or viewport-local',
    )
  }
  const valueMode = style.valueMode ?? 'raw'
  if (valueMode !== 'raw' && valueMode !== 'physical') {
    throw new GeoValidationError('INVALID_PROJECT', 'Style valueMode must be raw or physical')
  }
  const minimum =
    style.minimum === undefined ? undefined : finiteNumber(style.minimum, 'style minimum')
  const maximum =
    style.maximum === undefined ? undefined : finiteNumber(style.maximum, 'style maximum')
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new GeoValidationError('INVALID_PROJECT', 'Style range is inverted')
  }
  const stretch = style.stretch ?? 'minmax'
  if (stretch !== 'minmax' && stretch !== 'percentile') {
    throw new GeoValidationError('INVALID_PROJECT', 'Style stretch must be minmax or percentile')
  }
  const percentileLow =
    style.percentileLow === undefined
      ? undefined
      : unitPercent(style.percentileLow, 'style percentileLow')
  const percentileHigh =
    style.percentileHigh === undefined
      ? undefined
      : unitPercent(style.percentileHigh, 'style percentileHigh')
  if (
    percentileLow !== undefined &&
    percentileHigh !== undefined &&
    percentileHigh <= percentileLow
  ) {
    throw new GeoValidationError('INVALID_PROJECT', 'Style percentiles are inverted')
  }
  const gamma = style.gamma === undefined ? undefined : finiteNumber(style.gamma, 'style gamma')
  if (gamma !== undefined && gamma <= 0) {
    throw new GeoValidationError('INVALID_PROJECT', 'Style gamma must be positive')
  }
  return {
    mapping,
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    stretch,
    ...(percentileLow === undefined ? {} : { percentileLow }),
    ...(percentileHigh === undefined ? {} : { percentileHigh }),
    ...(gamma === undefined ? {} : { gamma }),
    nodataTransparent: style.nodataTransparent ?? true,
    resample,
    rangeMode,
    valueMode,
  }
}

function normalizeBandMapping(mapping: BandMapping): BandMapping {
  const gray = mapping.gray === undefined ? undefined : bandIndex(mapping.gray, 'gray band')
  const red = mapping.red === undefined ? undefined : bandIndex(mapping.red, 'red band')
  const green = mapping.green === undefined ? undefined : bandIndex(mapping.green, 'green band')
  const blue = mapping.blue === undefined ? undefined : bandIndex(mapping.blue, 'blue band')
  const hasGray = gray !== undefined
  const hasRgb = red !== undefined || green !== undefined || blue !== undefined
  if (hasGray && hasRgb) {
    throw new GeoValidationError('INVALID_PROJECT', 'Band mapping cannot mix gray and RGB')
  }
  if (!hasGray && !hasRgb) {
    throw new GeoValidationError('INVALID_PROJECT', 'Band mapping requires gray or RGB bands')
  }
  return {
    ...(gray === undefined ? {} : { gray }),
    ...(red === undefined ? {} : { red }),
    ...(green === undefined ? {} : { green }),
    ...(blue === undefined ? {} : { blue }),
  }
}

function normalizeBands(
  bands: readonly GeoBandMetadata[],
  componentCount: number,
): readonly GeoBandMetadata[] {
  const seen = new Set<number>()
  return bands.map((band) => {
    const index = bandIndex(band.index, 'band index')
    if (index >= componentCount) {
      throw new GeoValidationError('INVALID_PROJECT', 'Band metadata exceeds component count')
    }
    if (seen.has(index)) {
      throw new GeoValidationError('INVALID_PROJECT', `Duplicate band metadata index ${index}`)
    }
    seen.add(index)
    return {
      index,
      ...(band.name === undefined ? {} : { name: boundedString(band.name, 'band name') }),
      ...(band.commonName === undefined
        ? {}
        : { commonName: boundedString(band.commonName, 'band common name') }),
      ...(band.description === undefined
        ? {}
        : { description: boundedString(band.description, 'band description') }),
      ...(band.dataType === undefined
        ? {}
        : { dataType: boundedString(band.dataType, 'band data type') }),
      ...(band.nodata === undefined ? {} : { nodata: finiteNumber(band.nodata, 'band nodata') }),
      ...(band.scale === undefined ? {} : { scale: finiteNumber(band.scale, 'band scale') }),
      ...(band.offset === undefined ? {} : { offset: finiteNumber(band.offset, 'band offset') }),
      ...(band.unit === undefined ? {} : { unit: boundedString(band.unit, 'band unit') }),
      ...(band.wavelength === undefined
        ? {}
        : { wavelength: finiteNumber(band.wavelength, 'band wavelength') }),
      ...(band.colorInterpretation === undefined
        ? {}
        : {
            colorInterpretation: boundedString(
              band.colorInterpretation,
              'band color interpretation',
            ),
          }),
    }
  })
}

function normalizeLocator(locator: GeoRasterLocator): GeoRasterLocator {
  switch (locator.kind) {
    case 'remote-url':
      return { kind: 'remote-url', url: durableRemoteUrl(locator.url, 'remote URL') }
    case 'stac-asset':
      return {
        kind: 'stac-asset',
        catalog: normalizeCatalogReference(locator.catalog),
        roles: locator.roles.map((role) => boundedString(role, 'asset role')),
        bands: normalizeBands(locator.bands, Math.max(1, locator.bands.length)),
        ...(locator.datetime === undefined
          ? {}
          : { datetime: boundedString(locator.datetime, 'asset datetime') }),
        ...(locator.title === undefined
          ? {}
          : { title: boundedString(locator.title, 'asset title') }),
        ...(locator.mediaType === undefined
          ? {}
          : { mediaType: boundedString(locator.mediaType, 'asset media type') }),
        ...(locator.fileSize === undefined
          ? {}
          : { fileSize: positiveInteger(locator.fileSize, 'asset file size') }),
        ...(locator.checksum === undefined
          ? {}
          : { checksum: boundedString(locator.checksum, 'asset checksum') }),
        ...(locator.validator === undefined
          ? {}
          : { validator: boundedString(locator.validator, 'asset validator') }),
        ...(locator.projection === undefined
          ? {}
          : { projection: boundedString(locator.projection, 'asset projection') }),
      }
    case 'tnm-product':
      return {
        kind: 'tnm-product',
        catalog: normalizeCatalogReference(locator.catalog),
        productId: boundedString(locator.productId, 'TNM product id'),
        ...(locator.downloadUrl === undefined
          ? {}
          : { downloadUrl: durableRemoteUrl(locator.downloadUrl, 'TNM download URL') }),
        bands: normalizeBands(locator.bands, Math.max(1, locator.bands.length)),
        roles: locator.roles.map((role) => boundedString(role, 'TNM asset role')),
        ...(locator.datetime === undefined
          ? {}
          : { datetime: boundedString(locator.datetime, 'TNM product datetime') }),
        ...(locator.title === undefined
          ? {}
          : { title: boundedString(locator.title, 'TNM product title') }),
        ...(locator.mediaType === undefined
          ? {}
          : { mediaType: boundedString(locator.mediaType, 'TNM media type') }),
        ...(locator.fileSize === undefined
          ? {}
          : { fileSize: positiveInteger(locator.fileSize, 'TNM file size') }),
        ...(locator.checksum === undefined
          ? {}
          : { checksum: boundedString(locator.checksum, 'TNM checksum') }),
        ...(locator.validator === undefined
          ? {}
          : { validator: boundedString(locator.validator, 'TNM validator') }),
        ...(locator.projection === undefined
          ? {}
          : { projection: boundedString(locator.projection, 'TNM projection') }),
      }
    case 'local-file':
      return {
        kind: 'local-file',
        fingerprint: {
          name: boundedString(locator.fingerprint.name, 'local file name'),
          size: nonNegativeInteger(locator.fingerprint.size, 'local file size'),
          lastModified: nonNegativeInteger(
            locator.fingerprint.lastModified,
            'local file lastModified',
          ),
          ...(locator.fingerprint.mediaType === undefined
            ? {}
            : {
                mediaType: boundedString(locator.fingerprint.mediaType, 'local file media type'),
              }),
          ...(locator.fingerprint.digest === undefined
            ? {}
            : {
                digest: {
                  algorithm: 'sha256',
                  value: boundedString(locator.fingerprint.digest.value, 'local file digest'),
                },
              }),
          ...(locator.fingerprint.companionNames === undefined
            ? {}
            : {
                companionNames: locator.fingerprint.companionNames.map((name) =>
                  boundedString(name, 'local companion file name'),
                ),
              }),
        },
      }
    case 'bundled-example':
      return {
        kind: 'bundled-example',
        scenarioId: boundedId(locator.scenarioId, 'scenario id'),
        ...(locator.assetId === undefined
          ? {}
          : { assetId: boundedId(locator.assetId, 'example asset id') }),
      }
  }
}

function normalizeCatalogReference(value: GeoCatalogReference): GeoCatalogReference {
  const href = value.href === undefined ? undefined : boundedString(value.href, 'catalog href')
  if (href !== undefined && isUnsafeCatalogUrl(href)) {
    throw new GeoValidationError(
      'INVALID_PROJECT',
      'Catalog provenance cannot store signed or data URLs',
    )
  }
  const sourceUrl =
    value.sourceUrl === undefined ? undefined : boundedString(value.sourceUrl, 'source URL')
  if (sourceUrl !== undefined && isUnsafeCatalogUrl(sourceUrl)) {
    throw new GeoValidationError(
      'INVALID_PROJECT',
      'Catalog provenance cannot store signed or data URLs',
    )
  }
  return {
    catalogId: boundedId(value.catalogId, 'catalog id'),
    catalogTitle: boundedString(value.catalogTitle, 'catalog title'),
    collectionId: boundedId(value.collectionId, 'collection id'),
    itemId: boundedString(value.itemId, 'item id'),
    assetKey: boundedString(value.assetKey, 'asset key'),
    ...(href === undefined ? {} : { href }),
    ...(value.provider === undefined
      ? {}
      : { provider: boundedString(value.provider, 'provider') }),
    ...(value.license === undefined ? {} : { license: boundedString(value.license, 'license') }),
    ...(value.attribution === undefined
      ? {}
      : { attribution: boundedString(value.attribution, 'attribution') }),
    ...(value.protocol === undefined
      ? {}
      : { protocol: boundedString(value.protocol, 'protocol') }),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
  }
}

function normalizeSourceValidators(value: GeoSourceValidators): GeoSourceValidators {
  return {
    ...(value.etag === undefined ? {} : { etag: boundedString(value.etag, 'source ETag') }),
    ...(value.versionId === undefined
      ? {}
      : { versionId: boundedString(value.versionId, 'source version id') }),
    ...(value.lastModified === undefined
      ? {}
      : { lastModified: boundedString(value.lastModified, 'source last-modified') }),
    ...(value.size === undefined ? {} : { size: nonNegativeInteger(value.size, 'source size') }),
    ...(value.checksum === undefined
      ? {}
      : { checksum: boundedString(value.checksum, 'source checksum') }),
  }
}

function normalizeLastKnownMetadata(
  value: GeoSourceLastKnownMetadata,
  componentCount: number,
): GeoSourceLastKnownMetadata {
  return {
    ...(value.provider === undefined
      ? {}
      : { provider: boundedString(value.provider, 'source provider') }),
    ...(value.license === undefined
      ? {}
      : { license: boundedString(value.license, 'source license') }),
    ...(value.attribution === undefined
      ? {}
      : { attribution: boundedString(value.attribution, 'source attribution') }),
    ...(value.datetime === undefined
      ? {}
      : { datetime: boundedString(value.datetime, 'source datetime') }),
    ...(value.title === undefined ? {} : { title: boundedString(value.title, 'source title') }),
    ...(value.projection === undefined
      ? {}
      : { projection: boundedString(value.projection, 'source projection') }),
    bands: normalizeBands(value.bands, componentCount),
  }
}

function isUnsafeCatalogUrl(href: string): boolean {
  if (href.startsWith('data:')) return true
  try {
    const url = new URL(href)
    const unsafe = new Set([
      'x-amz-signature',
      'x-amz-credential',
      'x-amz-security-token',
      'x-goog-signature',
      'x-goog-credential',
      'signature',
      'sig',
      'token',
      'access_token',
      'api_key',
      'apikey',
      'key',
      'client_secret',
      'password',
      'authorization',
    ])
    return (
      url.username.length > 0 ||
      url.password.length > 0 ||
      [...url.searchParams.keys()].some((key) => unsafe.has(key.toLowerCase()))
    )
  } catch {
    return true
  }
}

function durableRemoteUrl(value: string, label: string): string {
  const normalized = boundedString(value, label)
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new GeoValidationError('INVALID_PROJECT', `${label} must be an absolute URL`)
  }
  const loopbackHttp =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  if ((url.protocol !== 'https:' && !loopbackHttp) || isUnsafeCatalogUrl(url.href)) {
    throw new GeoValidationError(
      'INVALID_PROJECT',
      `${label} must be durable HTTPS (or loopback HTTP) without signed credentials`,
    )
  }
  return url.href
}

function normalizeProvenance(value: GeoProvenanceReference): GeoProvenanceReference {
  return {
    id: boundedId(value.id, 'provenance id') as GeoProvenanceId,
    sourceIds: uniqueIds(
      value.sourceIds.map((id) => id),
      'provenance source id',
    ).map((id) => id as GeoSourceId),
    ...(value.recipe === undefined
      ? {}
      : {
          recipe: {
            recipeId: boundedString(value.recipe.recipeId, 'recipe id'),
            ...(value.recipe.recipeVersion === undefined
              ? {}
              : { recipeVersion: boundedString(value.recipe.recipeVersion, 'recipe version') }),
          },
        }),
    createdAt: boundedString(value.createdAt, 'provenance createdAt'),
    ...(value.note === undefined ? {} : { note: boundedString(value.note, 'provenance note') }),
    ...(value.execution === undefined ? {} : { execution: normalizeGeoExecution(value.execution) }),
  }
}

function normalizeGeoExecution(
  value: import('@pji-workbench/contracts').DerivedRasterGeoExecutionProvenanceV1,
): import('@pji-workbench/contracts').DerivedRasterGeoExecutionProvenanceV1 {
  if (
    value.schemaVersion !== 1 ||
    value.engine !== 'purejsimage/geo' ||
    value.cacheSchemaVersion !== 2
  )
    throw new GeoValidationError('INVALID_PROJECT', 'Derived Geo execution provenance is invalid')
  const relationships = new Set(['exact-grid', 'same-crs-different-grid', 'different-crs'])
  return {
    schemaVersion: 1,
    engine: 'purejsimage/geo',
    packageVersion: boundedString(value.packageVersion, 'Geo execution package version'),
    cacheSchemaVersion: 2,
    inputs: value.inputs.map((input) => {
      if (
        !relationships.has(input.relationship) ||
        typeof input.pixelAligned !== 'boolean' ||
        typeof input.pyramidCompatible !== 'boolean'
      )
        throw new GeoValidationError('INVALID_PROJECT', 'Derived Geo input provenance is invalid')
      return {
        layerId: boundedString(input.layerId, 'Geo execution layer id'),
        relationship: input.relationship,
        pixelAligned: input.pixelAligned,
        pyramidCompatible: input.pyramidCompatible,
        sourceGridIdentity: boundedString(input.sourceGridIdentity, 'Geo source grid identity'),
        targetGridIdentity: boundedString(input.targetGridIdentity, 'Geo target grid identity'),
        ...(input.transform === undefined
          ? {}
          : {
              transform: {
                descriptorId: boundedString(
                  input.transform.descriptorId,
                  'transform descriptor id',
                ),
                descriptorVersion: boundedString(
                  input.transform.descriptorVersion,
                  'transform descriptor version',
                ),
                transformIdentity: boundedString(
                  input.transform.transformIdentity,
                  'transform identity',
                ),
                implementationIdentity: boundedString(
                  input.transform.implementationIdentity,
                  'transform implementation identity',
                ),
                accuracy: { ...input.transform.accuracy },
                warnings: input.transform.warnings.map((warning) =>
                  boundedString(warning, 'transform warning'),
                ),
              },
            }),
      }
    }),
  }
}

function normalizeGeometry(geometry: GeoMapGeometry): GeoMapGeometry {
  if (geometryCoordinateCount(geometry) > GEO_PROJECT_LIMITS.maxRoiPoints) {
    throw new GeoValidationError('LIMIT_EXCEEDED', 'ROI geometry exceeds the total point limit')
  }
  switch (geometry.kind) {
    case 'point':
      return {
        kind: 'point',
        x: finiteNumber(geometry.x, 'ROI x'),
        y: finiteNumber(geometry.y, 'ROI y'),
      }
    case 'multi-point':
      return { kind: 'multi-point', points: mapPoints(geometry.points, 'multipoint') }
    case 'rectangle': {
      const minX = finiteNumber(geometry.minX, 'ROI minX')
      const minY = finiteNumber(geometry.minY, 'ROI minY')
      const maxX = finiteNumber(geometry.maxX, 'ROI maxX')
      const maxY = finiteNumber(geometry.maxY, 'ROI maxY')
      if (minX > maxX || minY > maxY) {
        throw new GeoValidationError('INVALID_PROJECT', 'ROI rectangle is inverted')
      }
      return { kind: 'rectangle', minX, minY, maxX, maxY }
    }
    case 'line':
      return { kind: 'line', points: mapPoints(geometry.points, 'line', 2) }
    case 'multi-line':
      if (geometry.lines.length === 0) {
        throw new GeoValidationError('INVALID_PROJECT', 'A multi-line ROI requires a line')
      }
      return {
        kind: 'multi-line',
        lines: geometry.lines.map((line, index) => mapPoints(line, `multi-line ${index}`, 2)),
      }
    case 'polygon':
      if (geometry.rings.length === 0) {
        throw new GeoValidationError('INVALID_PROJECT', 'A polygon ROI requires a ring')
      }
      return {
        kind: 'polygon',
        rings: geometry.rings.map((ring, index) => closedRing(ring, `polygon ring ${index}`)),
      }
    case 'multi-polygon':
      if (geometry.polygons.length === 0) {
        throw new GeoValidationError('INVALID_PROJECT', 'A multi-polygon ROI requires a polygon')
      }
      return {
        kind: 'multi-polygon',
        polygons: geometry.polygons.map((polygon, polygonIndex) => {
          if (polygon.length === 0) {
            throw new GeoValidationError(
              'INVALID_PROJECT',
              `Multi-polygon ${polygonIndex} requires a ring`,
            )
          }
          return polygon.map((ring, ringIndex) =>
            closedRing(ring, `multi-polygon ${polygonIndex} ring ${ringIndex}`),
          )
        }),
      }
    default: {
      const unexpected: never = geometry
      throw new GeoValidationError(
        'INVALID_PROJECT',
        `Unsupported ROI geometry ${(unexpected as GeoMapGeometry).kind}`,
      )
    }
  }
}

function geometryCoordinateCount(geometry: GeoMapGeometry): number {
  switch (geometry.kind) {
    case 'point':
      return 1
    case 'multi-point':
    case 'line':
      return geometry.points.length
    case 'rectangle':
      return 5
    case 'multi-line':
      return geometry.lines.reduce((sum, line) => sum + line.length, 0)
    case 'polygon':
      return geometry.rings.reduce((sum, ring) => sum + ring.length, 0)
    case 'multi-polygon':
      return geometry.polygons.reduce(
        (sum, polygon) => sum + polygon.reduce((polygonSum, ring) => polygonSum + ring.length, 0),
        0,
      )
  }
}

function mapPoints(
  points: readonly GeoMapPoint[],
  label: string,
  minimum = 1,
): readonly GeoMapPoint[] {
  if (points.length < minimum) {
    throw new GeoValidationError(
      'INVALID_PROJECT',
      `${label} requires at least ${minimum} point${minimum === 1 ? '' : 's'}`,
    )
  }
  if (points.length > GEO_PROJECT_LIMITS.maxRoiPoints) {
    throw new GeoValidationError('LIMIT_EXCEEDED', `${label} exceeds the point limit`)
  }
  return points.map((point, index) => ({
    x: finiteNumber(point.x, `${label}[${index}].x`),
    y: finiteNumber(point.y, `${label}[${index}].y`),
  }))
}

function closedRing(points: readonly GeoMapPoint[], label: string): readonly GeoMapPoint[] {
  const ring = mapPoints(points, label, 4)
  const first = ring[0]
  const last = ring.at(-1)
  if (first === undefined || last === undefined || first.x !== last.x || first.y !== last.y) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} must be closed`)
  }
  return ring
}

function normalizeRoiProvenance(value: GeoRoiProvenance): GeoRoiProvenance {
  switch (value.kind) {
    case 'drawn':
      return { kind: 'drawn', tool: value.tool }
    case 'imported':
      return {
        kind: 'imported',
        format: value.format,
        ...(value.sourceName === undefined
          ? {}
          : { sourceName: boundedString(value.sourceName, 'ROI import source') }),
        ...(value.legacyCrs === undefined
          ? {}
          : { legacyCrs: boundedString(value.legacyCrs, 'ROI legacy CRS') }),
        ...(value.interpretationConfirmed === undefined
          ? {}
          : { interpretationConfirmed: value.interpretationConfirmed }),
      }
    case 'action':
      return {
        kind: 'action',
        actionId: boundedString(value.actionId, 'ROI provenance action'),
        ...(value.note === undefined
          ? {}
          : { note: boundedString(value.note, 'ROI provenance note') }),
      }
  }
}

function normalizeRoiProperties(
  value: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, JsonValue>> {
  const serialized = JSON.stringify(value)
  if (new TextEncoder().encode(serialized).byteLength > GEO_PROJECT_LIMITS.maxRoiPropertyBytes) {
    throw new GeoValidationError('LIMIT_EXCEEDED', 'ROI properties exceed the byte limit')
  }
  const parsed = JSON.parse(serialized) as Readonly<Record<string, JsonValue>>
  rejectUnsafeJsonKeys(parsed, 'ROI properties')
  return parsed
}

function rejectUnsafeJsonKeys(value: JsonValue, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      rejectUnsafeJsonKeys(item, `${label}[${index}]`)
    })
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new GeoValidationError('INVALID_PROJECT', `${label} contains forbidden key ${key}`)
    }
    rejectUnsafeJsonKeys(item, `${label}.${key}`)
  }
}

function normalizedDate(value: string, label: string): string {
  const normalized = boundedString(value, label)
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} must be an ISO date`)
  }
  return normalized
}

function blendMode(value: GeoBlendMode): GeoBlendMode {
  if (!BLEND_MODES.has(value)) {
    throw new GeoValidationError('INVALID_PROJECT', 'Blend mode is unsupported')
  }
  return value
}

function bandIndex(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} must be a non-negative integer`)
  }
  return value
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} must be a positive integer`)
  }
  return value
}

function positiveNumber(value: number, label: string): number {
  const normalized = finiteNumber(value, label)
  if (normalized <= 0) throw new GeoValidationError('INVALID_PROJECT', `${label} must be positive`)
  return normalized
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} must be a non-negative integer`)
  }
  return value
}

function unitInterval(value: number, label: string): number {
  const next = finiteNumber(value, label)
  if (next < 0 || next > 1) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} must be between 0 and 1`)
  }
  return next
}

function unitPercent(value: number, label: string): number {
  const next = finiteNumber(value, label)
  if (next < 0 || next > 100) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} must be between 0 and 100`)
  }
  return next
}

function finiteNumber(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} must be finite`)
  }
  return Object.is(value, -0) ? 0 : value
}

function boundedString(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} must be a non-empty string`)
  }
  if (value.length > GEO_PROJECT_LIMITS.maxStringLength) {
    throw new GeoValidationError('LIMIT_EXCEEDED', `${label} exceeds the string limit`)
  }
  return value
}

function boundedId(value: string, label: string): string {
  return boundedString(value, label)
}

function uniqueIds(values: readonly string[], label: string): readonly string[] {
  const seen = new Set<string>()
  for (const value of values) {
    const id = boundedId(value, label)
    if (seen.has(id)) {
      throw new GeoValidationError('INVALID_PROJECT', `Duplicate ${label} ${id}`)
    }
    seen.add(id)
  }
  return [...seen]
}
