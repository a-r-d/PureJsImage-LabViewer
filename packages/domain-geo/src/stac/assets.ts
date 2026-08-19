import type { StacAsset, StacItem } from './types.js'

const TIFF_TYPE = /tiff|geotiff|cog/iu
const RASTER_ROLES = new Set(['data', 'visual', 'overview', 'analytic'])
const SKIP_ROLES = new Set(['thumbnail', 'metadata', 'index', 'external'])

export function rasterAssets(item: StacItem): readonly StacAsset[] {
  return item.assets.filter(isRasterAsset)
}

export function isRasterAsset(asset: StacAsset): boolean {
  if (asset.roles.some((role) => SKIP_ROLES.has(role))) return false
  if (asset.type !== undefined && TIFF_TYPE.test(asset.type)) return true
  if (asset.roles.some((role) => RASTER_ROLES.has(role)) && looksLikeTiffHref(asset.href))
    return true
  return looksLikeTiffHref(asset.href) && asset.roles.includes('data')
}

export function defaultRasterAsset(item: StacItem): StacAsset | undefined {
  const rasters = rasterAssets(item)
  return rasters.find((asset) => asset.key === 'data') ?? rasters[0]
}

export function looksLikeTiffHref(href: string): boolean {
  const path = href.split('?')[0]?.toLowerCase() ?? ''
  return path.endsWith('.tif') || path.endsWith('.tiff') || path.endsWith('.cog')
}

export function itemSelfHref(item: StacItem): string | undefined {
  return item.links.find((link) => link.rel === 'self')?.href
}
