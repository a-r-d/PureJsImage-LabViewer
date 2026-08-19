import type { CoordinateReferenceSystem } from '@pji-workbench/contracts'
import proj4 from 'proj4'

import type { CrsReference, GeoMapPoint } from './model.js'

export type CrsTransformErrorCode =
  | 'UNSUPPORTED_CRS'
  | 'UNSUPPORTED_TRANSFORM'
  | 'INVALID_COORDINATE'

export class CrsTransformError extends Error {
  constructor(
    readonly code: CrsTransformErrorCode,
    message: string,
    readonly from?: CrsReference,
    readonly to?: CrsReference,
  ) {
    super(message)
    this.name = 'CrsTransformError'
  }
}

const EPSG_4326 = 'EPSG:4326'
const EPSG_3857 = 'EPSG:3857'
const SUPPORTED_TRANSFORM_KEYS = new Set([EPSG_4326, EPSG_3857])

export const CRS_EPSG_4326: CrsReference = Object.freeze({
  kind: 'geographic',
  authority: 'EPSG',
  code: 4_326,
  name: 'WGS 84',
})

export const CRS_EPSG_3857: CrsReference = Object.freeze({
  kind: 'projected',
  authority: 'EPSG',
  code: 3_857,
  name: 'WGS 84 / Pseudo-Mercator',
})

let definitionsReady = false

export function crsKey(crs: CoordinateReferenceSystem): string | undefined {
  if (crs.authority === undefined || crs.code === undefined) return undefined
  return `${crs.authority.trim().toUpperCase()}:${String(crs.code).trim()}`
}

export function sameCrs(left: CrsReference, right: CrsReference): boolean {
  const leftKey = crsKey(left)
  const rightKey = crsKey(right)
  if (leftKey !== undefined && rightKey !== undefined) return leftKey === rightKey
  return (
    left.kind === right.kind &&
    left.authority === right.authority &&
    left.code === right.code &&
    left.name === right.name
  )
}

export function canTransformCrs(from: CrsReference, to: CrsReference): boolean {
  if (sameCrs(from, to)) return true
  const fromKey = crsKey(from)
  const toKey = crsKey(to)
  return (
    fromKey !== undefined &&
    toKey !== undefined &&
    SUPPORTED_TRANSFORM_KEYS.has(fromKey) &&
    SUPPORTED_TRANSFORM_KEYS.has(toKey)
  )
}

export function transformMapPoint(
  point: GeoMapPoint,
  from: CrsReference,
  to: CrsReference,
): GeoMapPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new CrsTransformError('INVALID_COORDINATE', 'Map coordinates must be finite', from, to)
  }
  if (sameCrs(from, to)) return { x: point.x, y: point.y }
  const fromKey = requireSupportedKey(from, to)
  const toKey = requireSupportedKey(to, from)
  if (!SUPPORTED_TRANSFORM_KEYS.has(fromKey) || !SUPPORTED_TRANSFORM_KEYS.has(toKey)) {
    throw new CrsTransformError(
      'UNSUPPORTED_CRS',
      `No transform is available for ${fromKey} to ${toKey}`,
      from,
      to,
    )
  }
  ensureProjectedDefinitions()
  const result = proj4(fromKey, toKey, [point.x, point.y])
  const x = result[0]
  const y = result[1]
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    throw new CrsTransformError(
      'INVALID_COORDINATE',
      `Transforming ${fromKey} to ${toKey} produced a non-finite coordinate`,
      from,
      to,
    )
  }
  return { x, y }
}

function requireSupportedKey(crs: CrsReference, other: CrsReference): string {
  const key = crsKey(crs)
  if (key === undefined) {
    throw new CrsTransformError(
      'UNSUPPORTED_CRS',
      'The CRS has no authority and code, so it cannot be projected',
      crs,
      other,
    )
  }
  return key
}

function ensureProjectedDefinitions(): void {
  if (definitionsReady) return
  proj4.defs(EPSG_4326, '+proj=longlat +datum=WGS84 +no_defs')
  proj4.defs(
    EPSG_3857,
    '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
  )
  definitionsReady = true
}
