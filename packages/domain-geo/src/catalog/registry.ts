import { KY_FROM_ABOVE_CATALOG, KY_FROM_ABOVE_DEFAULT_BBOX } from './ky-from-above.js'
import type { CatalogRegistryEntry, CatalogStory } from './types.js'

export const CATALOG_REGISTRY: readonly CatalogRegistryEntry[] = Object.freeze([
  KY_FROM_ABOVE_CATALOG,
])

export function catalogById(id: string): CatalogRegistryEntry | undefined {
  return CATALOG_REGISTRY.find((entry) => entry.id === id)
}

export const CATALOG_STORIES: readonly CatalogStory[] = Object.freeze([
  Object.freeze({
    id: 'kentucky-through-time',
    title: 'Kentucky Through Time',
    summary:
      'Search the same Frankfort-area tile across KyFromAbove leaf-off ortho phases and open one COG at a time.',
    catalogId: KY_FROM_ABOVE_CATALOG.id,
    collectionGroup: 'time-series-ortho',
    bbox: KY_FROM_ABOVE_DEFAULT_BBOX,
    style: { mapping: { red: 0, green: 1, blue: 2 }, stretch: 'minmax' as const },
  }),
  Object.freeze({
    id: 'natural-color-cir',
    title: 'Natural Color and Color Infrared',
    summary:
      'Open a 4-band leaf-off ortho, then switch the display mapping between natural color (RGB) and color infrared (NIR, R, G).',
    catalogId: KY_FROM_ABOVE_CATALOG.id,
    collectionGroup: 'leaf-off-ortho',
    bbox: KY_FROM_ABOVE_DEFAULT_BBOX,
    style: { mapping: { red: 0, green: 1, blue: 2 }, stretch: 'minmax' as const },
    presets: Object.freeze([
      Object.freeze({
        id: 'natural-color',
        label: 'Natural color',
        style: { mapping: { red: 0, green: 1, blue: 2 }, stretch: 'minmax' as const },
      }),
      Object.freeze({
        id: 'color-infrared',
        label: 'Color infrared',
        style: { mapping: { red: 3, green: 0, blue: 1 }, stretch: 'minmax' as const },
      }),
    ]),
  }),
  Object.freeze({
    id: 'terrain-lab',
    title: 'Terrain Lab',
    summary:
      'Open a LiDAR-derived DEM (bare-earth DTM). This catalog does not yet publish a paired DSM collection, so Atlas cannot composite DTM and DSM until that product exists.',
    catalogId: KY_FROM_ABOVE_CATALOG.id,
    collectionGroup: 'elevation-dtm',
    bbox: KY_FROM_ABOVE_DEFAULT_BBOX,
    note: 'KyFromAbove STAC currently lists DEM collections, not a surface-model (DSM) collection.',
    style: {
      mapping: { gray: 0 },
      stretch: 'percentile' as const,
      percentileLow: 2,
      percentileHigh: 98,
    },
  }),
  Object.freeze({
    id: 'cog-anatomy',
    title: 'COG Anatomy',
    summary:
      'Open a Cloud Optimized GeoTIFF and inspect IFDs, overviews, compression, affine/CRS, and Range telemetry in X-ray.',
    catalogId: KY_FROM_ABOVE_CATALOG.id,
    collectionGroup: 'leaf-off-ortho',
    bbox: KY_FROM_ABOVE_DEFAULT_BBOX,
    inspect: true,
  }),
])

export function storiesForCatalog(catalogId: string): readonly CatalogStory[] {
  return CATALOG_STORIES.filter((story) => story.catalogId === catalogId)
}
