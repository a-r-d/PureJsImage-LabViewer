import type { WorkerRequest, WorkerResponse } from '@pji-workbench/contracts'
import { type NumericTile, numericTileSampleOffset } from 'purejsimage/scientific'

export function numericValue(tile: NumericTile, x: number, y: number, component: number): number {
  return Number(tile.data[numericTileSampleOffset(tile, x, y, component)])
}

export function mapTile(
  tile: NumericTile,
  component: number,
  mapping: Extract<WorkerRequest, { kind: 'tile.request' }>['payload']['mapping'],
): Pick<
  Extract<WorkerResponse, { kind: 'tile.ready' }>['payload'],
  'rgba' | 'values' | 'range' | 'histogram'
> {
  if (component >= tile.componentCount) throw new RangeError('Selected component is unavailable')
  const length = tile.width * tile.height
  const values = new Float32Array(length)
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const value = numericValue(tile, x, y, component)
      values[y * tile.width + x] = value
      if (Number.isFinite(value)) {
        minimum = Math.min(minimum, value)
        maximum = Math.max(maximum, value)
      }
    }
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    minimum = 0
    maximum = 1
  }
  const automatic = mapping.range === 'auto'
  const low = mapping.minimum ?? minimum
  const highCandidate = mapping.maximum ?? maximum
  const high = highCandidate > low ? highCandidate : low + 1
  const histogram = Array.from({ length: 64 }, () => 0)
  const rgba = new Uint8ClampedArray(length * 4)
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? Number.NaN
    const normalized = Number.isFinite(value)
      ? Math.max(0, Math.min(1, (value - low) / (high - low)))
      : 0
    const display = Math.round(normalized * 255)
    const rgbaOffset = index * 4
    rgba[rgbaOffset] = display
    rgba[rgbaOffset + 1] = display
    rgba[rgbaOffset + 2] = display
    rgba[rgbaOffset + 3] = 255
    if (Number.isFinite(value)) {
      const bin = Math.min(
        63,
        Math.max(0, Math.floor(((value - minimum) / Math.max(1e-12, maximum - minimum)) * 63)),
      )
      histogram[bin] = (histogram[bin] ?? 0) + 1
    }
  }
  return { rgba, values, range: { minimum: low, maximum: high, automatic }, histogram }
}
