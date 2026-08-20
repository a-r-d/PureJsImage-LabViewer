import type { JsonValue } from '@pji-workbench/actions'

import { CRS_EPSG_4326, canTransformCrs, crsKey, sameCrs, transformMapPoint } from './crs.js'
import {
  type CrsReference,
  createGeoMapRoi,
  type GeoMapGeometry,
  type GeoMapPoint,
  type GeoMapRoi,
} from './model.js'

export const GEOJSON_LIMITS = Object.freeze({
  maxDocumentBytes: 4 * 1_024 * 1_024,
  maxFeatures: 2_000,
  maxTotalCoordinates: 100_000,
  maxNesting: 16,
  maxPropertyBytes: 32 * 1_024,
})

export type GeoJsonParseIssueCode =
  | 'INVALID_JSON'
  | 'INVALID_DOCUMENT'
  | 'UNSUPPORTED_GEOMETRY'
  | 'NON_FINITE_COORDINATE'
  | 'INVALID_COORDINATE'
  | 'LIMIT_EXCEEDED'
  | 'FORBIDDEN_KEY'
  | 'NON_PLAIN_OBJECT'
  | 'LEGACY_CRS_REQUIRES_CONFIRMATION'
  | 'UNSUPPORTED_CRS'
  | 'SELF_INTERSECTION'

export interface GeoJsonParseIssue {
  readonly code: GeoJsonParseIssueCode
  readonly severity: 'warning' | 'error'
  readonly path: string
  readonly message: string
}

export interface GeoJsonParseOptions {
  readonly limits?: Partial<typeof GEOJSON_LIMITS>
  readonly sourceName?: string
  readonly now?: () => string
  readonly idFactory?: (featureIndex: number) => string
  readonly legacyCrs?: Readonly<{
    confirmed: boolean
    definition?: CrsReference
  }>
  readonly selfIntersection?: 'reject' | 'allow-with-warning'
}

export interface GeoJsonParseResult {
  readonly rois: readonly GeoMapRoi[]
  readonly issues: readonly GeoJsonParseIssue[]
  readonly sourceCrs: CrsReference
  readonly requiresConfirmation: boolean
  readonly coordinateCount: number
}

export interface GeoJsonExportResult {
  readonly format: 'RFC7946-GeoJSON' | 'native-crs-GeoJSON'
  readonly compliant: boolean
  readonly crs: CrsReference
  readonly document: Readonly<Record<string, JsonValue>>
  readonly text: string
  readonly warnings: readonly string[]
}

interface ParseState {
  coordinates: number
  readonly limit: number
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export function parseGeoJson(
  input: string | Uint8Array | unknown,
  options: GeoJsonParseOptions = {},
): GeoJsonParseResult {
  const limits = { ...GEOJSON_LIMITS, ...options.limits }
  const issues: GeoJsonParseIssue[] = []
  const fail = (issue: GeoJsonParseIssue): GeoJsonParseResult => ({
    rois: [],
    issues: [...issues, issue],
    sourceCrs: CRS_EPSG_4326,
    requiresConfirmation: issue.code === 'LEGACY_CRS_REQUIRES_CONFIRMATION',
    coordinateCount: 0,
  })
  let value: unknown
  if (typeof input === 'string' || input instanceof Uint8Array) {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
    if (bytes.byteLength > limits.maxDocumentBytes) {
      return fail(issue('LIMIT_EXCEEDED', '$', 'GeoJSON document exceeds the byte limit'))
    }
    try {
      value = JSON.parse(
        typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input),
      )
    } catch {
      return fail(issue('INVALID_JSON', '$', 'GeoJSON document is not valid UTF-8 JSON'))
    }
  } else {
    value = input
    let bytes: number
    try {
      bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength
    } catch {
      return fail(issue('INVALID_DOCUMENT', '$', 'GeoJSON document must be JSON-safe'))
    }
    if (bytes > limits.maxDocumentBytes) {
      return fail(issue('LIMIT_EXCEEDED', '$', 'GeoJSON document exceeds the byte limit'))
    }
  }
  const structural = validateJsonStructure(value, '$', limits.maxNesting)
  if (structural !== undefined) return fail(structural)
  if (!plainRecord(value))
    return fail(issue('INVALID_DOCUMENT', '$', 'GeoJSON root must be an object'))

  const legacy = value['crs']
  let sourceCrs = CRS_EPSG_4326
  let legacyName: string | undefined
  if (legacy !== undefined) {
    legacyName = describeLegacyCrs(legacy)
    if (options.legacyCrs?.confirmed !== true) {
      return fail(
        issue(
          'LEGACY_CRS_REQUIRES_CONFIRMATION',
          '$.crs',
          `Legacy GeoJSON CRS ${legacyName} requires an explicit supported interpretation`,
          'warning',
        ),
      )
    }
    if (options.legacyCrs.definition === undefined) {
      return fail(issue('UNSUPPORTED_CRS', '$.crs', 'A supported CRS definition is required'))
    }
    sourceCrs = options.legacyCrs.definition
    if (!canTransformCrs(sourceCrs, CRS_EPSG_4326)) {
      return fail(
        issue(
          'UNSUPPORTED_CRS',
          '$.crs',
          `No supported transform is registered for ${crsKey(sourceCrs) ?? sourceCrs.name ?? 'the confirmed CRS'}`,
        ),
      )
    }
    issues.push(
      issue(
        'LEGACY_CRS_REQUIRES_CONFIRMATION',
        '$.crs',
        `Legacy CRS ${legacyName} was interpreted as ${crsKey(sourceCrs) ?? sourceCrs.name ?? 'custom CRS'}`,
        'warning',
      ),
    )
  }

  const candidates = featureCandidates(value)
  if (candidates instanceof Error) return fail(issue('INVALID_DOCUMENT', '$', candidates.message))
  if (candidates.length > limits.maxFeatures) {
    return fail(issue('LIMIT_EXCEEDED', '$.features', 'GeoJSON exceeds the feature-count limit'))
  }
  const state: ParseState = { coordinates: 0, limit: limits.maxTotalCoordinates }
  const rois: GeoMapRoi[] = []
  for (const [index, candidate] of candidates.entries()) {
    const path = candidates.length === 1 ? '$' : `$.features[${index}]`
    const parsed = parseFeature(candidate, path, state, limits.maxPropertyBytes)
    if ('issue' in parsed) return fail(parsed.issue)
    if (sameCrs(sourceCrs, CRS_EPSG_4326)) {
      const invalid = invalidWgs84Coordinate(parsed.geometry)
      if (invalid !== undefined)
        return fail(
          issue(
            'INVALID_COORDINATE',
            `${path}.geometry.coordinates`,
            `WGS84 longitude and latitude are out of range (${invalid.x}, ${invalid.y})`,
          ),
        )
    }
    const intersections = selfIntersections(parsed.geometry)
    if (intersections.length > 0) {
      const selfIssue = issue(
        'SELF_INTERSECTION',
        `${path}.geometry`,
        'Polygon rings self-intersect; raster masking would be ambiguous',
        options.selfIntersection === 'allow-with-warning' ? 'warning' : 'error',
      )
      issues.push(selfIssue)
      if (selfIssue.severity === 'error') {
        return {
          rois: [],
          issues,
          sourceCrs,
          requiresConfirmation: false,
          coordinateCount: state.coordinates,
        }
      }
    }
    const idValue = parsed.id
    const id =
      typeof idValue === 'string' || typeof idValue === 'number'
        ? `geojson:${String(idValue)}`
        : (options.idFactory?.(index) ?? `geojson:${index + 1}`)
    rois.push(
      createGeoMapRoi({
        id,
        ...(parsed.name === undefined ? {} : { name: parsed.name }),
        crs: sourceCrs,
        geometry: parsed.geometry,
        provenance: {
          kind: 'imported',
          format: legacy === undefined ? 'RFC7946-GeoJSON' : 'legacy-crs-GeoJSON',
          ...(options.sourceName === undefined ? {} : { sourceName: options.sourceName }),
          ...(legacyName === undefined
            ? {}
            : { legacyCrs: legacyName, interpretationConfirmed: true }),
        },
        createdAt: options.now?.() ?? new Date().toISOString(),
        ...(parsed.properties === undefined ? {} : { properties: parsed.properties }),
      }),
    )
  }
  return {
    rois,
    issues,
    sourceCrs,
    requiresConfirmation: false,
    coordinateCount: state.coordinates,
  }
}

export function exportGeoJson(
  rois: readonly GeoMapRoi[],
  options: Readonly<{
    nativeCrs?: boolean
    targetCrs?: CrsReference
    transformAccuracy?: Readonly<{ kind: 'exact' | 'approximate'; note?: string }>
    includeProperties?: boolean
  }> = {},
): GeoJsonExportResult {
  const native = options.nativeCrs === true
  const target = native ? (options.targetCrs ?? rois[0]?.crs ?? CRS_EPSG_4326) : CRS_EPSG_4326
  const warnings: string[] = []
  const transformsCoordinates = rois.some((roi) => !sameCrs(roi.crs, target))
  if (options.transformAccuracy?.kind === 'approximate') {
    warnings.push(options.transformAccuracy.note ?? 'The coordinate transform is approximate.')
  } else if (transformsCoordinates && options.transformAccuracy === undefined) {
    warnings.push(
      'Coordinate transform accuracy is not declared; treat the exported coordinates as approximate.',
    )
  }
  const features = rois.map((roi) => {
    if (!sameCrs(roi.crs, target) && !canTransformCrs(roi.crs, target)) {
      throw new Error(
        `No supported transform is available from ${crsKey(roi.crs) ?? 'unknown CRS'} to ${crsKey(target) ?? 'unknown CRS'}`,
      )
    }
    const geometry = sameCrs(roi.crs, target)
      ? roi.geometry
      : transformGeoMapGeometry(roi.geometry, roi.crs, target)
    const selected = options.includeProperties === false ? {} : (roi.properties ?? {})
    return {
      type: 'Feature',
      id: roi.id,
      geometry: geoJsonGeometry(geometry),
      properties: {
        ...selected,
        ...(roi.name === undefined ? {} : { name: roi.name }),
        'atlas:provenance': {
          createdAt: roi.createdAt,
          sourceCrs: crsKey(roi.crs) ?? roi.crs.name ?? roi.crs.kind,
          provenance: roi.provenance,
          exportTransform: {
            id: sameCrs(roi.crs, target)
              ? 'identity'
              : `proj4:${crsKey(roi.crs) ?? roi.crs.name ?? roi.crs.kind}->${crsKey(target) ?? target.name ?? target.kind}`,
            accuracy: sameCrs(roi.crs, target)
              ? 'exact'
              : (options.transformAccuracy?.kind ?? 'approximate'),
          },
        },
      },
    }
  })
  const document: Record<string, JsonValue> = {
    type: 'FeatureCollection',
    features: features as unknown as JsonValue,
    ...(native
      ? {
          'atlas:format': 'native-crs-GeoJSON',
          'atlas:crs': crsKey(target) ?? target.name ?? target.kind,
        }
      : {}),
  }
  return {
    format: native ? 'native-crs-GeoJSON' : 'RFC7946-GeoJSON',
    compliant: !native,
    crs: target,
    document,
    text: JSON.stringify(document, null, 2),
    warnings,
  }
}

export function transformGeoMapGeometry(
  geometry: GeoMapGeometry,
  from: CrsReference,
  to: CrsReference,
): GeoMapGeometry {
  const point = (value: GeoMapPoint): GeoMapPoint => transformMapPoint(value, from, to)
  switch (geometry.kind) {
    case 'point': {
      const transformed = point({ x: geometry.x, y: geometry.y })
      return { kind: 'point', ...transformed }
    }
    case 'multi-point':
      return { kind: 'multi-point', points: geometry.points.map(point) }
    case 'rectangle': {
      const corners = [
        point({ x: geometry.minX, y: geometry.minY }),
        point({ x: geometry.maxX, y: geometry.minY }),
        point({ x: geometry.maxX, y: geometry.maxY }),
        point({ x: geometry.minX, y: geometry.maxY }),
      ]
      return { kind: 'polygon', rings: [[...corners, corners[0] as GeoMapPoint]] }
    }
    case 'line':
      return { kind: 'line', points: geometry.points.map(point) }
    case 'multi-line':
      return { kind: 'multi-line', lines: geometry.lines.map((line) => line.map(point)) }
    case 'polygon':
      return { kind: 'polygon', rings: geometry.rings.map((ring) => ring.map(point)) }
    case 'multi-polygon':
      return {
        kind: 'multi-polygon',
        polygons: geometry.polygons.map((polygon) => polygon.map((ring) => ring.map(point))),
      }
  }
}

function parseFeature(
  value: Readonly<Record<string, unknown>>,
  path: string,
  state: ParseState,
  maxPropertyBytes: number,
):
  | Readonly<{
      geometry: GeoMapGeometry
      id?: string | number
      name?: string
      properties?: Readonly<Record<string, JsonValue>>
    }>
  | Readonly<{ issue: GeoJsonParseIssue }> {
  const feature = value['type'] === 'Feature'
  const geometryValue = feature ? value['geometry'] : value
  if (!plainRecord(geometryValue)) {
    return {
      issue: issue('INVALID_DOCUMENT', `${path}.geometry`, 'Feature geometry must be an object'),
    }
  }
  const geometry = parseGeometry(geometryValue, feature ? `${path}.geometry` : path, state)
  if ('issue' in geometry) return geometry
  if (!feature) return { geometry: geometry.geometry }
  const propertiesValue = value['properties']
  if (propertiesValue !== undefined && propertiesValue !== null && !plainRecord(propertiesValue)) {
    return {
      issue: issue(
        'INVALID_DOCUMENT',
        `${path}.properties`,
        'Feature properties must be an object or null',
      ),
    }
  }
  const properties =
    propertiesValue === null || propertiesValue === undefined ? undefined : propertiesValue
  if (properties !== undefined) {
    const bytes = new TextEncoder().encode(JSON.stringify(properties)).byteLength
    if (bytes > maxPropertyBytes) {
      return {
        issue: issue(
          'LIMIT_EXCEEDED',
          `${path}.properties`,
          'Feature properties exceed the byte limit',
        ),
      }
    }
  }
  const name = properties?.['name']
  return {
    geometry: geometry.geometry,
    ...(typeof value['id'] === 'string' || typeof value['id'] === 'number'
      ? { id: value['id'] }
      : {}),
    ...(typeof name === 'string' && name.length > 0 ? { name } : {}),
    ...(properties === undefined
      ? {}
      : { properties: properties as Readonly<Record<string, JsonValue>> }),
  }
}

function parseGeometry(
  value: Readonly<Record<string, unknown>>,
  path: string,
  state: ParseState,
): Readonly<{ geometry: GeoMapGeometry }> | Readonly<{ issue: GeoJsonParseIssue }> {
  const type = value['type']
  const coordinates = value['coordinates']
  const coordinate = (input: unknown, at: string): GeoMapPoint | GeoJsonParseIssue => {
    if (!Array.isArray(input) || input.length < 2)
      return issue('INVALID_DOCUMENT', at, 'Coordinate must contain longitude and latitude')
    const x = input[0]
    const y = input[1]
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      input.slice(2).some((ordinate) => typeof ordinate !== 'number' || !Number.isFinite(ordinate))
    ) {
      return issue('NON_FINITE_COORDINATE', at, 'Coordinates must be finite numbers')
    }
    state.coordinates += 1
    if (state.coordinates > state.limit)
      return issue('LIMIT_EXCEEDED', at, 'GeoJSON exceeds the total-coordinate limit')
    return { x: Object.is(x, -0) ? 0 : x, y: Object.is(y, -0) ? 0 : y }
  }
  const line = (
    input: unknown,
    at: string,
    minimum: number,
  ): readonly GeoMapPoint[] | GeoJsonParseIssue => {
    if (!Array.isArray(input) || input.length < minimum)
      return issue(
        'INVALID_DOCUMENT',
        at,
        `Coordinate sequence requires at least ${minimum} positions`,
      )
    const result: GeoMapPoint[] = []
    for (const [index, item] of input.entries()) {
      const next = coordinate(item, `${at}[${index}]`)
      if ('code' in next) return next
      result.push(next)
    }
    return result
  }
  const ring = (input: unknown, at: string): readonly GeoMapPoint[] | GeoJsonParseIssue => {
    const result = line(input, at, 4)
    if ('code' in result) return result
    const first = result[0]
    const last = result.at(-1)
    if (first === undefined || last === undefined || first.x !== last.x || first.y !== last.y) {
      return issue('INVALID_DOCUMENT', at, 'Polygon ring must be closed')
    }
    return result
  }
  if (type === 'Point') {
    const result = coordinate(coordinates, `${path}.coordinates`)
    return 'code' in result ? { issue: result } : { geometry: { kind: 'point', ...result } }
  }
  if (type === 'MultiPoint') {
    const result = line(coordinates, `${path}.coordinates`, 1)
    return 'code' in result
      ? { issue: result }
      : { geometry: { kind: 'multi-point', points: result } }
  }
  if (type === 'LineString') {
    const result = line(coordinates, `${path}.coordinates`, 2)
    return 'code' in result ? { issue: result } : { geometry: { kind: 'line', points: result } }
  }
  if (type === 'MultiLineString') {
    if (!Array.isArray(coordinates) || coordinates.length === 0)
      return {
        issue: issue('INVALID_DOCUMENT', `${path}.coordinates`, 'MultiLineString requires a line'),
      }
    const lines: (readonly GeoMapPoint[])[] = []
    for (const [index, item] of coordinates.entries()) {
      const result = line(item, `${path}.coordinates[${index}]`, 2)
      if ('code' in result) return { issue: result }
      lines.push(result)
    }
    return { geometry: { kind: 'multi-line', lines } }
  }
  const polygon = (
    input: unknown,
    at: string,
  ): readonly (readonly GeoMapPoint[])[] | GeoJsonParseIssue => {
    if (!Array.isArray(input) || input.length === 0)
      return issue('INVALID_DOCUMENT', at, 'Polygon requires a ring')
    const rings: (readonly GeoMapPoint[])[] = []
    for (const [index, item] of input.entries()) {
      const result = ring(item, `${at}[${index}]`)
      if ('code' in result) return result
      rings.push(result)
    }
    return rings
  }
  if (type === 'Polygon') {
    const result = polygon(coordinates, `${path}.coordinates`)
    return 'code' in result ? { issue: result } : { geometry: { kind: 'polygon', rings: result } }
  }
  if (type === 'MultiPolygon') {
    if (!Array.isArray(coordinates) || coordinates.length === 0)
      return {
        issue: issue('INVALID_DOCUMENT', `${path}.coordinates`, 'MultiPolygon requires a polygon'),
      }
    const polygons: (readonly (readonly GeoMapPoint[])[])[] = []
    for (const [index, item] of coordinates.entries()) {
      const result = polygon(item, `${path}.coordinates[${index}]`)
      if ('code' in result) return { issue: result }
      polygons.push(result)
    }
    return { geometry: { kind: 'multi-polygon', polygons } }
  }
  return {
    issue: issue(
      'UNSUPPORTED_GEOMETRY',
      `${path}.type`,
      `Unsupported GeoJSON geometry ${String(type)}`,
    ),
  }
}

function invalidWgs84Coordinate(geometry: GeoMapGeometry): GeoMapPoint | undefined {
  const invalid = (points: readonly GeoMapPoint[]) =>
    points.find(({ x, y }) => x < -180 || x > 180 || y < -90 || y > 90)
  switch (geometry.kind) {
    case 'point':
      return invalid([{ x: geometry.x, y: geometry.y }])
    case 'multi-point':
    case 'line':
      return invalid(geometry.points)
    case 'multi-line':
      return geometry.lines.map(invalid).find((point) => point !== undefined)
    case 'polygon':
      return geometry.rings.map(invalid).find((point) => point !== undefined)
    case 'multi-polygon':
      return geometry.polygons
        .flat()
        .map(invalid)
        .find((point) => point !== undefined)
    case 'rectangle':
      return invalid([
        { x: geometry.minX, y: geometry.minY },
        { x: geometry.maxX, y: geometry.maxY },
      ])
  }
}

function featureCandidates(
  value: Readonly<Record<string, unknown>>,
): readonly Readonly<Record<string, unknown>>[] | Error {
  if (value['type'] === 'FeatureCollection') {
    const features = value['features']
    if (!Array.isArray(features)) return new Error('FeatureCollection.features must be an array')
    if (!features.every(plainRecord))
      return new Error('Every FeatureCollection member must be an object')
    return features
  }
  if (value['type'] === 'Feature' || typeof value['type'] === 'string') return [value]
  return new Error('GeoJSON root must be a Feature, FeatureCollection, or supported geometry')
}

function validateJsonStructure(
  value: unknown,
  path: string,
  maxDepth: number,
  depth = 0,
): GeoJsonParseIssue | undefined {
  if (depth > maxDepth) return issue('LIMIT_EXCEEDED', path, 'GeoJSON exceeds the nesting limit')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return undefined
  if (typeof value === 'number')
    return Number.isFinite(value)
      ? undefined
      : issue('NON_FINITE_COORDINATE', path, 'JSON numbers must be finite')
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = validateJsonStructure(item, `${path}[${index}]`, maxDepth, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!plainRecord(value))
    return issue('NON_PLAIN_OBJECT', path, 'GeoJSON accepts plain JSON objects only')
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key))
      return issue('FORBIDDEN_KEY', `${path}.${key}`, `Forbidden key ${key}`)
    const found = validateJsonStructure(item, `${path}.${key}`, maxDepth, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

function plainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function issue(
  code: GeoJsonParseIssueCode,
  path: string,
  message: string,
  severity: 'warning' | 'error' = 'error',
): GeoJsonParseIssue {
  return { code, severity, path, message }
}

function describeLegacyCrs(value: unknown): string {
  if (!plainRecord(value)) return 'unrecognized legacy member'
  const properties = value['properties']
  if (plainRecord(properties) && typeof properties['name'] === 'string') return properties['name']
  return JSON.stringify(value).slice(0, 256)
}

function geoJsonGeometry(geometry: GeoMapGeometry): Readonly<Record<string, JsonValue>> {
  const pair = (point: GeoMapPoint): readonly [number, number] => [point.x, point.y]
  switch (geometry.kind) {
    case 'point':
      return { type: 'Point', coordinates: [geometry.x, geometry.y] }
    case 'multi-point':
      return { type: 'MultiPoint', coordinates: geometry.points.map(pair) }
    case 'rectangle': {
      const coordinates = [
        [
          [geometry.minX, geometry.minY],
          [geometry.maxX, geometry.minY],
          [geometry.maxX, geometry.maxY],
          [geometry.minX, geometry.maxY],
          [geometry.minX, geometry.minY],
        ],
      ]
      return { type: 'Polygon', coordinates }
    }
    case 'line':
      return { type: 'LineString', coordinates: geometry.points.map(pair) }
    case 'multi-line':
      return { type: 'MultiLineString', coordinates: geometry.lines.map((line) => line.map(pair)) }
    case 'polygon':
      return { type: 'Polygon', coordinates: geometry.rings.map((ring) => ring.map(pair)) }
    case 'multi-polygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.polygons.map((polygon) => polygon.map((ring) => ring.map(pair))),
      }
  }
}

function selfIntersections(geometry: GeoMapGeometry): readonly true[] {
  const polygons =
    geometry.kind === 'polygon'
      ? [geometry.rings]
      : geometry.kind === 'multi-polygon'
        ? geometry.polygons
        : []
  const found: true[] = []
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let first = 0; first < ring.length - 1; first += 1) {
        for (let second = first + 2; second < ring.length - 1; second += 1) {
          if (first === 0 && second === ring.length - 2) continue
          const a = ring[first]
          const b = ring[first + 1]
          const c = ring[second]
          const d = ring[second + 1]
          if (
            a !== undefined &&
            b !== undefined &&
            c !== undefined &&
            d !== undefined &&
            segmentsIntersect(a, b, c, d)
          )
            found.push(true)
        }
      }
    }
  }
  return found
}

function segmentsIntersect(
  a: GeoMapPoint,
  b: GeoMapPoint,
  c: GeoMapPoint,
  d: GeoMapPoint,
): boolean {
  const cross = (p: GeoMapPoint, q: GeoMapPoint, r: GeoMapPoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  return abC * abD < 0 && cdA * cdB < 0
}
