import {
  type ProfileResult,
  profileResultValueTypeId,
  type ResultCollection,
  resultCollectionValueTypeId,
  type ScalarResult,
  scalarResultValueTypeId,
  type TableResult,
  tableResultValueTypeId,
  validateProfileResult,
  validateResultCollection,
  validateScalarResult,
  validateTableResult,
} from 'purejsimage/analysis/results'

export interface ParticleCalibration {
  readonly xSpacing: number
  readonly ySpacing: number
  readonly unit?: string
}

export interface ParticleFilters {
  readonly edgePolicy: 'include' | 'exclude'
  readonly minimumArea: number
  readonly maximumArea: number
  readonly minimumCircularity: number
  readonly maximumCircularity: number
  readonly minimumAspectRatio: number
  readonly maximumAspectRatio: number
  readonly minimumSolidity: number
  readonly maximumSolidity: number
}

export interface ParticleAnalysisOptions {
  readonly filters: ParticleFilters
  readonly calibration?: ParticleCalibration
  readonly intensityUnit?: string
  readonly maximumObjects?: number
  readonly maximumHullPoints?: number
  readonly fieldMask?: Uint8Array
  readonly signal?: AbortSignal
}

export interface ParticleMeasurement {
  readonly label: number
  readonly edge: boolean
  readonly pixelArea: number
  readonly physicalArea?: number
  readonly centroidX: number
  readonly centroidY: number
  readonly boundingX: number
  readonly boundingY: number
  readonly boundingWidth: number
  readonly boundingHeight: number
  readonly pixelPerimeter: number
  readonly pixelEquivalentCircularDiameter: number
  readonly pixelMajorAxis: number
  readonly pixelMinorAxis: number
  readonly pixelOrientationRadians: number
  readonly perimeter: number
  readonly equivalentCircularDiameter: number
  readonly majorAxis: number
  readonly minorAxis: number
  readonly aspectRatio: number
  readonly orientationRadians: number
  readonly circularity: number
  readonly solidity: number
  readonly intensityMinimum: number
  readonly intensityMaximum: number
  readonly intensityMean: number
  readonly intensityStandardDeviation: number
  readonly integratedIntensity: number
}

export interface ParticleAnalysisResult {
  readonly measurements: readonly ParticleMeasurement[]
  readonly includedLabels: ReadonlySet<number>
  readonly filteredLabels: Uint32Array
  readonly table: TableResult
  readonly summary: ResultCollection
  readonly distribution: ProfileResult
}

interface MutableParticle {
  count: number
  sumX: number
  sumY: number
  sumXX: number
  sumYY: number
  sumXY: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  edge: boolean
  pixelPerimeter: number
  perimeter: number
  intensityCount: number
  intensityMinimum: number
  intensityMaximum: number
  intensityMean: number
  intensityM2: number
  integratedIntensity: number
  hullCoordinates: number[]
}

interface Point {
  readonly x: number
  readonly y: number
}

const checkpoint = (signal: AbortSignal | undefined, ordinal: number): void => {
  if ((ordinal & 16_383) === 0) signal?.throwIfAborted()
}

function scalar(value: number, unit?: string): ScalarResult {
  return validateScalarResult({
    kind: 'scalar',
    valueType: scalarResultValueTypeId,
    value,
    nanPolicy: Number.isNaN(value) ? 'allow' : 'forbid',
    ...(unit === undefined ? {} : { unit }),
  })
}

function cross(origin: Point, left: Point, right: Point): number {
  return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x)
}

function convexHull(points: readonly Point[]): readonly Point[] {
  if (points.length <= 1) return points
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y)
  const unique = sorted.filter(
    (point, index) =>
      index === 0 || point.x !== sorted[index - 1]?.x || point.y !== sorted[index - 1]?.y,
  )
  if (unique.length <= 2) return unique
  const lower: Point[] = []
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2] as Point, lower[lower.length - 1] as Point, point) <= 0
    )
      lower.pop()
    lower.push(point)
  }
  const upper: Point[] = []
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index] as Point
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2] as Point, upper[upper.length - 1] as Point, point) <= 0
    )
      upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function coordinatePoints(coordinates: readonly number[]): readonly Point[] {
  const points: Point[] = []
  for (let index = 0; index < coordinates.length; index += 2)
    points.push({ x: coordinates[index] ?? 0, y: coordinates[index + 1] ?? 0 })
  return points
}

function polygonArea(points: readonly Point[]): number {
  if (points.length < 3) return 0
  let twiceArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index] as Point
    const next = points[(index + 1) % points.length] as Point
    twiceArea += current.x * next.y - current.y * next.x
  }
  return Math.abs(twiceArea) / 2
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? Number.NaN)
}

function physicalUnit(unit: string | undefined, power: 1 | 2): string | undefined {
  return unit === undefined ? undefined : power === 1 ? unit : `${unit}²`
}

function columns(
  measurements: readonly ParticleMeasurement[],
  calibration: ParticleCalibration | undefined,
  intensityUnit: string | undefined,
) {
  const numeric = (
    name: keyof ParticleMeasurement,
    unit?: string,
  ): Readonly<{
    kind: 'numeric'
    name: string
    values: Float64Array
    unit?: string
    nanPolicy: 'forbid' | 'allow'
  }> => {
    const values = Float64Array.from(measurements, (measurement) => {
      const value = measurement[name]
      return typeof value === 'number' ? value : Number.NaN
    })
    return {
      kind: 'numeric',
      name,
      values,
      ...(unit === undefined ? {} : { unit }),
      nanPolicy: values.some(Number.isNaN) ? 'allow' : 'forbid',
    }
  }
  const pixelColumns = [
    numeric('label'),
    {
      kind: 'boolean' as const,
      name: 'edge',
      values: Uint8Array.from({ length: Math.ceil(measurements.length / 8) }, (_value, byte) => {
        let bits = 0
        for (let bit = 0; bit < 8; bit += 1)
          if (measurements[byte * 8 + bit]?.edge === true) bits |= 1 << bit
        return bits
      }),
    },
    numeric('pixelArea', 'px²'),
    numeric('centroidX', 'px'),
    numeric('centroidY', 'px'),
    numeric('boundingX', 'px'),
    numeric('boundingY', 'px'),
    numeric('boundingWidth', 'px'),
    numeric('boundingHeight', 'px'),
    numeric('pixelPerimeter', 'px'),
    numeric('pixelEquivalentCircularDiameter', 'px'),
    numeric('pixelMajorAxis', 'px'),
    numeric('pixelMinorAxis', 'px'),
    numeric('pixelOrientationRadians', 'rad'),
    numeric('perimeter', calibration?.unit ?? 'px'),
    numeric('equivalentCircularDiameter', calibration?.unit ?? 'px'),
    numeric('majorAxis', calibration?.unit ?? 'px'),
    numeric('minorAxis', calibration?.unit ?? 'px'),
    numeric('aspectRatio'),
    numeric('orientationRadians', 'rad'),
    numeric('circularity'),
    numeric('solidity'),
    numeric('intensityMinimum', intensityUnit),
    numeric('intensityMaximum', intensityUnit),
    numeric('intensityMean', intensityUnit),
    numeric('intensityStandardDeviation', intensityUnit),
    numeric(
      'integratedIntensity',
      intensityUnit === undefined ? undefined : `${intensityUnit}·px²`,
    ),
  ]
  return calibration === undefined
    ? pixelColumns
    : [numeric('physicalArea', physicalUnit(calibration.unit, 2)), ...pixelColumns]
}

function measurement(
  label: number,
  value: MutableParticle,
  calibration: ParticleCalibration | undefined,
): ParticleMeasurement {
  const centroidX = value.sumX / value.count
  const centroidY = value.sumY / value.count
  const pixelVarianceX = Math.max(0, value.sumXX / value.count - centroidX * centroidX) + 1 / 12
  const pixelVarianceY = Math.max(0, value.sumYY / value.count - centroidY * centroidY) + 1 / 12
  const pixelCovariance = value.sumXY / value.count - centroidX * centroidY
  const xSpacing = calibration?.xSpacing ?? 1
  const ySpacing = calibration?.ySpacing ?? 1
  const varianceX = pixelVarianceX * xSpacing * xSpacing
  const varianceY = pixelVarianceY * ySpacing * ySpacing
  const covariance = pixelCovariance * xSpacing * ySpacing
  const trace = varianceX + varianceY
  const root = Math.sqrt(Math.max(0, ((varianceX - varianceY) / 2) ** 2 + covariance ** 2))
  const majorVariance = trace / 2 + root
  const minorVariance = Math.max(0, trace / 2 - root)
  const pixelTrace = pixelVarianceX + pixelVarianceY
  const pixelRoot = Math.sqrt(
    Math.max(0, ((pixelVarianceX - pixelVarianceY) / 2) ** 2 + pixelCovariance ** 2),
  )
  const areaScale = xSpacing * ySpacing
  const pixelEquivalentCircularDiameter = 2 * Math.sqrt(value.count / Math.PI)
  const equivalentCircularDiameter = 2 * Math.sqrt((value.count * areaScale) / Math.PI)
  const pixelMajorAxis = 4 * Math.sqrt(pixelTrace / 2 + pixelRoot)
  const pixelMinorAxis = 4 * Math.sqrt(Math.max(0, pixelTrace / 2 - pixelRoot))
  const majorAxis = 4 * Math.sqrt(majorVariance)
  const minorAxis = 4 * Math.sqrt(minorVariance)
  const physicalArea = value.count * areaScale
  const hullArea = polygonArea(convexHull(coordinatePoints(value.hullCoordinates))) * areaScale
  const perimeter = value.perimeter
  return {
    label,
    edge: value.edge,
    pixelArea: value.count,
    ...(calibration === undefined ? {} : { physicalArea }),
    centroidX,
    centroidY,
    boundingX: value.minX,
    boundingY: value.minY,
    boundingWidth: value.maxX - value.minX + 1,
    boundingHeight: value.maxY - value.minY + 1,
    pixelPerimeter: value.pixelPerimeter,
    pixelEquivalentCircularDiameter,
    pixelMajorAxis,
    pixelMinorAxis,
    pixelOrientationRadians: 0.5 * Math.atan2(2 * pixelCovariance, pixelVarianceX - pixelVarianceY),
    perimeter,
    equivalentCircularDiameter,
    majorAxis,
    minorAxis,
    aspectRatio: minorAxis <= Number.EPSILON ? Number.POSITIVE_INFINITY : majorAxis / minorAxis,
    orientationRadians: 0.5 * Math.atan2(2 * covariance, varianceX - varianceY),
    circularity: perimeter <= 0 ? 0 : (4 * Math.PI * physicalArea) / (perimeter * perimeter),
    solidity: hullArea <= 0 ? 1 : Math.min(1, physicalArea / hullArea),
    intensityMinimum: value.intensityCount === 0 ? Number.NaN : value.intensityMinimum,
    intensityMaximum: value.intensityCount === 0 ? Number.NaN : value.intensityMaximum,
    intensityMean: value.intensityCount === 0 ? Number.NaN : value.intensityMean,
    intensityStandardDeviation:
      value.intensityCount === 0 ? Number.NaN : Math.sqrt(value.intensityM2 / value.intensityCount),
    integratedIntensity: value.integratedIntensity,
  }
}

function included(measurement: ParticleMeasurement, filters: ParticleFilters): boolean {
  return (
    (filters.edgePolicy === 'include' || !measurement.edge) &&
    measurement.pixelArea >= filters.minimumArea &&
    measurement.pixelArea <= filters.maximumArea &&
    measurement.circularity >= filters.minimumCircularity &&
    measurement.circularity <= filters.maximumCircularity &&
    measurement.aspectRatio >= filters.minimumAspectRatio &&
    measurement.aspectRatio <= filters.maximumAspectRatio &&
    measurement.solidity >= filters.minimumSolidity &&
    measurement.solidity <= filters.maximumSolidity
  )
}

export function analyzeParticles(
  labels: Uint32Array,
  intensities: Float64Array,
  width: number,
  height: number,
  options: ParticleAnalysisOptions,
): ParticleAnalysisResult {
  if (labels.length !== width * height || intensities.length !== labels.length)
    throw new Error('Particle input dimensions are invalid.')
  if (options.fieldMask !== undefined && options.fieldMask.length !== labels.length)
    throw new Error('Particle field mask dimensions are invalid.')
  const maximumObjects = options.maximumObjects ?? 100_000
  const maximumHullPoints = options.maximumHullPoints ?? 1_000_000
  const particles = new Map<number, MutableParticle>()
  let hullPointCount = 0
  const xSpacing = options.calibration?.xSpacing ?? 1
  const ySpacing = options.calibration?.ySpacing ?? 1
  for (let y = 0; y < height; y += 1) {
    const spans = new Map<number, { minimum: number; maximum: number }>()
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      checkpoint(options.signal, index)
      if (options.fieldMask?.[index] === 0) continue
      const label = labels[index] ?? 0
      if (label === 0) continue
      let particle = particles.get(label)
      if (particle === undefined) {
        if (particles.size >= maximumObjects)
          throw new Error('Particle count exceeds the bounded result limit.')
        particle = {
          count: 0,
          sumX: 0,
          sumY: 0,
          sumXX: 0,
          sumYY: 0,
          sumXY: 0,
          minX: x,
          minY: y,
          maxX: x,
          maxY: y,
          edge: false,
          pixelPerimeter: 0,
          perimeter: 0,
          intensityCount: 0,
          intensityMinimum: Number.POSITIVE_INFINITY,
          intensityMaximum: Number.NEGATIVE_INFINITY,
          intensityMean: 0,
          intensityM2: 0,
          integratedIntensity: 0,
          hullCoordinates: [],
        }
        particles.set(label, particle)
      }
      particle.count += 1
      particle.sumX += x
      particle.sumY += y
      particle.sumXX += x * x
      particle.sumYY += y * y
      particle.sumXY += x * y
      particle.minX = Math.min(particle.minX, x)
      particle.minY = Math.min(particle.minY, y)
      particle.maxX = Math.max(particle.maxX, x)
      particle.maxY = Math.max(particle.maxY, y)
      const outsideField = (candidate: number) => options.fieldMask?.[candidate] === 0
      particle.edge ||=
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        outsideField(index - 1) ||
        outsideField(index + 1) ||
        outsideField(index - width) ||
        outsideField(index + width)
      const sameParticle = (candidate: number) =>
        options.fieldMask?.[candidate] !== 0 && labels[candidate] === label
      if (x === 0 || !sameParticle(index - 1)) {
        particle.pixelPerimeter += 1
        particle.perimeter += ySpacing
      }
      if (x === width - 1 || !sameParticle(index + 1)) {
        particle.pixelPerimeter += 1
        particle.perimeter += ySpacing
      }
      if (y === 0 || !sameParticle(index - width)) {
        particle.pixelPerimeter += 1
        particle.perimeter += xSpacing
      }
      if (y === height - 1 || !sameParticle(index + width)) {
        particle.pixelPerimeter += 1
        particle.perimeter += xSpacing
      }
      const intensity = intensities[index] ?? Number.NaN
      if (Number.isFinite(intensity)) {
        particle.intensityCount += 1
        particle.intensityMinimum = Math.min(particle.intensityMinimum, intensity)
        particle.intensityMaximum = Math.max(particle.intensityMaximum, intensity)
        particle.integratedIntensity += intensity
        const delta = intensity - particle.intensityMean
        particle.intensityMean += delta / particle.intensityCount
        particle.intensityM2 += delta * (intensity - particle.intensityMean)
      }
      const span = spans.get(label)
      if (span === undefined) spans.set(label, { minimum: x, maximum: x })
      else {
        span.minimum = Math.min(span.minimum, x)
        span.maximum = Math.max(span.maximum, x)
      }
    }
    for (const [label, span] of spans) {
      const particle = particles.get(label)
      if (particle === undefined) continue
      if (hullPointCount + 4 > maximumHullPoints)
        throw new Error('Particle convex-hull work exceeds the bounded point limit.')
      particle.hullCoordinates.push(
        span.minimum - 0.5,
        y - 0.5,
        span.maximum + 0.5,
        y - 0.5,
        span.maximum + 0.5,
        y + 0.5,
        span.minimum - 0.5,
        y + 0.5,
      )
      hullPointCount += 4
    }
  }
  const measurements = [...particles.entries()]
    .sort(([left], [right]) => left - right)
    .map(([label, value]) => measurement(label, value, options.calibration))
    .filter((value) => included(value, options.filters))
  const includedLabels = new Set(measurements.map(({ label }) => label))
  const filteredLabels = Uint32Array.from(labels, (label, index) =>
    options.fieldMask?.[index] !== 0 && includedLabels.has(label) ? label : 0,
  )
  const table = validateTableResult({
    kind: 'table',
    valueType: tableResultValueTypeId,
    rowCount: measurements.length,
    columns: columns(measurements, options.calibration, options.intensityUnit),
    metadata: {
      deterministicOrder: 'ascending-source-label',
      edgePolicy: options.filters.edgePolicy,
      intensityStatistics: 'finite-source-samples',
      solidity: 'pixel-square-convex-hull',
    },
  })
  const areas = measurements.map((value) => value.physicalArea ?? value.pixelArea)
  const sizeUnit = options.calibration?.unit
  const areaUnit = physicalUnit(sizeUnit, 2) ?? 'px²'
  const totalArea = areas.reduce((total, value) => total + value, 0)
  const fieldPixelCount =
    options.fieldMask?.reduce((total, selected) => total + (selected === 0 ? 0 : 1), 0) ??
    width * height
  if (
    !Number.isSafeInteger(fieldPixelCount) ||
    fieldPixelCount < 1 ||
    fieldPixelCount > width * height
  )
    throw new Error('Particle field pixel count is invalid.')
  const fieldArea =
    fieldPixelCount * (options.calibration?.xSpacing ?? 1) * (options.calibration?.ySpacing ?? 1)
  const summary = validateResultCollection({
    kind: 'collection',
    valueType: resultCollectionValueTypeId,
    results: [
      { name: 'objectCount', result: scalar(measurements.length) },
      { name: 'areaFraction', result: scalar(fieldArea === 0 ? 0 : totalArea / fieldArea) },
      { name: 'totalArea', result: scalar(totalArea, areaUnit) },
      {
        name: 'meanArea',
        result: scalar(
          measurements.length === 0 ? Number.NaN : totalArea / measurements.length,
          areaUnit,
        ),
      },
      { name: 'medianArea', result: scalar(median(areas), areaUnit) },
    ],
    metadata: { fieldWidth: width, fieldHeight: height, fieldPixelCount, filters: options.filters },
  })
  const sortedSizes = measurements
    .map(({ equivalentCircularDiameter }) => equivalentCircularDiameter)
    .sort((left, right) => left - right)
  const cumulative = Float64Array.from(
    sortedSizes,
    (_value, index) => (index + 1) / Math.max(1, sortedSizes.length),
  )
  const distribution = validateProfileResult({
    kind: 'profile',
    valueType: profileResultValueTypeId,
    axis: {
      name: 'equivalentCircularDiameter',
      values: Float64Array.from(sortedSizes),
      ...(sizeUnit === undefined ? { unit: 'px' } : { unit: sizeUnit }),
      nanPolicy: 'forbid',
    },
    series: [{ name: 'cumulativeFraction', values: cumulative, nanPolicy: 'forbid' }],
    metadata: { order: 'ascending', empiricalCdf: true },
  })
  return { measurements, includedLabels, filteredLabels, table, summary, distribution }
}
