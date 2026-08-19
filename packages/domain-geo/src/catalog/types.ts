import type { GeoCatalogReference, RasterStyle } from '../model.js'
import type { StacBbox, StacProvider } from '../stac/types.js'

export const CATALOG_REGISTRY_SCHEMA_VERSION = 1 as const
export const ATLAS_SESSION_SCHEMA_VERSION = 1 as const
export const ATLAS_DEEP_LINK_SCHEMA_VERSION = 1 as const

export interface CatalogCrsDefinition {
  readonly key: string
  readonly proj4: string
}

export interface CatalogRegistryEntry {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly href: string
  readonly homepage: string
  readonly attribution: string
  readonly license: string
  readonly cacheVersion: string
  readonly defaultBbox?: StacBbox
  readonly crsDefinitions?: readonly CatalogCrsDefinition[]
  readonly collectionGroups: Readonly<Record<string, readonly string[]>>
}

export type CatalogAssetIdentity = Pick<
  GeoCatalogReference,
  'catalogId' | 'collectionId' | 'itemId' | 'assetKey'
>

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
