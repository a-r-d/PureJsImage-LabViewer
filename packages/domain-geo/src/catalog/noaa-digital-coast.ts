import type { StacBbox } from '../stac/types.js'
import type { CatalogRegistryEntry } from './types.js'

export const NOAA_DIGITAL_COAST_CATALOG_ID = 'noaa-digital-coast' as const

export const NOAA_PUERTO_RICO_COLLECTION_ID = 'noaa-cudem-pr-9524' as const
export const NOAA_PALM_COAST_COLLECTION_ID = 'noaa-rgbn-palm-coast-10213' as const
export const NOAA_WI_NAIP_COLLECTION_ID = 'noaa-naip-wisconsin-9158' as const

export const NOAA_PUERTO_RICO_BBOX: StacBbox = [-67.3, 17.45, -65.45, 18.55]
export const NOAA_PALM_COAST_BBOX: StacBbox = [-81.46, 29.52, -81.12, 30.22]
export const NOAA_WISCONSIN_BBOX: StacBbox = [-92.9, 42.5, -86.8, 47.1]

const NOAA_DEM_ROOT =
  'https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/NCEI_third_Topobathy_PuertoRico_9524/'
const NOAA_PALM_ROOT =
  'https://coastalimagery.blob.core.windows.net/digitalcoast/PalmCoastFL_RGBN_2024_10213/'
const NOAA_WI_ROOT = 'https://coastalimagery.blob.core.windows.net/digitalcoast/WI_NAIP_2018_9158/'

export const NOAA_DIGITAL_COAST_CATALOG: CatalogRegistryEntry = Object.freeze({
  id: NOAA_DIGITAL_COAST_CATALOG_ID,
  title: 'NOAA Digital Coast',
  description:
    'Curated NOAA Office for Coastal Management static STAC collections: Puerto Rico CUDEM terrain, Palm Coast 4-band imagery, and Wisconsin NAIP as a browse-budget stress collection. Atlas never crawls the global DEM/imagery indexes.',
  protocol: 'static-stac',
  endpoint: Object.freeze({
    kind: 'static-stac',
    rootHref: 'https://coast.noaa.gov/digitalcoast/',
    collections: Object.freeze([
      Object.freeze({
        id: NOAA_PUERTO_RICO_COLLECTION_ID,
        title: 'Puerto Rico CUDEM 1/3 arc-second (9524)',
        catalogHref: `${NOAA_DEM_ROOT}stac/catalog.json`,
        collectionHref: `${NOAA_DEM_ROOT}stac/noaa_dem_collection_m9524.json`,
        itemCollectionHref: `${NOAA_DEM_ROOT}stac/noaa_dem_item_collection_m9524.json`,
        itemDocumentBaseHref: `${NOAA_DEM_ROOT}stac/`,
        defaultBbox: NOAA_PUERTO_RICO_BBOX,
      }),
      Object.freeze({
        id: NOAA_PALM_COAST_COLLECTION_ID,
        title: 'Palm Coast FL 4-band RGBN (10213)',
        catalogHref: `${NOAA_PALM_ROOT}stac/catalog.json`,
        collectionHref: `${NOAA_PALM_ROOT}stac/noaa_imagery_collection_m10213.json`,
        itemCollectionHref: `${NOAA_PALM_ROOT}stac/noaa_imagery_item_collection_m10213.json`,
        itemDocumentBaseHref: `${NOAA_PALM_ROOT}stac/`,
        defaultBbox: NOAA_PALM_COAST_BBOX,
        // Live STAC eo:bands for dataset 10213 name b1–b5 red/green/blue/gray/alpha, not NIR.
        // CIR is not offered. See https://coast.noaa.gov/dataviewer/#/imagery/search/where:ID=10213
      }),
      Object.freeze({
        id: NOAA_WI_NAIP_COLLECTION_ID,
        title: 'Wisconsin NAIP 2018 (9158)',
        catalogHref: `${NOAA_WI_ROOT}stac/catalog.json`,
        collectionHref: `${NOAA_WI_ROOT}stac/noaa_imagery_collection_m9158.json`,
        itemCollectionHref: `${NOAA_WI_ROOT}stac/noaa_imagery_item_collection_m9158.json`,
        itemDocumentBaseHref: `${NOAA_WI_ROOT}stac/`,
        defaultBbox: NOAA_WISCONSIN_BBOX,
        maxItemCollectionBytes: 512 * 1024,
      }),
    ]),
  }),
  homepage: 'https://coast.noaa.gov/digitalcoast/',
  attribution: 'NOAA Office for Coastal Management, Digital Coast',
  license: 'NLPL',
  cacheVersion: '2026-08-19',
  defaultBbox: NOAA_PUERTO_RICO_BBOX,
  collectionGroups: Object.freeze({
    'puerto-rico-terrain': Object.freeze([NOAA_PUERTO_RICO_COLLECTION_ID]),
    'palm-coast-imagery': Object.freeze([NOAA_PALM_COAST_COLLECTION_ID]),
    'wisconsin-naip': Object.freeze([NOAA_WI_NAIP_COLLECTION_ID]),
  }),
})
