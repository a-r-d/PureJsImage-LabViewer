import { createMemoryStacCache, type StacMetadataCache } from './cache.js'
import {
  linkHref,
  parseStacCatalog,
  parseStacCollection,
  parseStacCollections,
  parseStacItem,
  parseStacItemCollection,
} from './parse.js'
import type {
  StacCatalog,
  StacCollection,
  StacItem,
  StacItemCollection,
  StacSearchQuery,
} from './types.js'
import { StacClientError } from './types.js'

export interface StacClientOptions {
  readonly fetch: typeof fetch
  readonly cache?: StacMetadataCache
  readonly cacheVersion: string
  readonly now?: () => string
}

export interface StacClient {
  getCatalog(href: string, signal?: AbortSignal): Promise<StacCatalog>
  listCollections(catalog: StacCatalog, signal?: AbortSignal): Promise<readonly StacCollection[]>
  getCollection(href: string, signal?: AbortSignal): Promise<StacCollection>
  getItem(href: string, signal?: AbortSignal): Promise<StacItem>
  search(
    catalog: StacCatalog,
    query: StacSearchQuery,
    signal?: AbortSignal,
  ): Promise<StacItemCollection>
  follow(href: string, signal?: AbortSignal): Promise<StacItemCollection>
  invalidate(url?: string): Promise<void>
}

export function createStacClient(options: StacClientOptions): StacClient {
  const cache = options.cache ?? createMemoryStacCache()
  const now = options.now ?? (() => new Date().toISOString())
  const fetchImpl: typeof fetch = (input, init) => options.fetch.call(globalThis, input, init)

  async function readJson(href: string, signal?: AbortSignal): Promise<unknown> {
    const cached = await cache.get(href)
    if (cached !== undefined && cached.cacheVersion === options.cacheVersion) return cached.body
    let response: Response
    try {
      response = await fetchImpl(
        href,
        signal === undefined ? { method: 'GET' } : { method: 'GET', signal },
      )
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new StacClientError('ABORTED', 'The catalog request was cancelled.')
      }
      throw new StacClientError(
        'UNAVAILABLE',
        error instanceof Error ? error.message : 'The catalog could not be reached.',
        'The server may be offline, or this origin may be blocked by CORS.',
      )
    }
    if (response.status === 404) {
      throw new StacClientError('NOT_FOUND', `Catalog resource not found: ${href}`)
    }
    if (!response.ok) {
      throw new StacClientError(
        'UNAVAILABLE',
        `Catalog request failed with HTTP ${response.status}.`,
        'Retry later, or refresh the catalog cache.',
      )
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new StacClientError('INVALID_DOCUMENT', 'The catalog response was not valid JSON.')
    }
    await cache.set({
      schemaVersion: 1,
      cacheVersion: options.cacheVersion,
      url: href,
      storedAt: now(),
      body,
    })
    return body
  }

  return {
    async getCatalog(href, signal) {
      return parseStacCatalog(await readJson(href, signal))
    },
    async listCollections(catalog, signal) {
      const href = linkHref(catalog.links, 'data') ?? joinHref(catalogSelf(catalog), 'collections')
      return parseStacCollections(await readJson(href, signal))
    },
    async getCollection(href, signal) {
      return parseStacCollection(await readJson(href, signal))
    },
    async getItem(href, signal) {
      return parseStacItem(await readJson(href, signal))
    },
    async search(catalog, query, signal) {
      const searchHref = searchLink(catalog)
      return parseStacItemCollection(await readJson(withSearchQuery(searchHref, query), signal))
    },
    async follow(href, signal) {
      return parseStacItemCollection(await readJson(href, signal))
    },
    async invalidate(url) {
      await cache.invalidate(url)
    },
  }
}

function catalogSelf(catalog: StacCatalog): string {
  return linkHref(catalog.links, 'self') ?? linkHref(catalog.links, 'root') ?? ''
}

function searchLink(catalog: StacCatalog): string {
  const search = catalog.links.find(
    (link) => link.rel === 'search' && (link.method ?? 'GET') === 'GET',
  )
  if (search !== undefined) return search.href
  const anySearch = linkHref(catalog.links, 'search')
  if (anySearch !== undefined) return anySearch
  return joinHref(catalogSelf(catalog), 'search')
}

function withSearchQuery(href: string, query: StacSearchQuery): string {
  const url = new URL(href)
  if (query.bbox !== undefined) url.searchParams.set('bbox', query.bbox.join(','))
  if (query.datetime !== undefined) url.searchParams.set('datetime', query.datetime)
  if (query.collections !== undefined && query.collections.length > 0) {
    url.searchParams.set('collections', query.collections.join(','))
  }
  url.searchParams.set('limit', String(query.limit ?? 12))
  return url.toString()
}

function joinHref(base: string, path: string): string {
  if (base.length === 0) return `/${path}`
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString()
}
