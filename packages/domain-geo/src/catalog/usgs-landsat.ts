import type { StacBbox } from '../stac/types.js'
import type { CatalogRegistryEntry } from './types.js'

/**
 * Landsat Collection 2 Level-2 Surface Reflectance scale when STAC `raster:bands`
 * omits scale/offset: `DN * 0.0000275 - 0.2`. This is a Landsat interpreter only —
 * generic raster code must not apply it.
 */
export const LANDSAT_SR_SCALE = 0.000_027_5
export const LANDSAT_SR_OFFSET = -0.2

export const USGS_LANDSAT_CATALOG_ID = 'usgs-landsat' as const
export const USGS_LANDSAT_SR_COLLECTION_ID = 'landsat-c2l2-sr' as const
export const USGS_LANDSAT_ST_COLLECTION_ID = 'landsat-c2l2-st' as const

export const USGS_LANDSAT_DEFAULT_BBOX: StacBbox = [-84.8, 38.8, -84.0, 39.4]
export const USGS_LANDSAT_DEFAULT_DATETIME = '2025-06-01T00:00:00Z/2025-09-30T23:59:59Z'

export const USGS_LANDSAT_CATALOG: CatalogRegistryEntry = Object.freeze({
  id: USGS_LANDSAT_CATALOG_ID,
  title: 'USGS Landsat',
  description:
    'USGS LandsatLook STAC API. Collection 2 Level-2 Surface Reflectance is primary; Surface Temperature is optional. Each optical band is a separate Cloud Optimized GeoTIFF. HTTPS asset hrefs are preferred; s3:// requester-pays alternates stay metadata-only.',
  protocol: 'stac-api',
  endpoint: Object.freeze({
    kind: 'stac-api',
    rootHref: 'https://landsatlook.usgs.gov/stac-server/',
  }),
  homepage: 'https://landsatlook.usgs.gov/',
  attribution: 'U.S. Geological Survey, Landsat Collection 2',
  license: 'Unknown',
  cacheVersion: '2026-08-19',
  defaultBbox: USGS_LANDSAT_DEFAULT_BBOX,
  defaultDatetime: USGS_LANDSAT_DEFAULT_DATETIME,
  defaultSortby: '+properties.eo:cloud_cover',
  preferredAssetKeys: Object.freeze(['red', 'nir08', 'green', 'blue']),
  browserNote:
    'LandsatLook CORS allows only landsatlook.usgs.gov, not Atlas. Search from this origin fails until USGS allows geo.purejsimage.com.',
  collectionGroups: Object.freeze({
    'surface-reflectance': Object.freeze([USGS_LANDSAT_SR_COLLECTION_ID]),
    'surface-temperature': Object.freeze([USGS_LANDSAT_ST_COLLECTION_ID]),
  }),
})
