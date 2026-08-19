import { CRS_EPSG_4326, CrsTransformError, crsKey, transformMapPoint } from './crs.js'
import type { CrsReference, GeoMapPoint } from './model.js'

export function formatMapPointerReadout(world: GeoMapPoint, crs: CrsReference): string {
  const key = crsKey(crs)
  if (key === 'EPSG:4326') {
    return `${formatFixed(world.x, 6)}°, ${formatFixed(world.y, 6)}°`
  }
  if (key === 'EPSG:3857') {
    return `${formatFixed(world.x, 2)} m, ${formatFixed(world.y, 2)} m`
  }
  const label = key ?? crs.name ?? crs.kind
  return `${formatFixed(world.x, 4)}, ${formatFixed(world.y, 4)} · ${label}`
}

export interface GeoCursorReadoutInput {
  readonly pixel: GeoMapPoint
  readonly world: GeoMapPoint
  readonly crs: CrsReference
  readonly bands: readonly Readonly<{ name: string; value: number | undefined }>[]
}

export function formatGeoCursorReadout(input: GeoCursorReadoutInput): string {
  const pixel = `px ${formatFixed(input.pixel.x, 2)}, ${formatFixed(input.pixel.y, 2)}`
  const source = `src ${formatMapPointerReadout(input.world, input.crs)}`
  const wgs84 = formatWgs84(input.world, input.crs)
  const bands = input.bands
    .map((band) => `${band.name}=${band.value === undefined ? '—' : formatFixed(band.value, 4)}`)
    .join(' ')
  return [pixel, source, wgs84, bands].filter((part) => part.length > 0).join(' · ')
}

function formatWgs84(world: GeoMapPoint, crs: CrsReference): string {
  try {
    const geographic = transformMapPoint(world, crs, CRS_EPSG_4326)
    return `WGS84 ${formatFixed(geographic.y, 6)}°, ${formatFixed(geographic.x, 6)}°`
  } catch (error) {
    if (error instanceof CrsTransformError) return ''
    throw error
  }
}

function formatFixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return 'NaN'
  return value.toFixed(digits)
}
