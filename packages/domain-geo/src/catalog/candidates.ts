import { defaultRasterAsset, itemSelfHref, rasterAssets } from '../stac/assets.js'
import type { StacAsset, StacCollection, StacItem } from '../stac/types.js'
import type { CatalogRegistryEntry, CatalogSourceCandidate, CatalogStory } from './types.js'
import { providerName } from './types.js'

export function candidatesFromItem(
  entry: CatalogRegistryEntry,
  item: StacItem,
  options?: {
    readonly collection?: StacCollection
    readonly style?: CatalogStory['style']
  },
): readonly CatalogSourceCandidate[] {
  const collection = options?.collection
  const style = options?.style
  const collectionId = item.collection ?? collection?.id
  if (collectionId === undefined) return []
  const license = item.license ?? collection?.license ?? entry.license
  const provider =
    providerName(item.providers) ?? providerName(collection?.providers ?? []) ?? entry.title
  const sourceUrl = itemSelfHref(item)
  return rasterAssets(item).map((asset) =>
    candidateFromAsset(entry, item, collectionId, asset, {
      license,
      provider,
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
      ...(style === undefined ? {} : { style }),
    }),
  )
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
