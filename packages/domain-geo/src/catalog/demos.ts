import type { RasterStyle } from '../model.js'
import { KY_FROM_ABOVE_CATALOG_ID } from './ky-from-above.js'
import {
  NOAA_DIGITAL_COAST_CATALOG_ID,
  NOAA_PUERTO_RICO_COLLECTION_ID,
} from './noaa-digital-coast.js'
import type { CatalogAssetIdentity, CatalogDisplayPreset } from './types.js'

export interface AtlasStartDemo {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly catalogTitle: string
  readonly identity: CatalogAssetIdentity
  readonly style: RasterStyle
  readonly inspect?: boolean
  readonly presets?: readonly CatalogDisplayPreset[]
}

const KENTUCKY_ORTHO_STYLE: RasterStyle = Object.freeze({
  mapping: { red: 0, green: 1, blue: 2 },
  stretch: 'minmax' as const,
})

const NOAA_TERRAIN_STYLE: RasterStyle = Object.freeze({
  mapping: { gray: 0 },
  stretch: 'percentile' as const,
  percentileLow: 2,
  percentileHigh: 98,
  nodataTransparent: true,
})

/**
 * Pinned HTTPS catalog identities that open as Ready layers from Atlas.
 * Collection IDs stay in registry entries; these item IDs are curated demos.
 */
export const ATLAS_START_DEMOS: readonly AtlasStartDemo[] = Object.freeze([
  Object.freeze({
    id: 'kentucky-frankfort-ortho',
    title: 'Kentucky leaf-off ortho',
    summary:
      'Frankfort-area 6-inch natural-color aerial COG. RGB 0,1,2 with min/max stretch. Switch to color infrared after it opens.',
    catalogTitle: 'Kentucky From Above',
    identity: Object.freeze({
      catalogId: KY_FROM_ABOVE_CATALOG_ID,
      collectionId: 'orthos-phase2',
      itemId: 'N082E280_2019_6IN_cog.tif',
      assetKey: 'data',
    }),
    style: KENTUCKY_ORTHO_STYLE,
    presets: Object.freeze([
      Object.freeze({
        id: 'natural-color',
        label: 'Natural color',
        style: KENTUCKY_ORTHO_STYLE,
      }),
      Object.freeze({
        id: 'color-infrared',
        label: 'Color infrared',
        style: Object.freeze({
          mapping: { red: 3, green: 0, blue: 1 },
          stretch: 'minmax' as const,
        }),
      }),
    ]),
  }),
  Object.freeze({
    id: 'noaa-puerto-rico-cudem',
    title: 'NOAA Puerto Rico terrain',
    summary:
      'CUDEM 1/3 arc-second topobathy over eastern Puerto Rico. Grayscale 2–98 percentile stretch with nodata transparent.',
    catalogTitle: 'NOAA Digital Coast',
    identity: Object.freeze({
      catalogId: NOAA_DIGITAL_COAST_CATALOG_ID,
      collectionId: NOAA_PUERTO_RICO_COLLECTION_ID,
      itemId: 'ncei13_n17x75_w065x75_2022v1',
      assetKey: 'ncei13_n17x75_w065x75_2022v1',
    }),
    style: NOAA_TERRAIN_STYLE,
  }),
])
