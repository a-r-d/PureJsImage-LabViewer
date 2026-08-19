import type { StacBbox } from '../stac/types.js'
import type { CatalogRegistryEntry } from './types.js'

export const USGS_3DEP_CATALOG_ID = 'usgs-3dep' as const

export const USGS_3DEP_NED_13 = 'National Elevation Dataset (NED) 1/3 arc-second'
export const USGS_3DEP_NED_1 = 'National Elevation Dataset (NED) 1 arc-second'
export const USGS_3DEP_DEM_1M = 'Digital Elevation Model (DEM) 1 meter'
export const USGS_3DEP_SEAMLESS_1M = 'Seamless 1-m DEM (S1M)'

/** Cincinnati / northern Kentucky AOI used by the National Terrain story. */
export const USGS_3DEP_CINCINNATI_BBOX: StacBbox = [-84.6, 39.05, -84.4, 39.2]

export const USGS_3DEP_CATALOG: CatalogRegistryEntry = Object.freeze({
  id: USGS_3DEP_CATALOG_ID,
  title: 'USGS 3DEP',
  description:
    'USGS 3D Elevation Program seamless DEMs through The National Map TNMAccess API (not STAC). Atlas lists GeoTIFF downloads only. Identity uses the dataset tag, ScienceBase product id, and asset key geotiff.',
  protocol: 'tnm-access',
  endpoint: Object.freeze({
    kind: 'tnm-access',
    productsHref: 'https://tnmaccess.nationalmap.gov/api/v1/products',
    datasetsHref: 'https://tnmaccess.nationalmap.gov/api/v1/datasets',
    datasetTags: Object.freeze([
      USGS_3DEP_NED_13,
      USGS_3DEP_NED_1,
      USGS_3DEP_DEM_1M,
      USGS_3DEP_SEAMLESS_1M,
    ]),
  }),
  homepage: 'https://www.usgs.gov/3d-elevation-program',
  attribution: 'U.S. Geological Survey, 3D Elevation Program',
  license: 'USGS-PD',
  cacheVersion: '2026-08-19',
  defaultBbox: USGS_3DEP_CINCINNATI_BBOX,
  collectionGroups: Object.freeze({
    'ned-13': Object.freeze([USGS_3DEP_NED_13]),
    'ned-1': Object.freeze([USGS_3DEP_NED_1]),
    'dem-1m': Object.freeze([USGS_3DEP_DEM_1M]),
    'seamless-1m': Object.freeze([USGS_3DEP_SEAMLESS_1M]),
  }),
})
