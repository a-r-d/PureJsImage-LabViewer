import {
  IMAGING_RESOURCE_LIMITS,
  type ImagingResourceLimits,
  type WorkerRequest,
} from '@pji-workbench/contracts'

const FOREGROUND_REQUEST_RESERVE = 4

const BACKGROUND_RENDER_REQUESTS: ReadonlySet<WorkerRequest['kind']> = new Set([
  'tile.request',
  'display.tile.request',
  'display.statistics.request',
  'geo.analysis.tile',
  'analysis.overlay-tile',
  'analysis.dataset-tile',
])

/** Keep viewport rendering from starving direct user actions such as ROI measurements. */
export function inFlightAdmissionLimit(
  kind: WorkerRequest['kind'],
  maxInFlightRequests: number,
): number {
  if (!BACKGROUND_RENDER_REQUESTS.has(kind)) return maxInFlightRequests
  return Math.max(1, maxInFlightRequests - FOREGROUND_REQUEST_RESERVE)
}

export function resolveImagingResourceLimits(
  overrides: Partial<ImagingResourceLimits> | undefined,
): ImagingResourceLimits {
  return {
    maxOpenSources: overrides?.maxOpenSources ?? IMAGING_RESOURCE_LIMITS.maxOpenSources,
    maxDatasetsPerSource:
      overrides?.maxDatasetsPerSource ?? IMAGING_RESOURCE_LIMITS.maxDatasetsPerSource,
    maxRangeCacheBytes: overrides?.maxRangeCacheBytes ?? IMAGING_RESOURCE_LIMITS.maxRangeCacheBytes,
    maxTileRuntimeBytes:
      overrides?.maxTileRuntimeBytes ?? IMAGING_RESOURCE_LIMITS.maxTileRuntimeBytes,
    maxInFlightRequests:
      overrides?.maxInFlightRequests ?? IMAGING_RESOURCE_LIMITS.maxInFlightRequests,
  }
}

export function mergeImagingResourceLimits(
  current: ImagingResourceLimits,
  overrides: Partial<ImagingResourceLimits> | undefined,
): ImagingResourceLimits {
  if (overrides === undefined) return current
  return resolveImagingResourceLimits({ ...current, ...overrides })
}
