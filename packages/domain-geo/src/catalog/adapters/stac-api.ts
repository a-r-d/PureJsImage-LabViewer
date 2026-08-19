import type { StacClient } from '../../stac/client.js'
import type { StacCatalog, StacItem, StacItemCollection, StacLink } from '../../stac/types.js'
import { StacClientError } from '../../stac/types.js'
import { candidatesFromItem, preferredCandidate, searchItemFromCandidates } from '../candidates.js'
import type {
  CatalogCollectionSummary,
  CatalogCursor,
  CatalogRegistryEntry,
  CatalogSearchPage,
  CatalogSourceCandidate,
} from '../types.js'
import { catalogRootHref } from '../types.js'
import type { CatalogAdapter } from './types.js'

export function createStacApiAdapter(
  clientFor: (entry: CatalogRegistryEntry) => StacClient,
): CatalogAdapter {
  return {
    protocol: 'stac-api',
    async listCollections(entry, signal) {
      const client = clientFor(entry)
      const root = await rootCatalog(client, entry, signal)
      const collections = await client.listCollections(root, signal)
      return collections.map(
        (collection): CatalogCollectionSummary => ({
          id: collection.id,
          ...(collection.title === undefined ? {} : { title: collection.title }),
          ...(collection.description === undefined ? {} : { description: collection.description }),
          ...(collection.bbox === undefined ? {} : { bbox: collection.bbox }),
        }),
      )
    },
    async search(entry, request, signal) {
      const client = clientFor(entry)
      const root = await rootCatalog(client, entry, signal)
      const page = await client.search(
        root,
        {
          ...(request.bbox === undefined ? {} : { bbox: request.bbox }),
          ...(request.datetime === undefined ? {} : { datetime: request.datetime }),
          ...(request.collections === undefined ? {} : { collections: request.collections }),
          ...(request.sortby === undefined ? {} : { sortby: request.sortby }),
          limit: request.limit ?? 12,
        },
        signal,
      )
      return toSearchPage(entry, page)
    },
    async follow(entry, cursor, signal) {
      const client = clientFor(entry)
      const page = await client.followLink(cursorToLink(cursor), signal)
      return toSearchPage(entry, page)
    },
    async resolveDeepLink(entry, identity, signal) {
      const client = clientFor(entry)
      const itemHref = new URL(
        `collections/${identity.collectionId}/items/${encodeURIComponent(identity.itemId)}`,
        withSlash(catalogRootHref(entry)),
      ).toString()
      const item = await client.getItem(itemHref, signal)
      return candidateFromResolvedItem(entry, item, identity.assetKey)
    },
  }
}

async function rootCatalog(
  client: StacClient,
  entry: CatalogRegistryEntry,
  signal?: AbortSignal,
): Promise<StacCatalog> {
  if (entry.endpoint.kind !== 'stac-api') {
    throw new StacClientError('INVALID_DOCUMENT', 'STAC API adapter received a non-API catalog.')
  }
  return client.getCatalog(entry.endpoint.rootHref, signal)
}

function toSearchPage(entry: CatalogRegistryEntry, page: StacItemCollection): CatalogSearchPage {
  const next = page.next === undefined ? undefined : cursorFromLink(page.next)
  return {
    items: page.items.flatMap((item) => {
      const collectionId = item.collection
      if (collectionId === undefined) return []
      return [searchItemFromCandidates(item, collectionId, candidatesFromItem(entry, item))]
    }),
    ...(next === undefined ? {} : { next }),
    ...(page.numberMatched === undefined ? {} : { numberMatched: page.numberMatched }),
    ...(page.numberReturned === undefined ? {} : { numberReturned: page.numberReturned }),
  }
}

function cursorFromLink(link: StacLink): CatalogCursor {
  return {
    href: link.href,
    method: link.method?.toUpperCase() === 'POST' ? 'POST' : 'GET',
    ...(link.body === undefined ? {} : { body: link.body }),
  }
}

function cursorToLink(cursor: CatalogCursor): StacLink {
  return {
    rel: 'next',
    href: cursor.href,
    ...(cursor.method === undefined ? {} : { method: cursor.method }),
    ...(cursor.body === undefined ? {} : { body: cursor.body }),
  }
}

function candidateFromResolvedItem(
  entry: CatalogRegistryEntry,
  item: StacItem,
  assetKey: string,
): CatalogSourceCandidate | undefined {
  return preferredCandidate(candidatesFromItem(entry, item), item, assetKey)
}

function withSlash(href: string): string {
  return href.endsWith('/') ? href : `${href}/`
}
