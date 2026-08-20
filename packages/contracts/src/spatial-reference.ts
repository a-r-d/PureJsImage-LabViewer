import type { RpcJsonObject, RpcJsonValue } from './analysis.js'

/** Six-parameter affine: x' = a*x + b*y + c, y' = d*x + e*y + f. */
export type AffineTransform = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
]

export type CrsKind = 'projected' | 'geographic' | 'unknown'
export type PixelInterpretation = 'pixel-is-area' | 'pixel-is-point' | 'unspecified'

export interface CoordinateReferenceSystem {
  readonly kind: CrsKind
  readonly authority?: string
  readonly code?: number | string
  readonly name?: string
}

export interface SpatialBounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export type SpatialNoData =
  | Readonly<{ kind: 'scalar'; value: number | string }>
  | Readonly<{ kind: 'components'; values: readonly (number | string)[] }>

/**
 * JSON-safe PureJsImage 0.15.0 spatial reference.
 * Additive on dataset descriptors; the Worker RPC envelope stays schemaVersion 1.
 */
export interface SpatialReference {
  readonly crs: CoordinateReferenceSystem
  readonly pixelInterpretation: PixelInterpretation
  readonly pixelToModel?: AffineTransform
  readonly modelToPixel?: AffineTransform
  readonly bounds?: SpatialBounds
  readonly noData?: SpatialNoData
  readonly metadata?: RpcJsonObject
}

export interface SpatialReferenceFact {
  readonly label: string
  readonly value: string
}

export class SpatialReferenceError extends Error {
  constructor(
    readonly code: 'INVALID_PAYLOAD' | 'LIMIT_EXCEEDED',
    message: string,
  ) {
    super(message)
    this.name = 'SpatialReferenceError'
  }
}

const CRS_KEYS = ['kind', 'authority', 'code', 'name'] as const
const SPATIAL_KEYS = [
  'crs',
  'pixelInterpretation',
  'pixelToModel',
  'modelToPixel',
  'bounds',
  'noData',
  'metadata',
] as const
const BOUNDS_KEYS = ['minX', 'minY', 'maxX', 'maxY'] as const
const CRS_EXTRA_KEY = 'purejsimage:crs-extra'
const SPATIAL_EXTRA_KEY = 'purejsimage:spatial-extra'
const GEOTIFF_METADATA_KEY = 'purejsimage:geotiff'
const MAX_STRING_LENGTH = 4_096
const MAX_ITEMS = 256
const MAX_METADATA_DEPTH = 8

interface SpatialCandidate {
  readonly authority?: unknown
  readonly bounds?: unknown
  readonly code?: unknown
  readonly crs?: unknown
  readonly kind?: unknown
  readonly maxX?: unknown
  readonly maxY?: unknown
  readonly metadata?: unknown
  readonly minX?: unknown
  readonly minY?: unknown
  readonly modelToPixel?: unknown
  readonly name?: unknown
  readonly noData?: unknown
  readonly pixelInterpretation?: unknown
  readonly pixelToModel?: unknown
  readonly value?: unknown
  readonly values?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonObject(value: RpcJsonValue): value is RpcJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordValue(value: unknown, label: string): SpatialCandidate {
  if (!isRecord(value)) {
    throw new SpatialReferenceError('INVALID_PAYLOAD', `${label} must be an object`)
  }
  return value as SpatialCandidate
}

function extraKeys(input: SpatialCandidate, allowed: readonly string[]): string[] {
  return Object.keys(input).filter((key) => !allowed.includes(key))
}

function extraRecord(input: SpatialCandidate, keys: readonly string[]): Record<string, unknown> {
  const record = input as Record<string, unknown>
  return Object.fromEntries(keys.map((key) => [key, record[key]]))
}

function jsonValue(value: unknown, label: string, depth = 0): RpcJsonValue {
  if (depth > MAX_METADATA_DEPTH) {
    throw new SpatialReferenceError('LIMIT_EXCEEDED', `${label} exceeds the nesting limit`)
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new SpatialReferenceError('INVALID_PAYLOAD', `${label} must be finite`)
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      throw new SpatialReferenceError('LIMIT_EXCEEDED', `${label} exceeds the string limit`)
    }
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ITEMS) {
      throw new SpatialReferenceError('LIMIT_EXCEEDED', `${label} exceeds the item limit`)
    }
    return value.map((item, index) => jsonValue(item, `${label}[${index}]`, depth + 1))
  }
  if (!isRecord(value)) {
    throw new SpatialReferenceError('INVALID_PAYLOAD', `${label} must be JSON-safe`)
  }
  const entries = Object.entries(value)
  if (entries.length > MAX_ITEMS) {
    throw new SpatialReferenceError('LIMIT_EXCEEDED', `${label} exceeds the item limit`)
  }
  return Object.fromEntries(
    entries.map(([key, item]) => {
      if (key.length > MAX_STRING_LENGTH) {
        throw new SpatialReferenceError('LIMIT_EXCEEDED', `${label} contains an oversized key`)
      }
      return [key, jsonValue(item, `${label}.${key}`, depth + 1)]
    }),
  )
}

function jsonObject(value: unknown, label: string): RpcJsonObject {
  const converted = jsonValue(value, label)
  if (!isJsonObject(converted)) {
    throw new SpatialReferenceError('INVALID_PAYLOAD', `${label} must be an object`)
  }
  return converted
}

function mergeMetadata(
  base: RpcJsonObject | undefined,
  extras: Readonly<Record<string, RpcJsonValue>>,
): RpcJsonObject | undefined {
  const keys = Object.keys(extras)
  if (keys.length === 0) return base
  return { ...(base ?? {}), ...extras }
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new SpatialReferenceError('INVALID_PAYLOAD', `${label} must be a non-empty string`)
  }
  if (value.length > MAX_STRING_LENGTH) {
    throw new SpatialReferenceError('LIMIT_EXCEEDED', `${label} exceeds the string limit`)
  }
  return value
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SpatialReferenceError('INVALID_PAYLOAD', `${label} must be finite`)
  }
  return Object.is(value, -0) ? 0 : value
}

function affineTransform(value: unknown, label: string): AffineTransform {
  if (!Array.isArray(value) || value.length !== 6) {
    throw new SpatialReferenceError('INVALID_PAYLOAD', `${label} must contain exactly six values`)
  }
  return [
    finiteNumber(value[0], `${label}[0]`),
    finiteNumber(value[1], `${label}[1]`),
    finiteNumber(value[2], `${label}[2]`),
    finiteNumber(value[3], `${label}[3]`),
    finiteNumber(value[4], `${label}[4]`),
    finiteNumber(value[5], `${label}[5]`),
  ]
}

function noDataValue(value: unknown, label: string): number | string {
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      throw new SpatialReferenceError('LIMIT_EXCEEDED', `${label} exceeds the string limit`)
    }
    return value
  }
  return finiteNumber(value, label)
}

function crsKind(value: unknown, extras: Record<string, RpcJsonValue>, label: string): CrsKind {
  if (value === 'projected' || value === 'geographic' || value === 'unknown') return value
  extras['kind'] = jsonValue(value, `${label}.kind`)
  return 'unknown'
}

function pixelInterpretation(
  value: unknown,
  extras: Record<string, RpcJsonValue>,
  label: string,
): PixelInterpretation {
  if (value === 'pixel-is-area' || value === 'pixel-is-point' || value === 'unspecified') {
    return value
  }
  extras['pixelInterpretation'] = jsonValue(value, `${label}.pixelInterpretation`)
  return 'unspecified'
}

function coordinateReferenceSystem(
  value: unknown,
  extras: Record<string, RpcJsonValue>,
  label: string,
): CoordinateReferenceSystem {
  const input = recordValue(value, label)
  const unknownKeys = extraKeys(input, CRS_KEYS)
  if (unknownKeys.length > 0) {
    extras[CRS_EXTRA_KEY] = jsonObject(extraRecord(input, unknownKeys), `${label} extra fields`)
  }
  const kind = crsKind(input.kind, extras, label)
  const authority = optionalString(input.authority, `${label}.authority`)
  const name = optionalString(input.name, `${label}.name`)
  let code: number | string | undefined
  if (input.code !== undefined) {
    if (typeof input.code === 'number') {
      if (!Number.isSafeInteger(input.code) || input.code < 0) {
        throw new SpatialReferenceError(
          'INVALID_PAYLOAD',
          `${label}.code must be a non-negative integer or string`,
        )
      }
      code = input.code
    } else if (typeof input.code === 'string') {
      code = optionalString(input.code, `${label}.code`)
    } else {
      throw new SpatialReferenceError('INVALID_PAYLOAD', `${label}.code must be a number or string`)
    }
  }
  if ((authority === undefined) !== (code === undefined)) {
    throw new SpatialReferenceError(
      'INVALID_PAYLOAD',
      `${label} authority and code must be provided together`,
    )
  }
  return {
    kind,
    ...(authority === undefined ? {} : { authority }),
    ...(code === undefined ? {} : { code }),
    ...(name === undefined ? {} : { name }),
  }
}

function spatialBounds(value: unknown, label: string): SpatialBounds {
  const input = recordValue(value, label)
  const unknownKeys = extraKeys(input, BOUNDS_KEYS)
  if (unknownKeys.length > 0) {
    throw new SpatialReferenceError(
      'INVALID_PAYLOAD',
      `${label} has unsupported field ${unknownKeys[0]}`,
    )
  }
  const minX = finiteNumber(input.minX, `${label}.minX`)
  const minY = finiteNumber(input.minY, `${label}.minY`)
  const maxX = finiteNumber(input.maxX, `${label}.maxX`)
  const maxY = finiteNumber(input.maxY, `${label}.maxY`)
  if (minX > maxX || minY > maxY) {
    throw new SpatialReferenceError('INVALID_PAYLOAD', `${label} are inverted`)
  }
  return { minX, minY, maxX, maxY }
}

function spatialNoData(value: unknown, componentCount: number, label: string): SpatialNoData {
  const input = recordValue(value, label)
  if (input.kind === 'scalar') {
    const unknownKeys = extraKeys(input, ['kind', 'value'])
    if (unknownKeys.length > 0) {
      throw new SpatialReferenceError(
        'INVALID_PAYLOAD',
        `${label} has unsupported field ${unknownKeys[0]}`,
      )
    }
    return { kind: 'scalar', value: noDataValue(input.value, `${label}.value`) }
  }
  if (input.kind === 'components') {
    const unknownKeys = extraKeys(input, ['kind', 'values'])
    if (unknownKeys.length > 0) {
      throw new SpatialReferenceError(
        'INVALID_PAYLOAD',
        `${label} has unsupported field ${unknownKeys[0]}`,
      )
    }
    if (!Array.isArray(input.values)) {
      throw new SpatialReferenceError('INVALID_PAYLOAD', `${label}.values must be an array`)
    }
    if (input.values.length !== componentCount) {
      throw new SpatialReferenceError(
        'INVALID_PAYLOAD',
        `${label}.values must match the dataset component count`,
      )
    }
    return {
      kind: 'components',
      values: input.values.map((entry, index) => noDataValue(entry, `${label}.values[${index}]`)),
    }
  }
  throw new SpatialReferenceError('INVALID_PAYLOAD', `${label}.kind is unsupported`)
}

export interface NormalizeSpatialReferenceOptions {
  readonly componentCount: number
  readonly label?: string
}

/** Validate and copy a JSON-safe spatial reference. Extra CRS fields are kept in metadata. */
export function normalizeSpatialReference(
  value: unknown,
  options: NormalizeSpatialReferenceOptions,
): SpatialReference {
  const label = options.label ?? 'spatialReference'
  const input = recordValue(value, label)
  const extras: Record<string, RpcJsonValue> = {}
  const unknownKeys = extraKeys(input, SPATIAL_KEYS)
  if (unknownKeys.length > 0) {
    extras[SPATIAL_EXTRA_KEY] = jsonObject(extraRecord(input, unknownKeys), `${label} extra fields`)
  }
  const crs = coordinateReferenceSystem(input.crs, extras, `${label}.crs`)
  const interpretation = pixelInterpretation(input.pixelInterpretation, extras, label)
  const pixelToModel =
    input.pixelToModel === undefined
      ? undefined
      : affineTransform(input.pixelToModel, `${label}.pixelToModel`)
  const modelToPixel =
    input.modelToPixel === undefined
      ? undefined
      : affineTransform(input.modelToPixel, `${label}.modelToPixel`)
  if (modelToPixel !== undefined && pixelToModel === undefined) {
    throw new SpatialReferenceError(
      'INVALID_PAYLOAD',
      `${label}.modelToPixel requires pixelToModel`,
    )
  }
  const bounds =
    input.bounds === undefined ? undefined : spatialBounds(input.bounds, `${label}.bounds`)
  const noData =
    input.noData === undefined
      ? undefined
      : spatialNoData(input.noData, options.componentCount, `${label}.noData`)
  const metadata = mergeMetadata(
    input.metadata === undefined ? undefined : jsonObject(input.metadata, `${label}.metadata`),
    extras,
  )
  return {
    crs,
    pixelInterpretation: interpretation,
    ...(pixelToModel === undefined ? {} : { pixelToModel }),
    ...(modelToPixel === undefined ? {} : { modelToPixel }),
    ...(bounds === undefined ? {} : { bounds }),
    ...(noData === undefined ? {} : { noData }),
    ...(metadata === undefined ? {} : { metadata }),
  }
}

function formatAffine(values: AffineTransform): string {
  return `[${values.map((value) => String(value)).join(', ')}]`
}

function crsLabel(crs: CoordinateReferenceSystem): string {
  const parts: string[] = []
  switch (crs.kind) {
    case 'projected':
      parts.push('Projected')
      break
    case 'geographic':
      parts.push('Geographic')
      break
    case 'unknown':
      parts.push('Unknown')
      break
    default: {
      const unexpected: never = crs.kind
      return String(unexpected)
    }
  }
  if (crs.authority !== undefined && crs.code !== undefined) {
    parts.push(`${crs.authority}:${crs.code}`)
  }
  if (crs.name !== undefined) parts.push(crs.name)
  return parts.join(' · ')
}

function pixelInterpretationLabel(value: PixelInterpretation): string {
  switch (value) {
    case 'pixel-is-area':
      return 'Pixel is area'
    case 'pixel-is-point':
      return 'Pixel is point'
    case 'unspecified':
      return 'Unspecified'
    default: {
      const unexpected: never = value
      return String(unexpected)
    }
  }
}

function geotiffRecord(metadata: RpcJsonObject | undefined): RpcJsonObject | undefined {
  if (metadata === undefined) return undefined
  const geotiff = metadata[GEOTIFF_METADATA_KEY]
  if (geotiff === undefined || !isJsonObject(geotiff)) return undefined
  return geotiff
}

function noDataLabel(noData: SpatialNoData): string {
  switch (noData.kind) {
    case 'scalar':
      return String(noData.value)
    case 'components':
      return noData.values.map((value) => String(value)).join(', ')
    default: {
      const unexpected: never = noData
      return String(unexpected)
    }
  }
}

/** Inspector-safe facts from a typed spatial reference. Does not scrape dataset metadata. */
export function spatialReferenceFacts(
  reference: SpatialReference,
): readonly SpatialReferenceFact[] {
  const facts: SpatialReferenceFact[] = [{ label: 'CRS', value: crsLabel(reference.crs) }]
  const geotiff = geotiffRecord(reference.metadata)
  const citation =
    geotiff !== undefined && typeof geotiff['citation'] === 'string'
      ? geotiff['citation']
      : undefined
  if (citation !== undefined && citation !== reference.crs.name) {
    facts.push({ label: 'CRS citation', value: citation })
  }
  facts.push({
    label: 'Raster type',
    value: pixelInterpretationLabel(reference.pixelInterpretation),
  })
  if (reference.pixelToModel !== undefined) {
    facts.push({ label: 'Pixel to model', value: formatAffine(reference.pixelToModel) })
  }
  if (reference.modelToPixel !== undefined) {
    facts.push({ label: 'Model to pixel', value: formatAffine(reference.modelToPixel) })
  }
  if (reference.bounds !== undefined) {
    const { minX, minY, maxX, maxY } = reference.bounds
    facts.push({
      label: 'Model bounds',
      value: `${minX} … ${maxX} × ${minY} … ${maxY}`,
    })
  }
  if (reference.noData !== undefined) {
    facts.push({ label: 'NoData', value: noDataLabel(reference.noData) })
  }
  const extras = reference.metadata?.[CRS_EXTRA_KEY]
  if (extras !== undefined) {
    facts.push({ label: 'CRS metadata', value: JSON.stringify(extras) })
  }
  return facts
}
