import type {
  CoordinateReferenceSystem,
  PixelInterpretation,
  SpatialReference,
} from '@pji-workbench/contracts'

export const GEO_PROJECT_SCHEMA_VERSION = 1 as const

export const GEO_PROJECT_LIMITS = Object.freeze({
  maxStringLength: 4_096,
  maxSources: 32,
  maxLayers: 128,
  maxRois: 256,
  maxRoiPoints: 4_096,
  maxProvenance: 128,
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
  readonly alpha?: number
}

export type RasterStretch = 'minmax' | 'percentile'

export interface RasterStyle {
  readonly mapping: BandMapping
  readonly palette?: string
  readonly minimum?: number
  readonly maximum?: number
  readonly stretch?: RasterStretch
  readonly percentileLow?: number
  readonly percentileHigh?: number
  readonly gamma?: number
  readonly nodataTransparent?: boolean
  readonly resample?: 'nearest' | 'bilinear'
}

export interface GeoRasterSource {
  readonly id: GeoSourceId
  readonly label: string
  readonly width: number
  readonly height: number
  readonly componentCount: number
  readonly spatialReference: SpatialReference
  readonly pixelInterpretation: PixelInterpretation
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
  readonly provenance: GeoProvenanceReference
}

export type GeoLayer = GeoRasterLayer | DerivedGeoRasterLayer

export type GeoComparisonMode = 'single' | 'swipe' | 'overlay'

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

export type GeoMapGeometry =
  | Readonly<{ kind: 'point'; x: number; y: number }>
  | Readonly<{ kind: 'rectangle'; minX: number; minY: number; maxX: number; maxY: number }>
  | Readonly<{ kind: 'line'; points: readonly GeoMapPoint[] }>
  | Readonly<{ kind: 'polygon'; rings: readonly (readonly GeoMapPoint[])[] }>

export interface GeoMapRoi {
  readonly id: GeoRoiId
  readonly name?: string
  readonly coordinateSpace: 'map'
  readonly crs: CrsReference
  readonly geometry: GeoMapGeometry
}

export interface GeoProject {
  readonly schemaVersion: typeof GEO_PROJECT_SCHEMA_VERSION
  readonly id: GeoProjectId
  readonly title: string
  readonly crs: CrsReference
  readonly sources: readonly GeoRasterSource[]
  readonly layers: readonly GeoLayer[]
  readonly comparison: GeoComparisonState
  readonly rois: readonly GeoMapRoi[]
  readonly provenance: readonly GeoProvenanceReference[]
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
  readonly provenance: GeoProvenanceReference
}

export interface CreateGeoMapRoiInput {
  readonly id: string
  readonly name?: string
  readonly crs: CrsReference
  readonly geometry: GeoMapGeometry
}

export interface CreateGeoProjectInput {
  readonly id?: string
  readonly title: string
  readonly crs: CrsReference
  readonly sources?: readonly GeoRasterSource[]
  readonly layers?: readonly GeoLayer[]
  readonly comparison?: GeoComparisonState
  readonly rois?: readonly GeoMapRoi[]
  readonly provenance?: readonly GeoProvenanceReference[]
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
  return {
    id: boundedId(input.id, 'source id') as GeoSourceId,
    label: boundedString(input.label, 'source label'),
    width: positiveInteger(input.width, 'source width'),
    height: positiveInteger(input.height, 'source height'),
    componentCount: positiveInteger(input.componentCount, 'component count'),
    spatialReference,
    pixelInterpretation: spatialReference.pixelInterpretation,
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
    provenance: normalizeProvenance(input.provenance),
  }
}

export function createGeoMapRoi(input: CreateGeoMapRoiInput): GeoMapRoi {
  return {
    id: boundedId(input.id, 'ROI id') as GeoRoiId,
    ...(input.name === undefined ? {} : { name: boundedString(input.name, 'ROI name') }),
    coordinateSpace: 'map',
    crs: input.crs,
    geometry: normalizeGeometry(input.geometry),
  }
}

export function createGeoProject(input: CreateGeoProjectInput): GeoProject {
  const sources = input.sources ?? []
  const layers = input.layers ?? []
  const rois = input.rois ?? []
  const provenance = input.provenance ?? []
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
  uniqueIds(
    sources.map(({ id }) => id),
    'source id',
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
  for (const layer of layers) {
    if (layer.kind === 'raster' && !sourceIds.has(layer.sourceId)) {
      throw new GeoValidationError(
        'INVALID_PROJECT',
        `Layer ${layer.id} references missing source ${layer.sourceId}`,
      )
    }
    if (layer.kind === 'derived') {
      if (layer.sourceId !== undefined && !sourceIds.has(layer.sourceId)) {
        throw new GeoValidationError(
          'INVALID_PROJECT',
          `Layer ${layer.id} references missing source ${layer.sourceId}`,
        )
      }
      for (const inputLayerId of layer.inputLayerIds) {
        if (!layerIds.has(inputLayerId)) {
          throw new GeoValidationError(
            'INVALID_PROJECT',
            `Layer ${layer.id} references missing input ${inputLayerId}`,
          )
        }
      }
    }
  }
  const comparison = input.comparison ?? { mode: 'single' }
  validateComparison(comparison, layerIds)
  for (const roi of rois) {
    if (roi.coordinateSpace !== 'map') {
      throw new GeoValidationError('INVALID_PROJECT', 'Geo ROIs must use map coordinates')
    }
  }
  return {
    schemaVersion: GEO_PROJECT_SCHEMA_VERSION,
    id: boundedId(input.id ?? 'geo-project', 'project id') as GeoProjectId,
    title: boundedString(input.title, 'project title'),
    crs: input.crs,
    sources,
    layers,
    comparison,
    rois,
    provenance: provenance.map(normalizeProvenance),
  }
}

function validateComparison(comparison: GeoComparisonState, layerIds: ReadonlySet<string>): void {
  switch (comparison.mode) {
    case 'single':
      return
    case 'swipe':
      requireLayer(comparison.leftLayerId, layerIds, 'swipe left layer')
      requireLayer(comparison.rightLayerId, layerIds, 'swipe right layer')
      unitInterval(comparison.swipePosition, 'swipe position')
      return
    case 'overlay':
      if (comparison.overlayLayerIds.length === 0) {
        throw new GeoValidationError('INVALID_PROJECT', 'Overlay comparison requires layers')
      }
      for (const layerId of comparison.overlayLayerIds)
        requireLayer(layerId, layerIds, 'overlay layer')
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

function requireLayer(id: string, layerIds: ReadonlySet<string>, label: string): void {
  if (!layerIds.has(id)) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} ${id} is not in the project`)
  }
}

function normalizeRasterStyle(style: RasterStyle): RasterStyle {
  const mapping = normalizeBandMapping(style.mapping)
  const palette =
    style.palette === undefined ? undefined : boundedString(style.palette, 'style palette')
  const resample = style.resample ?? 'nearest'
  if (resample !== 'nearest' && resample !== 'bilinear') {
    throw new GeoValidationError('INVALID_PROJECT', 'Style resample must be nearest or bilinear')
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
    ...(palette === undefined ? {} : { palette }),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    stretch,
    ...(percentileLow === undefined ? {} : { percentileLow }),
    ...(percentileHigh === undefined ? {} : { percentileHigh }),
    ...(gamma === undefined ? {} : { gamma }),
    nodataTransparent: style.nodataTransparent ?? true,
    resample,
  }
}

function normalizeBandMapping(mapping: BandMapping): BandMapping {
  const gray = mapping.gray === undefined ? undefined : bandIndex(mapping.gray, 'gray band')
  const red = mapping.red === undefined ? undefined : bandIndex(mapping.red, 'red band')
  const green = mapping.green === undefined ? undefined : bandIndex(mapping.green, 'green band')
  const blue = mapping.blue === undefined ? undefined : bandIndex(mapping.blue, 'blue band')
  const alpha = mapping.alpha === undefined ? undefined : bandIndex(mapping.alpha, 'alpha band')
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
    ...(alpha === undefined ? {} : { alpha }),
  }
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
  }
}

function normalizeGeometry(geometry: GeoMapGeometry): GeoMapGeometry {
  switch (geometry.kind) {
    case 'point':
      return {
        kind: 'point',
        x: finiteNumber(geometry.x, 'ROI x'),
        y: finiteNumber(geometry.y, 'ROI y'),
      }
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
      return { kind: 'line', points: mapPoints(geometry.points, 'line') }
    case 'polygon':
      if (geometry.rings.length === 0) {
        throw new GeoValidationError('INVALID_PROJECT', 'A polygon ROI requires a ring')
      }
      return {
        kind: 'polygon',
        rings: geometry.rings.map((ring, index) => mapPoints(ring, `polygon ring ${index}`)),
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

function mapPoints(points: readonly GeoMapPoint[], label: string): readonly GeoMapPoint[] {
  if (points.length === 0) {
    throw new GeoValidationError('INVALID_PROJECT', `${label} requires at least one point`)
  }
  if (points.length > GEO_PROJECT_LIMITS.maxRoiPoints) {
    throw new GeoValidationError('LIMIT_EXCEEDED', `${label} exceeds the point limit`)
  }
  return points.map((point, index) => ({
    x: finiteNumber(point.x, `${label}[${index}].x`),
    y: finiteNumber(point.y, `${label}[${index}].y`),
  }))
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
