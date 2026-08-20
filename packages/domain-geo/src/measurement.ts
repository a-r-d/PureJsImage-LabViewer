import { crsKey } from './crs.js'
import type { CrsReference, GeoMapGeometry, GeoMapPoint } from './model.js'

export type PlanarLinearUnit = 'metre' | 'international-foot' | 'us-survey-foot'
export type GeoMeasurementMethod =
  | 'planar-cartesian'
  | 'vincenty-inverse-wgs84'
  | 'wgs84-authalic-sphere-area'

export interface GeoMeasurementValue {
  readonly value: number
  readonly unit: string
}

export interface GeoMeasurementResult {
  readonly quantity: 'distance' | 'area'
  readonly mode: 'planar' | 'geodesic'
  readonly method: GeoMeasurementMethod
  readonly crs: string
  readonly ellipsoid?: 'WGS84'
  readonly native: GeoMeasurementValue
  readonly converted: readonly GeoMeasurementValue[]
  readonly provenance: Readonly<{
    method: GeoMeasurementMethod
    crs: string
    ellipsoid?: 'WGS84'
    linearUnit?: PlanarLinearUnit
  }>
}

export type GeoMeasurementErrorCode =
  | 'INVALID_GEOMETRY'
  | 'INVALID_CRS'
  | 'UNSUPPORTED_UNIT'
  | 'METHOD_UNAVAILABLE'

export class GeoMeasurementError extends Error {
  constructor(
    readonly code: GeoMeasurementErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'GeoMeasurementError'
  }
}

const METRES_PER_UNIT: Readonly<Record<PlanarLinearUnit, number>> = {
  metre: 1,
  'international-foot': 0.3048,
  'us-survey-foot': 1_200 / 3_937,
}

export function measureGeoDistance(
  geometry: GeoMapGeometry,
  crs: CrsReference,
  options: Readonly<{ planarUnit?: PlanarLinearUnit }> = {},
): GeoMeasurementResult {
  const lines = geometryLines(geometry)
  if (lines.length === 0) {
    throw new GeoMeasurementError('INVALID_GEOMETRY', 'Distance requires a line geometry')
  }
  if (crs.kind === 'projected') {
    const unit = options.planarUnit ?? projectedUnit(crs)
    let distance = 0
    for (const line of lines) {
      for (let index = 1; index < line.length; index += 1) {
        const left = line[index - 1]
        const right = line[index]
        if (left !== undefined && right !== undefined)
          distance += Math.hypot(right.x - left.x, right.y - left.y)
      }
    }
    return planarResult('distance', distance, unit, crs)
  }
  if (crs.kind !== 'geographic') {
    throw new GeoMeasurementError(
      'INVALID_CRS',
      'Distance measurement requires an identified projected or geographic CRS',
    )
  }
  requireWgs84(crs)
  let metres = 0
  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) {
      const left = line[index - 1]
      const right = line[index]
      if (left !== undefined && right !== undefined) metres += vincentyDistance(left, right)
    }
  }
  return geodesicResult('distance', metres, 'vincenty-inverse-wgs84', crs)
}

export function measureGeoArea(
  geometry: GeoMapGeometry,
  crs: CrsReference,
  options: Readonly<{ planarUnit?: PlanarLinearUnit }> = {},
): GeoMeasurementResult {
  const polygons = geometryPolygons(geometry)
  if (polygons.length === 0) {
    throw new GeoMeasurementError(
      'INVALID_GEOMETRY',
      'Area requires a polygon or rectangle geometry',
    )
  }
  if (crs.kind === 'projected') {
    const unit = options.planarUnit ?? projectedUnit(crs)
    let area = 0
    for (const polygon of polygons) {
      const outer = polygon[0]
      if (outer !== undefined) area += Math.abs(signedPlanarRingArea(outer))
      for (const hole of polygon.slice(1)) area -= Math.abs(signedPlanarRingArea(hole))
    }
    return planarResult('area', Math.max(0, area), unit, crs)
  }
  if (crs.kind !== 'geographic') {
    throw new GeoMeasurementError(
      'INVALID_CRS',
      'Area measurement requires an identified projected or geographic CRS',
    )
  }
  requireWgs84(crs)
  let squareMetres = 0
  for (const polygon of polygons) {
    const outer = polygon[0]
    if (outer !== undefined) squareMetres += Math.abs(authalicRingArea(outer))
    for (const hole of polygon.slice(1)) squareMetres -= Math.abs(authalicRingArea(hole))
  }
  return geodesicResult('area', Math.max(0, squareMetres), 'wgs84-authalic-sphere-area', crs)
}

function planarResult(
  quantity: 'distance' | 'area',
  value: number,
  unit: PlanarLinearUnit,
  crs: CrsReference,
): GeoMeasurementResult {
  const exponent = quantity === 'area' ? 2 : 1
  const metres = value * METRES_PER_UNIT[unit] ** exponent
  const suffix = quantity === 'area' ? '²' : ''
  const nativeUnit = `${unit}${suffix}`
  const converted =
    quantity === 'area'
      ? [
          { value: metres, unit: 'm²' },
          { value: metres / METRES_PER_UNIT['international-foot'] ** 2, unit: 'ft²' },
          { value: metres / METRES_PER_UNIT['us-survey-foot'] ** 2, unit: 'US survey ft²' },
        ]
      : [
          { value: metres, unit: 'm' },
          { value: metres / METRES_PER_UNIT['international-foot'], unit: 'ft' },
          { value: metres / METRES_PER_UNIT['us-survey-foot'], unit: 'US survey ft' },
        ]
  const method = 'planar-cartesian' as const
  const identity = crsIdentity(crs)
  return {
    quantity,
    mode: 'planar',
    method,
    crs: identity,
    native: { value, unit: nativeUnit },
    converted,
    provenance: { method, crs: identity, linearUnit: unit },
  }
}

function geodesicResult(
  quantity: 'distance' | 'area',
  value: number,
  method: Extract<GeoMeasurementMethod, 'vincenty-inverse-wgs84' | 'wgs84-authalic-sphere-area'>,
  crs: CrsReference,
): GeoMeasurementResult {
  const identity = crsIdentity(crs)
  const converted =
    quantity === 'area'
      ? [
          { value: value / 1_000_000, unit: 'km²' },
          { value: value / METRES_PER_UNIT['international-foot'] ** 2, unit: 'ft²' },
        ]
      : [
          { value: value / 1_000, unit: 'km' },
          { value: value / METRES_PER_UNIT['international-foot'], unit: 'ft' },
        ]
  return {
    quantity,
    mode: 'geodesic',
    method,
    crs: identity,
    ellipsoid: 'WGS84',
    native: { value, unit: quantity === 'area' ? 'm²' : 'm' },
    converted,
    provenance: { method, crs: identity, ellipsoid: 'WGS84' },
  }
}

function projectedUnit(crs: CrsReference): PlanarLinearUnit {
  const identity = `${crsKey(crs) ?? ''} ${crs.name ?? ''}`.toLowerCase()
  if (
    identity.includes('us survey foot') ||
    identity.includes('us-ft') ||
    identity.includes('ftus')
  )
    return 'us-survey-foot'
  if (identity.includes('international foot') || /\bfoot\b|\bfeet\b|\bft\b/.test(identity))
    return 'international-foot'
  if (crsKey(crs) === 'EPSG:3857' || /\bmetre\b|\bmeter\b|\bmetres\b|\bmeters\b/.test(identity))
    return 'metre'
  throw new GeoMeasurementError(
    'UNSUPPORTED_UNIT',
    'Projected CRS linear units are unknown; select metre, international foot, or US survey foot explicitly',
  )
}

function requireWgs84(crs: CrsReference): void {
  if (crsKey(crs) === 'EPSG:4326') return
  throw new GeoMeasurementError(
    'METHOD_UNAVAILABLE',
    'WGS84 geodesic measurement requires EPSG:4326 geometry; transform the ROI with a supported operation first',
  )
}

function geometryLines(geometry: GeoMapGeometry): readonly (readonly GeoMapPoint[])[] {
  if (geometry.kind === 'line') return [geometry.points]
  if (geometry.kind === 'multi-line') return geometry.lines
  if (geometry.kind === 'polygon') return geometry.rings
  if (geometry.kind === 'multi-polygon') return geometry.polygons.flat()
  if (geometry.kind === 'rectangle') return geometryPolygons(geometry).flat()
  return []
}

function geometryPolygons(
  geometry: GeoMapGeometry,
): readonly (readonly (readonly GeoMapPoint[])[])[] {
  if (geometry.kind === 'polygon') return [geometry.rings]
  if (geometry.kind === 'multi-polygon') return geometry.polygons
  if (geometry.kind === 'rectangle') {
    return [
      [
        [
          { x: geometry.minX, y: geometry.minY },
          { x: geometry.maxX, y: geometry.minY },
          { x: geometry.maxX, y: geometry.maxY },
          { x: geometry.minX, y: geometry.maxY },
          { x: geometry.minX, y: geometry.minY },
        ],
      ],
    ]
  }
  return []
}

function signedPlanarRingArea(ring: readonly GeoMapPoint[]): number {
  let twiceArea = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    const left = ring[index]
    const right = ring[index + 1]
    if (left !== undefined && right !== undefined) twiceArea += left.x * right.y - right.x * left.y
  }
  return twiceArea / 2
}

// Vincenty's inverse solution on the WGS84 ellipsoid. It refuses the rare non-convergent case.
function vincentyDistance(left: GeoMapPoint, right: GeoMapPoint): number {
  const a = 6_378_137
  const flattening = 1 / 298.257_223_563
  const b = (1 - flattening) * a
  const phi1 = radians(left.y)
  const phi2 = radians(right.y)
  const longitude = normalizeRadians(radians(right.x - left.x))
  if (Math.abs(phi1 - phi2) < Number.EPSILON && Math.abs(longitude) < Number.EPSILON) return 0
  const reduced1 = Math.atan((1 - flattening) * Math.tan(phi1))
  const reduced2 = Math.atan((1 - flattening) * Math.tan(phi2))
  const sin1 = Math.sin(reduced1)
  const cos1 = Math.cos(reduced1)
  const sin2 = Math.sin(reduced2)
  const cos2 = Math.cos(reduced2)
  let lambda = longitude
  let sigma = 0
  let sinSigma = 0
  let cosSigma = 0
  let cosSquaredAlpha = 0
  let cos2SigmaM = 0
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const sinLambda = Math.sin(lambda)
    const cosLambda = Math.cos(lambda)
    sinSigma = Math.hypot(cos2 * sinLambda, cos1 * sin2 - sin1 * cos2 * cosLambda)
    if (sinSigma === 0) return 0
    cosSigma = sin1 * sin2 + cos1 * cos2 * cosLambda
    sigma = Math.atan2(sinSigma, cosSigma)
    const sinAlpha = (cos1 * cos2 * sinLambda) / sinSigma
    cosSquaredAlpha = 1 - sinAlpha * sinAlpha
    cos2SigmaM = cosSquaredAlpha === 0 ? 0 : cosSigma - (2 * sin1 * sin2) / cosSquaredAlpha
    const c = (flattening / 16) * cosSquaredAlpha * (4 + flattening * (4 - 3 * cosSquaredAlpha))
    const previous = lambda
    lambda =
      longitude +
      (1 - c) *
        flattening *
        sinAlpha *
        (sigma + c * sinSigma * (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM ** 2)))
    if (Math.abs(lambda - previous) <= 1e-12) {
      const uSquared = (cosSquaredAlpha * (a * a - b * b)) / (b * b)
      const coefficientA =
        1 + (uSquared / 16_384) * (4_096 + uSquared * (-768 + uSquared * (320 - 175 * uSquared)))
      const coefficientB =
        (uSquared / 1_024) * (256 + uSquared * (-128 + uSquared * (74 - 47 * uSquared)))
      const deltaSigma =
        coefficientB *
        sinSigma *
        (cos2SigmaM +
          (coefficientB / 4) *
            (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
              (coefficientB / 6) *
                cos2SigmaM *
                (-3 + 4 * sinSigma ** 2) *
                (-3 + 4 * cos2SigmaM ** 2)))
      return b * coefficientA * (sigma - deltaSigma)
    }
  }
  throw new GeoMeasurementError(
    'METHOD_UNAVAILABLE',
    'WGS84 geodesic distance did not converge for this segment',
  )
}

// Chamberlain-Duquette area on the WGS84 authalic sphere (radius 6371007.1809 m).
function authalicRingArea(ring: readonly GeoMapPoint[]): number {
  const radius = 6_371_007.1809
  let sum = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    const left = ring[index]
    const right = ring[index + 1]
    if (left === undefined || right === undefined) continue
    const deltaLongitude = normalizeRadians(radians(right.x - left.x))
    sum += deltaLongitude * (2 + Math.sin(radians(left.y)) + Math.sin(radians(right.y)))
  }
  return (sum * radius * radius) / 2
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function normalizeRadians(value: number): number {
  let normalized = value
  while (normalized > Math.PI) normalized -= 2 * Math.PI
  while (normalized < -Math.PI) normalized += 2 * Math.PI
  return normalized
}

function crsIdentity(crs: CrsReference): string {
  return crsKey(crs) ?? crs.name ?? crs.kind
}
