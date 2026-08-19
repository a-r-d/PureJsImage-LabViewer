import type { DisplayMapping, StructuredRpcError } from '@pji-workbench/contracts'
import type { RasterStyle } from './model.js'
import type { StacClientError } from './stac/types.js'

export type GeoOpenFailureKind =
  | 'cors'
  | 'range'
  | 'unsupported-layout'
  | 'unsupported-compression'
  | 'malformed-metadata'
  | 'unsupported'
  | 'source-open-failed'
  | 'aborted'
  | 'catalog-unavailable'
  | 'catalog-too-large'
  | 'browser-network-blocked'
  | 'unsupported-scheme'
  | 'metadata-only'
  | 'expired-url'
  | 'other'

export interface GeoOpenFailure {
  readonly kind: GeoOpenFailureKind
  readonly title: string
  readonly message: string
  readonly guidance?: string
}

export function classifyStacClientError(error: StacClientError): GeoOpenFailure {
  switch (error.code) {
    case 'UNAVAILABLE':
      return {
        kind: 'catalog-unavailable',
        title: 'Catalog unavailable',
        message: error.message,
        guidance:
          error.guidance ??
          'The catalog may be offline or blocked by CORS. Cached metadata can still be used until you refresh.',
      }
    case 'NOT_FOUND':
      return {
        kind: 'catalog-unavailable',
        title: 'Catalog item not found',
        message: error.message,
        guidance: 'The collection or item may have been removed. Search again from the catalog.',
      }
    case 'INVALID_DOCUMENT':
      return {
        kind: 'malformed-metadata',
        title: 'Invalid STAC document',
        message: error.message,
      }
    case 'ABORTED':
      return {
        kind: 'aborted',
        title: 'Catalog request cancelled',
        message: error.message,
      }
    case 'TOO_LARGE':
      return {
        kind: 'catalog-too-large',
        title: 'Catalog is too large to browse',
        message: error.message,
        guidance:
          error.guidance ??
          'This static STAC item collection is too large to browse directly in the browser.',
      }
    default: {
      const unexpected: never = error.code
      return {
        kind: 'other',
        title: 'Catalog request failed',
        message: String(unexpected),
      }
    }
  }
}

export function classifyGeoOpenError(error: StructuredRpcError): GeoOpenFailure {
  switch (error.code) {
    case 'CORS_FAILED':
      return {
        kind: 'cors',
        title: 'CORS blocked this URL',
        message: error.message,
        guidance:
          error.guidance ??
          'The server must allow this origin to issue GET requests with a Range header.',
      }
    case 'RANGE_UNSUPPORTED':
      return {
        kind: 'range',
        title: 'Server lacks HTTP Range support',
        message: error.message,
        guidance:
          error.guidance ??
          'Cloud Optimized GeoTIFFs require HTTP 206 responses and a Content-Range header.',
      }
    case 'UNSUPPORTED_LAYOUT':
      return {
        kind: 'unsupported-layout',
        title: 'Unsupported TIFF layout',
        message: error.message,
        guidance: error.guidance ?? 'This file is not a readable tiled GeoTIFF or COG.',
      }
    case 'UNSUPPORTED_COMPRESSION':
      return {
        kind: 'unsupported-compression',
        title: 'Unsupported TIFF compression',
        message: error.message,
        guidance: error.guidance ?? 'PureJsImage cannot decode this compression codec.',
      }
    case 'MALFORMED_METADATA':
      return {
        kind: 'malformed-metadata',
        title: 'Malformed GeoTIFF metadata',
        message: error.message,
        guidance: error.guidance ?? 'The georeferencing tags could not be parsed.',
      }
    case 'UNSUPPORTED':
      return {
        kind: 'unsupported',
        title: 'Unsupported raster',
        message: error.message,
        ...(error.guidance === undefined ? {} : { guidance: error.guidance }),
      }
    case 'ABORTED':
      return {
        kind: 'aborted',
        title: 'Open cancelled',
        message: error.message,
      }
    case 'SOURCE_OPEN_FAILED':
      if (looksLikeExpiredUrl(error.message)) {
        return {
          kind: 'expired-url',
          title: 'Catalog asset URL expired',
          message: error.message,
          guidance:
            error.guidance ??
            'Search the catalog again. Shareable links store catalog/item/asset identity, not signed URLs.',
        }
      }
      return {
        kind: 'source-open-failed',
        title: 'Could not open this source',
        message: error.message,
        guidance:
          error.guidance ??
          'If this came from a catalog, refresh the item. Asset URLs can expire or lose Range/CORS support.',
      }
    case 'CORS_OR_RANGE_UNAVAILABLE':
      return {
        kind: 'range',
        title: 'Remote source is unavailable',
        message: error.message,
        guidance:
          error.guidance ??
          'If this came from a catalog, refresh the item. Asset URLs can expire or lose Range/CORS support.',
      }
    default:
      return {
        kind: 'other',
        title: 'Could not open this source',
        message: error.message,
        ...(error.guidance === undefined ? {} : { guidance: error.guidance }),
      }
  }
}

export function displayMappingFromStyle(
  style: RasterStyle,
  nodata: number | undefined,
): DisplayMapping {
  const mapping: DisplayMapping = {
    mode: 'linear',
    range: style.minimum !== undefined && style.maximum !== undefined ? 'manual' : 'auto',
    ...(style.minimum === undefined ? {} : { minimum: style.minimum }),
    ...(style.maximum === undefined ? {} : { maximum: style.maximum }),
    stretch: style.stretch ?? 'minmax',
    ...(style.percentileLow === undefined ? {} : { percentileLow: style.percentileLow }),
    ...(style.percentileHigh === undefined ? {} : { percentileHigh: style.percentileHigh }),
    ...(style.gamma === undefined ? {} : { gamma: style.gamma }),
    ...(nodata === undefined ? {} : { nodata }),
    nodataTransparent: style.nodataTransparent ?? true,
    bands: {
      ...(style.mapping.gray === undefined ? {} : { gray: style.mapping.gray }),
      ...(style.mapping.red === undefined ? {} : { red: style.mapping.red }),
      ...(style.mapping.green === undefined ? {} : { green: style.mapping.green }),
      ...(style.mapping.blue === undefined ? {} : { blue: style.mapping.blue }),
    },
  }
  return mapping
}

function looksLikeExpiredUrl(message: string): boolean {
  return /403|expired|AccessDenied|Request has expired|X-Amz-Expires/iu.test(message)
}
