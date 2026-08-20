import { createScientificLibrary, type ScientificDocument } from 'purejsimage/scientific'
import { HttpRangeSource } from 'purejsimage/sources/http-range'
import { wrapFetchToExposeContentRange } from './cors-range-fetch.js'
import { datasetDescriptor, defaultPlaneSelection } from './descriptor.js'
import { tiffInspectionRefusal, tryInspectTiffSource } from './worker-host/cog-inspect.js'
import { assertRemoteUrl, sourceName } from './worker-host/source-rpc.js'
import { loadReadersForSource } from './worker-readers.js'

export const RASTER_PREFLIGHT_RANGE_END = 65_535

export type RasterPreflightStage =
  | 'metadata-only'
  | 'range-readable'
  | 'tiff-compatible'
  | 'decoder-ready'

export type RasterPreflightCompatibility =
  | 'ready'
  | 'checking'
  | 'range-readable'
  | 'tiff-compatible'
  | 'metadata-only'
  | 'unsupported-scheme'
  | 'browser-network-blocked'
  | 'cors'
  | 'no-range'
  | 'content-encoding'
  | 'unsupported-tiff'
  | 'malformed-metadata'
  | 'decoder-failed'
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
  readonly transferBytes: number
  readonly uniqueBytes: number
  readonly objectSize?: number
  readonly validator?: {
    readonly header: 'etag' | 'last-modified' | 'x-amz-version-id'
    readonly value: string
  }
  readonly corsEvidence?: string
}

export interface RasterDatasetSummary {
  readonly id: string
  readonly name?: string
  readonly sampleType: string
  readonly axes: readonly { readonly id: string; readonly length: number }[]
  readonly components: readonly { readonly id: string; readonly kind: string }[]
  readonly resolutionLevels: readonly number[]
}

export interface RasterAssetPreflight {
  readonly href: string
  readonly stage: RasterPreflightStage
  readonly compatibility: RasterPreflightCompatibility
  readonly title: string
  readonly message: string
  readonly guidance?: string
  readonly failureCode?: string
  readonly transport: RasterTransportProbe
  readonly raster?: {
    readonly compression?: string
    readonly tiled?: boolean
    readonly bigTiff?: boolean
    readonly width?: number
    readonly height?: number
  }
  readonly readerId?: string
  readonly dataset?: RasterDatasetSummary
}

export interface RasterPreflightOptions {
  readonly fetch?: typeof fetch
  readonly signal?: AbortSignal
  readonly stage?: RasterPreflightStage
}

interface ObservedRangeResponse {
  status?: number
  contentRange?: string
  contentLength?: number
  contentEncoding?: string
}

export async function preflightRasterAsset(
  href: string,
  options: RasterPreflightOptions = {},
): Promise<RasterAssetPreflight> {
  const requestedStage = options.stage ?? 'decoder-ready'
  const scheme = schemeOf(href)
  const metadataOnly = metadataOnlyReport(href, scheme, requestedStage)
  if (metadataOnly !== undefined) return metadataOnly
  let url: URL
  try {
    url = assertRemoteUrl(href)
  } catch {
    return failureReport({
      href,
      scheme,
      stage: requestedStage,
      compatibility: 'unsupported-scheme',
      title: 'Unsupported URL scheme',
      message: 'Remote rasters must use HTTPS. HTTP is allowed only for localhost.',
      failureCode: 'UNSUPPORTED_SCHEME',
    })
  }
  if (requestedStage === 'metadata-only') {
    return {
      href: url.href,
      stage: requestedStage,
      compatibility: 'metadata-only',
      title: 'Metadata only',
      message: 'Catalog metadata and URL scheme are valid. Raster bytes were not requested.',
      transport: emptyTransport(url.href, scheme),
    }
  }

  const baseFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const observed: ObservedRangeResponse = {}
  const boundedRangeFetch = wrapFetchToExposeContentRange(baseFetch)
  const trackedFetch: typeof fetch = async (input, init) => {
    const response = await boundedRangeFetch(input, init)
    if (new Headers(init?.headers).has('range')) {
      observed.status = response.status
      const contentRange = response.headers.get('content-range')
      const contentEncoding = response.headers.get('content-encoding')
      const contentLength = safeHeaderInteger(response.headers.get('content-length'))
      if (contentRange !== null) observed.contentRange = contentRange
      if (contentEncoding !== null) observed.contentEncoding = contentEncoding
      if (contentLength !== undefined) observed.contentLength = contentLength
    }
    return response
  }
  const lifetime = new AbortController()
  let source: HttpRangeSource | undefined
  let document: ScientificDocument | undefined
  let tiffCompatible = false
  try {
    source = await HttpRangeSource.open(url, {
      blockBytes: 65_536,
      maxCacheBytes: 2 * 1024 * 1024,
      ...(options.signal === undefined ? {} : { openSignal: options.signal }),
      lifetimeSignal: lifetime.signal,
      fetch: trackedFetch,
    })
    if (requestedStage === 'range-readable') {
      return successReport(url, requestedStage, 'range-readable', source, observed, {
        title: 'Range readable',
        message: 'The server returned one exact bounded byte range.',
      })
    }

    const inspected = await tryInspectTiffSource(source, options.signal ?? lifetime.signal)
    const refusal =
      tiffInspectionRefusal(inspected.inspection) ??
      (inspected.error === undefined || inspected.inspection !== undefined
        ? undefined
        : inspected.error)
    if (refusal !== undefined) {
      const classified = classifyFailure(refusal, observed)
      return failureFromClassified(url, requestedStage, source, observed, classified)
    }
    tiffCompatible = true
    const raster = rasterSummary(inspected.inspection)
    if (requestedStage === 'tiff-compatible') {
      return successReport(url, requestedStage, 'tiff-compatible', source, observed, {
        title: 'TIFF compatible',
        message: 'The bounded Range source exposes a recognized TIFF or BigTIFF layout.',
        ...(raster === undefined ? {} : { raster }),
      })
    }

    const readers = await loadReadersForSource(sourceName(url), { maxInputBytes: source.size })
    document = await createScientificLibrary({ readers }).open({
      primary: { id: 'preflight-primary', name: sourceName(url), source },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    const summary = document.datasets[0]
    if (summary === undefined) throw new Error('The scientific reader exposed no datasets.')
    const dataset = await document.openDataset(summary.id, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    await readNativeSample(dataset, summary, options.signal ?? lifetime.signal)
    return successReport(url, requestedStage, 'ready', source, observed, {
      title: 'Ready',
      message: 'PureJsImage opened the dataset and returned a bounded 1×1 native raster sample.',
      ...(raster === undefined ? {} : { raster }),
      readerId: document.reader.id,
      dataset: summarizeDataset(summary),
    })
  } catch (error) {
    if (options.signal?.aborted === true) throw error
    const initiallyClassified = classifyFailure(error, observed)
    const classified =
      tiffCompatible && initiallyClassified.compatibility === 'browser-network-blocked'
        ? {
            compatibility: 'decoder-failed' as const,
            title: 'Scientific reader could not decode this raster',
            message: initiallyClassified.message,
            failureCode: 'DECODER_FAILED',
          }
        : initiallyClassified
    return source === undefined
      ? failureReport({
          href: url.href,
          scheme: url.protocol.replace(':', ''),
          stage: requestedStage,
          ...classified,
          observed,
        })
      : failureFromClassified(url, requestedStage, source, observed, classified)
  } finally {
    await document?.close?.()
    lifetime.abort(new DOMException('Raster preflight complete', 'AbortError'))
  }
}

export function preflightBadgeLabel(compatibility: RasterPreflightCompatibility): string {
  switch (compatibility) {
    case 'checking':
      return 'Checking'
    case 'ready':
      return 'Ready'
    case 'range-readable':
      return 'Range readable'
    case 'tiff-compatible':
      return 'TIFF compatible'
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
    case 'decoder-failed':
      return 'Decoder failed'
    case 'unknown':
      return 'Unknown'
  }
}

async function readNativeSample(
  dataset: Awaited<ReturnType<ScientificDocument['openDataset']>>,
  summary: ScientificDocument['datasets'][number],
  signal: AbortSignal,
): Promise<void> {
  const plane = defaultPlaneSelection(datasetDescriptor(summary))
  let pixels = 0
  for await (const block of dataset.readPlane({
    displayAxes: plane.displayAxes,
    fixedIndices: plane.fixedIndices,
    resolutionLevel: plane.resolutionLevel,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    signal,
  })) {
    try {
      if (block.width < 1 || block.height < 1 || block.data.byteLength < 1) {
        throw new Error('The scientific reader returned an empty native sample.')
      }
      pixels += block.width * block.height
      if (pixels > 1) throw new Error('The scientific reader exceeded the 1×1 sample request.')
    } finally {
      block.release?.()
    }
  }
  if (pixels !== 1)
    throw new Error('The scientific reader did not return the requested 1×1 sample.')
}

function summarizeDataset(summary: ScientificDocument['datasets'][number]): RasterDatasetSummary {
  return {
    id: summary.id,
    ...(summary.name === undefined ? {} : { name: summary.name }),
    sampleType: summary.descriptor.sampleType,
    axes: summary.descriptor.axes.map(({ id, length }) => ({ id, length })),
    components: summary.descriptor.components.map(({ id, kind }) => ({ id, kind })),
    resolutionLevels: summary.descriptor.levels.map(({ level }) => level),
  }
}

function rasterSummary(
  inspection: Awaited<ReturnType<typeof tryInspectTiffSource>>['inspection'],
): RasterAssetPreflight['raster'] | undefined {
  const directory = inspection?.directories[0]
  if (directory === undefined && inspection === undefined) return undefined
  return {
    ...(directory?.compression.name === undefined
      ? {}
      : { compression: directory.compression.name }),
    ...(directory === undefined ? {} : { tiled: directory.tiled }),
    ...(inspection === undefined ? {} : { bigTiff: inspection.container === 'BigTIFF' }),
    ...(directory === undefined ? {} : { width: directory.width, height: directory.height }),
  }
}

function successReport(
  url: URL,
  stage: RasterPreflightStage,
  compatibility: 'range-readable' | 'tiff-compatible' | 'ready',
  source: HttpRangeSource,
  observed: ObservedRangeResponse,
  details: Pick<RasterAssetPreflight, 'title' | 'message'> &
    Partial<Pick<RasterAssetPreflight, 'raster' | 'readerId' | 'dataset'>>,
): RasterAssetPreflight {
  return {
    href: url.href,
    stage,
    compatibility,
    title: details.title,
    message: details.message,
    transport: transportFromSource(url, source, observed),
    ...(details.raster === undefined ? {} : { raster: details.raster }),
    ...(details.readerId === undefined ? {} : { readerId: details.readerId }),
    ...(details.dataset === undefined ? {} : { dataset: details.dataset }),
  }
}

function failureFromClassified(
  url: URL,
  stage: RasterPreflightStage,
  source: HttpRangeSource,
  observed: ObservedRangeResponse,
  classified: ClassifiedFailure,
): RasterAssetPreflight {
  return {
    href: url.href,
    stage,
    ...classified,
    transport: transportFromSource(url, source, observed),
  }
}

interface ClassifiedFailure {
  readonly compatibility: RasterPreflightCompatibility
  readonly title: string
  readonly message: string
  readonly guidance?: string
  readonly failureCode: string
}

function classifyFailure(error: unknown, observed: ObservedRangeResponse): ClassifiedFailure {
  const message = errorMessages(error).join(' ') || 'Raster compatibility validation failed.'
  const code = errorCode(error)
  if (observed.status === 200 || /probe returned status 200|returned status 200/iu.test(message)) {
    return {
      compatibility: 'no-range',
      title: 'Server lacks HTTP Range support',
      message: 'The server answered a Range request with HTTP 200 instead of 206.',
      guidance: 'Cloud Optimized GeoTIFF access requires exact HTTP 206 byte ranges.',
      failureCode: 'NO_RANGE',
    }
  }
  if (observed.status === 416 || /status 416/iu.test(message)) {
    return {
      compatibility: 'no-range',
      title: 'Range probe unsatisfiable',
      message,
      failureCode: 'RANGE_UNSATISFIABLE',
    }
  }
  if (/content encoding|content-encoded/iu.test(message)) {
    return {
      compatibility: 'content-encoding',
      title: 'Compressed HTTP encoding',
      message,
      failureCode: 'CONTENT_ENCODING',
    }
  }
  if (/cors|access-control-allow-origin/iu.test(message)) {
    return {
      compatibility: 'cors',
      title: 'CORS blocked this URL',
      message,
      guidance: 'The server must allow this origin to issue GET requests with a Range header.',
      failureCode: 'CORS',
    }
  }
  if (code === 'UNSUPPORTED_COMPRESSION' || /compress/iu.test(message)) {
    return {
      compatibility: 'unsupported-tiff',
      title: 'Unsupported TIFF compression',
      message,
      failureCode: 'UNSUPPORTED_COMPRESSION',
    }
  }
  if (code === 'UNSUPPORTED_LAYOUT' || /layout|tile|strip/iu.test(message)) {
    return {
      compatibility: 'unsupported-tiff',
      title: 'Unsupported TIFF layout',
      message,
      failureCode: 'UNSUPPORTED_LAYOUT',
    }
  }
  if (code === 'MALFORMED_METADATA' || /malformed|truncated|geo.?tiff|ifd/iu.test(message)) {
    return {
      compatibility: 'malformed-metadata',
      title: 'Malformed GeoTIFF metadata',
      message,
      failureCode: 'MALFORMED_METADATA',
    }
  }
  if (/reader|dataset|native sample|1×1|1x1/iu.test(message)) {
    return {
      compatibility: 'decoder-failed',
      title: 'Scientific reader could not decode this raster',
      message,
      failureCode: 'DECODER_FAILED',
    }
  }
  return {
    compatibility: 'browser-network-blocked',
    title: 'Raster validation failed',
    message,
    guidance:
      'Retry the asset. Browser network failures are not classified as CORS without CORS evidence.',
    failureCode: code ?? 'NETWORK_OR_INVALID_RESPONSE',
  }
}

function errorMessages(error: unknown): string[] {
  const messages: string[] = []
  let current: unknown = error
  const seen = new Set<unknown>()
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    if (current instanceof Error && current.message.length > 0) messages.push(current.message)
    current = current instanceof Error ? current.cause : undefined
  }
  return messages
}

function errorCode(error: unknown): string | undefined {
  let current: unknown = error
  const seen = new Set<unknown>()
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    const record = current as { readonly code?: unknown; readonly cause?: unknown }
    if (typeof record.code === 'string') return record.code
    current = record.cause
  }
  return undefined
}

function metadataOnlyReport(
  href: string,
  scheme: string,
  stage: RasterPreflightStage,
): RasterAssetPreflight | undefined {
  if (!['s3', 'file', 'ftp', 'data', 'javascript'].includes(scheme)) return undefined
  const isS3 = scheme === 's3'
  return {
    href,
    stage,
    compatibility: isS3 ? 'metadata-only' : 'unsupported-scheme',
    title: isS3 ? 'Metadata only' : 'Unsupported URL scheme',
    message: isS3
      ? 'This asset is s3:// object storage. Atlas will not guess an HTTPS URL.'
      : `Atlas can only range-read HTTP(S) rasters, not ${scheme}: URLs.`,
    ...(!isS3 ? { failureCode: 'UNSUPPORTED_SCHEME' } : {}),
    transport: {
      ...emptyTransport(href, scheme),
    },
  }
}

function failureReport(options: {
  readonly href: string
  readonly scheme: string
  readonly stage: RasterPreflightStage
  readonly compatibility: RasterPreflightCompatibility
  readonly title: string
  readonly message: string
  readonly guidance?: string
  readonly failureCode: string
  readonly observed?: ObservedRangeResponse
}): RasterAssetPreflight {
  return {
    href: options.href,
    stage: options.stage,
    compatibility: options.compatibility,
    title: options.title,
    message: options.message,
    ...(options.guidance === undefined ? {} : { guidance: options.guidance }),
    failureCode: options.failureCode,
    transport: {
      ...emptyTransport(options.href, options.scheme),
      ...(options.observed?.status === undefined ? {} : { status: options.observed.status }),
      ...(options.observed === undefined ? {} : observedTransport(options.observed)),
    },
  }
}

function transportFromSource(
  url: URL,
  source: HttpRangeSource,
  observed: ObservedRangeResponse,
): RasterTransportProbe {
  const stats = source.stats
  return {
    href: url.href,
    scheme: url.protocol.replace(':', ''),
    ...observedTransport(observed),
    bytesRead: stats.transferBytes,
    transferBytes: stats.transferBytes,
    uniqueBytes: stats.uniqueBytes,
    objectSize: source.size,
    ...(source.validator === undefined ? {} : { validator: source.validator }),
  }
}

function observedTransport(observed: ObservedRangeResponse): Partial<RasterTransportProbe> {
  const rangeStatus =
    observed.status === 206
      ? ('partial' as const)
      : observed.status === 200
        ? ('full-body' as const)
        : observed.status === 416
          ? ('unsatisfiable' as const)
          : observed.status === undefined
            ? undefined
            : ('error' as const)
  return {
    ...(observed.status === undefined ? {} : { status: observed.status }),
    ...(rangeStatus === undefined ? {} : { rangeStatus }),
    ...(observed.contentRange === undefined ? {} : { contentRange: observed.contentRange }),
    ...(observed.contentLength === undefined ? {} : { contentLength: observed.contentLength }),
    ...(observed.contentEncoding === undefined
      ? {}
      : { contentEncoding: observed.contentEncoding }),
  }
}

function emptyTransport(href: string, scheme: string): RasterTransportProbe {
  return { href, scheme, bytesRead: 0, transferBytes: 0, uniqueBytes: 0 }
}

function schemeOf(href: string): string {
  const match = /^([a-z][a-z0-9+.-]*):/iu.exec(href)
  return match?.[1]?.toLowerCase() ?? ''
}

function safeHeaderInteger(value: string | null): number | undefined {
  if (value === null || value.length === 0) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}
