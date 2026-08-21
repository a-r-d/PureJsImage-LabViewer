export interface ParticleQualitySettings {
  readonly thresholdMethod: string
  readonly thresholdValue?: number
  readonly polarity?: string
  readonly openRadius: number
  readonly closeRadius: number
  readonly fillHoles: boolean
  readonly clearBorder: boolean
  readonly watershed: boolean
  readonly backgroundRadius?: number
}

export interface ParticleQualityCalibration {
  readonly unit?: string
  readonly xSpacing?: number
  readonly ySpacing?: number
}

export interface ParticleQualityInput {
  readonly objectCount: number
  readonly sampledObjectCount?: number
  readonly validPixels: number
  readonly nodataPixels: number
  readonly planeWidth: number
  readonly planeHeight: number
  readonly areas: readonly number[]
  readonly equivalentDiameters: readonly number[]
  readonly circularities: readonly number[]
  readonly solidities: readonly number[]
  readonly borderCount: number
  readonly settings: ParticleQualitySettings
  readonly calibration?: ParticleQualityCalibration
}

export interface NumericDistribution {
  readonly count: number
  readonly min: number
  readonly max: number
  readonly mean: number
  readonly p10: number
  readonly p50: number
  readonly p90: number
}

export interface ParticleQualityReport {
  readonly schemaVersion: 1
  readonly available: true
  readonly objectCount: number
  readonly validPixels: number
  readonly nodataPixels: number
  readonly foregroundFraction: number
  readonly borderObjectCount: number
  readonly borderObjectFraction: number
  readonly area: NumericDistribution
  readonly equivalentDiameter: NumericDistribution
  readonly circularity: NumericDistribution
  readonly solidity: NumericDistribution
  readonly extremeOutlierCount: number
  readonly tinyObjectFraction: number
  readonly largeObjectFraction: number
  readonly likelyMergedObjectCount: number
  readonly likelySplitOrNoiseCount: number
  readonly thresholdMethod: string
  readonly thresholdValue: number | null
  readonly polarity: string | null
  readonly morphology: Readonly<{
    openRadius: number
    closeRadius: number
    fillHoles: boolean
    clearBorder: boolean
    backgroundRadius: number | null
  }>
  readonly watershed: boolean
  readonly calibration: Readonly<{
    unit: string | null
    xSpacing: number | null
    ySpacing: number | null
  }>
  readonly warnings: readonly string[]
  readonly limitations: readonly string[]
}

export function particleQualityDiagnostics(input: ParticleQualityInput): ParticleQualityReport {
  const planePixels = Math.max(1, input.planeWidth * input.planeHeight)
  const foreground = input.areas.reduce((sum, area) => sum + area, 0)
  const area = distribution(input.areas)
  const equivalentDiameter = distribution(input.equivalentDiameters)
  const circularity = distribution(input.circularities)
  const solidity = distribution(input.solidities)
  const tinyCutoff = area.p50 * 0.15
  const largeCutoff = area.p50 * 4
  const tinyObjectFraction =
    input.areas.length === 0
      ? 0
      : input.areas.filter((value) => value < tinyCutoff).length / input.areas.length
  const largeObjectFraction =
    input.areas.length === 0
      ? 0
      : input.areas.filter((value) => value > largeCutoff).length / input.areas.length
  const likelyMergedObjectCount = input.areas.filter(
    (value, index) =>
      value > largeCutoff &&
      (input.circularities[index] ?? 1) < 0.55 &&
      (input.solidities[index] ?? 1) < 0.85,
  ).length
  const likelySplitOrNoiseCount = input.areas.filter((value) => value < tinyCutoff).length
  const extremeOutlierCount = input.areas.filter(
    (value) => value > area.p90 * 3 || value < Math.max(1, area.p10 / 4),
  ).length
  const warnings: string[] = []
  if (input.objectCount === 0) warnings.push('No objects were retained after filters.')
  if (input.borderCount / Math.max(1, input.objectCount) > 0.2)
    warnings.push('A large fraction of objects touch the ROI or plane border.')
  if (tinyObjectFraction > 0.25)
    warnings.push('Many retained objects are much smaller than the median.')
  if (likelyMergedObjectCount > 0)
    warnings.push(
      'Large irregular objects may indicate merges; inspect an approved labels preview.',
    )
  if (input.nodataPixels > 0)
    warnings.push('Nodata pixels were present and are excluded from foreground fraction.')
  const sampled = input.sampledObjectCount ?? input.areas.length
  if (sampled < input.objectCount)
    warnings.push(
      `Diagnostics used ${sampled} of ${input.objectCount} objects from the loaded table page.`,
    )
  const unit = input.calibration?.unit?.trim() ?? ''
  if (unit.length === 0 || /^(?:px|pixel|pixels)$/iu.test(unit))
    warnings.push('Calibration is missing or in pixels; physical sizes are not trustworthy.')
  return {
    schemaVersion: 1,
    available: true,
    objectCount: input.objectCount,
    validPixels: input.validPixels,
    nodataPixels: input.nodataPixels,
    foregroundFraction: foreground / planePixels,
    borderObjectCount: input.borderCount,
    borderObjectFraction: input.borderCount / Math.max(1, input.objectCount),
    area,
    equivalentDiameter,
    circularity,
    solidity,
    extremeOutlierCount,
    tinyObjectFraction,
    largeObjectFraction,
    likelyMergedObjectCount,
    likelySplitOrNoiseCount,
    thresholdMethod: input.settings.thresholdMethod,
    thresholdValue: input.settings.thresholdValue ?? null,
    polarity: input.settings.polarity ?? null,
    morphology: {
      openRadius: input.settings.openRadius,
      closeRadius: input.settings.closeRadius,
      fillHoles: input.settings.fillHoles,
      clearBorder: input.settings.clearBorder,
      backgroundRadius: input.settings.backgroundRadius ?? null,
    },
    watershed: input.settings.watershed,
    calibration: {
      unit: input.calibration?.unit ?? null,
      xSpacing: input.calibration?.xSpacing ?? null,
      ySpacing: input.calibration?.ySpacing ?? null,
    },
    warnings: warnings.slice(0, 12),
    limitations: [
      'These diagnostics are bounded descriptive statistics, not a formal statistical guarantee of segmentation quality.',
      'Use an approved model-visible labels preview together with these metrics before claiming the result looks reliable.',
    ],
  }
}

function distribution(values: readonly number[]): NumericDistribution {
  const finite = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)
  if (finite.length === 0) return { count: 0, min: 0, max: 0, mean: 0, p10: 0, p50: 0, p90: 0 }
  const sum = finite.reduce((total, value) => total + value, 0)
  return {
    count: finite.length,
    min: finite[0] ?? 0,
    max: finite[finite.length - 1] ?? 0,
    mean: sum / finite.length,
    p10: percentile(finite, 0.1),
    p50: percentile(finite, 0.5),
    p90: percentile(finite, 0.9),
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))))
  return sorted[index] ?? 0
}
