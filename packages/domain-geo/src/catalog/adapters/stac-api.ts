import type { StacClient } from '../../stac/client.js'
import { linkHref } from '../../stac/parse.js'
import type {
  StacCatalog,
  StacCollection,
  StacItem,
  StacItemCollection,
  StacLink,
} from '../../stac/types.js'
import { StacClientError } from '../../stac/types.js'
import { candidatesFromItem, preferredCandidate, searchItemFromCandidates } from '../candidates.js'
import type {
  CatalogCollectionSummary,
  CatalogCursor,
  CatalogRegistryEntry,
  CatalogSearchPage,
  CatalogSourceCandidate,
} from '../types.js'
import type { CatalogAdapter } from './types.js'

export function createStacApiAdapter(
  clientFor: (entry: CatalogRegistryEntry) => StacClient,
): CatalogAdapter {
  const collectionCache = new Map<string, Promise<StacCollection | undefined>>()
  const collectionLists = new Map<string, Promise<readonly StacCollection[]>>()
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
      return toSearchPage(entry, page, client, root, collectionCache, collectionLists, signal)
    },
    async follow(entry, cursor, signal) {
      const client = clientFor(entry)
      const page = await client.followLink(cursorToLink(cursor), signal)
      const root = await rootCatalog(client, entry, signal)
      return toSearchPage(entry, page, client, root, collectionCache, collectionLists, signal)
    },
    async resolveDeepLink(entry, identity, signal) {
      const client = clientFor(entry)
      const root = await rootCatalog(client, entry, signal)
      const rootHref =
        linkHref(root.links, 'self') ??
        (entry.endpoint.kind === 'stac-api' ? entry.endpoint.rootHref : undefined)
      if (rootHref === undefined) return undefined
      const baseHref = rootHref.endsWith('/') ? rootHref : `${rootHref}/`
      const item = await client.getItem(
        new URL(
          `collections/${encodeURIComponent(identity.collectionId)}/items/${encodeURIComponent(identity.itemId)}`,
          baseHref,
        ).href,
        signal,
      )
      const collection = await collectionForItem(
        entry,
        item,
        client,
        root,
        collectionCache,
        collectionLists,
        signal,
      )
      return candidateFromResolvedItem(entry, item, identity.assetKey, collection)
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

async function toSearchPage(
  entry: CatalogRegistryEntry,
  page: StacItemCollection,
  client: StacClient,
  root: StacCatalog,
  collectionCache: Map<string, Promise<StacCollection | undefined>>,
  collectionLists: Map<string, Promise<readonly StacCollection[]>>,
  signal?: AbortSignal,
): Promise<CatalogSearchPage> {
  const next = page.next === undefined ? undefined : cursorFromLink(page.next)
  const items = await Promise.all(
    page.items.map(async (item): Promise<CatalogSearchPage['items'][number] | undefined> => {
      const collectionId = item.collection
      if (collectionId === undefined) return undefined
      const collection = await collectionForItem(
        entry,
        item,
        client,
        root,
        collectionCache,
        collectionLists,
        signal,
      )
      const result = searchItemFromCandidates(
        item,
        collectionId,
        candidatesFromItem(entry, item, collection === undefined ? undefined : { collection }),
      )
      return {
        ...result,
        ...(collection?.title === undefined ? {} : { collectionTitle: collection.title }),
      }
    }),
  )
  return {
    items: items.filter((item): item is CatalogSearchPage['items'][number] => item !== undefined),
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
    ...(link.headers === undefined ? {} : { headers: link.headers }),
  }
}

function cursorToLink(cursor: CatalogCursor): StacLink {
  return {
    rel: 'next',
    href: cursor.href,
    ...(cursor.method === undefined ? {} : { method: cursor.method }),
    ...(cursor.body === undefined ? {} : { body: cursor.body }),
    ...(cursor.headers === undefined ? {} : { headers: cursor.headers }),
  }
}

function candidateFromResolvedItem(
  entry: CatalogRegistryEntry,
  item: StacItem,
  assetKey: string,
  collection?: StacCollection,
): CatalogSourceCandidate | undefined {
  return preferredCandidate(
    candidatesFromItem(entry, item, collection === undefined ? undefined : { collection }),
    item,
    assetKey,
  )
}

async function collectionForItem(
  entry: CatalogRegistryEntry,
  item: StacItem,
  client: StacClient,
  root: StacCatalog,
  collectionCache: Map<string, Promise<StacCollection | undefined>>,
  collectionLists: Map<string, Promise<readonly StacCollection[]>>,
  signal?: AbortSignal,
): Promise<StacCollection | undefined> {
  const collectionId = item.collection
  if (collectionId === undefined) return undefined
  const key = `${entry.id}:${entry.cacheVersion}:${collectionId}`
  const cached = collectionCache.get(key)
  if (cached !== undefined) return cached
  const pending = (async (): Promise<StacCollection | undefined> => {
    const advertised = item.links.find((link) => link.rel === 'collection')?.href
    if (advertised !== undefined) return client.getCollection(advertised, signal)
    const listKey = `${entry.id}:${entry.cacheVersion}`
    let listed = collectionLists.get(listKey)
    if (listed === undefined) {
      listed = client.listCollections(root, signal).catch((error: unknown) => {
        collectionLists.delete(listKey)
        throw error
      })
      collectionLists.set(listKey, listed)
    }
    return (await listed).find((collection) => collection.id === collectionId)
  })()
  collectionCache.set(key, pending)
  try {
    return await pending
  } catch (error) {
    collectionCache.delete(key)
    throw error
  }
}
