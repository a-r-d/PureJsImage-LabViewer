import type {
  AtlasCatalogSession,
  StacCacheEntry,
  StacMetadataCache,
} from '@pji-workbench/domain-geo'
import { parseAtlasCatalogSession, serializeAtlasCatalogSession } from '@pji-workbench/domain-geo'

const CACHE_KEY = 'pji-atlas-stac-cache-v1'
const SESSION_KEY = 'pji-atlas-catalog-session-v1'
const MAX_CACHE_ENTRIES = 48

export function createLocalStacCache(): StacMetadataCache {
  return {
    async get(url) {
      const records = readCache()
      const entry = records[url]
      if (entry === undefined || entry.schemaVersion !== 1) return undefined
      return entry
    },
    async set(entry) {
      const records = readCache()
      records[entry.url] = entry
      const keys = Object.keys(records)
      if (keys.length > MAX_CACHE_ENTRIES) {
        const extra = keys.slice(0, keys.length - MAX_CACHE_ENTRIES)
        for (const key of extra) delete records[key]
      }
      writeCache(records)
    },
    async invalidate(url) {
      if (url === undefined) {
        window.localStorage.removeItem(CACHE_KEY)
        return
      }
      const records = readCache()
      delete records[url]
      writeCache(records)
    },
  }
}

export function readAtlasSession(): AtlasCatalogSession | undefined {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (raw === null) return undefined
    return parseAtlasCatalogSession(JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

export function writeAtlasSession(session: AtlasCatalogSession): void {
  window.localStorage.setItem(SESSION_KEY, serializeAtlasCatalogSession(session))
}

function readCache(): Record<string, StacCacheEntry> {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, StacCacheEntry>
  } catch {
    return {}
  }
}

function writeCache(records: Record<string, StacCacheEntry>): void {
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(records))
}
