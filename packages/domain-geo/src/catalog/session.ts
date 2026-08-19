import type { RasterStyle } from '../model.js'
import type { AtlasCatalogSession, CatalogAssetProvenance } from './types.js'
import { ATLAS_SESSION_SCHEMA_VERSION } from './types.js'

export function serializeAtlasCatalogSession(session: AtlasCatalogSession): string {
  return JSON.stringify(session)
}

export function parseAtlasCatalogSession(value: unknown): AtlasCatalogSession | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  if (record['schemaVersion'] !== ATLAS_SESSION_SCHEMA_VERSION) return undefined
  const provenance = parseProvenance(record['provenance'])
  const label = requiredString(record['label'])
  if (provenance === undefined || label === undefined) return undefined
  const style = parseStyle(record['style'])
  return {
    schemaVersion: ATLAS_SESSION_SCHEMA_VERSION,
    provenance,
    label,
    ...(style === undefined ? {} : { style }),
  }
}

export function parseProvenance(value: unknown): CatalogAssetProvenance | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const catalogId = requiredString(record['catalogId'])
  const catalogTitle = requiredString(record['catalogTitle'])
  const collectionId = requiredString(record['collectionId'])
  const itemId = requiredString(record['itemId'])
  const assetKey = requiredString(record['assetKey'])
  const href = requiredString(record['href'])
  if (
    catalogId === undefined ||
    catalogTitle === undefined ||
    collectionId === undefined ||
    itemId === undefined ||
    assetKey === undefined ||
    href === undefined
  ) {
    return undefined
  }
  if (href.startsWith('data:') || href.includes('X-Amz-Signature') || href.includes('token=')) {
    return undefined
  }
  const provider = requiredString(record['provider'])
  const license = requiredString(record['license'])
  const attribution = requiredString(record['attribution'])
  const sourceUrl = requiredString(record['sourceUrl'])
  const protocol = requiredString(record['protocol'])
  return {
    catalogId,
    catalogTitle,
    collectionId,
    itemId,
    assetKey,
    href,
    ...(provider === undefined ? {} : { provider }),
    ...(license === undefined ? {} : { license }),
    ...(attribution === undefined ? {} : { attribution }),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(protocol === undefined ? {} : { protocol }),
  }
}

function parseStyle(value: unknown): RasterStyle | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const mapping = asRecord(record['mapping'])
  if (mapping === undefined) return undefined
  const gray = optionalIndex(mapping['gray'])
  const red = optionalIndex(mapping['red'])
  const green = optionalIndex(mapping['green'])
  const blue = optionalIndex(mapping['blue'])
  if (gray === undefined && red === undefined && green === undefined && blue === undefined) {
    return undefined
  }
  const stretch = record['stretch']
  const percentileLow = optionalFinite(record['percentileLow'])
  const percentileHigh = optionalFinite(record['percentileHigh'])
  return {
    mapping: {
      ...(gray === undefined ? {} : { gray }),
      ...(red === undefined ? {} : { red }),
      ...(green === undefined ? {} : { green }),
      ...(blue === undefined ? {} : { blue }),
    },
    ...(stretch === 'minmax' || stretch === 'percentile' ? { stretch } : {}),
    ...(percentileLow === undefined ? {} : { percentileLow }),
    ...(percentileHigh === undefined ? {} : { percentileHigh }),
  }
}

function optionalFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function requiredString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalIndex(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
