import type { GeoCatalogReference, RasterStyle } from '../model.js'
import type { StacBbox, StacEoBand, StacProvider } from '../stac/types.js'

export const CATALOG_REGISTRY_SCHEMA_VERSION = 2 as const
export const ATLAS_SESSION_SCHEMA_VERSION = 1 as const
export const ATLAS_DEEP_LINK_SCHEMA_VERSION = 1 as const

export type CatalogProtocol = 'stac-api' | 'static-stac' | 'tnm-access'

export interface CatalogCrsDefinition {
  readonly key: string
  readonly proj4: string
}

export interface StaticStacCollectionConfig {
  readonly id: string
  readonly title: string
  readonly catalogHref: string
  readonly collectionHref: string
  readonly itemCollectionHref: string
  /** Directory of per-item JSON documents, used for deep links without loading the item collection. */
  readonly itemDocumentBaseHref?: string
  readonly maxItemCollectionBytes?: number
  readonly defaultBbox?: StacBbox
  /**
   * Optional band names/style when STAC `eo:bands` is missing or incomplete.
   * Callers must cite the product documentation in `note`. Never infer NIR from sample count.
   */
  readonly bandOverride?: {
    readonly note: string
    readonly bands: readonly StacEoBand[]
    readonly style?: RasterStyle
  }
}

export type CatalogEndpoint =
  | { readonly kind: 'stac-api'; readonly rootHref: string }
  | {
      readonly kind: 'static-stac'
      readonly rootHref: string
      readonly collections: readonly StaticStacCollectionConfig[]
    }
  | {
      readonly kind: 'tnm-access'
      readonly productsHref: string
      readonly datasetsHref: string
      readonly datasetTags: readonly string[]
    }

export interface CatalogRegistryEntry {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly protocol: CatalogProtocol
  readonly endpoint: CatalogEndpoint
  readonly homepage: string
  readonly attribution: string
  readonly license: string
  readonly cacheVersion: string
  readonly defaultBbox?: StacBbox
  readonly defaultDatetime?: string
  readonly defaultSortby?: string
  readonly preferredAssetKeys?: readonly string[]
  readonly crsDefinitions?: readonly CatalogCrsDefinition[]
  readonly collectionGroups: Readonly<Record<string, readonly string[]>>
  /**
   * Optional origin/CORS limitation shown under the protocol hint. Not a provider branch;
   * CatalogPanel renders this string for any registry entry that sets it.
   */
  readonly browserNote?: string
}

export type CatalogAssetIdentity = Pick<
  GeoCatalogReference,
  'catalogId' | 'collectionId' | 'itemId' | 'assetKey'
> & {
  readonly href?: string
  readonly sourceUrl?: string
}

export type CatalogAssetProvenance = GeoCatalogReference

export interface CatalogSourceCandidate extends CatalogAssetProvenance {
  readonly label: string
  readonly datetime?: string
  readonly bbox?: StacBbox
  readonly mediaType?: string
  readonly bandCount?: number
  readonly projEpsg?: number
  readonly style?: RasterStyle
}

export interface CatalogStoryPreset {
  readonly id: string
  readonly label: string
  readonly style: RasterStyle
}

export interface CatalogStory {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly catalogId: string
  readonly collectionGroup: string
  readonly bbox?: StacBbox
  readonly datetime?: string
  readonly inspect?: boolean
  readonly note?: string
  readonly style?: RasterStyle
  readonly presets?: readonly CatalogStoryPreset[]
}

export interface AtlasDeepLink extends CatalogAssetIdentity {
  readonly schemaVersion: typeof ATLAS_DEEP_LINK_SCHEMA_VERSION
  readonly inspect?: boolean
}

export interface AtlasCatalogSession {
  readonly schemaVersion: typeof ATLAS_SESSION_SCHEMA_VERSION
  readonly provenance: CatalogAssetProvenance
  readonly label: string
  readonly style?: RasterStyle
}

export interface CatalogCollectionSummary {
  readonly id: string
  readonly title?: string
  readonly description?: string
  readonly bbox?: StacBbox
}

export interface CatalogSearchRequest {
  readonly bbox?: StacBbox
  readonly datetime?: string
  readonly collections?: readonly string[]
  readonly limit?: number
  readonly sortby?: string
  readonly offset?: number
}

export interface CatalogCursor {
  readonly href: string
  readonly method?: 'GET' | 'POST'
  readonly body?: Readonly<Record<string, unknown>>
  readonly headers?: Readonly<Record<string, string>>
}

export interface CatalogSearchItem {
  readonly id: string
  readonly collectionId: string
  readonly title?: string
  readonly collectionTitle?: string
  readonly datetime?: string
  readonly bbox?: StacBbox
  readonly candidates: readonly CatalogSourceCandidate[]
}

export interface CatalogSearchPage {
  readonly items: readonly CatalogSearchItem[]
  readonly next?: CatalogCursor
  readonly numberMatched?: number
  readonly numberReturned?: number
}

export function providerName(providers: readonly StacProvider[]): string | undefined {
  const producer = providers.find((provider) => provider.roles?.includes('producer'))
  return producer?.name ?? providers[0]?.name
}

export function collectionIdsForStory(
  entry: CatalogRegistryEntry,
  story: CatalogStory,
): readonly string[] {
  return entry.collectionGroups[story.collectionGroup] ?? []
}

export function catalogRootHref(entry: CatalogRegistryEntry): string {
  switch (entry.endpoint.kind) {
    case 'stac-api':
    case 'static-stac':
      return entry.endpoint.rootHref
    case 'tnm-access':
      return entry.endpoint.productsHref
  }
}

export function catalogProtocolHint(entry: CatalogRegistryEntry): string {
  const protocol =
    entry.protocol === 'stac-api'
      ? 'STAC API · public HTTPS'
      : entry.protocol === 'static-stac'
        ? 'Static STAC · public HTTPS'
        : 'TNMAccess API · public HTTPS'
  return entry.browserNote === undefined ? protocol : `${protocol}. ${entry.browserNote}`
}

export function collectionSummariesFromRegistry(
  entry: CatalogRegistryEntry,
): readonly CatalogCollectionSummary[] {
  const seen = new Set<string>()
  const summaries: CatalogCollectionSummary[] = []
  for (const ids of Object.values(entry.collectionGroups)) {
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      summaries.push({ id, title: id })
    }
  }
  return summaries
}

export function staticStacCollections(
  entry: CatalogRegistryEntry,
): readonly StaticStacCollectionConfig[] {
  return entry.endpoint.kind === 'static-stac' ? entry.endpoint.collections : []
}
