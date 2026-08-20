import { looksLikeTiffHref } from '../../stac/assets.js'
import { parseStacBbox } from '../../stac/parse.js'
import { StacClientError } from '../../stac/types.js'
import { type CatalogJsonFetchOptions, fetchCatalogJson } from '../json-fetch.js'
import type {
  CatalogCollectionSummary,
  CatalogCursor,
  CatalogRegistryEntry,
  CatalogSearchItem,
  CatalogSearchPage,
  CatalogSearchRequest,
  CatalogSourceCandidate,
} from '../types.js'
import type { CatalogAdapter } from './types.js'

const DEFAULT_PAGE_SIZE = 12
const GEOTIFF_ASSET_KEY = 'geotiff' as const

export function createTnmAccessAdapter(jsonOptions: CatalogJsonFetchOptions): CatalogAdapter {
  return {
    protocol: 'tnm-access',
    async listCollections(entry, signal) {
      const endpoint = tnmEndpoint(entry)
      try {
        const body = await fetchCatalogJson(jsonOptions, {
          href: endpoint.datasetsHref,
          ...(signal === undefined ? {} : { signal }),
        })
        const tags = datasetTagsFromBody(body)
        const selected = tags.filter((tag) => endpoint.datasetTags.includes(tag.id))
        if (selected.length > 0) {
          return selected.map(
            (tag): CatalogCollectionSummary => ({
              id: tag.id,
              title: tag.title,
            }),
          )
        }
      } catch (error) {
        if (error instanceof StacClientError && error.code === 'ABORTED') throw error
      }
      return endpoint.datasetTags.map(
        (tag): CatalogCollectionSummary => ({
          id: tag,
          title: tag,
        }),
      )
    },
    async search(entry, request, signal) {
      const endpoint = tnmEndpoint(entry)
      const offset = request.offset ?? 0
      const limit = request.limit ?? DEFAULT_PAGE_SIZE
      const datasets = (request.collections ?? endpoint.datasetTags).join(',')
      const href = productsHref(endpoint.productsHref, {
        datasets,
        ...(request.bbox === undefined ? {} : { bbox: request.bbox.join(',') }),
        ...tnmDateParams(request.datetime),
        prodFormats: 'GeoTIFF,TIFF',
        max: String(limit),
        offset: String(offset),
        outputFormat: 'json',
      })
      const body = await fetchCatalogJson(jsonOptions, {
        href,
        ...(signal === undefined ? {} : { signal }),
      })
      return productsPage(entry, body, request, offset, limit, href, endpoint.datasetTags[0])
    },
    async follow(entry, cursor, signal) {
      return this.search(entry, requestFromCursor(cursor), signal)
    },
    async resolveDeepLink(entry, identity, signal) {
      if (identity.href !== undefined && isDownloadableGeoTiff(identity.href, 'GeoTIFF')) {
        return {
          catalogId: entry.id,
          catalogTitle: entry.title,
          collectionId: identity.collectionId,
          itemId: identity.itemId,
          assetKey: identity.assetKey,
          href: identity.href,
          protocol: entry.protocol,
          label: identity.itemId,
          attribution: entry.attribution,
          license: entry.license,
          provider: entry.title,
          mediaType: 'image/tiff',
          roles: ['data'],
          bands: [],
          ...(identity.sourceUrl === undefined ? {} : { sourceUrl: identity.sourceUrl }),
        }
      }
      // Legacy links did not preserve the product href. Do not scan a national prefix and
      // accidentally resolve a different product; deterministic rehydration requires the href.
      signal?.throwIfAborted()
      return undefined
    },
  }
}

function tnmEndpoint(
  entry: CatalogRegistryEntry,
): Extract<CatalogRegistryEntry['endpoint'], { kind: 'tnm-access' }> {
  if (entry.endpoint.kind !== 'tnm-access') {
    throw new StacClientError('INVALID_DOCUMENT', 'TNMAccess adapter received a non-TNM catalog.')
  }
  return entry.endpoint
}

function productsHref(base: string, params: Readonly<Record<string, string>>): string {
  const url = new URL(base)
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value.length > 0) search.set(key, value)
  }
  url.search = search.toString()
  return url.toString()
}

function productsPage(
  entry: CatalogRegistryEntry,
  body: unknown,
  request: CatalogSearchRequest,
  offset: number,
  limit: number,
  href: string,
  fallbackTag: string | undefined,
): CatalogSearchPage {
  const record = asRecord(body)
  const errors = stringList(record['errors'])
  const messages = stringList(record['messages'])
  if (errors.length > 0) {
    throw new StacClientError('UNAVAILABLE', errors.join(' '), messages.join(' ') || undefined)
  }
  const rawItems = Array.isArray(record['items']) ? record['items'] : []
  const items = rawItems.flatMap((value) => {
    const item = tnmSearchItem(entry, value, request.collections?.[0] ?? fallbackTag)
    return item === undefined ? [] : [item]
  })
  const total = optionalInteger(record['total']) ?? items.length + offset
  const nextOffset = offset + items.length
  const next: CatalogCursor | undefined =
    nextOffset < total
      ? {
          href,
          method: 'GET',
          body: {
            kind: 'tnm-page',
            offset: nextOffset,
            limit,
            ...(request.bbox === undefined ? {} : { bbox: [...request.bbox] }),
            ...(request.datetime === undefined ? {} : { datetime: request.datetime }),
            ...(request.collections === undefined ? {} : { collections: [...request.collections] }),
          },
        }
      : undefined
  return {
    items,
    ...(next === undefined ? {} : { next }),
    numberMatched: total,
    numberReturned: items.length,
  }
}

function tnmSearchItem(
  entry: CatalogRegistryEntry,
  value: unknown,
  fallbackCollection: string | undefined,
): CatalogSearchItem | undefined {
  const record = asRecord(value)
  const itemId = optionalString(record['sourceId']) ?? optionalString(record['title'])
  if (itemId === undefined) return undefined
  const href = geotiffHref(record)
  if (href === undefined) return undefined
  const datasetsTag = firstString(record['datasets'])
  const collectionId = datasetsTag ?? fallbackCollection ?? 'geotiff'
  const bbox = tnmBbox(record['boundingBox'])
  const datetime = optionalString(record['publicationDate'])
  const title = optionalString(record['title']) ?? itemId
  const sourceUrl = optionalString(record['metaUrl']) ?? optionalString(record['moreInfo'])
  const candidate: CatalogSourceCandidate = {
    catalogId: entry.id,
    catalogTitle: entry.title,
    collectionId,
    itemId,
    assetKey: GEOTIFF_ASSET_KEY,
    href,
    protocol: entry.protocol,
    label: title,
    attribution: entry.attribution,
    license: entry.license,
    provider: entry.title,
    roles: ['data'],
    bands: [],
    ...(datetime === undefined ? {} : { datetime }),
    ...(bbox === undefined ? {} : { bbox }),
    mediaType: 'image/tiff',
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
  }
  return {
    id: itemId,
    collectionId,
    title,
    ...(datetime === undefined ? {} : { datetime }),
    ...(bbox === undefined ? {} : { bbox }),
    candidates: [candidate],
  }
}

function geotiffHref(record: Record<string, unknown>): string | undefined {
  const raster = optionalString(record['downloadURLRaster'])
  if (raster !== undefined && isDownloadableGeoTiff(raster, optionalString(record['format']))) {
    return raster
  }
  const direct = optionalString(record['downloadURL'])
  if (direct !== undefined && isDownloadableGeoTiff(direct, optionalString(record['format'])))
    return direct
  const urls = record['urls']
  if (isRecord(urls)) {
    for (const [format, value] of Object.entries(urls)) {
      if (typeof value === 'string' && isDownloadableGeoTiff(value, format)) return value
    }
  }
  const files = record['files']
  if (Array.isArray(files)) {
    for (const file of files) {
      if (!isRecord(file)) continue
      const href = optionalString(file['url']) ?? optionalString(file['href'])
      const format = optionalString(file['format']) ?? optionalString(file['type'])
      if (href !== undefined && isDownloadableGeoTiff(href, format)) return href
    }
  }
  return undefined
}

function isDownloadableGeoTiff(href: string, format: string | undefined): boolean {
  let pathname: string
  try {
    const url = new URL(href)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    pathname = url.pathname.toLowerCase()
  } catch {
    return false
  }
  if (/\.(zip|xml|json|txt|pdf)$/u.test(pathname)) return false
  if (format !== undefined && /geotiff|\btiff\b/iu.test(format) && looksLikeTiffHref(href)) {
    return true
  }
  return looksLikeTiffHref(href)
}

function tnmDateParams(datetime: string | undefined): Readonly<Record<string, string>> {
  if (datetime === undefined || datetime.length === 0) return {}
  const [rawStart, rawEnd] = datetime.split('/', 2)
  const start = normalizeTnmDate(rawStart)
  const end = normalizeTnmDate(rawEnd ?? rawStart)
  if (start === undefined || end === undefined) return {}
  return { dateType: 'Publication', start, end }
}

function normalizeTnmDate(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0 || value === '..') return undefined
  const date = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : undefined
}

function datasetTagsFromBody(
  value: unknown,
): readonly { readonly id: string; readonly title: string }[] {
  const rows = Array.isArray(value) ? value : []
  const tags: { readonly id: string; readonly title: string }[] = []
  for (const row of rows) {
    if (!isRecord(row)) continue
    const nested = row['tags']
    if (!Array.isArray(nested)) continue
    for (const tag of nested) {
      if (!isRecord(tag)) continue
      const id = optionalString(tag['sbDatasetTag'])
      const title = optionalString(tag['title']) ?? id
      if (id === undefined || title === undefined) continue
      tags.push({ id, title })
    }
  }
  return tags
}

function tnmBbox(value: unknown): readonly [number, number, number, number] | undefined {
  if (!isRecord(value)) return undefined
  const west = optionalNumber(value['minX'])
  const south = optionalNumber(value['minY'])
  const east = optionalNumber(value['maxX'])
  const north = optionalNumber(value['maxY'])
  if (west === undefined || south === undefined || east === undefined || north === undefined) {
    return undefined
  }
  return [west, south, east, north]
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

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (!Array.isArray(value)) return undefined
  const first = value.find((entry) => typeof entry === 'string' && entry.length > 0)
  return typeof first === 'string' ? first : undefined
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}
