import type { AtlasDeepLink, CatalogAssetIdentity } from './types.js'
import { ATLAS_DEEP_LINK_SCHEMA_VERSION } from './types.js'

const KEYS = ['catalog', 'collection', 'item', 'asset', 'href', 'source', 'inspect'] as const

export function serializeAtlasDeepLink(
  link: CatalogAssetIdentity & { readonly inspect?: boolean },
): string {
  const params = new URLSearchParams()
  params.set('v', String(ATLAS_DEEP_LINK_SCHEMA_VERSION))
  params.set('catalog', link.catalogId)
  params.set('collection', link.collectionId)
  params.set('item', link.itemId)
  params.set('asset', link.assetKey)
  if (safeHttpsUrl(link.href)) params.set('href', link.href)
  if (safeHttpsUrl(link.sourceUrl)) params.set('source', link.sourceUrl)
  if (link.inspect === true) params.set('inspect', '1')
  return `#${params.toString()}`
}

export function parseAtlasDeepLink(hash: string): AtlasDeepLink | undefined {
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash
  if (trimmed.length === 0) return undefined
  const params = new URLSearchParams(trimmed)
  const version = params.get('v')
  if (version !== null && version !== String(ATLAS_DEEP_LINK_SCHEMA_VERSION)) return undefined
  const catalogId = params.get('catalog')
  const collectionId = params.get('collection')
  const itemId = params.get('item')
  const assetKey = params.get('asset')
  const href = params.get('href')
  const sourceUrl = params.get('source')
  if (
    catalogId === null ||
    collectionId === null ||
    itemId === null ||
    assetKey === null ||
    catalogId.length === 0 ||
    collectionId.length === 0 ||
    itemId.length === 0 ||
    assetKey.length === 0
  ) {
    return undefined
  }
  for (const key of params.keys()) {
    if (key !== 'v' && !KEYS.includes(key as (typeof KEYS)[number])) return undefined
  }
  return {
    schemaVersion: ATLAS_DEEP_LINK_SCHEMA_VERSION,
    catalogId,
    collectionId,
    itemId,
    assetKey,
    ...(safeHttpsUrl(href) ? { href } : {}),
    ...(safeHttpsUrl(sourceUrl) ? { sourceUrl } : {}),
    ...(params.get('inspect') === '1' ? { inspect: true } : {}),
  }
}

function safeHttpsUrl(value: string | null | undefined): value is string {
  if (value === null || value === undefined || value.length === 0 || value.length > 8_192)
    return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
