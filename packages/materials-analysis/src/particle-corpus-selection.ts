import { analyzeParticles } from './particles.js'

export interface ParticleCorpusFeatureInput {
  readonly id: string
  readonly image: Float64Array
  readonly instanceLabels: Uint32Array
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly channelCount: number
}

export interface ParticleCorpusFeatures {
  readonly objectCount: number
  readonly foregroundFraction: number
  readonly objectAreaMedian: number
  readonly objectAreaP10: number
  readonly objectAreaP90: number
  readonly objectAreaCoefficientOfVariation: number
  readonly edgeTouchingInstanceFraction: number
  readonly nearTouchingGraphDensity1: number
  readonly nearTouchingGraphDensity2: number
  readonly nearTouchingGraphDensity4: number
  readonly eccentricityP90: number
  readonly solidityP10: number
  readonly perimeterToAreaP90: number
  readonly intensityGradient: number
  readonly localBoundaryContrast: number
  readonly focusScore: number
  readonly estimatedSnr: number
  readonly bitDepth: number
  readonly channelCount: number
}

export interface ParticleCorpusCandidate {
  readonly id: string
  readonly features: ParticleCorpusFeatures
}

export interface ParticleCorpusSelection {
  readonly id: string
  readonly features: ParticleCorpusFeatures
  readonly reasons: readonly string[]
}

const UNFILTERED = {
  edgePolicy: 'include' as const,
  minimumArea: 1,
  maximumArea: Number.MAX_SAFE_INTEGER,
  minimumCircularity: 0,
  maximumCircularity: Number.MAX_SAFE_INTEGER,
  minimumAspectRatio: 0,
  maximumAspectRatio: Number.MAX_SAFE_INTEGER,
  minimumSolidity: 0,
  maximumSolidity: Number.MAX_SAFE_INTEGER,
}

const FEATURE_KEYS = [
  'objectCount',
  'foregroundFraction',
  'objectAreaMedian',
  'objectAreaP10',
  'objectAreaP90',
  'objectAreaCoefficientOfVariation',
  'edgeTouchingInstanceFraction',
  'nearTouchingGraphDensity1',
  'nearTouchingGraphDensity2',
  'nearTouchingGraphDensity4',
  'eccentricityP90',
  'solidityP10',
  'perimeterToAreaP90',
  'intensityGradient',
  'localBoundaryContrast',
  'focusScore',
  'estimatedSnr',
  'bitDepth',
  'channelCount',
] as const satisfies readonly (keyof ParticleCorpusFeatures)[]

function quantile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const position = fraction * (sorted.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const weight = position - lower
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0
  const center = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - center) ** 2)))
}

function nearTouchingGraphDensity(
  labels: Uint32Array,
  width: number,
  height: number,
  radius: 1 | 2 | 4,
  objectCount: number,
): number {
  if (objectCount < 2) return 0
  const edges = new Set<string>()
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const label = labels[y * width + x] ?? 0
      if (label === 0) continue
      for (let dy = -radius; dy <= radius; dy += 1) {
        const candidateY = y + dy
        if (candidateY < 0 || candidateY >= height) continue
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const candidateX = x + dx
          if (candidateX < 0 || candidateX >= width) continue
          const other = labels[candidateY * width + candidateX] ?? 0
          if (other === 0 || other === label) continue
          const lower = Math.min(label, other)
          const upper = Math.max(label, other)
          edges.add(`${lower}:${upper}`)
        }
      }
    }
  }
  return edges.size / ((objectCount * (objectCount - 1)) / 2)
}

function intensityRange(image: Float64Array): Readonly<{ minimum: number; range: number }> {
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (const value of image) {
    if (!Number.isFinite(value)) continue
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  return Number.isFinite(minimum) && Number.isFinite(maximum)
    ? { minimum, range: Math.max(Number.EPSILON, maximum - minimum) }
    : { minimum: 0, range: 1 }
}

function illuminationGradient(image: Float64Array, width: number, height: number): number {
  const { range } = intensityRange(image)
  let sum = 0
  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumYY = 0
  let sumXI = 0
  let sumYI = 0
  let count = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = image[y * width + x] ?? Number.NaN
      if (!Number.isFinite(value)) continue
      count += 1
      sum += value
      sumX += x
      sumY += y
      sumXX += x * x
      sumYY += y * y
      sumXI += x * value
      sumYI += y * value
    }
  }
  if (count === 0) return 0
  const slopeX =
    (sumXI - (sumX * sum) / count) / Math.max(Number.EPSILON, sumXX - sumX ** 2 / count)
  const slopeY =
    (sumYI - (sumY * sum) / count) / Math.max(Number.EPSILON, sumYY - sumY ** 2 / count)
  return Math.hypot(slopeX * Math.max(1, width - 1), slopeY * Math.max(1, height - 1)) / range
}

function boundaryContrast(
  image: Float64Array,
  labels: Uint32Array,
  width: number,
  height: number,
): number {
  const { range } = intensityRange(image)
  const contrasts: number[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (labels[index] === 0) continue
      const foreground = image[index] ?? Number.NaN
      if (!Number.isFinite(foreground)) continue
      const neighbors = [
        x === 0 ? -1 : index - 1,
        x === width - 1 ? -1 : index + 1,
        y === 0 ? -1 : index - width,
        y === height - 1 ? -1 : index + width,
      ]
      for (const neighbor of neighbors) {
        const background = neighbor < 0 ? Number.NaN : (image[neighbor] ?? Number.NaN)
        if (neighbor >= 0 && labels[neighbor] === 0 && Number.isFinite(background))
          contrasts.push(Math.abs(foreground - background) / range)
      }
    }
  }
  return mean(contrasts)
}

function focusScore(image: Float64Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0
  const { range } = intensityRange(image)
  const laplacian: number[] = []
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const center = image[index] ?? 0
      laplacian.push(
        (image[index - 1] ?? center) +
          (image[index + 1] ?? center) +
          (image[index - width] ?? center) +
          (image[index + width] ?? center) -
          4 * center,
      )
    }
  }
  return (standardDeviation(laplacian) / range) ** 2
}

function estimatedSnr(image: Float64Array, labels: Uint32Array): number {
  const foreground: number[] = []
  const background: number[] = []
  for (let index = 0; index < image.length; index += 1) {
    const value = image[index] ?? Number.NaN
    if (!Number.isFinite(value)) continue
    ;(labels[index] === 0 ? background : foreground).push(value)
  }
  const noise = Math.sqrt(
    (standardDeviation(foreground) ** 2 + standardDeviation(background) ** 2) / 2,
  )
  return Math.abs(mean(foreground) - mean(background)) / Math.max(Number.EPSILON, noise)
}

/** Computes the frozen, mask-derived feature vector used for corpus selection. */
export function computeParticleCorpusFeatures(
  input: ParticleCorpusFeatureInput,
): ParticleCorpusFeatures {
  if (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height))
    throw new Error('Corpus feature dimensions must be safe integers.')
  const pixelCount = input.width * input.height
  if (input.width < 1 || input.height < 1 || !Number.isSafeInteger(pixelCount))
    throw new Error('Corpus feature dimensions are invalid.')
  if (input.image.length !== pixelCount || input.instanceLabels.length !== pixelCount)
    throw new Error('Corpus image and instance-mask dimensions do not match.')
  if (!Number.isSafeInteger(input.bitDepth) || input.bitDepth < 1 || input.bitDepth > 64)
    throw new Error('Corpus bit depth is invalid.')
  if (
    !Number.isSafeInteger(input.channelCount) ||
    input.channelCount < 1 ||
    input.channelCount > 64
  )
    throw new Error('Corpus channel count is invalid.')
  const result = analyzeParticles(input.instanceLabels, input.image, input.width, input.height, {
    filters: UNFILTERED,
  })
  const areasByLabel = new Map<number, number>()
  const borderLabels = new Set<number>()
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const label = input.instanceLabels[y * input.width + x] ?? 0
      if (label === 0) continue
      areasByLabel.set(label, (areasByLabel.get(label) ?? 0) + 1)
      if (x === 0 || y === 0 || x === input.width - 1 || y === input.height - 1)
        borderLabels.add(label)
    }
  }
  const areas = [...areasByLabel.values()]
  const areaMean = mean(areas)
  const objectCount = areasByLabel.size
  return {
    objectCount,
    foregroundFraction: areas.reduce((total, value) => total + value, 0) / pixelCount,
    objectAreaMedian: quantile(areas, 0.5),
    objectAreaP10: quantile(areas, 0.1),
    objectAreaP90: quantile(areas, 0.9),
    objectAreaCoefficientOfVariation: areaMean === 0 ? 0 : standardDeviation(areas) / areaMean,
    edgeTouchingInstanceFraction: borderLabels.size / Math.max(1, objectCount),
    nearTouchingGraphDensity1: nearTouchingGraphDensity(
      input.instanceLabels,
      input.width,
      input.height,
      1,
      objectCount,
    ),
    nearTouchingGraphDensity2: nearTouchingGraphDensity(
      input.instanceLabels,
      input.width,
      input.height,
      2,
      objectCount,
    ),
    nearTouchingGraphDensity4: nearTouchingGraphDensity(
      input.instanceLabels,
      input.width,
      input.height,
      4,
      objectCount,
    ),
    eccentricityP90: quantile(
      result.measurements.map(({ aspectRatio }) =>
        Math.sqrt(Math.max(0, 1 - 1 / Math.max(1, aspectRatio) ** 2)),
      ),
      0.9,
    ),
    solidityP10: quantile(
      result.measurements.map(({ solidity }) => solidity),
      0.1,
    ),
    perimeterToAreaP90: quantile(
      result.measurements.map(({ pixelArea, pixelPerimeter }) => pixelPerimeter / pixelArea),
      0.9,
    ),
    intensityGradient: illuminationGradient(input.image, input.width, input.height),
    localBoundaryContrast: boundaryContrast(
      input.image,
      input.instanceLabels,
      input.width,
      input.height,
    ),
    focusScore: focusScore(input.image, input.width, input.height),
    estimatedSnr: estimatedSnr(input.image, input.instanceLabels),
    bitDepth: input.bitDepth,
    channelCount: input.channelCount,
  }
}

function distance(left: readonly number[], right: readonly number[]): number {
  return Math.sqrt(
    left.reduce((total, value, index) => total + (value - (right[index] ?? 0)) ** 2, 0),
  )
}

function normalizedVectors(candidates: readonly ParticleCorpusCandidate[]): readonly number[][] {
  return candidates.map(({ features }) =>
    FEATURE_KEYS.map((key) => {
      const values = candidates.map((candidate) => candidate.features[key])
      const minimum = Math.min(...values)
      const maximum = Math.max(...values)
      return maximum === minimum ? 0 : (features[key] - minimum) / (maximum - minimum)
    }),
  )
}

function clusterMedoidIndices(vectors: readonly number[][], count: number): readonly number[] {
  if (vectors.length === 0 || count < 1) return []
  const medoids = [0]
  while (medoids.length < Math.min(count, vectors.length)) {
    let best = -1
    let bestDistance = -1
    for (let index = 0; index < vectors.length; index += 1) {
      if (medoids.includes(index)) continue
      const nearest = Math.min(
        ...medoids.map((medoid) => distance(vectors[index] ?? [], vectors[medoid] ?? [])),
      )
      if (nearest > bestDistance) {
        best = index
        bestDistance = nearest
      }
    }
    if (best < 0) break
    medoids.push(best)
  }
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const clusters = medoids.map(() => [] as number[])
    for (let index = 0; index < vectors.length; index += 1) {
      let cluster = 0
      let nearest = Number.POSITIVE_INFINITY
      medoids.forEach((medoid, candidateCluster) => {
        const candidateDistance = distance(vectors[index] ?? [], vectors[medoid] ?? [])
        if (candidateDistance < nearest) {
          nearest = candidateDistance
          cluster = candidateCluster
        }
      })
      clusters[cluster]?.push(index)
    }
    const next = clusters.map((members, cluster) => {
      let best = medoids[cluster] ?? 0
      let bestCost = Number.POSITIVE_INFINITY
      for (const candidate of members) {
        const cost = members.reduce(
          (total, member) => total + distance(vectors[candidate] ?? [], vectors[member] ?? []),
          0,
        )
        if (cost < bestCost || (cost === bestCost && candidate < best)) {
          best = candidate
          bestCost = cost
        }
      }
      return best
    })
    if (next.every((value, index) => value === medoids[index])) break
    medoids.splice(0, medoids.length, ...next)
  }
  return [...medoids].sort((left, right) => left - right)
}

/**
 * Selects one multivariate median, both feature extremes, and deterministic cluster medoids.
 * Every selected fixture carries all reasons so a frozen report explains the choice.
 */
export function selectParticleCorpusHardCases(
  input: readonly ParticleCorpusCandidate[],
  clusterCount = 3,
  maximumCount?: number,
): readonly ParticleCorpusSelection[] {
  if (!Number.isSafeInteger(clusterCount) || clusterCount < 1)
    throw new Error('Corpus cluster count must be a positive safe integer.')
  if (
    maximumCount !== undefined &&
    (!Number.isSafeInteger(maximumCount) || maximumCount < 1 || maximumCount <= clusterCount)
  )
    throw new Error('Corpus selection maximum must be a safe integer greater than clusterCount.')
  const candidates = [...input].sort((left, right) => left.id.localeCompare(right.id))
  if (new Set(candidates.map(({ id }) => id)).size !== candidates.length)
    throw new Error('Corpus candidate IDs must be unique.')
  if (candidates.length === 0) return []
  for (const candidate of candidates)
    for (const key of FEATURE_KEYS)
      if (!Number.isFinite(candidate.features[key]))
        throw new Error(`Corpus feature ${candidate.id}/${key} must be finite.`)
  const vectors = normalizedVectors(candidates)
  const reasons = new Map<number, Set<string>>()
  const add = (index: number, reason: string) => {
    const current = reasons.get(index) ?? new Set<string>()
    current.add(reason)
    reasons.set(index, current)
  }
  const medianVector = FEATURE_KEYS.map((_, featureIndex) =>
    quantile(
      vectors.map((vector) => vector[featureIndex] ?? 0),
      0.5,
    ),
  )
  let medianIndex = 0
  for (let index = 1; index < candidates.length; index += 1)
    if (
      distance(vectors[index] ?? [], medianVector) <
      distance(vectors[medianIndex] ?? [], medianVector)
    )
      medianIndex = index
  add(medianIndex, 'multivariate-median')
  for (const key of FEATURE_KEYS) {
    const ordered = candidates
      .map(({ features }, index) => ({ index, value: features[key] }))
      .sort((left, right) => left.value - right.value || left.index - right.index)
    add(ordered[0]?.index ?? 0, `${key}:minimum`)
    add(ordered[ordered.length - 1]?.index ?? 0, `${key}:maximum`)
  }
  for (const index of clusterMedoidIndices(vectors, clusterCount)) add(index, 'cluster-medoid')
  const selections = [...reasons.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, selectedReasons]) => {
      const candidate = candidates[index]
      if (candidate === undefined) throw new Error('Corpus selection index is invalid.')
      return {
        id: candidate.id,
        features: candidate.features,
        reasons: [...selectedReasons].sort(),
      }
    })
  if (maximumCount === undefined || selections.length <= maximumCount) return selections
  const retained = new Set<string>()
  for (const selection of selections)
    if (
      selection.reasons.includes('multivariate-median') ||
      selection.reasons.includes('cluster-medoid')
    )
      retained.add(selection.id)
  const uncovered = new Set(selections.flatMap(({ reasons: selectionReasons }) => selectionReasons))
  for (const selection of selections)
    if (retained.has(selection.id)) for (const reason of selection.reasons) uncovered.delete(reason)
  while (retained.size < maximumCount) {
    const candidate = selections
      .filter(({ id }) => !retained.has(id))
      .map((selection) => ({
        selection,
        gain: selection.reasons.filter((reason) => uncovered.has(reason)).length,
      }))
      .sort(
        (left, right) =>
          right.gain - left.gain ||
          right.selection.reasons.length - left.selection.reasons.length ||
          left.selection.id.localeCompare(right.selection.id),
      )[0]
    if (candidate === undefined) break
    retained.add(candidate.selection.id)
    for (const reason of candidate.selection.reasons) uncovered.delete(reason)
  }
  return selections.filter(({ id }) => retained.has(id))
}
