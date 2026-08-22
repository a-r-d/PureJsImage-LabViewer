import type { JsonValue } from '@pji-workbench/actions'

import type { GeoActionId } from './actions.js'
import { KY_FROM_ABOVE_CATALOG, KY_FROM_ABOVE_DEFAULT_BBOX } from './catalog/ky-from-above.js'
import {
  NOAA_DIGITAL_COAST_CATALOG,
  NOAA_PALM_COAST_BBOX,
  NOAA_PUERTO_RICO_BBOX,
} from './catalog/noaa-digital-coast.js'
import type {
  CatalogAssetIdentity,
  CatalogDisplayPreset,
  CatalogRegistryEntry,
  CatalogSourceCandidate,
} from './catalog/types.js'
import { USGS_3DEP_CATALOG, USGS_3DEP_CINCINNATI_BBOX } from './catalog/usgs-3dep.js'
import {
  USGS_LANDSAT_CATALOG,
  USGS_LANDSAT_DEFAULT_BBOX,
  USGS_LANDSAT_DEFAULT_DATETIME,
} from './catalog/usgs-landsat.js'
import type { GeoLayerId, GeoSourceId } from './model.js'

export const GEO_WORKFLOW_SCHEMA_VERSION = 1 as const

export type GeoWorkflowAvailabilityStatus =
  | 'available'
  | 'available-after-source-selection'
  | 'blocked-browser-cors'
  | 'blocked-missing-range'
  | 'blocked-unsupported-decoder'
  | 'blocked-missing-bands'
  | 'blocked-incompatible-crs'
  | 'blocked-unavailable-relay'
  | 'blocked-missing-operation'

export interface GeoWorkflowAvailability {
  readonly status: GeoWorkflowAvailabilityStatus
  readonly reason: string
}

export interface GeoWorkflowCatalogDependency {
  readonly catalogId: string
  readonly collectionGroup: string
  readonly purpose: string
}

export interface GeoWorkflowSelector {
  readonly id: string
  readonly catalogId: string
  readonly collectionGroup: string
  readonly bbox: readonly [number, number, number, number]
  readonly datetime?: string
  readonly sortby?: string
  readonly limit: number
  readonly parameterWhen?: Readonly<{ parameterId: string; equals: string }>
}

export type GeoWorkflowBandRole = 'red' | 'green' | 'blue' | 'nir' | 'elevation' | 'primary'

export interface GeoWorkflowAssetRequirement {
  readonly role: GeoWorkflowBandRole
  readonly required: boolean
  readonly commonNames: readonly string[]
  readonly assetKeys?: readonly string[]
  readonly providerOverrideNoteRequired?: boolean
}

export interface GeoWorkflowParameter {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly type: 'boolean' | 'enum'
  readonly default: boolean | string
  readonly options?: readonly Readonly<{ value: string; label: string }>[]
}

export type GeoWorkflowStep =
  | Readonly<{ id: string; title: string; kind: 'catalog-discovery'; selectorId: string }>
  | Readonly<{
      id: string
      title: string
      kind: 'user-decision'
      decision: 'one-candidate' | 'two-acquisition-dates' | 'display-preset' | 'value-mode'
      minimumSelections: number
      maximumSelections: number
    }>
  | Readonly<{
      id: string
      title: string
      kind: 'compatibility-check'
      checks: readonly (
        | 'decoder-ready'
        | 'same-crs'
        | 'meaningful-overlap'
        | 'required-bands'
        | 'units'
        | 'nodata'
        | 'pixel-size'
      )[]
    }>
  | Readonly<{
      id: string
      title: string
      kind: 'open-assets'
      mode: 'primary' | 'required-band-assets'
    }>
  | Readonly<{
      id: string
      title: string
      kind: 'semantic-action'
      actionId: GeoActionId
      purpose: 'fit-source' | 'inspect-cog' | 'set-display' | 'compare-swipe' | 'compare-blink'
    }>
  | Readonly<{
      id: string
      title: string
      kind: 'derived-output'
      operation:
        | 'virtual-band-stack'
        | 'normalized-difference'
        | 'hillshade'
        | 'slope'
        | 'line-profile'
        | 'region-statistics'
      inputRoles: readonly GeoWorkflowBandRole[]
      optional?: boolean
    }>
  | Readonly<{
      id: string
      title: string
      kind: 'report'
      report: 'cog-xray' | 'comparison-attribution' | 'terrain-summary' | 'workflow-provenance'
    }>

export interface GeoWorkflowOutputDefinition {
  readonly id: string
  readonly kind: 'layer' | 'table' | 'report'
  readonly title: string
  readonly optional?: boolean
}

export interface GeoWorkflowRecipe {
  readonly kind: 'recipe'
  readonly schemaVersion: typeof GEO_WORKFLOW_SCHEMA_VERSION
  readonly id: string
  readonly version: 1
  readonly title: string
  readonly summary: string
  readonly purpose: string
  readonly catalogDependencies: readonly GeoWorkflowCatalogDependency[]
  readonly selectors: readonly GeoWorkflowSelector[]
  readonly requiredAssets: readonly GeoWorkflowAssetRequirement[]
  readonly alignment: Readonly<{
    kind: 'none' | 'same-crs-overlap' | 'explicit-target-grid'
    resamplingAllowed: boolean
    crossCrsTransformAllowed: boolean
  }>
  readonly requiredOperations: readonly GeoActionId[]
  readonly inputParameters: readonly GeoWorkflowParameter[]
  readonly steps: readonly GeoWorkflowStep[]
  readonly approvalPoints: readonly Readonly<{
    stepId: string
    reason: string
    required: boolean
  }>[]
  readonly outputs: readonly GeoWorkflowOutputDefinition[]
  readonly attributionRequirements: readonly string[]
  readonly fallbackExplanation: string
}

export interface GeoWorkflowDecisionOption {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly candidateIdentities: readonly CatalogAssetIdentity[]
  readonly attribution: readonly string[]
  readonly supportedParameters?: Readonly<Record<string, readonly string[]>>
}

export interface GeoWorkflowActionRecord {
  readonly sequence: number
  readonly stepId: string
  readonly actionId: GeoActionId
  readonly input: JsonValue
  readonly result: JsonValue
}

export interface GeoWorkflowRunRecord {
  readonly schemaVersion: 1
  readonly id: string
  readonly workflowId: string
  readonly workflowVersion: 1
  readonly status: 'awaiting-decision' | 'running' | 'completed' | 'cancelled' | 'failed'
  readonly currentStepId?: string
  readonly parameters: Readonly<Record<string, JsonValue>>
  readonly decisions: Readonly<Record<string, readonly string[]>>
  readonly selectedAssets: readonly CatalogAssetIdentity[]
  readonly actions: readonly GeoWorkflowActionRecord[]
  readonly sourceIds: readonly GeoSourceId[]
  readonly outputLayerIds: readonly GeoLayerId[]
  readonly completedOutputs: readonly Readonly<{
    id: string
    title: string
    kind: 'layer' | 'table' | 'report'
    reference?: string
  }>[]
  readonly attribution: readonly string[]
  readonly availability: GeoWorkflowAvailability
  readonly startedAt: string
  readonly completedAt?: string
  readonly error?: string
}

const requiredAction = (actionId: GeoActionId): GeoActionId => actionId
const recipe = (value: GeoWorkflowRecipe): GeoWorkflowRecipe => Object.freeze(value)

export const GEO_WORKFLOW_RECIPES = Object.freeze([
  recipe({
    kind: 'recipe',
    schemaVersion: 1,
    id: 'cog-anatomy',
    version: 1,
    title: 'COG Anatomy',
    summary:
      'Inspect a decoder-ready COG and watch bounded Range telemetry change while navigating.',
    purpose:
      'Explain TIFF structure and range-backed behavior without claiming standards certification.',
    catalogDependencies: [
      {
        catalogId: KY_FROM_ABOVE_CATALOG.id,
        collectionGroup: 'leaf-off-ortho',
        purpose: 'COG source',
      },
    ],
    selectors: [
      {
        id: 'source',
        catalogId: KY_FROM_ABOVE_CATALOG.id,
        collectionGroup: 'leaf-off-ortho',
        bbox: KY_FROM_ABOVE_DEFAULT_BBOX,
        limit: 12,
      },
    ],
    requiredAssets: [{ role: 'primary', required: true, commonNames: [] }],
    alignment: { kind: 'none', resamplingAllowed: false, crossCrsTransformAllowed: false },
    requiredOperations: [
      requiredAction('geo.source.open_catalog_asset'),
      requiredAction('geo.viewport.fit_source'),
    ],
    inputParameters: [],
    steps: [
      {
        id: 'discover',
        title: 'Search configured catalog',
        kind: 'catalog-discovery',
        selectorId: 'source',
      },
      {
        id: 'choose',
        title: 'Choose a decoder-ready COG',
        kind: 'user-decision',
        decision: 'one-candidate',
        minimumSelections: 1,
        maximumSelections: 1,
      },
      {
        id: 'verify',
        title: 'Inspect candidate compatibility',
        kind: 'compatibility-check',
        checks: ['decoder-ready'],
      },
      { id: 'open', title: 'Open source', kind: 'open-assets', mode: 'primary' },
      {
        id: 'fit',
        title: 'Fit source',
        kind: 'semantic-action',
        actionId: 'geo.viewport.fit_source',
        purpose: 'fit-source',
      },
      {
        id: 'inspect',
        title: 'Open COG X-ray',
        kind: 'semantic-action',
        actionId: 'geo.source.describe',
        purpose: 'inspect-cog',
      },
      { id: 'report', title: 'COG structure and telemetry', kind: 'report', report: 'cog-xray' },
      {
        id: 'provenance',
        title: 'Record workflow provenance',
        kind: 'report',
        report: 'workflow-provenance',
      },
    ],
    approvalPoints: [
      {
        stepId: 'open',
        reason: 'Open the selected remote raster with bounded Range requests.',
        required: true,
      },
    ],
    outputs: [{ id: 'cog-report', kind: 'report', title: 'COG X-ray and telemetry' }],
    attributionRequirements: ['catalog', 'collection', 'item', 'asset', 'provider', 'license'],
    fallbackExplanation:
      'Structural inspection reports observed TIFF/BigTIFF organization and transport behavior; it is not standards certification.',
  }),
  recipe({
    kind: 'recipe',
    schemaVersion: 1,
    id: 'kentucky-through-time',
    version: 1,
    title: 'Kentucky Through Time',
    summary:
      'Choose two overlapping Kentucky ortho acquisitions and compare them with swipe or blink.',
    purpose:
      'Compare two verified dates for the same place while retaining both catalog identities.',
    catalogDependencies: [
      {
        catalogId: KY_FROM_ABOVE_CATALOG.id,
        collectionGroup: 'time-series-ortho',
        purpose: 'dated orthophotos',
      },
    ],
    selectors: [
      {
        id: 'dates',
        catalogId: KY_FROM_ABOVE_CATALOG.id,
        collectionGroup: 'time-series-ortho',
        bbox: KY_FROM_ABOVE_DEFAULT_BBOX,
        limit: 24,
      },
    ],
    requiredAssets: [{ role: 'primary', required: true, commonNames: [] }],
    alignment: {
      kind: 'same-crs-overlap',
      resamplingAllowed: false,
      crossCrsTransformAllowed: false,
    },
    requiredOperations: [
      'geo.source.open_catalog_asset',
      'geo.comparison.set_swipe',
      'geo.comparison.set_blink',
    ],
    inputParameters: [
      {
        id: 'comparisonMode',
        title: 'Comparison mode',
        description: 'Choose the synchronized comparison view.',
        type: 'enum',
        default: 'swipe',
        options: [
          { value: 'swipe', label: 'Swipe' },
          { value: 'blink', label: 'Blink' },
        ],
      },
    ],
    steps: [
      {
        id: 'discover',
        title: 'Search compatible ortho collections',
        kind: 'catalog-discovery',
        selectorId: 'dates',
      },
      {
        id: 'choose',
        title: 'Choose two acquisition dates',
        kind: 'user-decision',
        decision: 'two-acquisition-dates',
        minimumSelections: 2,
        maximumSelections: 2,
      },
      {
        id: 'verify',
        title: 'Verify CRS and overlap',
        kind: 'compatibility-check',
        checks: ['decoder-ready', 'same-crs', 'meaningful-overlap'],
      },
      { id: 'open', title: 'Open both dated sources', kind: 'open-assets', mode: 'primary' },
      {
        id: 'compare',
        title: 'Configure comparison',
        kind: 'semantic-action',
        actionId: 'geo.comparison.set_swipe',
        purpose: 'compare-swipe',
      },
      {
        id: 'attribution',
        title: 'Display both dates and sources',
        kind: 'report',
        report: 'comparison-attribution',
      },
      {
        id: 'provenance',
        title: 'Record workflow provenance',
        kind: 'report',
        report: 'workflow-provenance',
      },
    ],
    approvalPoints: [{ stepId: 'open', reason: 'Open two remote COG sources.', required: true }],
    outputs: [{ id: 'comparison', kind: 'report', title: 'Two-date comparison with attribution' }],
    attributionRequirements: [
      'both acquisition dates',
      'both catalog asset identities',
      'provider',
      'license',
    ],
    fallbackExplanation:
      'The workflow remains a candidate search until two distinct, overlapping dates with the same identified CRS are selected.',
  }),
  recipe({
    kind: 'recipe',
    schemaVersion: 1,
    id: 'natural-color-cir',
    version: 1,
    title: 'Natural Color and Color Infrared',
    summary: 'Create only display mappings supported by explicit band metadata.',
    purpose: 'Offer RGB and CIR without inferring NIR from component count.',
    catalogDependencies: [
      {
        catalogId: KY_FROM_ABOVE_CATALOG.id,
        collectionGroup: 'leaf-off-ortho',
        purpose: 'multiband imagery',
      },
    ],
    selectors: [
      {
        id: 'imagery',
        catalogId: KY_FROM_ABOVE_CATALOG.id,
        collectionGroup: 'leaf-off-ortho',
        bbox: KY_FROM_ABOVE_DEFAULT_BBOX,
        limit: 12,
      },
    ],
    requiredAssets: [
      { role: 'red', required: true, commonNames: ['red'] },
      { role: 'green', required: true, commonNames: ['green'] },
      { role: 'blue', required: true, commonNames: ['blue'] },
      {
        role: 'nir',
        required: false,
        commonNames: ['nir', 'nir08'],
        providerOverrideNoteRequired: true,
      },
    ],
    alignment: { kind: 'none', resamplingAllowed: false, crossCrsTransformAllowed: false },
    requiredOperations: ['geo.source.open_catalog_asset', 'geo.layer.set_style'],
    inputParameters: [
      {
        id: 'displayPreset',
        title: 'Display preset',
        description: 'Metadata-supported display mapping.',
        type: 'enum',
        default: 'natural-color',
        options: [
          { value: 'natural-color', label: 'Natural color' },
          { value: 'cir', label: 'Color infrared' },
        ],
      },
    ],
    steps: [
      { id: 'discover', title: 'Search imagery', kind: 'catalog-discovery', selectorId: 'imagery' },
      {
        id: 'choose',
        title: 'Choose an image',
        kind: 'user-decision',
        decision: 'one-candidate',
        minimumSelections: 1,
        maximumSelections: 1,
      },
      {
        id: 'verify',
        title: 'Inspect full band metadata',
        kind: 'compatibility-check',
        checks: ['decoder-ready', 'required-bands'],
      },
      { id: 'open', title: 'Open imagery', kind: 'open-assets', mode: 'primary' },
      {
        id: 'display',
        title: 'Apply exact band mapping',
        kind: 'semantic-action',
        actionId: 'geo.layer.set_style',
        purpose: 'set-display',
      },
      {
        id: 'provenance',
        title: 'Record exact mapping recipe',
        kind: 'report',
        report: 'workflow-provenance',
      },
    ],
    approvalPoints: [{ stepId: 'open', reason: 'Open the selected remote image.', required: true }],
    outputs: [{ id: 'display-layer', kind: 'layer', title: 'Metadata-driven color layer' }],
    attributionRequirements: [
      'catalog asset identity',
      'provider',
      'license',
      'exact band mapping',
    ],
    fallbackExplanation:
      'CIR is hidden unless NIR is explicitly identified by item metadata or an audited provider override with a source note.',
  }),
  recipe({
    kind: 'recipe',
    schemaVersion: 1,
    id: 'terrain-lab',
    version: 1,
    title: 'Terrain Lab',
    summary:
      'Inspect a bare-earth DEM and derive hillshade, slope, profile, and regional statistics.',
    purpose: 'Analyze elevation with explicit units, nodata, CRS, and pixel size.',
    catalogDependencies: [
      { catalogId: USGS_3DEP_CATALOG.id, collectionGroup: 'ned-13', purpose: 'DEM source' },
      {
        catalogId: KY_FROM_ABOVE_CATALOG.id,
        collectionGroup: 'elevation-dtm',
        purpose: 'bare-earth DTM fallback',
      },
    ],
    selectors: [
      {
        id: 'dem',
        catalogId: USGS_3DEP_CATALOG.id,
        collectionGroup: 'ned-13',
        bbox: USGS_3DEP_CINCINNATI_BBOX,
        limit: 12,
      },
    ],
    requiredAssets: [{ role: 'elevation', required: true, commonNames: [] }],
    alignment: {
      kind: 'explicit-target-grid',
      resamplingAllowed: true,
      crossCrsTransformAllowed: false,
    },
    requiredOperations: [
      'geo.source.open_catalog_asset',
      'geo.analysis.hillshade',
      'geo.analysis.slope',
      'geo.analysis.line_profile',
      'geo.analysis.region_statistics',
    ],
    inputParameters: [],
    steps: [
      {
        id: 'discover',
        title: 'Search DEM products',
        kind: 'catalog-discovery',
        selectorId: 'dem',
      },
      {
        id: 'choose',
        title: 'Choose a DEM',
        kind: 'user-decision',
        decision: 'one-candidate',
        minimumSelections: 1,
        maximumSelections: 1,
      },
      {
        id: 'verify',
        title: 'Inspect units, nodata, CRS, and pixel size',
        kind: 'compatibility-check',
        checks: ['decoder-ready', 'units', 'nodata', 'pixel-size'],
      },
      { id: 'open', title: 'Open DEM', kind: 'open-assets', mode: 'primary' },
      {
        id: 'hillshade',
        title: 'Create hillshade',
        kind: 'derived-output',
        operation: 'hillshade',
        inputRoles: ['elevation'],
      },
      {
        id: 'slope',
        title: 'Create slope',
        kind: 'derived-output',
        operation: 'slope',
        inputRoles: ['elevation'],
      },
      {
        id: 'profile',
        title: 'Sample line profile',
        kind: 'derived-output',
        operation: 'line-profile',
        inputRoles: ['elevation'],
        optional: true,
      },
      {
        id: 'summary',
        title: 'Summarize elevation region',
        kind: 'derived-output',
        operation: 'region-statistics',
        inputRoles: ['elevation'],
        optional: true,
      },
      {
        id: 'provenance',
        title: 'Record terrain provenance',
        kind: 'report',
        report: 'terrain-summary',
      },
    ],
    approvalPoints: [
      { stepId: 'open', reason: 'Open the remote DEM.', required: true },
      { stepId: 'hillshade', reason: 'Run bounded terrain analysis.', required: true },
    ],
    outputs: [
      { id: 'hillshade', kind: 'layer', title: 'Hillshade' },
      { id: 'slope', kind: 'layer', title: 'Slope' },
      { id: 'profile', kind: 'table', title: 'Elevation profile', optional: true },
      { id: 'summary', kind: 'report', title: 'Regional elevation summary', optional: true },
    ],
    attributionRequirements: [
      'source identity',
      'horizontal units',
      'vertical units',
      'nodata policy',
    ],
    fallbackExplanation:
      'DSM minus DTM is not offered unless the selected catalog publishes a compatible DSM. A DTM is never described as a DSM.',
  }),
  recipe({
    kind: 'recipe',
    schemaVersion: 1,
    id: 'usgs-landsat-cincinnati',
    version: 1,
    title: 'USGS Landsat Cincinnati',
    summary: 'Compose named surface-reflectance band assets into RGB, CIR, and optional NDVI.',
    purpose:
      'Prove browser-native multi-asset Landsat analysis with explicit scaling and identities.',
    catalogDependencies: [
      {
        catalogId: USGS_LANDSAT_CATALOG.id,
        collectionGroup: 'surface-reflectance',
        purpose: 'low-cloud Landsat scene',
      },
    ],
    selectors: [
      {
        id: 'scene',
        catalogId: USGS_LANDSAT_CATALOG.id,
        collectionGroup: 'surface-reflectance',
        bbox: USGS_LANDSAT_DEFAULT_BBOX,
        datetime: USGS_LANDSAT_DEFAULT_DATETIME,
        sortby: '+properties.eo:cloud_cover',
        limit: 12,
      },
    ],
    requiredAssets: [
      { role: 'red', required: true, commonNames: ['red'], assetKeys: ['red'] },
      { role: 'green', required: true, commonNames: ['green'], assetKeys: ['green'] },
      { role: 'blue', required: true, commonNames: ['blue'], assetKeys: ['blue'] },
      { role: 'nir', required: true, commonNames: ['nir', 'nir08'], assetKeys: ['nir08'] },
    ],
    alignment: {
      kind: 'explicit-target-grid',
      resamplingAllowed: true,
      crossCrsTransformAllowed: false,
    },
    requiredOperations: [
      'geo.source.open_catalog_asset',
      'geo.analysis.virtual_band_stack',
      'geo.analysis.normalized_difference',
    ],
    inputParameters: [
      {
        id: 'valueMode',
        title: 'Surface-reflectance values',
        description: 'Choose stored DN or scaled reflectance explicitly.',
        type: 'enum',
        default: 'scaled',
        options: [
          { value: 'raw', label: 'Raw stored values' },
          { value: 'scaled', label: 'Scaled surface reflectance' },
        ],
      },
      {
        id: 'includeNdvi',
        title: 'Create NDVI',
        description: 'Create normalized difference from named NIR and red assets.',
        type: 'boolean',
        default: true,
      },
    ],
    steps: [
      {
        id: 'discover',
        title: 'Search low-cloud surface reflectance',
        kind: 'catalog-discovery',
        selectorId: 'scene',
      },
      {
        id: 'choose',
        title: 'Choose a scene',
        kind: 'user-decision',
        decision: 'one-candidate',
        minimumSelections: 1,
        maximumSelections: 1,
      },
      {
        id: 'verify',
        title: 'Inspect collection and band assets',
        kind: 'compatibility-check',
        checks: ['decoder-ready', 'required-bands', 'same-crs'],
      },
      {
        id: 'values',
        title: 'Choose raw or scaled values',
        kind: 'user-decision',
        decision: 'value-mode',
        minimumSelections: 1,
        maximumSelections: 1,
      },
      {
        id: 'open',
        title: 'Open required band assets',
        kind: 'open-assets',
        mode: 'required-band-assets',
      },
      {
        id: 'stack',
        title: 'Create virtual band stack',
        kind: 'derived-output',
        operation: 'virtual-band-stack',
        inputRoles: ['red', 'green', 'blue', 'nir'],
      },
      {
        id: 'ndvi',
        title: 'Create optional NDVI',
        kind: 'derived-output',
        operation: 'normalized-difference',
        inputRoles: ['nir', 'red'],
        optional: true,
      },
      {
        id: 'provenance',
        title: 'Record every asset identity',
        kind: 'report',
        report: 'workflow-provenance',
      },
    ],
    approvalPoints: [
      { stepId: 'open', reason: 'Open four remote Landsat band COGs.', required: true },
      { stepId: 'stack', reason: 'Create virtual derived layers.', required: true },
    ],
    outputs: [
      { id: 'natural-color', kind: 'layer', title: 'Natural color virtual stack' },
      { id: 'cir', kind: 'layer', title: 'Color infrared virtual stack' },
      { id: 'ndvi', kind: 'layer', title: 'NDVI', optional: true },
    ],
    attributionRequirements: [
      'collection',
      'scene',
      'every asset key',
      'USGS attribution',
      'value mode and scale/offset',
    ],
    fallbackExplanation:
      'The workflow explains and stops when LandsatLook CORS or the absence of an approved relay prevents browser access.',
  }),
  recipe({
    kind: 'recipe',
    schemaVersion: 1,
    id: 'noaa-raster-inspection',
    version: 1,
    title: 'NOAA Raster Inspection',
    summary:
      'Inspect either NOAA terrain or imagery using only metadata-supported display presets.',
    purpose: 'Cover NOAA terrain and imagery without promoting Palm Coast band 4 to NIR.',
    catalogDependencies: [
      {
        catalogId: NOAA_DIGITAL_COAST_CATALOG.id,
        collectionGroup: 'puerto-rico-terrain',
        purpose: 'terrain mode',
      },
      {
        catalogId: NOAA_DIGITAL_COAST_CATALOG.id,
        collectionGroup: 'palm-coast-imagery',
        purpose: 'imagery mode',
      },
    ],
    selectors: [
      {
        id: 'terrain',
        catalogId: NOAA_DIGITAL_COAST_CATALOG.id,
        collectionGroup: 'puerto-rico-terrain',
        bbox: NOAA_PUERTO_RICO_BBOX,
        limit: 12,
        parameterWhen: { parameterId: 'mode', equals: 'terrain' },
      },
      {
        id: 'imagery',
        catalogId: NOAA_DIGITAL_COAST_CATALOG.id,
        collectionGroup: 'palm-coast-imagery',
        bbox: NOAA_PALM_COAST_BBOX,
        limit: 12,
        parameterWhen: { parameterId: 'mode', equals: 'imagery' },
      },
    ],
    requiredAssets: [{ role: 'primary', required: true, commonNames: [] }],
    alignment: { kind: 'none', resamplingAllowed: false, crossCrsTransformAllowed: false },
    requiredOperations: ['geo.source.open_catalog_asset', 'geo.layer.set_style'],
    inputParameters: [
      {
        id: 'mode',
        title: 'NOAA workflow',
        description: 'Choose terrain or imagery inspection.',
        type: 'enum',
        default: 'terrain',
        options: [
          { value: 'terrain', label: 'Terrain tile' },
          { value: 'imagery', label: 'Imagery' },
        ],
      },
    ],
    steps: [
      {
        id: 'discover',
        title: 'Search NOAA catalog',
        kind: 'catalog-discovery',
        selectorId: 'terrain',
      },
      {
        id: 'choose',
        title: 'Choose a raster',
        kind: 'user-decision',
        decision: 'one-candidate',
        minimumSelections: 1,
        maximumSelections: 1,
      },
      {
        id: 'verify',
        title: 'Inspect decoder and band metadata',
        kind: 'compatibility-check',
        checks: ['decoder-ready', 'required-bands'],
      },
      { id: 'open', title: 'Open raster', kind: 'open-assets', mode: 'primary' },
      {
        id: 'display',
        title: 'Apply supported display preset',
        kind: 'semantic-action',
        actionId: 'geo.layer.set_style',
        purpose: 'set-display',
      },
      {
        id: 'provenance',
        title: 'Record NOAA provenance',
        kind: 'report',
        report: 'workflow-provenance',
      },
    ],
    approvalPoints: [{ stepId: 'open', reason: 'Open the selected NOAA raster.', required: true }],
    outputs: [{ id: 'inspection-layer', kind: 'layer', title: 'Metadata-supported NOAA raster' }],
    attributionRequirements: ['NOAA collection', 'item', 'asset', 'provider and license'],
    fallbackExplanation:
      'Only presets supported by actual item metadata are exposed. Palm Coast CIR remains unavailable unless NIR is explicitly identified.',
  }),
] satisfies readonly GeoWorkflowRecipe[])

export function geoWorkflowById(id: string): GeoWorkflowRecipe | undefined {
  return GEO_WORKFLOW_RECIPES.find((workflow) => workflow.id === id)
}

export function assertGeoWorkflowRecipe(value: unknown): asserts value is GeoWorkflowRecipe {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Geo workflow must be an object.')
  const workflow = value as Partial<GeoWorkflowRecipe>
  if (workflow.schemaVersion !== 1 || workflow.version !== 1 || workflow.kind !== 'recipe')
    throw new Error('Geo workflow version is unsupported.')
  for (const field of [
    workflow.id,
    workflow.title,
    workflow.summary,
    workflow.purpose,
    workflow.fallbackExplanation,
  ]) {
    if (typeof field !== 'string' || field.trim().length === 0 || field.length > 4_096)
      throw new Error('Geo workflow text is invalid.')
  }
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0 || workflow.steps.length > 64)
    throw new Error('Geo workflow steps are invalid.')
  const stepIds = new Set<string>()
  for (const step of workflow.steps) {
    if (stepIds.has(step.id)) throw new Error(`Duplicate workflow step ${step.id}.`)
    stepIds.add(step.id)
  }
  const serialized = JSON.stringify(value)
  if (serialized.length > 128 * 1_024) throw new Error('Geo workflow exceeds the size limit.')
  if (/https?:\/\//iu.test(serialized))
    throw new Error('Geo workflow definitions must not contain URLs.')
  for (const selector of workflow.selectors ?? []) {
    if (!workflow.catalogDependencies?.some(({ catalogId }) => catalogId === selector.catalogId))
      throw new Error(`Workflow selector ${selector.id} has an undeclared catalog.`)
  }
  for (const approval of workflow.approvalPoints ?? []) {
    if (!stepIds.has(approval.stepId))
      throw new Error(`Approval references missing step ${approval.stepId}.`)
  }
}

export function workflowAvailability(
  workflow: GeoWorkflowRecipe,
  context: Readonly<{
    catalogs: readonly CatalogRegistryEntry[]
    availableActions: ReadonlySet<GeoActionId>
    candidates?: readonly CatalogSourceCandidate[]
    transport?: 'ready' | 'cors' | 'missing-range' | 'unsupported-decoder' | 'unavailable-relay'
  }>,
): GeoWorkflowAvailability {
  assertGeoWorkflowRecipe(workflow)
  for (const dependency of workflow.catalogDependencies) {
    if (!context.catalogs.some(({ id }) => id === dependency.catalogId))
      return {
        status: 'blocked-unavailable-relay',
        reason: `Catalog ${dependency.catalogId} is not configured.`,
      }
  }
  const missing = workflow.requiredOperations.find((id) => !context.availableActions.has(id))
  if (missing !== undefined)
    return {
      status: 'blocked-missing-operation',
      reason: `Required operation ${missing} is unavailable.`,
    }
  if (context.transport === 'cors')
    return { status: 'blocked-browser-cors', reason: workflow.fallbackExplanation }
  if (context.transport === 'missing-range')
    return {
      status: 'blocked-missing-range',
      reason: 'The selected source does not support required HTTP Range reads.',
    }
  if (context.transport === 'unsupported-decoder')
    return {
      status: 'blocked-unsupported-decoder',
      reason: 'The selected source is not decoder-ready.',
    }
  if (context.transport === 'unavailable-relay')
    return { status: 'blocked-unavailable-relay', reason: workflow.fallbackExplanation }
  if (context.candidates === undefined || context.candidates.length === 0)
    return {
      status: 'available-after-source-selection',
      reason: 'Search and select a compatible source before execution.',
    }
  const requiredBands = workflow.requiredAssets.filter(
    ({ required, commonNames }) => required && commonNames.length > 0,
  )
  if (
    requiredBands.length > 0 &&
    !context.candidates.some((candidate) =>
      requiredBands.every((requirement) => candidateHasBand(candidate, requirement)),
    )
  )
    return {
      status: 'blocked-missing-bands',
      reason: 'No candidate explicitly identifies every required band.',
    }
  return {
    status: 'available',
    reason: 'Required catalogs, operations, and candidate metadata are available.',
  }
}

export function candidateHasBand(
  candidate: CatalogSourceCandidate,
  requirement: GeoWorkflowAssetRequirement,
): boolean {
  const names = new Set(requirement.commonNames.map((value) => value.toLowerCase()))
  if (
    candidate.bands.some((band) =>
      [band.commonName, band.name, band.description].some(
        (value) => value !== undefined && names.has(value.toLowerCase()),
      ),
    )
  )
    return true
  return requirement.assetKeys?.some((key) => key === candidate.assetKey) === true
}

/** Display choices derived only from named bands; component count is never semantic metadata. */
export function displayPresetsForCandidate(
  candidate: CatalogSourceCandidate,
): readonly Readonly<{ id: string; label: string; style: import('./model.js').RasterStyle }>[] {
  const indexFor = (...names: readonly string[]): number | undefined => {
    const accepted = new Set(names.map((name) => name.toLowerCase()))
    return candidate.bands.find((band) =>
      [band.commonName, band.name, band.description].some(
        (value) => value !== undefined && accepted.has(value.toLowerCase()),
      ),
    )?.index
  }
  const red = indexFor('red')
  const green = indexFor('green')
  const blue = indexFor('blue')
  const nir = indexFor('nir', 'nir08')
  const stable = {
    stretch: 'percentile' as const,
    percentileLow: 2,
    percentileHigh: 98,
    rangeMode: 'stable' as const,
    nodataTransparent: true,
  }
  const presets: Array<
    Readonly<{ id: string; label: string; style: import('./model.js').RasterStyle }>
  > = []
  if (red !== undefined && green !== undefined && blue !== undefined) {
    presets.push({
      id: 'natural-color',
      label: 'Natural color',
      style: { ...stable, mapping: { red, green, blue } },
    })
  }
  if (nir !== undefined && red !== undefined && green !== undefined) {
    presets.push({
      id: 'color-infrared',
      label: 'Color infrared',
      style: { ...stable, mapping: { red: nir, green: red, blue: green } },
    })
  }
  return presets
}

/** Curated demo presets win on id collision so advertised CIR is not dropped. */
export function mergeDisplayPresets(
  discovered: readonly CatalogDisplayPreset[],
  curated: readonly CatalogDisplayPreset[] | undefined,
): readonly CatalogDisplayPreset[] {
  if (curated === undefined || curated.length === 0) return discovered
  const merged: CatalogDisplayPreset[] = []
  const seen = new Set<string>()
  for (const preset of [...curated, ...discovered]) {
    if (seen.has(preset.id)) continue
    seen.add(preset.id)
    merged.push(preset)
  }
  return merged
}

export function workflowAssetIdentity(candidate: CatalogSourceCandidate): CatalogAssetIdentity {
  return {
    catalogId: candidate.catalogId,
    collectionId: candidate.collectionId,
    itemId: candidate.itemId,
    assetKey: candidate.assetKey,
  }
}
