import { crsKey } from './crs.js'
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

function formatFixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return 'NaN'
  return value.toFixed(digits)
}
