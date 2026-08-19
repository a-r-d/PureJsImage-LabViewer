import type { StacMetadataCache } from '../stac/cache.js'
import { createMemoryStacCache } from '../stac/cache.js'
import { createStacClient, type StacClient } from '../stac/client.js'
import { StacClientError } from '../stac/types.js'
import { createStacApiAdapter } from './adapters/stac-api.js'
import { createStaticStacAdapter } from './adapters/static-stac.js'
import { createTnmAccessAdapter } from './adapters/tnm-access.js'
import type { CatalogAdapter } from './adapters/types.js'
import {
  type CatalogJsonFetchOptions,
  DEFAULT_CATALOG_MAX_JSON_BYTES,
  DEFAULT_CATALOG_TIMEOUT_MS,
} from './json-fetch.js'
import type {
  CatalogAssetIdentity,
  CatalogCollectionSummary,
  CatalogCursor,
  CatalogRegistryEntry,
  CatalogSearchPage,
  CatalogSearchRequest,
  CatalogSourceCandidate,
} from './types.js'
import { catalogRootHref } from './types.js'

export interface CatalogServiceOptions {
  readonly fetch: typeof fetch
  readonly cache?: StacMetadataCache
  readonly cacheVersion: string
  readonly maxJsonBytes?: number
  readonly timeoutMs?: number
  readonly now?: () => string
}

export interface CatalogService {
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
  invalidate(url?: string): Promise<void>
}

export function createCatalogService(options: CatalogServiceOptions): CatalogService {
  const cache = options.cache ?? createMemoryStacCache()
  const jsonOptions: CatalogJsonFetchOptions = {
    fetch: (input, init) => options.fetch.call(globalThis, input, init),
    maxBytes: options.maxJsonBytes ?? DEFAULT_CATALOG_MAX_JSON_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS,
  }
  const stacClients = new Map<string, StacClient>()
  const clientFor = (entry: CatalogRegistryEntry): StacClient => {
    const key = `${entry.id}:${entry.protocol}:${entry.cacheVersion}`
    const existing = stacClients.get(key)
    if (existing !== undefined) return existing
    const created = createStacClient({
      fetch: options.fetch,
      cache,
      cacheVersion: `${options.cacheVersion}:${entry.cacheVersion}`,
      cacheKeyPrefix: `${entry.id}:${entry.protocol}`,
      catalogRootHref: catalogRootHref(entry),
      ...(jsonOptions.maxBytes === undefined ? {} : { maxJsonBytes: jsonOptions.maxBytes }),
      ...(jsonOptions.timeoutMs === undefined ? {} : { timeoutMs: jsonOptions.timeoutMs }),
      ...(options.now === undefined ? {} : { now: options.now }),
    })
    stacClients.set(key, created)
    return created
  }
  const adapters: Record<CatalogRegistryEntry['protocol'], CatalogAdapter> = {
    'stac-api': createStacApiAdapter(clientFor),
    'static-stac': createStaticStacAdapter(jsonOptions),
    'tnm-access': createTnmAccessAdapter(jsonOptions),
  }

  function adapter(entry: CatalogRegistryEntry): CatalogAdapter {
    return adapters[entry.protocol]
  }

  function withDefaults(
    entry: CatalogRegistryEntry,
    request: CatalogSearchRequest,
  ): CatalogSearchRequest {
    return {
      ...request,
      ...(request.bbox === undefined && entry.defaultBbox !== undefined
        ? { bbox: entry.defaultBbox }
        : {}),
      ...(request.datetime === undefined && entry.defaultDatetime !== undefined
        ? { datetime: entry.defaultDatetime }
        : {}),
      ...(request.sortby === undefined && entry.defaultSortby !== undefined
        ? { sortby: entry.defaultSortby }
        : {}),
    }
  }

  return {
    listCollections(entry, signal) {
      return adapter(entry).listCollections(entry, signal)
    },
    search(entry, request, signal) {
      return adapter(entry).search(entry, withDefaults(entry, request), signal)
    },
    follow(entry, cursor, signal) {
      return adapter(entry).follow(entry, cursor, signal)
    },
    resolveDeepLink(entry, identity, signal) {
      return adapter(entry).resolveDeepLink(entry, identity, signal)
    },
    async invalidate(url) {
      await cache.invalidate(url)
      stacClients.clear()
    },
  }
}

export function assertCatalogService(value: CatalogService | undefined): CatalogService {
  if (value === undefined) {
    throw new StacClientError('UNAVAILABLE', 'Catalog service is not available.')
  }
  return value
}
