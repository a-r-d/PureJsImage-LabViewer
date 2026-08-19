import type {
  StacAsset,
  StacAssetAlternate,
  StacBbox,
  StacCatalog,
  StacCollection,
  StacEoBand,
  StacItem,
  StacItemCollection,
  StacLink,
  StacProvider,
  StacRasterBand,
} from './types.js'
import { StacClientError } from './types.js'

export interface StacParseOptions {
  readonly baseHref?: string
}

export function parseStacCatalog(value: unknown, options?: StacParseOptions): StacCatalog {
  const record = asRecord(value, 'STAC catalog')
  const type = optionalString(record['type'])
  if (type !== undefined && type !== 'Catalog' && type !== 'Collection') {
    throw new StacClientError('INVALID_DOCUMENT', 'The STAC root is not a Catalog or Collection.')
  }
  const id = requiredString(record['id'], 'STAC catalog id')
  const links = parseLinks(record['links'], options?.baseHref)
  const conformsTo = parseStringArray(record['conformsTo'])
  const title = optionalString(record['title'])
  const description = optionalString(record['description'])
  const stacVersion = optionalString(record['stac_version'])
  const license = optionalString(record['license'])
  return {
    type: type === 'Collection' ? 'Collection' : 'Catalog',
    id,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(stacVersion === undefined ? {} : { stacVersion }),
    conformsTo,
    links,
    ...(license === undefined ? {} : { license }),
    providers: parseProviders(record['providers']),
  }
}

export function parseStacCollection(value: unknown, options?: StacParseOptions): StacCollection {
  const catalog = parseStacCatalog(value, options)
  const record = asRecord(value, 'STAC collection')
  const extent = isRecord(record['extent']) ? record['extent'] : undefined
  const spatial =
    extent !== undefined && isRecord(extent['spatial']) ? extent['spatial'] : undefined
  const temporal =
    extent !== undefined && isRecord(extent['temporal']) ? extent['temporal'] : undefined
  const bbox = firstBbox(spatial?.['bbox'])
  const interval = firstInterval(temporal?.['interval'])
  return {
    ...catalog,
    type: 'Collection',
    ...(bbox === undefined ? {} : { bbox }),
    ...(interval === undefined ? {} : { interval }),
  }
}

export function parseStacCollections(
  value: unknown,
  options?: StacParseOptions,
): readonly StacCollection[] {
  const record = asRecord(value, 'STAC collections')
  const collections = record['collections']
  if (!Array.isArray(collections)) {
    throw new StacClientError(
      'INVALID_DOCUMENT',
      'The collections document is missing collections.',
    )
  }
  return collections.map((collection) => parseStacCollection(collection, options))
}

export function parseStacItem(value: unknown, options?: StacParseOptions): StacItem {
  const record = asRecord(value, 'STAC item')
  if (record['type'] !== 'Feature') {
    throw new StacClientError('INVALID_DOCUMENT', 'A STAC item must be a GeoJSON Feature.')
  }
  const id = requiredString(record['id'], 'STAC item id')
  const properties = isRecord(record['properties']) ? record['properties'] : {}
  const assetsRecord = isRecord(record['assets']) ? record['assets'] : {}
  const assets = Object.entries(assetsRecord).map(([key, asset]) =>
    parseAsset(key, asset, options?.baseHref),
  )
  const links = parseLinks(record['links'], options?.baseHref)
  const bbox = parseStacBbox(record['bbox']) ?? parseStacBbox(properties['proj:bbox'])
  const datetime = optionalString(properties['datetime'])
  const startDatetime = optionalString(properties['start_datetime'])
  const endDatetime = optionalString(properties['end_datetime'])
  const projEpsg = optionalFinite(properties['proj:epsg'])
  const projCode = optionalString(properties['proj:code'])
  const projShape = parseShape(properties['proj:shape'])
  const projTransform = parseNumberArray(properties['proj:transform'])
  const eoBands = parseEoBands(properties['eo:bands'])
  const collection = optionalString(record['collection'])
  const license = optionalString(properties['license'])
  return {
    type: 'Feature',
    id,
    ...(collection === undefined ? {} : { collection }),
    ...(bbox === undefined ? {} : { bbox }),
    ...(datetime === undefined ? {} : { datetime }),
    ...(startDatetime === undefined ? {} : { startDatetime }),
    ...(endDatetime === undefined ? {} : { endDatetime }),
    ...(license === undefined ? {} : { license }),
    providers: parseProviders(properties['providers']),
    links,
    assets,
    stacExtensions: parseStringArray(record['stac_extensions']),
    ...(projEpsg === undefined ? {} : { projEpsg }),
    ...(projCode === undefined ? {} : { projCode }),
    ...(projShape === undefined ? {} : { projShape }),
    ...(projTransform === undefined ? {} : { projTransform }),
    eoBands,
  }
}

export function parseStacItemCollection(
  value: unknown,
  options?: StacParseOptions,
): StacItemCollection {
  const record = asRecord(value, 'STAC item collection')
  if (record['type'] !== 'FeatureCollection') {
    throw new StacClientError('INVALID_DOCUMENT', 'STAC search must return a FeatureCollection.')
  }
  const features = record['features']
  if (!Array.isArray(features)) {
    throw new StacClientError('INVALID_DOCUMENT', 'The FeatureCollection is missing features.')
  }
  const links = parseLinks(record['links'], options?.baseHref)
  const next = links.find((link) => link.rel === 'next')
  const numberMatched = optionalFinite(record['numberMatched'])
  const numberReturned = optionalFinite(record['numberReturned'])
  return {
    type: 'FeatureCollection',
    items: features.map((feature) => parseStacItem(feature, options)),
    links,
    ...(numberMatched === undefined ? {} : { numberMatched }),
    ...(numberReturned === undefined ? {} : { numberReturned }),
    ...(next === undefined ? {} : { nextHref: next.href, next }),
  }
}

export function resolveStacHref(href: string, baseHref: string | undefined): string {
  if (baseHref === undefined || baseHref.length === 0) return href
  try {
    return new URL(href, baseHref).toString()
  } catch {
    return href
  }
}

export function linkHref(links: readonly StacLink[], rel: string): string | undefined {
  return links.find((link) => link.rel === rel)?.href
}

function parseAsset(key: string, value: unknown, baseHref: string | undefined): StacAsset {
  const record = asRecord(value, `STAC asset ${key}`)
  const href = resolveStacHref(requiredString(record['href'], `STAC asset ${key} href`), baseHref)
  const roles = parseStringArray(record['roles'])
  const title = optionalString(record['title'])
  const type = optionalString(record['type'])
  const fileSize = optionalFinite(record['file:size'])
  const fileHeaderSize = optionalFinite(record['file:header_size'])
  const fileChecksum = optionalString(record['file:checksum'])
  const alternate = parseAlternate(record['alternate'], baseHref)
  return {
    key,
    href,
    ...(title === undefined ? {} : { title }),
    ...(type === undefined ? {} : { type }),
    roles,
    eoBands: parseEoBands(record['eo:bands']),
    rasterBands: parseRasterBands(record['raster:bands']),
    alternate,
    ...(fileSize === undefined ? {} : { fileSize }),
    ...(fileHeaderSize === undefined ? {} : { fileHeaderSize }),
    ...(fileChecksum === undefined ? {} : { fileChecksum }),
  }
}

function parseAlternate(
  value: unknown,
  baseHref: string | undefined,
): readonly StacAssetAlternate[] {
  if (!isRecord(value)) return []
  const alternate: StacAssetAlternate[] = []
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue
    const href = optionalString(entry['href'])
    if (href === undefined) continue
    alternate.push({ key, href: resolveStacHref(href, baseHref) })
  }
  return alternate
}

function parseLinks(value: unknown, baseHref: string | undefined): readonly StacLink[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new StacClientError('INVALID_DOCUMENT', 'STAC links must be an array.')
  }
  return value.map((entry, index) => {
    const record = asRecord(entry, `STAC link ${index}`)
    const type = optionalString(record['type'])
    const title = optionalString(record['title'])
    const method = optionalString(record['method'])
    const body = isRecord(record['body']) ? record['body'] : undefined
    const merge = record['merge'] === true ? true : undefined
    return {
      rel: requiredString(record['rel'], `STAC link ${index} rel`),
      href: resolveStacHref(requiredString(record['href'], `STAC link ${index} href`), baseHref),
      ...(type === undefined ? {} : { type }),
      ...(title === undefined ? {} : { title }),
      ...(method === undefined ? {} : { method }),
      ...(body === undefined ? {} : { body }),
      ...(merge === undefined ? {} : { merge }),
    }
  })
}

function parseProviders(value: unknown): readonly StacProvider[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) return []
  const providers: StacProvider[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const name = optionalString(entry['name'])
    if (name === undefined) continue
    const url = optionalString(entry['url'])
    providers.push({
      name,
      ...(url === undefined ? {} : { url }),
      roles: parseStringArray(entry['roles']),
    })
  }
  return providers
}

function parseEoBands(value: unknown): readonly StacEoBand[] {
  if (!Array.isArray(value)) return []
  const bands: StacEoBand[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const name = optionalString(entry['name'])
    const description = optionalString(entry['description'])
    const commonName = optionalString(entry['common_name'])
    bands.push({
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
      ...(commonName === undefined ? {} : { commonName }),
    })
  }
  return bands
}

function parseRasterBands(value: unknown): readonly StacRasterBand[] {
  if (!Array.isArray(value)) return []
  const bands: StacRasterBand[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const dataType = optionalString(entry['data_type'])
    const sampling = optionalString(entry['sampling'])
    const nodata = optionalFinite(entry['nodata'])
    const scale = optionalFinite(entry['scale'])
    const offset = optionalFinite(entry['offset'])
    bands.push({
      ...(dataType === undefined ? {} : { dataType }),
      ...(nodata === undefined ? {} : { nodata }),
      ...(scale === undefined ? {} : { scale }),
      ...(offset === undefined ? {} : { offset }),
      ...(sampling === undefined ? {} : { sampling }),
    })
  }
  return bands
}

export function parseStacBbox(value: unknown): StacBbox | undefined {
  if (!Array.isArray(value) || value.length < 4) return undefined
  const west = value[0]
  const south = value[1]
  const east = value[2]
  const north = value[3]
  if (
    typeof west !== 'number' ||
    typeof south !== 'number' ||
    typeof east !== 'number' ||
    typeof north !== 'number' ||
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north)
  ) {
    return undefined
  }
  return [west, south, east, north]
}

function firstBbox(value: unknown): StacBbox | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  return parseStacBbox(value[0])
}

function firstInterval(value: unknown): readonly [string | null, string | null] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const first = value[0]
  if (!Array.isArray(first) || first.length < 2) return undefined
  const start = first[0]
  const end = first[1]
  return [
    start === null || typeof start === 'string' ? start : null,
    end === null || typeof end === 'string' ? end : null,
  ]
}

function parseShape(value: unknown): readonly [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const height = value[0]
  const width = value[1]
  if (typeof height !== 'number' || typeof width !== 'number') return undefined
  if (!Number.isFinite(height) || !Number.isFinite(width)) return undefined
  return [height, width]
}

function parseNumberArray(value: unknown): readonly number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const numbers: number[] = []
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return undefined
    numbers.push(entry)
  }
  return numbers
}

function parseStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new StacClientError('INVALID_DOCUMENT', `${label} must be a JSON object.`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new StacClientError('INVALID_DOCUMENT', `${label} must be a non-empty string.`)
  }
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
