import type {
  ActionCost,
  ActionDefinition,
  ActionMutability,
  JsonSchema,
  WorkbenchActionDescriptorV1,
} from '@pji-workbench/actions'

export type GeoActionId =
  | 'geo.catalog.list'
  | 'geo.catalog.list_collections'
  | 'geo.catalog.search'
  | 'geo.catalog.follow'
  | 'geo.catalog.inspect_item'
  | 'geo.catalog.inspect_asset'
  | 'geo.source.open_catalog_asset'
  | 'geo.source.open_remote'
  | 'geo.source.open_local_resource'
  | 'geo.source.list'
  | 'geo.source.describe'
  | 'geo.source.close'
  | 'geo.source.retry'
  | 'geo.source.rebind_local'
  | 'geo.layer.list'
  | 'geo.layer.add'
  | 'geo.layer.remove'
  | 'geo.layer.duplicate'
  | 'geo.layer.select'
  | 'geo.layer.set_visibility'
  | 'geo.layer.set_opacity'
  | 'geo.layer.set_order'
  | 'geo.layer.set_style'
  | 'geo.layer.fit'
  | 'geo.comparison.read'
  | 'geo.comparison.set_single'
  | 'geo.comparison.set_overlay'
  | 'geo.comparison.set_swipe'
  | 'geo.comparison.set_blink'
  | 'geo.viewport.read'
  | 'geo.viewport.fit_source'
  | 'geo.viewport.fit_layer'
  | 'geo.viewport.fit_bounds'
  | 'geo.viewport.propose'
  | 'geo.raster.sample_point'
  | 'geo.raster.describe_bands'
  | 'geo.raster.describe_statistics'
  | 'geo.analysis.describe'
  | 'geo.analysis.dry_run'
  | 'geo.analysis.band_math'
  | 'geo.analysis.normalized_difference'
  | 'geo.analysis.virtual_band_stack'
  | 'geo.analysis.hillshade'
  | 'geo.analysis.slope'
  | 'geo.analysis.aspect'
  | 'geo.analysis.raster_difference'
  | 'geo.analysis.region_statistics'
  | 'geo.analysis.line_profile'
  | 'geo.analysis.cancel'
  | 'geo.analysis.release'
  | 'geo.derived_layer.remove'

export interface GeoActionContext {
  readonly hasSource: boolean
  readonly hasSelection: boolean
  readonly sourceCount: number
  readonly sourceLimit: number
  readonly hasLocalResources: boolean
  readonly comparisonEnabled: boolean
  readonly viewportAvailable: boolean
}

const EMPTY = { type: 'object', additionalProperties: false } as const
const OBJECT = { type: 'object' } as const
const ARRAY = { type: 'array', maxItems: 128 } as const
const ID = { type: 'string', minLength: 1, maxLength: 256 } as const
const URL = { type: 'string', minLength: 8, maxLength: 4_096 } as const

function objectInput(
  properties: Readonly<Record<string, JsonSchema>>,
  required: readonly string[] = [],
): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

function descriptor(
  id: GeoActionId,
  title: string,
  category: string,
  options: {
    readonly input?: JsonSchema
    readonly output?: JsonSchema
    readonly mutability?: ActionMutability
    readonly cost?: ActionCost
    readonly permissions?: readonly string[]
    readonly cancellable?: boolean
  } = {},
): WorkbenchActionDescriptorV1 {
  return {
    schemaVersion: 1,
    id,
    version: 1,
    title,
    description: `${title} through the Atlas semantic action host.`,
    category,
    inputSchema: options.input ?? EMPTY,
    outputSchema: options.output ?? OBJECT,
    mutability: options.mutability ?? 'read',
    cost: options.cost ?? 'trivial',
    permissions: options.permissions ?? ['workspace.read'],
    cancellable: options.cancellable ?? false,
  }
}

const requiresSource = (context: GeoActionContext) =>
  context.hasSource ? { available: true } : { available: false, reason: 'Open a source first.' }
const requiresSelection = (context: GeoActionContext) =>
  context.hasSelection ? { available: true } : { available: false, reason: 'Select a layer first.' }
const requiresCapacity = (context: GeoActionContext) =>
  context.sourceCount < context.sourceLimit
    ? { available: true }
    : {
        available: false,
        reason: `Close a source before opening another (${context.sourceLimit} maximum).`,
      }
const requiresLocalResource = (context: GeoActionContext) =>
  context.hasLocalResources
    ? requiresCapacity(context)
    : { available: false, reason: 'Choose a local file first.' }
const requiresComparison = (context: GeoActionContext) =>
  context.comparisonEnabled
    ? requiresSource(context)
    : { available: false, reason: 'Comparison rendering is not available in this Atlas build.' }
const requiresViewport = (context: GeoActionContext) =>
  context.viewportAvailable
    ? requiresSource(context)
    : { available: false, reason: 'The viewport is not mounted.' }
const requiresRasterSampling = () => ({
  available: false,
  reason: 'Point sampling requires the mounted viewport tile cache.',
})
const requiresRasterStatistics = () => ({
  available: false,
  reason: 'Statistics are not implemented for Atlas yet.',
})

const DERIVED_RECIPE = objectInput({ recipe: OBJECT, label: ID }, ['recipe'])

const analysisMutation = (id: GeoActionId, title: string): ActionDefinition<GeoActionContext> => ({
  descriptor: descriptor(id, title, 'analysis', {
    input: DERIVED_RECIPE,
    mutability: 'mutation',
    cost: 'expensive',
    permissions: ['workspace.propose', 'source.read-pixels'],
    cancellable: true,
  }),
  availability: requiresSource,
})

const catalogRead = (
  id: GeoActionId,
  title: string,
  input: JsonSchema = EMPTY,
): ActionDefinition<GeoActionContext> => ({
  descriptor: descriptor(id, title, 'catalog', {
    input,
    output: id === 'geo.catalog.list' || id === 'geo.catalog.list_collections' ? ARRAY : OBJECT,
    cost: 'external',
    permissions: ['network.explicit-hosts'],
    cancellable: true,
  }),
})

const sourceMutation = (
  id: GeoActionId,
  title: string,
  input: JsonSchema,
  availability: (context: GeoActionContext) => {
    readonly available: boolean
    readonly reason?: string
  },
): ActionDefinition<GeoActionContext> => ({
  descriptor: descriptor(id, title, 'source', {
    input,
    mutability: 'mutation',
    cost: id === 'geo.source.close' ? 'interactive' : 'external',
    permissions: id === 'geo.source.close' ? ['workspace.propose'] : ['source.read-metadata'],
    cancellable: id !== 'geo.source.close',
  }),
  availability,
})

export const geoActionDefinitions: readonly ActionDefinition<GeoActionContext>[] = Object.freeze([
  catalogRead('geo.catalog.list', 'List catalogs'),
  catalogRead(
    'geo.catalog.list_collections',
    'List catalog collections',
    objectInput({ catalogId: ID }, ['catalogId']),
  ),
  catalogRead('geo.catalog.search', 'Search catalog', OBJECT),
  catalogRead('geo.catalog.follow', 'Follow catalog page', OBJECT),
  catalogRead('geo.catalog.inspect_item', 'Inspect catalog item', OBJECT),
  catalogRead('geo.catalog.inspect_asset', 'Inspect catalog asset', OBJECT),
  sourceMutation('geo.source.open_catalog_asset', 'Open catalog asset', OBJECT, requiresCapacity),
  sourceMutation(
    'geo.source.open_remote',
    'Open remote raster',
    objectInput({ url: URL, label: ID }, ['url']),
    requiresCapacity,
  ),
  sourceMutation(
    'geo.source.open_local_resource',
    'Open local resource',
    objectInput({ resourceId: ID }, ['resourceId']),
    requiresLocalResource,
  ),
  { descriptor: descriptor('geo.source.list', 'List sources', 'source', { output: ARRAY }) },
  {
    descriptor: descriptor('geo.source.describe', 'Describe source', 'source', {
      input: objectInput({ sourceId: ID }, ['sourceId']),
    }),
    availability: requiresSource,
  },
  sourceMutation(
    'geo.source.close',
    'Close source',
    objectInput({ sourceId: ID, dependentLayers: { type: 'string', enum: ['refuse', 'remove'] } }, [
      'sourceId',
    ]),
    requiresSource,
  ),
  sourceMutation(
    'geo.source.retry',
    'Retry source',
    objectInput({ sourceId: ID }, ['sourceId']),
    requiresSource,
  ),
  sourceMutation(
    'geo.source.rebind_local',
    'Rebind local source',
    objectInput({ sourceId: ID, resourceId: ID }, ['sourceId', 'resourceId']),
    requiresLocalResource,
  ),
  {
    descriptor: descriptor('geo.layer.list', 'List layers', 'layer', { output: ARRAY }),
    availability: requiresSource,
  },
  {
    descriptor: descriptor('geo.layer.add', 'Add layer', 'layer', {
      input: OBJECT,
      mutability: 'mutation',
      permissions: ['workspace.propose'],
    }),
    availability: requiresSource,
  },
  ...(['remove', 'duplicate', 'select'] as const).map((name) => ({
    descriptor: descriptor(
      `geo.layer.${name}`,
      `${name[0]?.toUpperCase() ?? ''}${name.slice(1)} layer`,
      'layer',
      {
        input: objectInput({ layerId: ID }, ['layerId']),
        mutability: 'mutation',
        permissions: ['workspace.propose'],
      },
    ),
    availability: requiresSelection,
  })),
  {
    descriptor: descriptor('geo.layer.set_visibility', 'Set layer visibility', 'layer', {
      input: objectInput({ layerId: ID, visible: { type: 'boolean' } }, ['layerId', 'visible']),
      mutability: 'mutation',
      permissions: ['workspace.propose'],
    }),
    availability: requiresSelection,
  },
  {
    descriptor: descriptor('geo.layer.set_opacity', 'Set layer opacity', 'layer', {
      input: objectInput({ layerId: ID, opacity: { type: 'number', minimum: 0, maximum: 1 } }, [
        'layerId',
        'opacity',
      ]),
      mutability: 'mutation',
      permissions: ['workspace.propose'],
    }),
    availability: requiresSelection,
  },
  {
    descriptor: descriptor('geo.layer.set_order', 'Set layer order', 'layer', {
      input: objectInput({ layerId: ID, direction: { type: 'integer', minimum: -1, maximum: 1 } }, [
        'layerId',
        'direction',
      ]),
      mutability: 'mutation',
      permissions: ['workspace.propose'],
    }),
    availability: requiresSelection,
  },
  {
    descriptor: descriptor('geo.layer.set_style', 'Set raster style', 'layer', {
      input: OBJECT,
      mutability: 'mutation',
      permissions: ['workspace.propose'],
    }),
    availability: requiresSelection,
  },
  {
    descriptor: descriptor('geo.layer.fit', 'Fit layer', 'layer', {
      input: objectInput({ layerId: ID }, ['layerId']),
      mutability: 'proposal',
      permissions: ['viewport.propose'],
    }),
    availability: requiresViewport,
  },
  {
    descriptor: descriptor('geo.comparison.read', 'Read comparison mode', 'comparison'),
    availability: requiresSource,
  },
  ...(['set_single', 'set_overlay', 'set_swipe', 'set_blink'] as const).map((name) => ({
    descriptor: descriptor(
      `geo.comparison.${name}`,
      `Set ${name.slice(4)} comparison`,
      'comparison',
      {
        input: OBJECT,
        mutability: 'mutation',
        permissions: ['workspace.propose'],
      },
    ),
    availability: requiresComparison,
  })),
  {
    descriptor: descriptor('geo.viewport.read', 'Read viewport', 'viewport'),
    availability: requiresViewport,
  },
  ...(['fit_source', 'fit_layer', 'fit_bounds', 'propose'] as const).map((name) => ({
    descriptor: descriptor(
      `geo.viewport.${name}`,
      `${name.replace('_', ' ')} viewport`,
      'viewport',
      {
        input: OBJECT,
        mutability: 'proposal',
        permissions: ['viewport.propose'],
      },
    ),
    availability: requiresViewport,
  })),
  {
    descriptor: descriptor('geo.raster.sample_point', 'Sample raster point', 'raster', {
      input: OBJECT,
      cost: 'interactive',
    }),
    availability: requiresRasterSampling,
  },
  {
    descriptor: descriptor('geo.raster.describe_bands', 'Describe raster bands', 'raster', {
      input: OBJECT,
      output: ARRAY,
    }),
    availability: requiresSelection,
  },
  {
    descriptor: descriptor(
      'geo.raster.describe_statistics',
      'Describe raster statistics',
      'raster',
      {
        input: OBJECT,
        cost: 'expensive',
        cancellable: true,
      },
    ),
    availability: requiresRasterStatistics,
  },
  {
    descriptor: descriptor(
      'geo.analysis.describe',
      'Describe derived raster analysis',
      'analysis',
      {
        input: objectInput({ layerId: ID }, ['layerId']),
        cost: 'interactive',
      },
    ),
    availability: requiresSource,
  },
  {
    descriptor: descriptor('geo.analysis.dry_run', 'Plan derived raster analysis', 'analysis', {
      input: objectInput({ recipe: OBJECT }, ['recipe']),
      cost: 'interactive',
      permissions: ['source.read-metadata'],
      cancellable: true,
    }),
    availability: requiresSource,
  },
  analysisMutation('geo.analysis.band_math', 'Create band-math layer'),
  analysisMutation('geo.analysis.normalized_difference', 'Create normalized-difference layer'),
  analysisMutation('geo.analysis.virtual_band_stack', 'Create virtual band stack'),
  analysisMutation('geo.analysis.hillshade', 'Create hillshade layer'),
  analysisMutation('geo.analysis.slope', 'Create slope layer'),
  analysisMutation('geo.analysis.aspect', 'Create aspect layer'),
  analysisMutation('geo.analysis.raster_difference', 'Create raster-difference layer'),
  {
    descriptor: descriptor('geo.analysis.region_statistics', 'Analyze raster region', 'analysis', {
      input: OBJECT,
      cost: 'expensive',
      permissions: ['source.read-pixels'],
      cancellable: true,
    }),
    availability: requiresSource,
  },
  {
    descriptor: descriptor('geo.analysis.line_profile', 'Sample raster line profile', 'analysis', {
      input: OBJECT,
      cost: 'expensive',
      permissions: ['source.read-pixels'],
      cancellable: true,
    }),
    availability: requiresSource,
  },
  ...(['cancel', 'release'] as const).map((name) => ({
    descriptor: descriptor(
      `geo.analysis.${name}`,
      `${name[0]?.toUpperCase() ?? ''}${name.slice(1)} derived analysis`,
      'analysis',
      {
        input: objectInput({ layerId: ID }, ['layerId']),
        mutability: 'mutation',
        cost: 'interactive',
        permissions: ['workspace.propose'],
      },
    ),
    availability: requiresSource,
  })),
  {
    descriptor: descriptor('geo.derived_layer.remove', 'Remove derived layer', 'analysis', {
      input: objectInput({ layerId: ID }, ['layerId']),
      mutability: 'mutation',
      cost: 'interactive',
      permissions: ['workspace.propose'],
    }),
    availability: requiresSource,
  },
])
