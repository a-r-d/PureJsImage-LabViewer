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
  parseStacCollectionsPage,
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
    request?: {
      readonly method?: 'GET' | 'POST'
      readonly body?: unknown
      readonly headers?: Readonly<Record<string, string>>
    },
  ): Promise<unknown> {
    const method = request?.method ?? 'GET'
    const key = cacheUrl(href, method, request?.body)
    const cached = await cache.get(key)
    if (cached !== undefined && cached.cacheVersion === options.cacheVersion) return cached.body
    const body = await fetchCatalogJson(jsonOptions, {
      href,
      method,
      ...(request?.body === undefined ? {} : { body: request.body }),
      ...(request?.headers === undefined ? {} : { headers: request.headers }),
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
    request?: {
      readonly method?: 'GET' | 'POST'
      readonly body?: unknown
      readonly headers?: Readonly<Record<string, string>>
    },
  ): Promise<StacItemCollection> {
    return parseStacItemCollection(await readJson(href, signal, request), parseOptions(href))
  }

  return {
    async getCatalog(href, signal) {
      return parseStacCatalog(await readJson(href, signal), parseOptions(href))
    },
    async listCollections(catalog, signal) {
      let link: StacLink | undefined = {
        rel: 'data',
        href: linkHref(catalog.links, 'data') ?? joinHref(catalogSelf(catalog), 'collections'),
        method: 'GET',
      }
      const collections: StacCollection[] = []
      const visited = new Set<string>()
      for (let pageIndex = 0; link !== undefined && pageIndex < 32; pageIndex += 1) {
        assertPaginationPolicy(link.href, options.catalogRootHref ?? catalogSelf(catalog))
        const method = httpMethod(link.method) ?? 'GET'
        const key = `${method}:${link.href}:${stableBody(link.body)}`
        if (visited.has(key)) {
          throw new StacClientError(
            'INVALID_DOCUMENT',
            'STAC collections pagination repeated a page.',
          )
        }
        visited.add(key)
        const page = parseStacCollectionsPage(
          await readJson(link.href, signal, {
            method,
            ...(link.body === undefined ? {} : { body: link.body }),
            ...(link.headers === undefined ? {} : { headers: allowedLinkHeaders(link.headers) }),
          }),
          parseOptions(link.href),
        )
        collections.push(...page.collections)
        if (collections.length > 10_000) {
          throw new StacClientError('TOO_LARGE', 'STAC collections listing exceeds 10,000 entries.')
        }
        link = page.next
      }
      if (link !== undefined) {
        throw new StacClientError('TOO_LARGE', 'STAC collections pagination exceeds 32 pages.')
      }
      return collections
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
        const body = searchBody(query)
        const page = await readItemCollection(link.href, signal, {
          method: 'POST',
          body,
          ...(link.headers === undefined ? {} : { headers: allowedLinkHeaders(link.headers) }),
        })
        return withEffectiveNext(page, body)
      }
      const page = await readItemCollection(withSearchQuery(link.href, query), signal)
      return withEffectiveNext(page, searchBody(query))
    },
    async follow(href, signal) {
      return readItemCollection(href, signal)
    },
    async followLink(link, signal) {
      const method = httpMethod(link.method) ?? 'GET'
      const root = options.catalogRootHref ?? link.href
      assertPaginationPolicy(link.href, root)
      if (method === 'POST') {
        const page = await readItemCollection(link.href, signal, {
          method: 'POST',
          ...(link.body === undefined ? {} : { body: link.body }),
          ...(link.headers === undefined ? {} : { headers: allowedLinkHeaders(link.headers) }),
        })
        return withEffectiveNext(page, link.body ?? {})
      }
      const page = await readItemCollection(link.href, signal, {
        ...(link.headers === undefined ? {} : { headers: allowedLinkHeaders(link.headers) }),
      })
      return withEffectiveNext(page, link.body ?? {})
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

function withEffectiveNext(
  page: StacItemCollection,
  previousBody: Readonly<Record<string, unknown>>,
): StacItemCollection {
  if (page.next === undefined || (httpMethod(page.next.method) ?? 'GET') !== 'POST') return page
  const body =
    page.next.merge === true ? { ...previousBody, ...(page.next.body ?? {}) } : page.next.body
  const next: StacLink = {
    ...page.next,
    ...(body === undefined ? {} : { body }),
  }
  return { ...page, next, nextHref: next.href }
}

function assertPaginationPolicy(href: string, root: string): void {
  if (sameOrigin(href, root)) return
  throw new StacClientError(
    'UNAVAILABLE',
    'Refusing STAC pagination outside the configured catalog origin.',
    'Pagination links must remain within the configured catalog policy.',
  )
}

function allowedLinkHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const allowed: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase()
    if (normalized === 'accept' || normalized === 'prefer') allowed[normalized] = value
  }
  return allowed
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
