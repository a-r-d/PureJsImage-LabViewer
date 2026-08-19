import { defaultRasterAsset, itemSelfHref, rasterAssets } from '../stac/assets.js'
import type { StacAsset, StacCollection, StacItem } from '../stac/types.js'
import type {
  CatalogRegistryEntry,
  CatalogSearchItem,
  CatalogSourceCandidate,
  CatalogStory,
} from './types.js'
import { providerName } from './types.js'

export function candidatesFromItem(
  entry: CatalogRegistryEntry,
  item: StacItem,
  options?: {
    readonly collection?: StacCollection
    readonly collectionId?: string
    readonly style?: CatalogStory['style']
  },
): readonly CatalogSourceCandidate[] {
  const collection = options?.collection
  const style = options?.style
  const collectionId = options?.collectionId ?? item.collection ?? collection?.id
  if (collectionId === undefined) return []
  const license = item.license ?? collection?.license ?? entry.license
  const provider =
    providerName(item.providers) ?? providerName(collection?.providers ?? []) ?? entry.title
  const sourceUrl = itemSelfHref(item)
  return rasterAssets(item).map((asset) =>
    candidateFromAsset(entry, item, collectionId, preferHttpsAsset(asset), {
      license,
      provider,
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
      ...(style === undefined ? {} : { style }),
    }),
  )
}

export function searchItemFromCandidates(
  item: Pick<StacItem, 'id' | 'datetime' | 'bbox'>,
  collectionId: string,
  candidates: readonly CatalogSourceCandidate[],
  title?: string,
): CatalogSearchItem {
  return {
    id: item.id,
    collectionId,
    ...(title === undefined ? {} : { title }),
    ...(item.datetime === undefined ? {} : { datetime: item.datetime }),
    ...(item.bbox === undefined ? {} : { bbox: item.bbox }),
    candidates,
  }
}

export function candidateFromAsset(
  entry: CatalogRegistryEntry,
  item: StacItem,
  collectionId: string,
  asset: StacAsset,
  extra: {
    readonly license?: string
    readonly provider?: string
    readonly sourceUrl?: string
    readonly style?: CatalogStory['style']
  },
): CatalogSourceCandidate {
  const bands = asset.eoBands.length > 0 ? asset.eoBands : item.eoBands
  const bandCount = bands.length > 0 ? bands.length : asset.rasterBands.length
  return {
    catalogId: entry.id,
    catalogTitle: entry.title,
    collectionId,
    itemId: item.id,
    assetKey: asset.key,
    href: asset.href,
    protocol: entry.protocol,
    label: asset.title ?? item.id,
    ...(item.datetime === undefined ? {} : { datetime: item.datetime }),
    ...(item.bbox === undefined ? {} : { bbox: item.bbox }),
    ...(asset.type === undefined ? {} : { mediaType: asset.type }),
    ...(bandCount === 0 ? {} : { bandCount }),
    ...(item.projEpsg === undefined ? {} : { projEpsg: item.projEpsg }),
    ...(extra.provider === undefined ? {} : { provider: extra.provider }),
    ...(extra.license === undefined ? {} : { license: extra.license }),
    attribution: entry.attribution,
    ...(extra.sourceUrl === undefined ? {} : { sourceUrl: extra.sourceUrl }),
    ...(extra.style === undefined ? {} : { style: extra.style }),
  }
}

export function preferredCandidate(
  candidates: readonly CatalogSourceCandidate[],
  item: StacItem,
  assetKey?: string,
): CatalogSourceCandidate | undefined {
  if (assetKey !== undefined) return candidates.find((candidate) => candidate.assetKey === assetKey)
  const preferred = defaultRasterAsset(item)
  if (preferred === undefined) return candidates[0]
  return candidates.find((candidate) => candidate.assetKey === preferred.key) ?? candidates[0]
}

export function preferredSearchCandidate(
  item: CatalogSearchItem,
  assetKey?: string,
  preferredAssetKeys?: readonly string[],
): CatalogSourceCandidate | undefined {
  if (assetKey !== undefined) {
    return item.candidates.find((candidate) => candidate.assetKey === assetKey)
  }
  if (preferredAssetKeys !== undefined) {
    for (const key of preferredAssetKeys) {
      const match = item.candidates.find((candidate) => candidate.assetKey === key)
      if (match !== undefined) return match
    }
  }
  return item.candidates[0]
}

/** Prefer an HTTPS alternate when the primary asset is s3://. Never invent an HTTPS URL. */
export function preferHttpsAsset(asset: StacAsset): StacAsset {
  if (asset.href.startsWith('https://') || asset.href.startsWith('http://')) return asset
  const https = asset.alternate.find(
    (entry) => entry.href.startsWith('https://') || entry.href.startsWith('http://'),
  )
  if (https === undefined) return asset
  return { ...asset, href: https.href }
}
