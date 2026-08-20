import { parseStacBbox, parseStacItem, parseStacItemCollection } from '../../stac/parse.js'
import type { StacBbox, StacItem } from '../../stac/types.js'
import { StacClientError } from '../../stac/types.js'
import { candidatesFromItem, preferredCandidate, searchItemFromCandidates } from '../candidates.js'
import { type CatalogJsonFetchOptions, fetchCatalogJson, headCatalogBytes } from '../json-fetch.js'
import type {
  CatalogCollectionSummary,
  CatalogCursor,
  CatalogRegistryEntry,
  CatalogSearchItem,
  CatalogSearchPage,
  CatalogSearchRequest,
  StaticStacCollectionConfig,
} from '../types.js'
import type { CatalogAdapter } from './types.js'

const DEFAULT_PAGE_SIZE = 12

export function createStaticStacAdapter(jsonOptions: CatalogJsonFetchOptions): CatalogAdapter {
  return {
    protocol: 'static-stac',
    async listCollections(entry) {
      return configuredCollections(entry).map(
        (collection): CatalogCollectionSummary => ({
          id: collection.id,
          title: collection.title,
          ...(collection.defaultBbox === undefined ? {} : { bbox: collection.defaultBbox }),
        }),
      )
    },
    async search(entry, request, signal) {
      const collections = collectionsForSearch(entry, request.collections)
      const items = await loadFilteredItems(jsonOptions, entry, collections, request, signal)
      return paginate(items, request.limit ?? DEFAULT_PAGE_SIZE, request.offset ?? 0, request)
    },
    async follow(entry, cursor, signal) {
      const request = requestFromCursor(cursor)
      return this.search(entry, request, signal)
    },
    async resolveDeepLink(entry, identity, signal) {
      const collection = configuredCollections(entry).find(
        (candidate) => candidate.id === identity.collectionId,
      )
      if (collection === undefined) return undefined
      const item = await loadItemDocument(jsonOptions, collection, identity.itemId, signal)
      if (item === undefined) return undefined
      const withCollection =
        item.collection === undefined ? { ...item, collection: collection.id } : item
      const candidates = candidatesFromItem(entry, withCollection, {
        collectionId: collection.id,
        ...(collection.bandOverride?.style === undefined
          ? {}
          : { style: collection.bandOverride.style }),
      })
      return preferredCandidate(candidates, withCollection, identity.assetKey)
    },
  }
}

function configuredCollections(entry: CatalogRegistryEntry): readonly StaticStacCollectionConfig[] {
  if (entry.endpoint.kind !== 'static-stac') {
    throw new StacClientError(
      'INVALID_DOCUMENT',
      'Static STAC adapter received a non-static catalog.',
    )
  }
  return entry.endpoint.collections
}

function collectionsForSearch(
  entry: CatalogRegistryEntry,
  ids: readonly string[] | undefined,
): readonly StaticStacCollectionConfig[] {
  const all = configuredCollections(entry)
  if (ids === undefined || ids.length === 0) return all
  return all.filter((collection) => ids.includes(collection.id))
}

async function loadFilteredItems(
  jsonOptions: CatalogJsonFetchOptions,
  entry: CatalogRegistryEntry,
  collections: readonly StaticStacCollectionConfig[],
  request: CatalogSearchRequest,
  signal?: AbortSignal,
): Promise<readonly CatalogSearchItem[]> {
  const items: CatalogSearchItem[] = []
  for (const collection of collections) {
    const parsed = await loadItemCollection(jsonOptions, collection, signal)
    for (const item of parsed) {
      const withCollection =
        item.collection === undefined ? { ...item, collection: collection.id } : item
      if (!itemMatches(withCollection, request, collection.id)) continue
      const style = collection.bandOverride?.style
      const candidates = candidatesFromItem(entry, withCollection, {
        collectionId: collection.id,
        ...(style === undefined ? {} : { style }),
      })
      if (candidates.length === 0) continue
      items.push(searchItemFromCandidates(withCollection, collection.id, candidates, item.id))
    }
  }
  return items
}

async function loadItemCollection(
  jsonOptions: CatalogJsonFetchOptions,
  collection: StaticStacCollectionConfig,
  signal?: AbortSignal,
): Promise<readonly StacItem[]> {
  const maxBytes = collection.maxItemCollectionBytes ?? jsonOptions.maxBytes
  const length = await headCatalogBytes(jsonOptions, collection.itemCollectionHref, signal)
  if (length !== undefined && maxBytes !== undefined && length > maxBytes) {
    throw new StacClientError(
      'TOO_LARGE',
      `Catalog document exceeds ${String(maxBytes)} bytes: ${collection.itemCollectionHref}`,
      'This static STAC item collection is too large to browse directly in the browser.',
    )
  }
  const body = await fetchCatalogJson(jsonOptions, {
    href: collection.itemCollectionHref,
    ...(signal === undefined ? {} : { signal }),
    ...(maxBytes === undefined ? {} : { maxBytes }),
  })
  return parseStacItemCollection(body, { baseHref: collection.itemCollectionHref }).items
}

async function loadItemDocument(
  jsonOptions: CatalogJsonFetchOptions,
  collection: StaticStacCollectionConfig,
  itemId: string,
  signal?: AbortSignal,
): Promise<StacItem | undefined> {
  const base = collection.itemDocumentBaseHref
  if (base !== undefined) {
    const baseUrl = new URL(base.endsWith('/') ? base : `${base}/`)
    const encodedId = encodeURIComponent(itemId)
    if (itemId.length === 0 || itemId === '.' || itemId === '..' || encodedId.length > 8_192) {
      throw new StacClientError(
        'INVALID_DOCUMENT',
        'Static STAC item id is not a safe path segment.',
      )
    }
    const itemUrl = new URL(`${encodedId}.json`, baseUrl)
    if (itemUrl.origin !== baseUrl.origin || !itemUrl.pathname.startsWith(baseUrl.pathname)) {
      throw new StacClientError(
        'INVALID_DOCUMENT',
        'Static STAC item id escaped its collection directory.',
      )
    }
    const href = itemUrl.toString()
    const maxBytes = collection.maxItemCollectionBytes ?? jsonOptions.maxBytes
    const body = await fetchCatalogJson(jsonOptions, {
      href,
      ...(signal === undefined ? {} : { signal }),
      ...(maxBytes === undefined ? {} : { maxBytes }),
    })
    return parseStacItem(body, { baseHref: href })
  }
  const items = await loadItemCollection(jsonOptions, collection, signal)
  return items.find((item) => item.id === itemId)
}

function itemMatches(item: StacItem, request: CatalogSearchRequest, collectionId: string): boolean {
  if (request.collections !== undefined && request.collections.length > 0) {
    if (!request.collections.includes(item.collection ?? collectionId)) return false
  }
  if (
    request.bbox !== undefined &&
    item.bbox !== undefined &&
    !bboxesOverlap(request.bbox, item.bbox)
  ) {
    return false
  }
  if (request.datetime !== undefined && !datetimeMatches(item.datetime, request.datetime)) {
    return false
  }
  return true
}

function bboxesOverlap(left: StacBbox, right: StacBbox): boolean {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1]
}

function datetimeMatches(value: string | undefined, filter: string): boolean {
  if (value === undefined) return true
  const [start, end] = filter.split('/')
  if (end === undefined) return value.startsWith(filter) || value >= filter
  const lower = start === undefined || start.length === 0 ? undefined : start
  const upper = end.length === 0 ? undefined : end
  if (lower !== undefined && value < lower) return false
  if (upper !== undefined && value > upper) return false
  return true
}

function paginate(
  items: readonly CatalogSearchItem[],
  limit: number,
  offset: number,
  request: CatalogSearchRequest,
): CatalogSearchPage {
  const slice = items.slice(offset, offset + limit)
  const nextOffset = offset + slice.length
  const next: CatalogCursor | undefined =
    nextOffset < items.length
      ? {
          href: `static-stac:next?offset=${String(nextOffset)}`,
          method: 'GET',
          body: {
            kind: 'static-stac-page',
            offset: nextOffset,
            limit,
            ...(request.bbox === undefined ? {} : { bbox: [...request.bbox] }),
            ...(request.datetime === undefined ? {} : { datetime: request.datetime }),
            ...(request.collections === undefined ? {} : { collections: [...request.collections] }),
          },
        }
      : undefined
  return {
    items: slice,
    ...(next === undefined ? {} : { next }),
    numberMatched: items.length,
    numberReturned: slice.length,
  }
}

function requestFromCursor(cursor: CatalogCursor): CatalogSearchRequest {
  const body = cursor.body ?? {}
  const bbox = parseStacBbox(body['bbox'])
  const collections = Array.isArray(body['collections'])
    ? body['collections'].filter((value): value is string => typeof value === 'string')
    : undefined
  const datetime = typeof body['datetime'] === 'string' ? body['datetime'] : undefined
  const limit = typeof body['limit'] === 'number' ? body['limit'] : DEFAULT_PAGE_SIZE
  const offset = typeof body['offset'] === 'number' ? body['offset'] : 0
  return {
    ...(bbox === undefined ? {} : { bbox }),
    ...(datetime === undefined ? {} : { datetime }),
    ...(collections === undefined ? {} : { collections }),
    limit,
    offset,
  }
}
