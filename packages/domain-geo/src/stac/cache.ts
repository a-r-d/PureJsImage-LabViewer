const CACHE_SCHEMA_VERSION = 1 as const

export interface StacCacheEntry {
  readonly schemaVersion: typeof CACHE_SCHEMA_VERSION
  readonly cacheVersion: string
  readonly url: string
  readonly storedAt: string
  readonly body: unknown
}

export interface StacMetadataCache {
  get(url: string): Promise<StacCacheEntry | undefined>
  set(entry: StacCacheEntry): Promise<void>
  invalidate(url?: string): Promise<void>
}

export function cacheKey(cacheVersion: string, url: string): string {
  return `v${CACHE_SCHEMA_VERSION}:${cacheVersion}:${url}`
}

export function createMemoryStacCache(): StacMetadataCache {
  const records = new Map<string, StacCacheEntry>()
  return {
    async get(url) {
      for (const entry of records.values()) {
        if (entry.url === url) return entry
      }
      return undefined
    },
    async set(entry) {
      if (entry.schemaVersion !== CACHE_SCHEMA_VERSION) return
      records.set(cacheKey(entry.cacheVersion, entry.url), entry)
    },
    async invalidate(url) {
      if (url === undefined) {
        records.clear()
        return
      }
      for (const [key, entry] of records) {
        if (entry.url === url) records.delete(key)
      }
    },
  }
}

export function readCacheEntry(
  cacheVersion: string,
  url: string,
  value: unknown,
): StacCacheEntry | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record['schemaVersion'] !== CACHE_SCHEMA_VERSION) return undefined
  if (record['cacheVersion'] !== cacheVersion) return undefined
  if (record['url'] !== url) return undefined
  if (typeof record['storedAt'] !== 'string') return undefined
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    cacheVersion,
    url,
    storedAt: record['storedAt'],
    body: record['body'],
  }
}
