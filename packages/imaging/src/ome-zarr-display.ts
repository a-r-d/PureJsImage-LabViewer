import type { DisplayMapping, OmeZarrChannelDisplayState } from '@pji-workbench/contracts'
import type { NumericTile } from 'purejsimage/scientific'

import type { DatasetRecord } from './worker-host/runtime.js'
import { mapTile, numericValue } from './worker-host/view-rpc.js'

export function omeZarrChannelAxisId(record: DatasetRecord): string | undefined {
  const channel = record.dataset.descriptor.axes.find(
    (axis) => axis.kind === 'channel' || axis.id === 'c' || axis.id === 'C',
  )
  return channel?.id
}

export function authoredOmeZarrDisplayMapping(
  metadata: Readonly<Record<string, unknown>> | undefined,
): DisplayMapping | undefined {
  const display = metadata?.['omeZarrDisplay']
  if (typeof display !== 'object' || display === null || Array.isArray(display)) return undefined
  const record = display as Readonly<Record<string, unknown>>
  const channels = record['channels']
  if (!Array.isArray(channels) || channels.length === 0) return undefined
  const rdefs =
    typeof record['rdefs'] === 'object' &&
    record['rdefs'] !== null &&
    !Array.isArray(record['rdefs'])
      ? (record['rdefs'] as Readonly<Record<string, unknown>>)
      : undefined
  const model = rdefs?.['model']
  return {
    mode: 'linear',
    range: 'auto',
    ...(model === 'color' || model === 'greyscale' ? { colorModel: model } : {}),
    omeZarrChannels: channels.map((channel, index) => authoredChannel(channel, index)),
  }
}

function authoredChannel(value: unknown, index: number): OmeZarrChannelDisplayState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { index, active: true }
  }
  const channel = value as Readonly<Record<string, unknown>>
  const window =
    typeof channel['window'] === 'object' &&
    channel['window'] !== null &&
    !Array.isArray(channel['window'])
      ? (channel['window'] as Readonly<Record<string, unknown>>)
      : undefined
  return {
    index,
    active: channel['active'] !== false,
    ...(typeof channel['color'] === 'number' ? { color: channel['color'] } : {}),
    ...(typeof channel['coefficient'] === 'number' ? { coefficient: channel['coefficient'] } : {}),
    ...(typeof channel['inverted'] === 'boolean' ? { inverted: channel['inverted'] } : {}),
    ...(typeof channel['label'] === 'string' ? { label: channel['label'] } : {}),
    ...(typeof window?.['start'] === 'number' && typeof window['end'] === 'number'
      ? { window: { start: window['start'], end: window['end'] } }
      : {}),
  }
}

export async function composeOmeZarrDisplayTile(
  record: DatasetRecord,
  request: Readonly<{
    displayAxes: readonly [string, string]
    fixedIndices: readonly Readonly<{ axisId: string; index: number }>[]
    resolutionLevel: number
    region: Readonly<{ x: number; y: number; width: number; height: number }>
    priority: 'visible' | 'near-visible' | 'background'
    mapping: DisplayMapping
    component: number
  }>,
  signal: AbortSignal,
): Promise<ReturnType<typeof mapTile>> {
  const axisId = omeZarrChannelAxisId(record)
  const channels = request.mapping.omeZarrChannels
  if (
    axisId === undefined ||
    channels === undefined ||
    channels.length === 0 ||
    request.displayAxes.includes(axisId)
  ) {
    const tile = await requestPlane(record, request, signal)
    try {
      return mapTile(tile, request.component, request.mapping)
    } finally {
      tile.release()
    }
  }
  const active = channels.filter((channel) => channel.active)
  const selected =
    request.mapping.colorModel === 'greyscale' ? active.slice(0, 1) : active.slice(0, 8)
  if (selected.length === 0) {
    const empty = emptyMappedTile(request.region.width, request.region.height)
    return empty
  }
  const planes: NumericTile[] = []
  try {
    for (const channel of selected) {
      planes.push(
        await requestPlane(
          record,
          {
            ...request,
            fixedIndices: withChannelIndex(request.fixedIndices, axisId, channel.index),
          },
          signal,
        ),
      )
    }
    const width = planes[0]?.width ?? request.region.width
    const height = planes[0]?.height ?? request.region.height
    const primary = collect(planes[0], request.component, width, height)
    const histogram = buildHistogram(primary)
    const rgba = new Uint8ClampedArray(width * height * 4)
    if (request.mapping.colorModel === 'greyscale' || selected.length === 1) {
      paintGray(rgba, primary, selected[0], request.mapping)
    } else {
      paintColor(rgba, planes, selected, request.component, request.mapping)
    }
    return {
      rgba,
      values: primary,
      range: {
        minimum: selected[0]?.window?.start ?? 0,
        maximum: selected[0]?.window?.end ?? 1,
        automatic: false,
      },
      histogram,
    }
  } finally {
    for (const plane of planes) plane.release()
  }
}

async function requestPlane(
  record: DatasetRecord,
  request: Readonly<{
    displayAxes: readonly [string, string]
    fixedIndices: readonly Readonly<{ axisId: string; index: number }>[]
    resolutionLevel: number
    region: Readonly<{ x: number; y: number; width: number; height: number }>
    priority: 'visible' | 'near-visible' | 'background'
  }>,
  signal: AbortSignal,
): Promise<NumericTile> {
  return record.runtime.request(record.tileSource, {
    address: {
      cacheClass: 'source',
      namespace: `viewport:${record.handleId}`,
      dataset: record.tileIdentity,
      displayAxes: request.displayAxes,
      fixedIndices: request.fixedIndices,
      resolutionLevel: request.resolutionLevel,
      ...request.region,
    },
    priority: request.priority,
    signal,
    target: { sampleType: 'float32' },
  })
}

function collect(
  tile: NumericTile | undefined,
  component: number,
  width: number,
  height: number,
): Float32Array {
  const values = new Float32Array(width * height)
  if (tile === undefined) return values
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      values[y * width + x] = numericValue(tile, x, y, component)
    }
  }
  return values
}

function paintGray(
  rgba: Uint8ClampedArray,
  values: Float32Array,
  channel: OmeZarrChannelDisplayState | undefined,
  mapping: DisplayMapping,
): void {
  for (let index = 0; index < values.length; index += 1) {
    const level = Math.round(normalized(values[index] ?? 0, channel, mapping) * 255)
    const offset = index * 4
    rgba[offset] = level
    rgba[offset + 1] = level
    rgba[offset + 2] = level
    rgba[offset + 3] = 255
  }
}

function paintColor(
  rgba: Uint8ClampedArray,
  planes: readonly NumericTile[],
  channels: readonly OmeZarrChannelDisplayState[],
  component: number,
  mapping: DisplayMapping,
): void {
  const width = planes[0]?.width ?? 0
  const height = planes[0]?.height ?? 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let red = 0
      let green = 0
      let blue = 0
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
        const channel = channels[channelIndex]
        const plane = planes[channelIndex]
        if (channel === undefined || plane === undefined) continue
        const weight = normalized(numericValue(plane, x, y, component), channel, mapping)
        const rgb = channelRgb(channel.color)
        red += weight * rgb[0]
        green += weight * rgb[1]
        blue += weight * rgb[2]
      }
      const offset = (y * width + x) * 4
      rgba[offset] = Math.round(Math.min(1, red) * 255)
      rgba[offset + 1] = Math.round(Math.min(1, green) * 255)
      rgba[offset + 2] = Math.round(Math.min(1, blue) * 255)
      rgba[offset + 3] = 255
    }
  }
}

function normalized(
  value: number,
  channel: OmeZarrChannelDisplayState | undefined,
  mapping: DisplayMapping,
): number {
  const start = channel?.window?.start ?? mapping.minimum ?? 0
  const end = channel?.window?.end ?? mapping.maximum ?? start + 1
  const span = end - start
  let unit = span === 0 || !Number.isFinite(value) ? 0 : (value - start) / span
  unit = Math.min(1, Math.max(0, unit))
  if (channel?.inverted === true) unit = 1 - unit
  return unit * (channel?.coefficient ?? 1)
}

function channelRgb(color: number | undefined): readonly [number, number, number] {
  const packed = color ?? 0xffffff
  return [((packed >> 16) & 255) / 255, ((packed >> 8) & 255) / 255, (packed & 255) / 255]
}

function buildHistogram(values: Float32Array): number[] {
  const histogram = Array.from({ length: 64 }, () => 0)
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  if (!(maximum > minimum)) return histogram
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    const bucket = Math.min(63, Math.floor(((value - minimum) / (maximum - minimum)) * 64))
    histogram[bucket] = (histogram[bucket] ?? 0) + 1
  }
  return histogram
}

function withChannelIndex(
  fixedIndices: readonly Readonly<{ axisId: string; index: number }>[],
  axisId: string,
  index: number,
): readonly Readonly<{ axisId: string; index: number }>[] {
  if (fixedIndices.some((fixed) => fixed.axisId === axisId)) {
    return fixedIndices.map((fixed) => (fixed.axisId === axisId ? { axisId, index } : fixed))
  }
  return [...fixedIndices, { axisId, index }]
}

function emptyMappedTile(width: number, height: number) {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255
  return {
    rgba,
    values: new Float32Array(width * height),
    range: { minimum: 0, maximum: 1, automatic: true },
    histogram: Array.from({ length: 64 }, () => 0),
  }
}
