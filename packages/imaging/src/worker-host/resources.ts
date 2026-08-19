import { IMAGING_RESOURCE_LIMITS, type ImagingResourceLimits } from '@pji-workbench/contracts'

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
