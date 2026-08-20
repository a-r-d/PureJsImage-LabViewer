import type { DisplayMapping, WorkerRequest, WorkerResponse } from '@pji-workbench/contracts'
import { type NumericTile, numericTileSampleOffset } from 'purejsimage/scientific'

export function numericValue(tile: NumericTile, x: number, y: number, component: number): number {
  return Number(tile.data[numericTileSampleOffset(tile, x, y, component)])
}

type MappedTile = Pick<
  Extract<WorkerResponse, { kind: 'tile.ready' }>['payload'],
  'rgba' | 'values' | 'range' | 'histogram'
> & {
  readonly bandValues?: readonly Float32Array[]
}

export function mappedTileTransfer(mapped: MappedTile): Transferable[] {
  const transfer: Transferable[] = [mapped.rgba.buffer, mapped.values.buffer]
  if (mapped.bandValues === undefined) return transfer
  for (const band of mapped.bandValues) {
    if (band.buffer === mapped.values.buffer) continue
    transfer.push(band.buffer)
  }
  return transfer
}

export function mappedDisplayTileTransfer(rgba: Uint8ClampedArray): Transferable[] {
  return [rgba.buffer]
}

export function mapTile(
  tile: NumericTile,
  component: number,
  mapping: Extract<WorkerRequest, { kind: 'tile.request' }>['payload']['mapping'],
): MappedTile {
  const channels = displayChannels(tile.componentCount, component, mapping)
  const primary = collectChannel(
    tile,
    channels.primary,
    mapping.componentTransforms?.[String(channels.primary)],
  )
  const extras =
    channels.extra.length === 0
      ? undefined
      : channels.extra.map((channel) =>
          collectChannel(tile, channel, mapping.componentTransforms?.[String(channel)]),
        )
  const nodata = mapping.nodata
  const transparent = mapping.nodataTransparent === true ? nodata : undefined
  const { minimum, maximum } = finiteRange(primary, nodata)
  const automatic = mapping.range === 'auto'
  const stretched = stretchRange(primary, mapping, minimum, maximum, nodata, channels.primary)
  const histogram = buildHistogram(primary, stretched.low, stretched.high, nodata)
  const rgba = new Uint8ClampedArray(primary.length * 4)
  const gamma = mapping.gamma !== undefined && mapping.gamma !== 1 ? mapping.gamma : undefined
  if (extras === undefined) {
    paintGray(rgba, primary, stretched.low, stretched.high, gamma, transparent)
    return {
      rgba,
      values: primary,
      range: { minimum: stretched.low, maximum: stretched.high, automatic },
      histogram,
    }
  }
  const red = primary
  const green = extras[0] ?? primary
  const blue = extras[1] ?? extras[0] ?? primary
  const greenRange = stretchRange(
    green,
    mapping,
    ...rangeTuple(finiteRange(green, nodata)),
    nodata,
    channels.extra[0] ?? channels.primary,
  )
  const blueRange = stretchRange(
    blue,
    mapping,
    ...rangeTuple(finiteRange(blue, nodata)),
    nodata,
    channels.extra[1] ?? channels.extra[0] ?? channels.primary,
  )
  paintRgb(rgba, red, green, blue, stretched, greenRange, blueRange, gamma, transparent)
  return {
    rgba,
    values: primary,
    bandValues: extras.length === 1 ? [primary, green] : [primary, green, blue],
    range: { minimum: stretched.low, maximum: stretched.high, automatic },
    histogram,
  }
}

function displayChannels(
  componentCount: number,
  component: number,
  mapping: DisplayMapping,
): Readonly<{ primary: number; extra: readonly number[] }> {
  const bands = mapping.bands
  if (bands === undefined) {
    assertChannel(component, componentCount)
    return { primary: component, extra: [] }
  }
  if (bands.gray !== undefined) {
    assertChannel(bands.gray, componentCount)
    return { primary: bands.gray, extra: [] }
  }
  const red = bands.red ?? 0
  const green = bands.green ?? red
  const blue = bands.blue ?? green
  assertChannel(red, componentCount)
  assertChannel(green, componentCount)
  assertChannel(blue, componentCount)
  if (green === red && blue === red) return { primary: red, extra: [] }
  if (blue === green) return { primary: red, extra: [green] }
  return { primary: red, extra: [green, blue] }
}

function assertChannel(channel: number, componentCount: number): void {
  if (channel >= componentCount) throw new RangeError('Selected component is unavailable')
}

function collectChannel(
  tile: NumericTile,
  channel: number,
  transform?: Readonly<{ scale: number; offset: number }>,
): Float32Array {
  const length = tile.width * tile.height
  const values = new Float32Array(length)
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const raw = numericValue(tile, x, y, channel)
      values[y * tile.width + x] =
        transform === undefined ? raw : raw * transform.scale + transform.offset
    }
  }
  return values
}

function finiteRange(
  values: Float32Array,
  nodata?: number,
): Readonly<{ minimum: number; maximum: number }> {
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === undefined || !Number.isFinite(value) || isNodata(value, nodata)) continue
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return { minimum: 0, maximum: 1 }
  return { minimum, maximum }
}

function rangeTuple(range: Readonly<{ minimum: number; maximum: number }>): [number, number] {
  return [range.minimum, range.maximum]
}

function stretchRange(
  values: Float32Array,
  mapping: DisplayMapping,
  dataMinimum: number,
  dataMaximum: number,
  nodata?: number,
  component?: number,
): Readonly<{ low: number; high: number }> {
  const fixed = component === undefined ? undefined : mapping.channelRanges?.[String(component)]
  if (fixed !== undefined) return { low: fixed.minimum, high: fixed.maximum }
  if (mapping.range === 'manual') {
    const low = mapping.minimum ?? dataMinimum
    const highCandidate = mapping.maximum ?? dataMaximum
    return { low, high: highCandidate > low ? highCandidate : low + 1 }
  }
  if (mapping.stretch === 'percentile') {
    const low = percentile(values, mapping.percentileLow ?? 2, nodata)
    const highCandidate = percentile(values, mapping.percentileHigh ?? 98, nodata)
    return { low, high: highCandidate > low ? highCandidate : low + 1 }
  }
  const low = mapping.minimum ?? dataMinimum
  const highCandidate = mapping.maximum ?? dataMaximum
  return { low, high: highCandidate > low ? highCandidate : low + 1 }
}

function percentile(values: Float32Array, percent: number, nodata?: number): number {
  const finite: number[] = []
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value !== undefined && Number.isFinite(value) && !isNodata(value, nodata)) {
      finite.push(value)
    }
  }
  if (finite.length === 0) return 0
  finite.sort((left, right) => left - right)
  const clamped = Math.min(100, Math.max(0, percent))
  const index = Math.min(
    finite.length - 1,
    Math.max(0, Math.floor((clamped / 100) * (finite.length - 1))),
  )
  return finite[index] ?? 0
}

function buildHistogram(
  values: Float32Array,
  minimum: number,
  maximum: number,
  nodata?: number,
): readonly number[] {
  const histogram = Array.from({ length: 64 }, () => 0)
  const span = Math.max(1e-12, maximum - minimum)
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === undefined || !Number.isFinite(value) || isNodata(value, nodata)) continue
    const bin = Math.min(63, Math.max(0, Math.floor(((value - minimum) / span) * 63)))
    histogram[bin] = (histogram[bin] ?? 0) + 1
  }
  return histogram
}

function paintGray(
  rgba: Uint8ClampedArray,
  values: Float32Array,
  low: number,
  high: number,
  gamma: number | undefined,
  nodata: number | undefined,
): void {
  const span = high - low
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? Number.NaN
    const display = displayByte(value, low, span, gamma)
    const offset = index * 4
    rgba[offset] = display
    rgba[offset + 1] = display
    rgba[offset + 2] = display
    rgba[offset + 3] = isNodata(value, nodata) ? 0 : 255
  }
}

function paintRgb(
  rgba: Uint8ClampedArray,
  red: Float32Array,
  green: Float32Array,
  blue: Float32Array,
  redRange: Readonly<{ low: number; high: number }>,
  greenRange: Readonly<{ low: number; high: number }>,
  blueRange: Readonly<{ low: number; high: number }>,
  gamma: number | undefined,
  nodata: number | undefined,
): void {
  const redSpan = redRange.high - redRange.low
  const greenSpan = greenRange.high - greenRange.low
  const blueSpan = blueRange.high - blueRange.low
  for (let index = 0; index < red.length; index += 1) {
    const redValue = red[index] ?? Number.NaN
    const greenValue = green[index] ?? Number.NaN
    const blueValue = blue[index] ?? Number.NaN
    const offset = index * 4
    rgba[offset] = displayByte(redValue, redRange.low, redSpan, gamma)
    rgba[offset + 1] = displayByte(greenValue, greenRange.low, greenSpan, gamma)
    rgba[offset + 2] = displayByte(blueValue, blueRange.low, blueSpan, gamma)
    rgba[offset + 3] =
      isNodata(redValue, nodata) || isNodata(greenValue, nodata) || isNodata(blueValue, nodata)
        ? 0
        : 255
  }
}

function displayByte(value: number, low: number, span: number, gamma: number | undefined): number {
  if (!Number.isFinite(value)) return 0
  const normalized = Math.max(0, Math.min(1, (value - low) / span))
  const shaped = gamma === undefined ? normalized : normalized ** (1 / gamma)
  return Math.round(shaped * 255)
}

function isNodata(value: number, nodata: number | undefined): boolean {
  return nodata !== undefined && Object.is(value, nodata)
}
