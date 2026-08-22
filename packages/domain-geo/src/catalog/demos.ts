import type { RasterStyle } from '../model.js'
import { KY_FROM_ABOVE_CATALOG_ID } from './ky-from-above.js'
import {
  NOAA_DIGITAL_COAST_CATALOG_ID,
  NOAA_PALM_COAST_COLLECTION_ID,
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

const PALM_COAST_STYLE: RasterStyle = Object.freeze({
  mapping: { red: 0, green: 1, blue: 2 },
  stretch: 'percentile' as const,
  percentileLow: 2,
  percentileHigh: 98,
  nodataTransparent: true,
})

/**
 * Pinned HTTPS catalog identities that open as Ready layers from Atlas.
 * Collection IDs stay in registry entries; these item IDs are curated demos.
 * Palm Coast uses a filled inland tile (`474000e3303000n`). The mosaic origin
 * cell `456000e3342000n` is ~99% zero-fill and renders as a white sliver.
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
    id: 'noaa-palm-coast-rgbn',
    title: 'Palm Coast aerial',
    summary:
      'NOAA Digital Coast 4-band RGBN over Palm Coast, Florida. Natural color on samples 0,1,2 with a 2–98 percentile stretch. This item is a filled 25 cm tile, not the empty origin cell of the mosaic. Band 4 is gray, not NIR, so color infrared is not offered.',
    catalogTitle: 'NOAA Digital Coast',
    identity: Object.freeze({
      catalogId: NOAA_DIGITAL_COAST_CATALOG_ID,
      collectionId: NOAA_PALM_COAST_COLLECTION_ID,
      itemId: '474000e3303000n',
      assetKey: '474000e3303000n',
    }),
    style: PALM_COAST_STYLE,
    presets: Object.freeze([
      Object.freeze({
        id: 'natural-color',
        label: 'Natural color',
        style: PALM_COAST_STYLE,
      }),
    ]),
  }),
])

export function curatedPresetsForIdentity(
  identity: CatalogAssetIdentity,
): readonly CatalogDisplayPreset[] | undefined {
  return ATLAS_START_DEMOS.find(
    (demo) =>
      demo.identity.catalogId === identity.catalogId &&
      demo.identity.collectionId === identity.collectionId &&
      demo.identity.itemId === identity.itemId &&
      demo.identity.assetKey === identity.assetKey,
  )?.presets
}
