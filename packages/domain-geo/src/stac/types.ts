export type StacBbox = readonly [number, number, number, number]

export interface StacLink {
  readonly rel: string
  readonly href: string
  readonly type?: string
  readonly title?: string
  readonly method?: string
  readonly body?: Readonly<Record<string, unknown>>
  readonly merge?: boolean
}

export interface StacProvider {
  readonly name: string
  readonly url?: string
  readonly roles?: readonly string[]
}

export interface StacEoBand {
  readonly name?: string
  readonly description?: string
  readonly commonName?: string
}

export interface StacRasterBand {
  readonly dataType?: string
  readonly nodata?: number
  readonly scale?: number
  readonly offset?: number
  readonly sampling?: string
}

export interface StacAssetAlternate {
  readonly key: string
  readonly href: string
}

export interface StacAsset {
  readonly key: string
  readonly href: string
  readonly title?: string
  readonly type?: string
  readonly roles: readonly string[]
  readonly eoBands: readonly StacEoBand[]
  readonly rasterBands: readonly StacRasterBand[]
  readonly alternate: readonly StacAssetAlternate[]
  readonly fileSize?: number
  readonly fileHeaderSize?: number
  readonly fileChecksum?: string
}

export interface StacCatalog {
  readonly type: 'Catalog' | 'Collection'
  readonly id: string
  readonly title?: string
  readonly description?: string
  readonly stacVersion?: string
  readonly conformsTo: readonly string[]
  readonly links: readonly StacLink[]
  readonly license?: string
  readonly providers: readonly StacProvider[]
}

export interface StacCollection extends StacCatalog {
  readonly type: 'Collection'
  readonly bbox?: StacBbox
  readonly interval?: readonly [string | null, string | null]
}

export interface StacItem {
  readonly type: 'Feature'
  readonly id: string
  readonly collection?: string
  readonly bbox?: StacBbox
  readonly datetime?: string
  readonly startDatetime?: string
  readonly endDatetime?: string
  readonly license?: string
  readonly providers: readonly StacProvider[]
  readonly links: readonly StacLink[]
  readonly assets: readonly StacAsset[]
  readonly stacExtensions: readonly string[]
  readonly projEpsg?: number
  readonly projCode?: string
  readonly projShape?: readonly [number, number]
  readonly projTransform?: readonly number[]
  readonly eoBands: readonly StacEoBand[]
}

export interface StacItemCollection {
  readonly type: 'FeatureCollection'
  readonly items: readonly StacItem[]
  readonly links: readonly StacLink[]
  readonly numberMatched?: number
  readonly numberReturned?: number
  readonly nextHref?: string
  readonly next?: StacLink
}

export type StacClientErrorCode =
  | 'UNAVAILABLE'
  | 'NOT_FOUND'
  | 'INVALID_DOCUMENT'
  | 'ABORTED'
  | 'TOO_LARGE'
  | 'NETWORK'

export class StacClientError extends Error {
  constructor(
    readonly code: StacClientErrorCode,
    message: string,
    readonly guidance?: string,
  ) {
    super(message)
    this.name = 'StacClientError'
  }
}

export interface StacSearchQuery {
  readonly bbox?: StacBbox
  readonly datetime?: string
  readonly collections?: readonly string[]
  readonly limit?: number
  readonly sortby?: string
}
