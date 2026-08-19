import { HttpRangeSource } from 'purejsimage/sources/http-range'

import { wrapFetchToExposeContentRange } from './cors-range-fetch.js'
import { tiffInspectionRefusal, tryInspectTiffSource } from './worker-host/cog-inspect.js'
import { assertRemoteUrl } from './worker-host/source-rpc.js'

export const RASTER_PREFLIGHT_RANGE_END = 65_535

export type RasterPreflightCompatibility =
  | 'ready'
  | 'checking'
  | 'metadata-only'
  | 'unsupported-scheme'
  | 'browser-network-blocked'
  | 'cors'
  | 'no-range'
  | 'content-encoding'
  | 'unsupported-tiff'
  | 'malformed-metadata'
  | 'unknown'

export interface RasterTransportProbe {
  readonly href: string
  readonly scheme: string
  readonly status?: number
  readonly rangeStatus?: 'partial' | 'full-body' | 'unsatisfiable' | 'error'
  readonly contentRange?: string
  readonly contentLength?: number
  readonly contentEncoding?: string
  readonly bytesRead: number
  readonly corsEvidence?: string
}

export interface RasterAssetPreflight {
  readonly href: string
  readonly compatibility: RasterPreflightCompatibility
  readonly title: string
  readonly message: string
  readonly guidance?: string
  readonly transport: RasterTransportProbe
  readonly raster?: {
    readonly compression?: string
    readonly tiled?: boolean
    readonly bigTiff?: boolean
    readonly width?: number
    readonly height?: number
  }
}

export interface RasterPreflightOptions {
  readonly fetch?: typeof fetch
  readonly signal?: AbortSignal
}

export async function preflightRasterAsset(
  href: string,
  options: RasterPreflightOptions = {},
): Promise<RasterAssetPreflight> {
  const scheme = schemeOf(href)
  if (
    scheme === 's3' ||
    scheme === 'file' ||
    scheme === 'ftp' ||
    scheme === 'data' ||
    scheme === 'javascript'
  ) {
    return {
      href,
      compatibility: scheme === 's3' ? 'metadata-only' : 'unsupported-scheme',
      title: scheme === 's3' ? 'Metadata only' : 'Unsupported URL scheme',
      message:
        scheme === 's3'
          ? 'This asset is s3:// requester-pays or unsigned object storage. Atlas will not guess an HTTPS URL.'
          : `Atlas can only range-read HTTP(S) rasters, not ${scheme}: URLs.`,
      transport: { href, scheme, bytesRead: 0 },
    }
  }
  let url: URL
  try {
    url = assertRemoteUrl(href)
  } catch {
    return {
      href,
      compatibility: 'unsupported-scheme',
      title: 'Unsupported URL scheme',
      message: 'Remote rasters must use HTTPS. HTTP is allowed only for localhost.',
      transport: { href, scheme, bytesRead: 0 },
    }
  }
  const baseFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const rangeFetch = wrapFetchToExposeContentRange(baseFetch)
  const headers = new Headers({ Range: `bytes=0-${String(RASTER_PREFLIGHT_RANGE_END)}` })
  let response: Response
  try {
    response = await rangeFetch(url, {
      method: 'GET',
      headers,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The raster URL could not be reached.'
    const cors = /cors|access-control-allow-origin/iu.test(message)
    return {
      href: url.href,
      compatibility: cors ? 'cors' : 'browser-network-blocked',
      title: cors ? 'CORS blocked this URL' : 'Browser blocked this URL',
      message,
      guidance: cors
        ? 'The server must allow this origin to issue GET requests with a Range header.'
        : 'The browser blocked the request. This is not classified as CORS unless the error names CORS.',
      transport: {
        href: url.href,
        scheme: url.protocol.replace(':', ''),
        bytesRead: 0,
        rangeStatus: 'error',
        ...(cors ? { corsEvidence: message } : {}),
      },
    }
  }
  const encoding = response.headers.get('content-encoding')
  if (encoding !== null && encoding.length > 0 && encoding.toLowerCase() !== 'identity') {
    return {
      href: url.href,
      compatibility: 'content-encoding',
      title: 'Compressed HTTP encoding',
      message: `The server encoded the body as ${encoding}. Range reads require identity encoding.`,
      transport: transportFromResponse(url, response, 0, encoding),
    }
  }
  if (response.status === 200) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      href: url.href,
      compatibility: 'no-range',
      title: 'Server lacks HTTP Range support',
      message: 'The server answered the Range probe with HTTP 200 (full body) instead of 206.',
      guidance: 'Cloud Optimized GeoTIFFs require HTTP 206 and a Content-Range header.',
      transport: transportFromResponse(url, response, bytes.byteLength, encoding, 'full-body'),
    }
  }
  if (response.status === 416) {
    return {
      href: url.href,
      compatibility: 'no-range',
      title: 'Range probe unsatisfiable',
      message: 'The server answered the Range probe with HTTP 416.',
      transport: transportFromResponse(url, response, 0, encoding, 'unsatisfiable'),
    }
  }
  if (response.status !== 206) {
    return {
      href: url.href,
      compatibility: 'browser-network-blocked',
      title: 'Range probe failed',
      message: `The Range probe failed with HTTP ${String(response.status)}.`,
      transport: transportFromResponse(url, response, 0, encoding, 'error'),
    }
  }
  const prefix = new Uint8Array(await response.arrayBuffer())
  const transport = transportFromResponse(url, response, prefix.byteLength, encoding, 'partial')
  try {
    const lifetime = new AbortController()
    const source = await HttpRangeSource.open(url, {
      blockBytes: 65_536,
      maxCacheBytes: 2 * 1024 * 1024,
      ...(options.signal === undefined ? {} : { openSignal: options.signal }),
      lifetimeSignal: lifetime.signal,
      fetch: rangeFetch,
    })
    try {
      const inspected = await tryInspectTiffSource(source, options.signal ?? lifetime.signal)
      const structured = tiffInspectionRefusal(inspected.inspection)
      if (structured !== undefined) {
        const classified = classifyInspectError(structured)
        return {
          href: url.href,
          compatibility: classified.compatibility,
          title: classified.title,
          message: classified.message,
          ...(classified.guidance === undefined ? {} : { guidance: classified.guidance }),
          transport,
        }
      }
      if (inspected.error !== undefined && inspected.inspection === undefined) {
        const classified = classifyInspectError(inspected.error)
        return {
          href: url.href,
          compatibility: classified.compatibility,
          title: classified.title,
          message: classified.message,
          ...(classified.guidance === undefined ? {} : { guidance: classified.guidance }),
          transport,
        }
      }
      const inspection = inspected.inspection
      const directory = inspection?.directories[0]
      return {
        href: url.href,
        compatibility: 'ready',
        title: 'Ready',
        message:
          'This raster supports HTTPS Range reads and PureJsImage can inspect the TIFF layout.',
        transport,
        raster: {
          ...(directory?.compression.name === undefined
            ? {}
            : { compression: directory.compression.name }),
          ...(directory === undefined ? {} : { tiled: directory.tiled }),
          ...(inspection === undefined ? {} : { bigTiff: inspection.container === 'BigTIFF' }),
          ...(directory === undefined ? {} : { width: directory.width, height: directory.height }),
        },
      }
    } finally {
      lifetime.abort()
    }
  } catch (error) {
    const classified = classifyInspectError(error)
    return {
      href: url.href,
      compatibility: classified.compatibility,
      title: classified.title,
      message: classified.message,
      ...(classified.guidance === undefined ? {} : { guidance: classified.guidance }),
      transport,
    }
  }
}

export function preflightBadgeLabel(compatibility: RasterPreflightCompatibility): string {
  switch (compatibility) {
    case 'checking':
      return 'Checking'
    case 'ready':
      return 'Ready'
    case 'metadata-only':
      return 'Metadata only'
    case 'unsupported-scheme':
      return 'Unsupported URL'
    case 'browser-network-blocked':
      return 'Browser blocked'
    case 'cors':
      return 'CORS blocked'
    case 'no-range':
      return 'No Range'
    case 'content-encoding':
      return 'Encoded body'
    case 'unsupported-tiff':
      return 'Unsupported TIFF'
    case 'malformed-metadata':
      return 'Malformed TIFF'
    case 'unknown':
      return 'Unknown'
  }
}

function schemeOf(href: string): string {
  const match = /^([a-z][a-z0-9+.-]*):/iu.exec(href)
  return match?.[1]?.toLowerCase() ?? ''
}

function transportFromResponse(
  url: URL,
  response: Response,
  bytesRead: number,
  encoding: string | null,
  rangeStatus?: RasterTransportProbe['rangeStatus'],
): RasterTransportProbe {
  const contentRange = response.headers.get('content-range') ?? undefined
  const contentLengthHeader = response.headers.get('content-length')
  const contentLength =
    contentLengthHeader === null || contentLengthHeader.length === 0
      ? undefined
      : Number(contentLengthHeader)
  return {
    href: url.href,
    scheme: url.protocol.replace(':', ''),
    status: response.status,
    bytesRead,
    ...(rangeStatus === undefined ? {} : { rangeStatus }),
    ...(contentRange === undefined ? {} : { contentRange }),
    ...(contentLength === undefined || !Number.isFinite(contentLength) ? {} : { contentLength }),
    ...(encoding === null || encoding.length === 0 ? {} : { contentEncoding: encoding }),
  }
}

function classifyInspectError(error: unknown): {
  readonly compatibility: RasterPreflightCompatibility
  readonly title: string
  readonly message: string
  readonly guidance?: string
} {
  const record =
    typeof error === 'object' && error !== null ? (error as { readonly code?: unknown }) : {}
  const code = typeof record.code === 'string' ? record.code : undefined
  const message = error instanceof Error ? error.message : 'TIFF inspection failed.'
  if (code === 'UNSUPPORTED_COMPRESSION' || /compress/iu.test(message)) {
    return {
      compatibility: 'unsupported-tiff',
      title: 'Unsupported TIFF compression',
      message,
    }
  }
  if (code === 'UNSUPPORTED_LAYOUT' || /layout|tile|strip/iu.test(message)) {
    return {
      compatibility: 'unsupported-tiff',
      title: 'Unsupported TIFF layout',
      message,
    }
  }
  if (code === 'MALFORMED_METADATA' || /malformed|truncated|geo.?tiff|ifd/iu.test(message)) {
    return {
      compatibility: 'malformed-metadata',
      title: 'Malformed GeoTIFF metadata',
      message,
    }
  }
  return {
    compatibility: 'unsupported-tiff',
    title: 'Unsupported TIFF',
    message,
  }
}
