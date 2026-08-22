import type {
  CogInspectionReport,
  RpcErrorCode,
  StructuredRpcError,
} from '@pji-workbench/contracts'
import { BlobSource, type ImageSource } from 'purejsimage'
import type { GeoTiffStructuralReport } from 'purejsimage/geo/readers/geotiff'
import { inspectCog, openTiffDocument } from 'purejsimage/tiff'

import { tiffOpenLimits } from '../tiff-open-limits.js'

export function looksLikeTiffName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.tif') || lower.endsWith('.tiff') || lower.endsWith('.cog')
}

/** Compatibility adapter for the existing Atlas COG X-ray UI and telemetry contract. */
export function cogInspectionFromGeoTiffStructure(
  report: GeoTiffStructuralReport,
): CogInspectionReport {
  return {
    container: report.container,
    byteOrder: report.byteOrder,
    topLevelDirectoryCount: report.topLevelDirectoryCount,
    directories: report.directories.map((directory) => ({ ...directory })),
    issues: report.issues.map((issue) => ({ ...issue })),
    likelyCog: report.likelyCog,
  }
}

export async function inspectReadableTiff(
  source: ImageSource,
  signal: AbortSignal,
): Promise<CogInspectionReport | undefined> {
  const inspected = await tryInspectTiffSource(source, signal)
  const refusal =
    tiffInspectionRefusal(inspected.inspection) ??
    (inspected.error === undefined
      ? undefined
      : classifyTiffOpenFailure(inspected.error, undefined))
  if (refusal !== undefined) throw refusal
  return inspected.inspection
}

export async function tryInspectTiffSource(
  source: ImageSource,
  signal: AbortSignal,
): Promise<{
  readonly inspection?: CogInspectionReport
  readonly error?: unknown
}> {
  try {
    const document = await openTiffDocument(source, {
      signal,
      ...tiffOpenLimits(source.size),
    })
    const inspection = await inspectCog(document)
    return { inspection: JSON.parse(JSON.stringify(inspection)) as CogInspectionReport }
  } catch (error) {
    return { error }
  }
}

export function blobSourceFromFile(file: Blob): ImageSource {
  return new BlobSource(file)
}

/**
 * Striped GeoTIFFs are still readable; refuse codecs and tile tables that cannot be decoded.
 * inspectCog marks strips as errors because they are not Cloud Optimized.
 */
export function tiffInspectionRefusal(
  inspection: CogInspectionReport | undefined,
): StructuredRpcError | undefined {
  return classifyInspectionIssues(inspection, new Error('TIFF inspection rejected this source'))
}

export function classifyTiffOpenFailure(
  error: unknown,
  inspection: CogInspectionReport | undefined,
): StructuredRpcError | undefined {
  const fromIssues = classifyInspectionIssues(inspection, error)
  if (fromIssues !== undefined) return fromIssues
  const record =
    typeof error === 'object' && error !== null ? (error as { readonly code?: unknown }) : {}
  const cause = error instanceof Error ? error.cause : undefined
  const causeRecord =
    typeof cause === 'object' && cause !== null ? (cause as { readonly code?: unknown }) : {}
  const code =
    typeof record.code === 'string'
      ? record.code
      : typeof causeRecord.code === 'string'
        ? causeRecord.code
        : undefined
  const message = `${errorMessage(error)} ${errorMessage(cause)}`
  if (code === 'TRUNCATED_INPUT' || /truncated|unexpected end|exceeds the input/iu.test(message)) {
    return structuredOpenFailure(
      'MALFORMED_METADATA',
      error,
      'The GeoTIFF metadata is truncated or unreadable.',
    )
  }
  if (code === 'INVALID_INPUT' && /tiff (header|ifd|byte order|short|long)\b/iu.test(message)) {
    return structuredOpenFailure(
      'MALFORMED_METADATA',
      error,
      'The GeoTIFF metadata is truncated or unreadable.',
    )
  }
  if (/geo.?tiff|geo.?key|model(?:tiepoint|pixel.?scale)|spatial reference/iu.test(message)) {
    return structuredOpenFailure(
      'MALFORMED_METADATA',
      error,
      'The GeoTIFF georeferencing tags are malformed.',
    )
  }
  if (
    code === 'UNSUPPORTED_FORMAT' ||
    code === 'UNSUPPORTED_FEATURE' ||
    code === 'UNSUPPORTED_OPERATION'
  ) {
    if (/compress/iu.test(message)) {
      return structuredOpenFailure(
        'UNSUPPORTED_COMPRESSION',
        error,
        'This TIFF uses a compression codec that PureJsImage cannot decode.',
      )
    }
    if (/tile|strip|layout|ifd|overview/iu.test(message)) {
      return structuredOpenFailure(
        'UNSUPPORTED_LAYOUT',
        error,
        'This TIFF layout is not supported.',
      )
    }
  }
  return undefined
}

function classifyInspectionIssues(
  inspection: CogInspectionReport | undefined,
  error: unknown,
): StructuredRpcError | undefined {
  const issues = inspection?.issues ?? []
  if (
    issues.some((issue) => issue.severity === 'error' && issue.code === 'UNSUPPORTED_COMPRESSION')
  ) {
    return structuredOpenFailure(
      'UNSUPPORTED_COMPRESSION',
      error,
      'This TIFF uses a compression codec that PureJsImage cannot decode.',
    )
  }
  if (
    issues.some(
      (issue) =>
        issue.severity === 'error' &&
        (issue.code === 'MISSING_TILE_TABLE' || issue.code === 'INVALID_TILE_TABLE'),
    )
  ) {
    return structuredOpenFailure(
      'UNSUPPORTED_LAYOUT',
      error,
      'This TIFF layout cannot be opened as a Cloud Optimized GeoTIFF.',
    )
  }
  return undefined
}

function structuredOpenFailure(
  code: RpcErrorCode,
  error: unknown,
  guidance: string,
): StructuredRpcError {
  return {
    code,
    message: errorMessage(error),
    guidance,
    retryable: false,
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown worker error'
}
