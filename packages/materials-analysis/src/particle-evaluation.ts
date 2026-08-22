import { analyzeParticles, type ParticleMeasurement } from './particles.js'

export interface ParticleSegmentationEvaluationInput {
  readonly predictedLabels: Uint32Array
  readonly truthLabels: Uint32Array
  readonly width: number
  readonly height: number
  readonly ignoreMask?: Uint8Array
  readonly iouThreshold?: number
  readonly overlapThreshold?: number
  readonly boundaryTolerancePixels?: number
}

export interface SemanticSegmentationEvaluationInput {
  readonly predictedMask: Uint8Array
  readonly truthMask: Uint8Array
  readonly width: number
  readonly height: number
  readonly ignoreMask?: Uint8Array
  readonly boundaryTolerancePixels?: number
}

export interface SemanticSegmentationEvaluation {
  readonly schemaVersion: 1
  readonly policy: Readonly<{ boundaryTolerancePixels: number; ignoredPixels: number }>
  readonly truthForegroundPixels: number
  readonly predictedForegroundPixels: number
  readonly intersectionPixels: number
  readonly unionPixels: number
  readonly maskIoU: number
  readonly maskDice: number
  readonly boundaryF1: number
  readonly foregroundFractionError: number
}

export interface ParticleInstanceMatch {
  readonly truthLabel: number
  readonly predictedLabel: number
  readonly intersectionPixels: number
  readonly iou: number
}

export interface ParticleSegmentationEvaluation {
  readonly schemaVersion: 1
  readonly policy: Readonly<{
    iouThreshold: number
    overlapThreshold: number
    boundaryTolerancePixels: number
    ignoredPixels: number
  }>
  readonly truthCount: Readonly<{ includingBorder: number; excludingBorder: number }>
  readonly predictedCount: Readonly<{ includingBorder: number; excludingBorder: number }>
  readonly countError: Readonly<{ includingBorder: number; excludingBorder: number }>
  readonly precision: number
  readonly recall: number
  readonly f1: number
  readonly mergeRate: number
  readonly splitRate: number
  readonly maskIoU: number
  readonly maskDice: number
  readonly boundaryF1: number
  readonly meanCentroidErrorPixels: number
  readonly meanAreaRelativeBias: number
  readonly meanEquivalentDiameterRelativeBias: number
  readonly meanAspectRatioRelativeBias: number
  readonly meanAbsoluteOrientationErrorRadians: number
  readonly foregroundFractionError: number
  readonly matches: readonly ParticleInstanceMatch[]
}

export interface ParticleRefinementAssessment {
  readonly classification: 'improved' | 'regressed' | 'ambiguous' | 'unchanged'
  readonly countDelta: number
  readonly countErrorChange: number
  readonly evidence: readonly string[]
  readonly limitation: string
}

interface LabelStatistics {
  readonly area: Map<number, number>
  readonly measurements: Map<number, ParticleMeasurement>
  readonly borderLabels: ReadonlySet<number>
}

/** Evaluation-only deterministic labeling for binary benchmark masks. */
export function labelBinaryMaskForEvaluation(
  mask: Uint8Array,
  width: number,
  height: number,
  connectivity: 4 | 8 = 8,
): Uint32Array {
  if (mask.length !== width * height) throw new Error('Binary mask dimensions do not match.')
  const labels = new Uint32Array(mask.length)
  const queue = new Uint32Array(mask.length)
  const offsets =
    connectivity === 4
      ? ([
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const)
      : ([
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [-1, -1],
          [1, -1],
          [-1, 1],
        ] as const)
  let label = 0
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || labels[start] !== 0) continue
    label += 1
    let head = 0
    let tail = 1
    queue[0] = start
    labels[start] = label
    while (head < tail) {
      const index = queue[head] ?? 0
      head += 1
      const x = index % width
      const y = Math.floor(index / width)
      for (const [dx, dy] of offsets) {
        const candidateX = x + dx
        const candidateY = y + dy
        if (candidateX < 0 || candidateY < 0 || candidateX >= width || candidateY >= height)
          continue
        const candidate = candidateY * width + candidateX
        if (mask[candidate] === 0 || labels[candidate] !== 0) continue
        labels[candidate] = label
        queue[tail] = candidate
        tail += 1
      }
    }
  }
  return labels
}

/** Decodes color-coded instance masks without assuming that a color is globally unique. */
export function labelColorInstanceMaskForEvaluation(
  samples: ArrayLike<number>,
  width: number,
  height: number,
  channels: number,
): Uint32Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('Color instance-mask dimensions must be positive safe integers.')
  if (!Number.isSafeInteger(channels) || channels < 1 || channels > 4)
    throw new Error('Color instance masks must have between one and four channels.')
  if (samples.length !== width * height * channels)
    throw new Error('Color instance-mask dimensions do not match.')
  const labels = new Uint32Array(width * height)
  const queue = new Uint32Array(labels.length)
  const sameColor = (left: number, right: number): boolean => {
    for (let channel = 0; channel < channels; channel += 1)
      if (samples[left * channels + channel] !== samples[right * channels + channel]) return false
    return true
  }
  const foreground = (index: number): boolean => {
    if (channels === 4 && samples[index * channels + 3] === 0) return false
    for (let channel = 0; channel < Math.min(3, channels); channel += 1)
      if (samples[index * channels + channel] !== 0) return true
    return false
  }
  let label = 0
  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] !== 0 || !foreground(start)) continue
    label += 1
    let head = 0
    let tail = 1
    queue[0] = start
    labels[start] = label
    while (head < tail) {
      const index = queue[head] ?? 0
      head += 1
      const x = index % width
      const y = Math.floor(index / width)
      for (let dy = -1; dy <= 1; dy += 1) {
        const candidateY = y + dy
        if (candidateY < 0 || candidateY >= height) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const candidateX = x + dx
          if (candidateX < 0 || candidateX >= width) continue
          const candidate = candidateY * width + candidateX
          if (labels[candidate] !== 0 || !foreground(candidate) || !sameColor(start, candidate))
            continue
          labels[candidate] = label
          queue[tail] = candidate
          tail += 1
        }
      }
    }
  }
  return labels
}

const ALL_PARTICLES = {
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

function boundedFraction(value: number | undefined, fallback: number, name: string): number {
  const normalized = value ?? fallback
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized > 1)
    throw new Error(`${name} must be greater than zero and at most one.`)
  return normalized
}

function validateInput(input: ParticleSegmentationEvaluationInput): void {
  if (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height))
    throw new Error('Particle evaluation dimensions must be safe integers.')
  if (input.width < 1 || input.height < 1)
    throw new Error('Particle evaluation dimensions must be positive.')
  const pixels = input.width * input.height
  if (!Number.isSafeInteger(pixels))
    throw new Error('Particle evaluation dimensions are too large.')
  if (input.predictedLabels.length !== pixels || input.truthLabels.length !== pixels)
    throw new Error('Particle evaluation label dimensions do not match.')
  if (input.ignoreMask !== undefined && input.ignoreMask.length !== pixels)
    throw new Error('Particle evaluation ignore-mask dimensions do not match.')
  if (
    input.boundaryTolerancePixels !== undefined &&
    (!Number.isSafeInteger(input.boundaryTolerancePixels) || input.boundaryTolerancePixels < 0)
  )
    throw new Error('Boundary tolerance must be a non-negative safe integer.')
}

function admittedLabels(labels: Uint32Array, ignoreMask: Uint8Array | undefined): Uint32Array {
  return ignoreMask === undefined
    ? labels
    : Uint32Array.from(labels, (label, index) => (ignoreMask[index] === 0 ? label : 0))
}

function statistics(
  labels: Uint32Array,
  width: number,
  height: number,
  fieldMask: Uint8Array | undefined,
): LabelStatistics {
  const area = new Map<number, number>()
  const borderLabels = new Set<number>()
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const label = labels[index] ?? 0
      if (label === 0 || (fieldMask !== undefined && fieldMask[index] === 0)) continue
      area.set(label, (area.get(label) ?? 0) + 1)
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        borderLabels.add(label)
        continue
      }
      if (
        fieldMask !== undefined &&
        [index - 1, index + 1, index - width, index + width].some(
          (neighbor) => fieldMask[neighbor] === 0,
        )
      )
        borderLabels.add(label)
    }
  }
  const result = analyzeParticles(labels, new Float64Array(labels.length), width, height, {
    filters: ALL_PARTICLES,
    ...(fieldMask === undefined ? {} : { fieldMask }),
  })
  return {
    // Count and match labels directly. The measurement filter intentionally omits degenerate
    // one-pixel/one-axis shapes whose aspect ratio is infinite, but evaluation must not lose them.
    area,
    measurements: new Map(
      result.measurements.map((measurement) => [measurement.label, measurement]),
    ),
    borderLabels,
  }
}

function pairKey(truthLabel: number, predictedLabel: number): string {
  return `${truthLabel}:${predictedLabel}`
}

function harmonicMean(left: number, right: number): number {
  return left + right === 0 ? 0 : (2 * left * right) / (left + right)
}

function relativeBias(predicted: number, truth: number): number {
  return truth === 0 ? 0 : (predicted - truth) / truth
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}

function axialAngleDistance(left: number, right: number): number {
  const delta = Math.abs(left - right) % Math.PI
  return Math.min(delta, Math.PI - delta)
}

function boundaryMask(
  labels: ArrayLike<number>,
  width: number,
  height: number,
  ignoreMask: Uint8Array | undefined,
): Uint8Array {
  const output = new Uint8Array(labels.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if ((ignoreMask !== undefined && ignoreMask[index] !== 0) || labels[index] === 0) continue
      const neighbors = [
        x === 0 ? -1 : index - 1,
        x === width - 1 ? -1 : index + 1,
        y === 0 ? -1 : index - width,
        y === height - 1 ? -1 : index + width,
      ]
      if (
        neighbors.some(
          (neighbor) =>
            neighbor < 0 ||
            ((ignoreMask === undefined || ignoreMask[neighbor] === 0) &&
              (labels[neighbor] ?? 0) !== labels[index]),
        )
      )
        output[index] = 1
    }
  }
  return output
}

/** Grades binary semantic masks without inventing instance identities or count metrics. */
export function evaluateSemanticSegmentation(
  input: SemanticSegmentationEvaluationInput,
): SemanticSegmentationEvaluation {
  const pixels = input.width * input.height
  if (
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.width < 1 ||
    input.height < 1 ||
    !Number.isSafeInteger(pixels) ||
    input.predictedMask.length !== pixels ||
    input.truthMask.length !== pixels ||
    (input.ignoreMask !== undefined && input.ignoreMask.length !== pixels)
  )
    throw new Error('Semantic segmentation dimensions do not match.')
  const boundaryTolerancePixels = input.boundaryTolerancePixels ?? 1
  if (
    !Number.isSafeInteger(boundaryTolerancePixels) ||
    boundaryTolerancePixels < 0 ||
    boundaryTolerancePixels > 16
  )
    throw new Error('Boundary tolerance must be an integer between 0 and 16 pixels.')
  let ignoredPixels = 0
  let truthForegroundPixels = 0
  let predictedForegroundPixels = 0
  let intersectionPixels = 0
  let unionPixels = 0
  for (let index = 0; index < pixels; index += 1) {
    if (input.ignoreMask !== undefined && input.ignoreMask[index] !== 0) {
      ignoredPixels += 1
      continue
    }
    const truth = input.truthMask[index] !== 0
    const predicted = input.predictedMask[index] !== 0
    if (truth) truthForegroundPixels += 1
    if (predicted) predictedForegroundPixels += 1
    if (truth && predicted) intersectionPixels += 1
    if (truth || predicted) unionPixels += 1
  }
  const truthBoundary = boundaryMask(input.truthMask, input.width, input.height, input.ignoreMask)
  const predictedBoundary = boundaryMask(
    input.predictedMask,
    input.width,
    input.height,
    input.ignoreMask,
  )
  const boundaryPrecision = boundaryRecall(
    predictedBoundary,
    truthBoundary,
    input.width,
    input.height,
    boundaryTolerancePixels,
  )
  const boundaryRecallValue = boundaryRecall(
    truthBoundary,
    predictedBoundary,
    input.width,
    input.height,
    boundaryTolerancePixels,
  )
  const usablePixels = Math.max(1, pixels - ignoredPixels)
  const diceDenominator = truthForegroundPixels + predictedForegroundPixels
  return {
    schemaVersion: 1,
    policy: { boundaryTolerancePixels, ignoredPixels },
    truthForegroundPixels,
    predictedForegroundPixels,
    intersectionPixels,
    unionPixels,
    maskIoU: unionPixels === 0 ? 1 : intersectionPixels / unionPixels,
    maskDice: diceDenominator === 0 ? 1 : (2 * intersectionPixels) / diceDenominator,
    boundaryF1: harmonicMean(boundaryPrecision, boundaryRecallValue),
    foregroundFractionError: (predictedForegroundPixels - truthForegroundPixels) / usablePixels,
  }
}

function boundaryRecall(
  source: Uint8Array,
  target: Uint8Array,
  width: number,
  height: number,
  tolerance: number,
): number {
  let count = 0
  let matched = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (source[index] === 0) continue
      count += 1
      let found = false
      for (let dy = -tolerance; dy <= tolerance && !found; dy += 1) {
        const candidateY = y + dy
        if (candidateY < 0 || candidateY >= height) continue
        for (let dx = -tolerance; dx <= tolerance; dx += 1) {
          const candidateX = x + dx
          if (candidateX < 0 || candidateX >= width) continue
          if (target[candidateY * width + candidateX] !== 0) {
            found = true
            break
          }
        }
      }
      if (found) matched += 1
    }
  }
  return count === 0 ? (target.some((value) => value !== 0) ? 0 : 1) : matched / count
}

/**
 * Grades an instance-label prediction against an independent instance mask. Ignore pixels are
 * removed before object counting, matching, boundary scoring, and morphometry. Matches are a
 * deterministic one-to-one greedy assignment ordered by descending IoU and stable label IDs.
 */
export function evaluateParticleSegmentation(
  input: ParticleSegmentationEvaluationInput,
): ParticleSegmentationEvaluation {
  validateInput(input)
  const iouThreshold = boundedFraction(input.iouThreshold, 0.5, 'IoU threshold')
  const overlapThreshold = boundedFraction(input.overlapThreshold, 0.15, 'Overlap threshold')
  const boundaryTolerancePixels = input.boundaryTolerancePixels ?? 1
  const predicted = admittedLabels(input.predictedLabels, input.ignoreMask)
  const truth = admittedLabels(input.truthLabels, input.ignoreMask)
  const fieldMask =
    input.ignoreMask === undefined
      ? undefined
      : Uint8Array.from(input.ignoreMask, (ignored) => (ignored === 0 ? 1 : 0))
  const truthStats = statistics(truth, input.width, input.height, fieldMask)
  const predictedStats = statistics(predicted, input.width, input.height, fieldMask)
  const intersections = new Map<string, number>()
  let foregroundIntersection = 0
  let foregroundUnion = 0
  let truthForeground = 0
  let predictedForeground = 0
  let ignoredPixels = 0
  for (let index = 0; index < truth.length; index += 1) {
    if (input.ignoreMask !== undefined && input.ignoreMask[index] !== 0) {
      ignoredPixels += 1
      continue
    }
    const truthLabel = truth[index] ?? 0
    const predictedLabel = predicted[index] ?? 0
    const inTruth = truthLabel !== 0
    const inPrediction = predictedLabel !== 0
    if (inTruth) truthForeground += 1
    if (inPrediction) predictedForeground += 1
    if (inTruth || inPrediction) foregroundUnion += 1
    if (inTruth && inPrediction) {
      foregroundIntersection += 1
      const key = pairKey(truthLabel, predictedLabel)
      intersections.set(key, (intersections.get(key) ?? 0) + 1)
    }
  }
  const candidates = [...intersections.entries()]
    .map(([key, intersectionPixels]) => {
      const [truthText, predictedText] = key.split(':')
      const truthLabel = Number(truthText)
      const predictedLabel = Number(predictedText)
      const truthArea = truthStats.area.get(truthLabel) ?? 0
      const predictedArea = predictedStats.area.get(predictedLabel) ?? 0
      return {
        truthLabel,
        predictedLabel,
        intersectionPixels,
        iou: intersectionPixels / Math.max(1, truthArea + predictedArea - intersectionPixels),
      }
    })
    .sort(
      (left, right) =>
        right.iou - left.iou ||
        left.truthLabel - right.truthLabel ||
        left.predictedLabel - right.predictedLabel,
    )
  const matchedTruth = new Set<number>()
  const matchedPredicted = new Set<number>()
  const matches: ParticleInstanceMatch[] = []
  for (const candidate of candidates) {
    if (candidate.iou < iouThreshold) continue
    if (matchedTruth.has(candidate.truthLabel) || matchedPredicted.has(candidate.predictedLabel))
      continue
    matchedTruth.add(candidate.truthLabel)
    matchedPredicted.add(candidate.predictedLabel)
    matches.push(candidate)
  }
  const mergeCount = [...predictedStats.area.keys()].filter((predictedLabel) => {
    const predictedArea = predictedStats.area.get(predictedLabel) ?? 0
    return (
      [...truthStats.area.keys()].filter((truthLabel) => {
        const intersection = intersections.get(pairKey(truthLabel, predictedLabel)) ?? 0
        const truthArea = truthStats.area.get(truthLabel) ?? 0
        const iou = intersection / Math.max(1, truthArea + predictedArea - intersection)
        return iou >= overlapThreshold
      }).length > 1
    )
  }).length
  const splitCount = [...truthStats.area.keys()].filter((truthLabel) => {
    const truthArea = truthStats.area.get(truthLabel) ?? 0
    return (
      [...predictedStats.area.keys()].filter((predictedLabel) => {
        const intersection = intersections.get(pairKey(truthLabel, predictedLabel)) ?? 0
        const predictedArea = predictedStats.area.get(predictedLabel) ?? 0
        const iou = intersection / Math.max(1, truthArea + predictedArea - intersection)
        return iou >= overlapThreshold
      }).length > 1
    )
  }).length
  const precision =
    predictedStats.area.size === 0
      ? truthStats.area.size === 0
        ? 1
        : 0
      : matches.length / predictedStats.area.size
  const recall =
    truthStats.area.size === 0
      ? predictedStats.area.size === 0
        ? 1
        : 0
      : matches.length / truthStats.area.size
  const usablePixels = Math.max(1, truth.length - ignoredPixels)
  const truthBoundary = boundaryMask(truth, input.width, input.height, input.ignoreMask)
  const predictedBoundary = boundaryMask(predicted, input.width, input.height, input.ignoreMask)
  const boundaryPrecision = boundaryRecall(
    predictedBoundary,
    truthBoundary,
    input.width,
    input.height,
    boundaryTolerancePixels,
  )
  const boundaryRecallValue = boundaryRecall(
    truthBoundary,
    predictedBoundary,
    input.width,
    input.height,
    boundaryTolerancePixels,
  )
  const pairedMeasurements = matches.flatMap(({ truthLabel, predictedLabel }) => {
    const truthMeasurement = truthStats.measurements.get(truthLabel)
    const predictedMeasurement = predictedStats.measurements.get(predictedLabel)
    return truthMeasurement === undefined || predictedMeasurement === undefined
      ? []
      : [{ truth: truthMeasurement, predicted: predictedMeasurement }]
  })
  const truthCountExcludingBorder = truthStats.area.size - truthStats.borderLabels.size
  const predictedCountExcludingBorder = predictedStats.area.size - predictedStats.borderLabels.size
  const maskIoU = foregroundUnion === 0 ? 1 : foregroundIntersection / foregroundUnion
  const maskDiceDenominator = truthForeground + predictedForeground
  return {
    schemaVersion: 1,
    policy: { iouThreshold, overlapThreshold, boundaryTolerancePixels, ignoredPixels },
    truthCount: {
      includingBorder: truthStats.area.size,
      excludingBorder: truthCountExcludingBorder,
    },
    predictedCount: {
      includingBorder: predictedStats.area.size,
      excludingBorder: predictedCountExcludingBorder,
    },
    countError: {
      includingBorder: predictedStats.area.size - truthStats.area.size,
      excludingBorder: predictedCountExcludingBorder - truthCountExcludingBorder,
    },
    precision,
    recall,
    f1: harmonicMean(precision, recall),
    mergeRate: mergeCount / Math.max(1, predictedStats.area.size),
    splitRate: splitCount / Math.max(1, truthStats.area.size),
    maskIoU,
    maskDice: maskDiceDenominator === 0 ? 1 : (2 * foregroundIntersection) / maskDiceDenominator,
    boundaryF1: harmonicMean(boundaryPrecision, boundaryRecallValue),
    meanCentroidErrorPixels: mean(
      pairedMeasurements.map(({ truth: expected, predicted: actual }) =>
        Math.hypot(actual.centroidX - expected.centroidX, actual.centroidY - expected.centroidY),
      ),
    ),
    meanAreaRelativeBias: mean(
      pairedMeasurements.map(({ truth: expected, predicted: actual }) =>
        relativeBias(actual.pixelArea, expected.pixelArea),
      ),
    ),
    meanEquivalentDiameterRelativeBias: mean(
      pairedMeasurements.map(({ truth: expected, predicted: actual }) =>
        relativeBias(
          actual.pixelEquivalentCircularDiameter,
          expected.pixelEquivalentCircularDiameter,
        ),
      ),
    ),
    meanAspectRatioRelativeBias: mean(
      pairedMeasurements.map(({ truth: expected, predicted: actual }) =>
        relativeBias(actual.aspectRatio, expected.aspectRatio),
      ),
    ),
    meanAbsoluteOrientationErrorRadians: mean(
      pairedMeasurements.map(({ truth: expected, predicted: actual }) =>
        axialAngleDistance(actual.pixelOrientationRadians, expected.pixelOrientationRadians),
      ),
    ),
    foregroundFractionError: predictedForeground / usablePixels - truthForeground / usablePixels,
    matches,
  }
}

/**
 * Compares two oracle-backed corpus runs. Count delta is reported but deliberately excluded from
 * classification; improvement requires the instance and mask evidence to move consistently.
 */
export function assessParticleRefinement(
  previous: ParticleSegmentationEvaluation,
  current: ParticleSegmentationEvaluation,
  tolerance = 1e-9,
): ParticleRefinementAssessment {
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new Error('Refinement comparison tolerance must be finite and non-negative.')
  const higherIsBetter = [
    ['instance F1', previous.f1, current.f1],
    ['mask IoU', previous.maskIoU, current.maskIoU],
    ['boundary F1', previous.boundaryF1, current.boundaryF1],
  ] as const
  const lowerIsBetter = [
    [
      'absolute count error',
      Math.abs(previous.countError.includingBorder),
      Math.abs(current.countError.includingBorder),
    ],
    ['merge rate', previous.mergeRate, current.mergeRate],
    ['split rate', previous.splitRate, current.splitRate],
    ['centroid error', previous.meanCentroidErrorPixels, current.meanCentroidErrorPixels],
    [
      'absolute area bias',
      Math.abs(previous.meanAreaRelativeBias),
      Math.abs(current.meanAreaRelativeBias),
    ],
  ] as const
  const evidence: string[] = []
  let improvements = 0
  let regressions = 0
  for (const [name, before, after] of higherIsBetter) {
    const delta = after - before
    if (delta > tolerance) improvements += 1
    else if (delta < -tolerance) regressions += 1
    if (Math.abs(delta) > tolerance) evidence.push(`${name}: ${before} -> ${after}`)
  }
  for (const [name, before, after] of lowerIsBetter) {
    const delta = after - before
    if (delta < -tolerance) improvements += 1
    else if (delta > tolerance) regressions += 1
    if (Math.abs(delta) > tolerance) evidence.push(`${name}: ${before} -> ${after}`)
  }
  const classification =
    improvements === 0 && regressions === 0
      ? 'unchanged'
      : improvements > 0 && regressions === 0
        ? 'improved'
        : regressions > 0 && improvements === 0
          ? 'regressed'
          : 'ambiguous'
  return {
    classification,
    countDelta: current.predictedCount.includingBorder - previous.predictedCount.includingBorder,
    countErrorChange:
      Math.abs(current.countError.includingBorder) - Math.abs(previous.countError.includingBorder),
    evidence,
    limitation:
      'This classification is valid only for this fixture and independent instance mask; it is not a universal particle-analysis guarantee.',
  }
}
