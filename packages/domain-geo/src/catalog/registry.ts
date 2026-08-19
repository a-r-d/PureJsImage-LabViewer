import { KY_FROM_ABOVE_CATALOG, KY_FROM_ABOVE_DEFAULT_BBOX } from './ky-from-above.js'
import {
  NOAA_DIGITAL_COAST_CATALOG,
  NOAA_PALM_COAST_BBOX,
  NOAA_PUERTO_RICO_BBOX,
} from './noaa-digital-coast.js'
import type { CatalogRegistryEntry, CatalogStory } from './types.js'
import { USGS_3DEP_CATALOG, USGS_3DEP_CINCINNATI_BBOX } from './usgs-3dep.js'
import {
  USGS_LANDSAT_CATALOG,
  USGS_LANDSAT_DEFAULT_BBOX,
  USGS_LANDSAT_DEFAULT_DATETIME,
} from './usgs-landsat.js'

export const CATALOG_REGISTRY: readonly CatalogRegistryEntry[] = Object.freeze([
  NOAA_DIGITAL_COAST_CATALOG,
  USGS_3DEP_CATALOG,
  USGS_LANDSAT_CATALOG,
  KY_FROM_ABOVE_CATALOG,
])

export function catalogById(id: string): CatalogRegistryEntry | undefined {
  return CATALOG_REGISTRY.find((entry) => entry.id === id)
}

export const CATALOG_STORIES: readonly CatalogStory[] = Object.freeze([
  Object.freeze({
    id: 'noaa-puerto-rico-terrain',
    title: 'NOAA Puerto Rico Terrain',
    summary:
      'Open a NOAA CUDEM 1/3 arc-second topobathy tile over eastern Puerto Rico and inspect it as grayscale with a 2–98 percentile stretch.',
    catalogId: NOAA_DIGITAL_COAST_CATALOG.id,
    collectionGroup: 'puerto-rico-terrain',
    bbox: NOAA_PUERTO_RICO_BBOX,
    inspect: true,
    style: {
      mapping: { gray: 0 },
      stretch: 'percentile' as const,
      percentileLow: 2,
      percentileHigh: 98,
    },
  }),
  Object.freeze({
    id: 'noaa-palm-coast-color',
    title: 'Palm Coast 4-band',
    summary:
      'Open NOAA NGS Palm Coast 4-band imagery as natural color (STAC eo:bands red/green/blue). CIR is not offered: live metadata labels band 4 gray, not NIR.',
    catalogId: NOAA_DIGITAL_COAST_CATALOG.id,
    collectionGroup: 'palm-coast-imagery',
    bbox: NOAA_PALM_COAST_BBOX,
    style: { mapping: { red: 0, green: 1, blue: 2 }, stretch: 'minmax' as const },
  }),
  Object.freeze({
    id: 'usgs-national-terrain',
    title: 'USGS National Terrain',
    summary:
      'Search USGS 3DEP 1/3 arc-second DEM GeoTIFFs over Cincinnati through TNMAccess. Atlas does not hard-code a product URL.',
    catalogId: USGS_3DEP_CATALOG.id,
    collectionGroup: 'ned-13',
    bbox: USGS_3DEP_CINCINNATI_BBOX,
    style: {
      mapping: { gray: 0 },
      stretch: 'percentile' as const,
      percentileLow: 2,
      percentileHigh: 98,
    },
  }),
  Object.freeze({
    id: 'usgs-landsat-cincinnati',
    title: 'USGS Landsat Cincinnati',
    summary:
      'Search Landsat Collection 2 surface reflectance over Cincinnati, prefer low cloud cover, and open the HTTPS red (SR_B4) Cloud Optimized GeoTIFF.',
    catalogId: USGS_LANDSAT_CATALOG.id,
    collectionGroup: 'surface-reflectance',
    bbox: USGS_LANDSAT_DEFAULT_BBOX,
    datetime: USGS_LANDSAT_DEFAULT_DATETIME,
    style: {
      mapping: { gray: 0 },
      stretch: 'percentile' as const,
      percentileLow: 2,
      percentileHigh: 98,
    },
  }),
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
