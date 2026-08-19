import type {
  CatalogAssetIdentity,
  CatalogCollectionSummary,
  CatalogCursor,
  CatalogProtocol,
  CatalogRegistryEntry,
  CatalogSearchPage,
  CatalogSearchRequest,
  CatalogSourceCandidate,
} from '../types.js'

export interface CatalogAdapter {
  readonly protocol: CatalogProtocol
  listCollections(
    entry: CatalogRegistryEntry,
    signal?: AbortSignal,
  ): Promise<readonly CatalogCollectionSummary[]>
  search(
    entry: CatalogRegistryEntry,
    request: CatalogSearchRequest,
    signal?: AbortSignal,
  ): Promise<CatalogSearchPage>
  follow(
    entry: CatalogRegistryEntry,
    cursor: CatalogCursor,
    signal?: AbortSignal,
  ): Promise<CatalogSearchPage>
  resolveDeepLink(
    entry: CatalogRegistryEntry,
    identity: CatalogAssetIdentity,
    signal?: AbortSignal,
  ): Promise<CatalogSourceCandidate | undefined>
}
