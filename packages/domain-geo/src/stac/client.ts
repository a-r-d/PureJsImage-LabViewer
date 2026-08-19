import {
  type CatalogJsonFetchOptions,
  fetchCatalogJson,
  httpMethod,
  sameOrigin,
} from '../catalog/json-fetch.js'
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
  StacLink,
  StacSearchQuery,
} from './types.js'
import { StacClientError } from './types.js'

export interface StacClientOptions {
  readonly fetch: typeof fetch
  readonly cache?: StacMetadataCache
  readonly cacheVersion: string
  readonly cacheKeyPrefix?: string
  readonly catalogRootHref?: string
  readonly maxJsonBytes?: number
  readonly timeoutMs?: number
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
  followLink(link: StacLink, signal?: AbortSignal): Promise<StacItemCollection>
  invalidate(url?: string): Promise<void>
}

export function createStacClient(options: StacClientOptions): StacClient {
  const cache = options.cache ?? createMemoryStacCache()
  const now = options.now ?? (() => new Date().toISOString())
  const jsonOptions: CatalogJsonFetchOptions = {
    fetch: (input, init) => options.fetch.call(globalThis, input, init),
    ...(options.maxJsonBytes === undefined ? {} : { maxBytes: options.maxJsonBytes }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  }

  function cacheUrl(href: string, method: 'GET' | 'POST', body?: unknown): string {
    const prefixed =
      options.cacheKeyPrefix === undefined ? href : `${options.cacheKeyPrefix}:${href}`
    if (method === 'GET') return prefixed
    return `${prefixed}#POST:${stableBody(body)}`
  }

  async function readJson(
    href: string,
    signal: AbortSignal | undefined,
    request?: { readonly method?: 'GET' | 'POST'; readonly body?: unknown },
  ): Promise<unknown> {
    const method = request?.method ?? 'GET'
    const key = cacheUrl(href, method, request?.body)
    const cached = await cache.get(key)
    if (cached !== undefined && cached.cacheVersion === options.cacheVersion) return cached.body
    const body = await fetchCatalogJson(jsonOptions, {
      href,
      method,
      ...(request?.body === undefined ? {} : { body: request.body }),
      ...(signal === undefined ? {} : { signal }),
    })
    await cache.set({
      schemaVersion: 1,
      cacheVersion: options.cacheVersion,
      url: key,
      storedAt: now(),
      body,
    })
    return body
  }

  function parseOptions(href: string): { readonly baseHref: string } {
    return { baseHref: href }
  }

  async function readItemCollection(
    href: string,
    signal: AbortSignal | undefined,
    request?: { readonly method?: 'GET' | 'POST'; readonly body?: unknown },
  ): Promise<StacItemCollection> {
    return parseStacItemCollection(await readJson(href, signal, request), parseOptions(href))
  }

  return {
    async getCatalog(href, signal) {
      return parseStacCatalog(await readJson(href, signal), parseOptions(href))
    },
    async listCollections(catalog, signal) {
      const href = linkHref(catalog.links, 'data') ?? joinHref(catalogSelf(catalog), 'collections')
      return parseStacCollections(await readJson(href, signal), parseOptions(href))
    },
    async getCollection(href, signal) {
      return parseStacCollection(await readJson(href, signal), parseOptions(href))
    },
    async getItem(href, signal) {
      return parseStacItem(await readJson(href, signal), parseOptions(href))
    },
    async search(catalog, query, signal) {
      const link = searchLink(catalog)
      const root = options.catalogRootHref ?? catalogSelf(catalog)
      const method = httpMethod(link.method) ?? 'GET'
      if (method === 'POST') {
        if (!sameOrigin(link.href, root)) {
          throw new StacClientError(
            'UNAVAILABLE',
            'Refusing a cross-origin STAC POST search.',
            'Atlas only POSTs search when the catalog advertises it on the same origin as the catalog root.',
          )
        }
        return readItemCollection(link.href, signal, {
          method: 'POST',
          body: searchBody(query),
        })
      }
      return readItemCollection(withSearchQuery(link.href, query), signal)
    },
    async follow(href, signal) {
      return readItemCollection(href, signal)
    },
    async followLink(link, signal) {
      const method = httpMethod(link.method) ?? 'GET'
      const root = options.catalogRootHref ?? link.href
      if (method === 'POST') {
        if (!sameOrigin(link.href, root)) {
          throw new StacClientError(
            'UNAVAILABLE',
            'Refusing a cross-origin STAC POST next page.',
            'Atlas only POSTs pagination when the next link is on the catalog origin.',
          )
        }
        return readItemCollection(link.href, signal, {
          method: 'POST',
          ...(link.body === undefined ? {} : { body: link.body }),
        })
      }
      return readItemCollection(link.href, signal)
    },
    async invalidate(url) {
      if (url === undefined) {
        await cache.invalidate()
        return
      }
      await cache.invalidate(cacheUrl(url, 'GET'))
    },
  }
}

function catalogSelf(catalog: StacCatalog): string {
  return linkHref(catalog.links, 'self') ?? linkHref(catalog.links, 'root') ?? ''
}

function searchLink(catalog: StacCatalog): StacLink {
  const getSearch = catalog.links.find(
    (link) => link.rel === 'search' && (httpMethod(link.method) ?? 'GET') === 'GET',
  )
  if (getSearch !== undefined) return getSearch
  const postSearch = catalog.links.find(
    (link) => link.rel === 'search' && httpMethod(link.method) === 'POST',
  )
  if (postSearch !== undefined) return postSearch
  const anySearch = catalog.links.find((link) => link.rel === 'search')
  if (anySearch !== undefined) return anySearch
  return { rel: 'search', href: joinHref(catalogSelf(catalog), 'search'), method: 'GET' }
}

function withSearchQuery(href: string, query: StacSearchQuery): string {
  const url = new URL(href)
  if (query.bbox !== undefined) url.searchParams.set('bbox', query.bbox.join(','))
  if (query.datetime !== undefined) url.searchParams.set('datetime', query.datetime)
  if (query.collections !== undefined && query.collections.length > 0) {
    url.searchParams.set('collections', query.collections.join(','))
  }
  if (query.sortby !== undefined) url.searchParams.set('sortby', query.sortby)
  url.searchParams.set('limit', String(query.limit ?? 12))
  return url.toString()
}

function searchBody(query: StacSearchQuery): Record<string, unknown> {
  return {
    ...(query.bbox === undefined ? {} : { bbox: [...query.bbox] }),
    ...(query.datetime === undefined ? {} : { datetime: query.datetime }),
    ...(query.collections === undefined || query.collections.length === 0
      ? {}
      : { collections: [...query.collections] }),
    ...(query.sortby === undefined ? {} : { sortby: query.sortby }),
    limit: query.limit ?? 12,
  }
}

function joinHref(base: string, path: string): string {
  if (base.length === 0) return `/${path}`
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString()
}

function stableBody(body: unknown): string {
  try {
    return JSON.stringify(body ?? {})
  } catch {
    return ''
  }
}
