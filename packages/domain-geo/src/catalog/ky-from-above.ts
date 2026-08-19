import type { StacBbox } from '../stac/types.js'
import type { CatalogRegistryEntry } from './types.js'

/** Official KyFromAbove STAC API. Collection IDs stay in this registry entry only. */
export const KY_FROM_ABOVE_CATALOG_ID = 'ky-from-above' as const

export const KY_FROM_ABOVE_DEFAULT_BBOX: StacBbox = [-84.9, 38.16, -84.82, 38.22]

export const KY_FROM_ABOVE_CATALOG: CatalogRegistryEntry = Object.freeze({
  id: KY_FROM_ABOVE_CATALOG_ID,
  title: 'Kentucky From Above',
  description:
    'Leaf-off aerial orthos and LiDAR-derived elevation for Kentucky. Rasters are Cloud Optimized GeoTIFFs in EPSG:3089 (Kentucky Single Zone, US feet). CC-BY-4.0 from the Kentucky Division of Geographic Information.',
  protocol: 'stac-api',
  endpoint: Object.freeze({
    kind: 'stac-api',
    rootHref: 'https://spved5ihrl.execute-api.us-west-2.amazonaws.com/',
  }),
  homepage: 'https://kyfromabove.ky.gov/',
  attribution: 'Kentucky Division of Geographic Information, KyFromAbove',
  license: 'CC-BY-4.0',
  cacheVersion: '2026-08-19',
  defaultBbox: KY_FROM_ABOVE_DEFAULT_BBOX,
  crsDefinitions: [
    Object.freeze({
      key: 'EPSG:3089',
      proj4:
        '+proj=lcc +lat_1=37.08333333333334 +lat_2=38.66666666666666 +lat_0=36.33333333333334 +lon_0=-85.75 +x_0=1500000 +y_0=999999.9998983998 +ellps=GRS80 +datum=NAD83 +to_meter=0.3048006096012192 +no_defs',
    }),
  ],
  collectionGroups: Object.freeze({
    'time-series-ortho': Object.freeze(['orthos-phase1', 'orthos-phase2', 'orthos-phase3']),
    'leaf-off-ortho': Object.freeze(['orthos-phase2', 'orthos-phase3']),
    'elevation-dtm': Object.freeze(['dem-phase2', 'dem-phase3', 'dem-phase1']),
    'elevation-dsm': Object.freeze([]),
  }),
})
