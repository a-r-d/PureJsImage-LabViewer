import type { JsonValue } from '@pji-workbench/actions'
import type { GeoActionId } from '@pji-workbench/domain-geo'

export interface AtlasAgentEvalStep {
  readonly actionId: GeoActionId
  readonly input: JsonValue
  readonly expectedOutput: string
}

export interface AtlasAgentEvalCase {
  readonly id: string
  readonly title: string
  readonly fixtureId: string
  readonly userRequest: string
  readonly expectedBehavior: 'complete' | 'propose' | 'refuse'
  readonly steps: readonly AtlasAgentEvalStep[]
  readonly stoppingCondition: string
}

export interface AtlasAgentFailureEvalCase {
  readonly id: string
  readonly expectedError:
    | 'ABORTED'
    | 'ACTION_EXECUTION_FAILED'
    | 'ACTION_UNAVAILABLE'
    | 'ACTION_VALIDATION_FAILED'
    | 'APPROVAL_DENIED'
    | 'MAXIMUM_STEPS'
    | 'PROVIDER_ERROR'
    | 'STALE_PROJECT_REVISION'
    | 'TIMEOUT'
    | 'TOOL_OUTPUT_TOO_LARGE'
    | 'UNSUPPORTED_MODEL'
}

export const ATLAS_AGENT_EVAL_CASES: readonly AtlasAgentEvalCase[] = Object.freeze([
  {
    id: 'atlas-kentucky-cog',
    title: 'Search Kentucky and open a decoder-ready COG',
    fixtureId: 'atlas-kentucky-stac-cog',
    userRequest: 'Search Kentucky and open a decoder-ready COG.',
    expectedBehavior: 'complete',
    steps: [
      step('geo.catalog.search', { query: 'Kentucky' }, 'bounded catalog candidates'),
      step(
        'geo.source.open_catalog_asset',
        { catalogId: 'fixture', itemId: 'ky-cog', assetKey: 'visual' },
        'opened semantic source and layer IDs',
      ),
    ],
    stoppingCondition: 'A decoder-ready catalog source is open.',
  },
  {
    id: 'atlas-explain-cog-xray',
    title: 'Explain COG X-ray telemetry',
    fixtureId: 'atlas-cog-xray',
    userRequest: 'Explain the current COG X-ray telemetry.',
    expectedBehavior: 'complete',
    steps: [step('geo.source.describe', { sourceId: 'source-cog' }, 'bounded COG source summary')],
    stoppingCondition: 'The range and byte telemetry is explained without raw payloads.',
  },
  {
    id: 'atlas-natural-color',
    title: 'Select natural color from named bands',
    fixtureId: 'atlas-landsat-natural-color',
    userRequest: 'Use named bands to display natural color.',
    expectedBehavior: 'complete',
    steps: [
      step('geo.raster.describe_bands', { layerId: 'landsat' }, 'named band metadata'),
      step(
        'geo.layer.set_style',
        { layerId: 'landsat', preset: 'natural-color' },
        'updated layer style',
      ),
    ],
    stoppingCondition: 'The named red, green, and blue bands drive the display style.',
  },
  {
    id: 'atlas-refuse-cir-without-nir',
    title: 'Refuse CIR when NIR metadata is absent',
    fixtureId: 'atlas-rgb-only',
    userRequest: 'Display this source as color infrared.',
    expectedBehavior: 'refuse',
    steps: [step('geo.raster.describe_bands', { layerId: 'rgb-only' }, 'RGB-only band metadata')],
    stoppingCondition: 'No style mutation occurs because no NIR band is identified.',
  },
  {
    id: 'atlas-landsat-virtual-stack',
    title: 'Build a Landsat virtual stack',
    fixtureId: 'atlas-landsat-separate-assets',
    userRequest: 'Build a virtual Landsat stack from the separate band assets.',
    expectedBehavior: 'complete',
    steps: [
      step(
        'geo.analysis.virtual_band_stack',
        { recipe: { operation: 'virtual-band-stack' }, label: 'Landsat virtual stack' },
        'derived virtual-stack layer ID and recipe provenance',
      ),
    ],
    stoppingCondition: 'The normalized virtual-stack recipe is represented by a derived layer.',
  },
  {
    id: 'atlas-ndvi-approved',
    title: 'Produce NDVI with dry-run and approval',
    fixtureId: 'atlas-landsat-ndvi',
    userRequest: 'Plan and create NDVI.',
    expectedBehavior: 'complete',
    steps: [
      step(
        'geo.analysis.dry_run',
        { recipe: { operation: 'normalized-difference' } },
        'work estimate',
      ),
      step(
        'geo.analysis.normalized_difference',
        { recipe: { operation: 'normalized-difference' }, label: 'NDVI' },
        'approved NDVI layer and provenance',
      ),
    ],
    stoppingCondition: 'The approved NDVI derived layer exists.',
  },
  {
    id: 'atlas-dem-hillshade',
    title: 'Open a DEM and produce hillshade',
    fixtureId: 'atlas-dem-cog',
    userRequest: 'Open the DEM and create hillshade.',
    expectedBehavior: 'complete',
    steps: [
      step(
        'geo.source.open_catalog_asset',
        { catalogId: 'fixture', itemId: 'dem', assetKey: 'elevation' },
        'opened DEM source',
      ),
      step(
        'geo.analysis.hillshade',
        { recipe: { operation: 'hillshade' }, label: 'Hillshade' },
        'derived hillshade layer',
      ),
    ],
    stoppingCondition: 'The DEM-backed hillshade layer exists with recipe provenance.',
  },
  {
    id: 'atlas-two-date-swipe',
    title: 'Compare two dated sources with swipe',
    fixtureId: 'atlas-two-date-comparison',
    userRequest: 'Compare these dated scenes with swipe.',
    expectedBehavior: 'complete',
    steps: [
      step(
        'geo.comparison.set_swipe',
        { leftLayerId: 'older', rightLayerId: 'newer', position: 0.5 },
        'swipe comparison state',
      ),
    ],
    stoppingCondition: 'The two dated layers are configured in swipe mode.',
  },
  {
    id: 'atlas-refuse-mixed-crs-overlay',
    title: 'Refuse mixed-CRS overlay without reprojection',
    fixtureId: 'atlas-mixed-crs',
    userRequest: 'Overlay these mixed-CRS sources without changing either grid.',
    expectedBehavior: 'refuse',
    steps: [step('geo.comparison.read', {}, 'comparison and CRS summary')],
    stoppingCondition: 'No overlay mutation occurs without a supported reprojection plan.',
  },
  {
    id: 'atlas-propose-difference-grid',
    title: 'Propose a target grid for raster difference',
    fixtureId: 'atlas-difference-grid',
    userRequest: 'Difference these rasters using an explicit compatible target grid.',
    expectedBehavior: 'propose',
    steps: [
      step(
        'geo.analysis.dry_run',
        { recipe: { operation: 'raster-difference', targetGrid: { strategy: 'explicit' } } },
        'target-grid and resampling work estimate',
      ),
      step(
        'geo.analysis.raster_difference',
        {
          recipe: { operation: 'raster-difference', targetGrid: { strategy: 'explicit' } },
          label: 'Raster difference',
        },
        'approval-gated difference layer',
      ),
    ],
    stoppingCondition: 'An explicit target grid is proposed before execution.',
  },
  {
    id: 'atlas-roi-zonal-statistics',
    title: 'Select an ROI and summarize zonal statistics',
    fixtureId: 'atlas-roi-zonal',
    userRequest: 'Select the ROI and summarize raster statistics inside it.',
    expectedBehavior: 'complete',
    steps: [
      step('geo.roi.select', { roiId: 'roi-fixture' }, 'selected ROI identity'),
      step(
        'geo.analysis.zonal_statistics',
        { roiId: 'roi-fixture', layerId: 'raster-fixture' },
        'bounded statistics summary and artifact references',
      ),
    ],
    stoppingCondition: 'Valid/nodata counts and bounded statistics are summarized.',
  },
  {
    id: 'atlas-save-project',
    title: 'Save a project',
    fixtureId: 'atlas-project-save',
    userRequest: 'Save the current Atlas project.',
    expectedBehavior: 'complete',
    steps: [step('geo.project.save', {}, 'saved project identity and checksum')],
    stoppingCondition: 'The current project revision is saved.',
  },
  {
    id: 'atlas-rehydrate-public-project',
    title: 'Rehydrate a saved public-catalog project',
    fixtureId: 'atlas-project-rehydrate',
    userRequest: 'Rehydrate this saved public-catalog project.',
    expectedBehavior: 'complete',
    steps: [
      step(
        'geo.project.rehydration_plan',
        { projectId: 'project-fixture' },
        'source rehydration plan',
      ),
      step('geo.project.open', { projectId: 'project-fixture' }, 'transactionally opened project'),
    ],
    stoppingCondition: 'Stable public catalog identities have fresh runtime bindings.',
  },
])

export const ATLAS_AGENT_FAILURE_EVAL_CASES: readonly AtlasAgentFailureEvalCase[] = Object.freeze([
  { id: 'malformed-tool-input', expectedError: 'ACTION_VALIDATION_FAILED' },
  { id: 'unavailable-action', expectedError: 'ACTION_UNAVAILABLE' },
  { id: 'repeated-provider-failure', expectedError: 'PROVIDER_ERROR' },
  { id: 'maximum-steps', expectedError: 'MAXIMUM_STEPS' },
  { id: 'timeout', expectedError: 'TIMEOUT' },
  { id: 'cancellation', expectedError: 'ABORTED' },
  { id: 'stale-project-revision', expectedError: 'STALE_PROJECT_REVISION' },
  { id: 'approval-denial', expectedError: 'APPROVAL_DENIED' },
  { id: 'unsupported-decoder', expectedError: 'ACTION_EXECUTION_FAILED' },
  { id: 'unavailable-relay', expectedError: 'ACTION_UNAVAILABLE' },
  { id: 'tool-output-too-large', expectedError: 'TOOL_OUTPUT_TOO_LARGE' },
])

function step(actionId: GeoActionId, input: JsonValue, expectedOutput: string): AtlasAgentEvalStep {
  return { actionId, input, expectedOutput }
}
