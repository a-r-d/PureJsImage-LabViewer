import {
  type AffineTransform,
  DISPLAY_STATISTICS_ALGORITHM_VERSION,
  type DisplayStatistics,
  type DisplayStatisticsRequest,
  type RasterPointSample,
  type RasterPointSampleRequest,
  RpcValidationError,
} from '@pji-workbench/contracts'

import type { DatasetRecord } from './runtime.js'
import { numericValue } from './view-rpc.js'

const SAMPLE_TILE_SIZE = 64

export function displayStatisticsCacheKey(request: DisplayStatisticsRequest): string {
  return stableHash(
    JSON.stringify({
      algorithm: DISPLAY_STATISTICS_ALGORITHM_VERSION,
      sourceIdentity: request.sourceIdentity,
      sourceRevision: request.sourceRevision,
      datasetHandleId: request.datasetHandleId,
      generation: request.generation,
      componentIndices: request.componentIndices,
      displayAxes: request.displayAxes,
      fixedIndices: request.fixedIndices,
      resolutionPolicy: request.resolutionPolicy,
      nodataPolicy: request.nodataPolicy,
      sampleBudget: request.sampleBudget,
      percentilePolicy: request.percentilePolicy,
      scaleOffsetPolicy: request.scaleOffsetPolicy,
    }),
  )
}

export async function computeDisplayStatistics(
  record: DatasetRecord,
  request: DisplayStatisticsRequest,
  signal: AbortSignal,
): Promise<DisplayStatistics> {
  const descriptor = record.dataset.descriptor
  for (const component of request.componentIndices) {
    if (component < 0 || component >= descriptor.components.length) {
      throw new RpcValidationError(
        'INVALID_PAYLOAD',
        'Selected statistics component is unavailable',
      )
    }
  }
  const overview = chooseOverview(record, request)
  const width = axisLength(record, request.displayAxes[0], overview)
  const height = axisLength(record, request.displayAxes[1], overview)
  const componentCount = request.componentIndices.length
  const decodedComponentCount = Math.max(1, descriptor.components.length)
  const maxSamples = Math.min(
    Math.floor(request.sampleBudget.maxSamples / componentCount),
    Math.floor(request.sampleBudget.maxBytes / (decodedComponentCount * 4)),
  )
  if (maxSamples < 1) {
    throw new RpcValidationError(
      'LIMIT_EXCEEDED',
      'Statistics budget cannot hold one decoded multi-component sample',
    )
  }
  const regions = samplingRegions(width, height, maxSamples, request.sampleBudget.maxTiles)
  const values = request.componentIndices.map(() => [] as number[])
  const excluded = request.componentIndices.map(() => 0)
  let sampledPixels = 0
  for (const region of regions) {
    signal.throwIfAborted()
    const tile = await record.runtime.request(record.tileSource, {
      address: {
        cacheClass: 'source',
        namespace: `display-statistics:${record.handleId}`,
        dataset: record.tileIdentity,
        displayAxes: request.displayAxes,
        fixedIndices: request.fixedIndices,
        resolutionLevel: overview,
        ...region,
      },
      priority: 'background',
      signal,
      target: { sampleType: 'float32' },
    })
    try {
      sampledPixels += tile.width * tile.height
      for (let y = 0; y < tile.height; y += 1) {
        for (let x = 0; x < tile.width; x += 1) {
          for (let index = 0; index < request.componentIndices.length; index += 1) {
            const component = request.componentIndices[index]
            if (component === undefined) continue
            const raw = numericValue(tile, x, y, component)
            const descriptorNodata = componentNodata(descriptor, component)
            const isExcluded =
              !Number.isFinite(raw) ||
              (request.nodataPolicy.kind === 'exclude' &&
                ((request.nodataPolicy.value !== undefined &&
                  Object.is(raw, request.nodataPolicy.value)) ||
                  (descriptorNodata !== undefined && Object.is(raw, descriptorNodata))))
            if (isExcluded) {
              excluded[index] = (excluded[index] ?? 0) + 1
              continue
            }
            const transform = request.scaleOffsetPolicy.components[index] ?? {
              scale: 1,
              offset: 0,
            }
            values[index]?.push(
              request.scaleOffsetPolicy.kind === 'physical'
                ? raw * transform.scale + transform.offset
                : raw,
            )
          }
        }
      }
    } finally {
      tile.release()
    }
  }
  const cacheKey = displayStatisticsCacheKey(request)
  return {
    algorithmVersion: DISPLAY_STATISTICS_ALGORITHM_VERSION,
    statisticsRevision: cacheKey,
    cacheKey,
    cached: false,
    sourceIdentity: request.sourceIdentity,
    sourceRevision: request.sourceRevision,
    datasetHandleId: request.datasetHandleId,
    overview,
    sampledTiles: regions.length,
    sampledValues: values.reduce((total, component) => total + component.length, 0),
    sampleCoverage: Math.min(1, sampledPixels / Math.max(1, width * height)),
    components: request.componentIndices.map((component, index) =>
      summarizeComponent(
        component,
        values[index] ?? [],
        excluded[index] ?? 0,
        request.percentilePolicy.low,
        request.percentilePolicy.high,
      ),
    ),
  }
}

export async function sampleRasterPoint(
  record: DatasetRecord,
  request: RasterPointSampleRequest,
  signal: AbortSignal,
): Promise<RasterPointSample> {
  const descriptor = record.dataset.descriptor
  const width = axisLength(record, request.displayAxes[0], 0)
  const height = axisLength(record, request.displayAxes[1], 0)
  const x = Math.floor(request.pixel.x)
  const y = Math.floor(request.pixel.y)
  if (x < 0 || y < 0 || x >= width || y >= height) {
    throw new RpcValidationError('INVALID_PAYLOAD', 'Point sample is outside the source raster')
  }
  const tile = await record.runtime.request(record.tileSource, {
    address: {
      cacheClass: 'source',
      namespace: `raster-sample:${record.handleId}`,
      dataset: record.tileIdentity,
      displayAxes: request.displayAxes,
      fixedIndices: request.fixedIndices,
      resolutionLevel: 0,
      x,
      y,
      width: 1,
      height: 1,
    },
    priority: 'visible',
    signal,
    target: { sampleType: 'float32' },
  })
  try {
    const spatial = descriptor.spatialReference
    const sourceMapCoordinate = applyAffine(spatial?.pixelToModel, request.pixel)
    const components = descriptor.components.map((component, index) => {
      const raw = numericValue(tile, 0, 0, index)
      const nodataValue = componentNodata(descriptor, index)
      const nodata =
        !Number.isFinite(raw) || (nodataValue !== undefined && Object.is(raw, nodataValue))
      return {
        index,
        name: component.name ?? component.id ?? `Band ${index + 1}`,
        ...(component.unit === undefined ? {} : { unit: component.unit }),
        value: nodata ? null : raw,
        nodata,
      }
    })
    return {
      sourceIdentity: request.sourceIdentity,
      datasetHandleId: request.datasetHandleId,
      layerId: request.layerId,
      pixel: request.pixel,
      sourceMapCoordinate,
      projectMapCoordinate: request.projectMapCoordinate,
      nodata: components.every(({ nodata }) => nodata),
      components,
    }
  } finally {
    tile.release()
  }
}

function chooseOverview(record: DatasetRecord, request: DisplayStatisticsRequest): number {
  const levels = record.dataset.descriptor.levels
  if (request.resolutionPolicy.kind === 'level') {
    const requested = request.resolutionPolicy.level ?? 0
    if (!levels.some(({ level }) => level === requested)) {
      throw new RpcValidationError('INVALID_PAYLOAD', 'Statistics overview is unavailable')
    }
    return requested
  }
  return (
    [...levels].sort((left, right) => {
      const leftArea = levelArea(record, left.level, request.displayAxes)
      const rightArea = levelArea(record, right.level, request.displayAxes)
      return leftArea - rightArea || right.level - left.level
    })[0]?.level ?? 0
  )
}

function axisLength(record: DatasetRecord, axisId: string, level: number): number {
  const descriptor = record.dataset.descriptor
  const base = descriptor.axes.find(({ id }) => id === axisId)?.length
  if (base === undefined)
    throw new RpcValidationError('INVALID_PAYLOAD', `Axis ${axisId} is missing`)
  return (
    descriptor.levels
      .find((candidate) => candidate.level === level)
      ?.axisLengths.find((axis) => axis.axisId === axisId)?.length ?? base
  )
}

function levelArea(record: DatasetRecord, level: number, axes: readonly [string, string]): number {
  return axisLength(record, axes[0], level) * axisLength(record, axes[1], level)
}

function samplingRegions(
  width: number,
  height: number,
  maxSamples: number,
  maxTiles: number,
): readonly Readonly<{ x: number; y: number; width: number; height: number }>[] {
  const targetTiles = Math.max(1, Math.min(maxTiles, maxSamples))
  const tileSide = Math.max(
    1,
    Math.min(SAMPLE_TILE_SIZE, Math.floor(Math.sqrt(maxSamples / targetTiles))),
  )
  const pixelsPerTile = tileSide * tileSide
  const count = Math.max(1, Math.min(maxTiles, Math.floor(maxSamples / pixelsPerTile) || 1))
  const columns = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / columns)
  const planned = Array.from({ length: count }, (_, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const regionWidth = Math.min(tileSide, width)
    const regionHeight = Math.min(tileSide, height)
    const centerX = ((column + 0.5) / columns) * width
    const centerY = ((row + 0.5) / rows) * height
    return {
      x: Math.max(0, Math.min(width - regionWidth, Math.floor(centerX - regionWidth / 2))),
      y: Math.max(0, Math.min(height - regionHeight, Math.floor(centerY - regionHeight / 2))),
      width: regionWidth,
      height: regionHeight,
    }
  })
  const unique = new Map<string, (typeof planned)[number]>()
  for (const region of planned) {
    unique.set(`${region.x}:${region.y}:${region.width}:${region.height}`, region)
  }
  return [...unique.values()]
}

function summarizeComponent(
  component: number,
  values: number[],
  excludedSamples: number,
  lowPercent: number,
  highPercent: number,
) {
  if (values.length === 0) {
    return {
      component,
      minimum: 0,
      maximum: 1,
      percentileLow: 0,
      percentileHigh: 1,
      validSamples: 0,
      excludedSamples,
    }
  }
  values.sort((left, right) => left - right)
  const minimum = values[0] ?? 0
  const maximumCandidate = values.at(-1) ?? minimum + 1
  const maximum = maximumCandidate > minimum ? maximumCandidate : minimum + 1
  return {
    component,
    minimum,
    maximum,
    percentileLow: percentile(values, lowPercent),
    percentileHigh: Math.max(
      percentile(values, highPercent),
      percentile(values, lowPercent) + 1e-12,
    ),
    validSamples: values.length,
    excludedSamples,
  }
}

function percentile(sorted: readonly number[], percent: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((Math.min(100, Math.max(0, percent)) / 100) * (sorted.length - 1))),
  )
  return sorted[index] ?? 0
}

function componentNodata(
  descriptor: DatasetRecord['dataset']['descriptor'],
  component: number,
): number | undefined {
  const noData = descriptor.spatialReference?.noData
  const value =
    noData?.kind === 'components'
      ? noData.values[component]
      : noData?.kind === 'scalar'
        ? noData.value
        : descriptor.noDataValue
  return typeof value === 'number' ? value : undefined
}

function applyAffine(
  affine: AffineTransform | undefined,
  point: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  if (!Array.isArray(affine) || affine.length !== 6) return point
  return {
    x: affine[0] * point.x + affine[1] * point.y + affine[2],
    y: affine[3] * point.x + affine[4] * point.y + affine[5],
  }
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `ds-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
