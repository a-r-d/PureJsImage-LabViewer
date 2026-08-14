import { applyThreshold, type ThresholdMethod } from './segmentation.js'

export type SurfaceCorrection =
  | 'none'
  | 'subtract-mean'
  | 'first-order-plane'
  | 'row-median'
  | 'polynomial'

export interface SurfaceCorrectionOptions {
  readonly correction: SurfaceCorrection
  readonly polynomialDegree: 0 | 1 | 2
  readonly exclusionMask?: Uint8Array
  readonly signal?: AbortSignal
}

export interface SurfaceCorrectionResult {
  readonly values: Float64Array
  readonly coefficients: Float64Array
  readonly includedCount: number
}

export interface SurfaceRoughness {
  readonly count: number
  readonly minimum: number
  readonly maximum: number
  readonly mean: number
  readonly ra: number
  readonly rq: number
  /** Maximum peak-to-valley height over the admitted area: max(z) - min(z). */
  readonly rz: number
}

export interface SurfaceHistogram {
  readonly binEdges: Float64Array
  readonly counts: Uint32Array
}

export interface SurfaceProfile {
  readonly distance: Float64Array
  readonly height: Float64Array
}

function checkpoint(signal: AbortSignal | undefined, index: number): void {
  if ((index & 1_023) === 0) signal?.throwIfAborted()
}

function included(value: number, mask: Uint8Array | undefined, index: number): boolean {
  return Number.isFinite(value) && (mask === undefined || mask[index] === 0)
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle] ?? Number.NaN
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? upper) + upper) / 2 : upper
}

function polynomialTerms(x: number, y: number, degree: 0 | 1 | 2): readonly number[] {
  if (degree === 0) return [1]
  if (degree === 1) return [1, x, y]
  return [1, x, y, x * x, x * y, y * y]
}

function solveLinear(matrix: Float64Array, vector: Float64Array, size: number): Float64Array {
  const augmented = new Float64Array(size * (size + 1))
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1)
      augmented[row * (size + 1) + column] = matrix[row * size + column] ?? 0
    augmented[row * (size + 1) + size] = vector[row] ?? 0
  }
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot
    for (let row = pivot + 1; row < size; row += 1)
      if (
        Math.abs(augmented[row * (size + 1) + pivot] ?? 0) >
        Math.abs(augmented[best * (size + 1) + pivot] ?? 0)
      )
        best = row
    if (Math.abs(augmented[best * (size + 1) + pivot] ?? 0) < 1e-12)
      throw new Error('Surface background fit is singular for the admitted samples.')
    if (best !== pivot)
      for (let column = pivot; column <= size; column += 1) {
        const first = pivot * (size + 1) + column
        const second = best * (size + 1) + column
        const value = augmented[first] ?? 0
        augmented[first] = augmented[second] ?? 0
        augmented[second] = value
      }
    const divisor = augmented[pivot * (size + 1) + pivot] ?? 1
    for (let column = pivot; column <= size; column += 1)
      augmented[pivot * (size + 1) + column] =
        (augmented[pivot * (size + 1) + column] ?? 0) / divisor
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue
      const factor = augmented[row * (size + 1) + pivot] ?? 0
      for (let column = pivot; column <= size; column += 1)
        augmented[row * (size + 1) + column] =
          (augmented[row * (size + 1) + column] ?? 0) -
          factor * (augmented[pivot * (size + 1) + column] ?? 0)
    }
  }
  return Float64Array.from({ length: size }, (_value, row) =>
    Number(augmented[row * (size + 1) + size] ?? 0),
  )
}

function fitPolynomial(
  values: ArrayLike<number>,
  width: number,
  height: number,
  degree: 0 | 1 | 2,
  exclusionMask: Uint8Array | undefined,
  signal: AbortSignal | undefined,
): Readonly<{ coefficients: Float64Array; count: number }> {
  const termCount = polynomialTerms(0, 0, degree).length
  const normal = new Float64Array(termCount * termCount)
  const right = new Float64Array(termCount)
  let count = 0
  const scaleX = Math.max(1, width - 1)
  const scaleY = Math.max(1, height - 1)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      checkpoint(signal, index)
      const value = Number(values[index])
      if (!included(value, exclusionMask, index)) continue
      const terms = polynomialTerms((2 * x) / scaleX - 1, (2 * y) / scaleY - 1, degree)
      for (let row = 0; row < termCount; row += 1) {
        right[row] = (right[row] ?? 0) + (terms[row] ?? 0) * value
        for (let column = 0; column < termCount; column += 1)
          normal[row * termCount + column] =
            (normal[row * termCount + column] ?? 0) + (terms[row] ?? 0) * (terms[column] ?? 0)
      }
      count += 1
    }
  }
  if (count < termCount) throw new Error('Too few finite, unmasked samples for surface leveling.')
  return { coefficients: solveLinear(normal, right, termCount), count }
}

export function correctSurface(
  values: ArrayLike<number>,
  width: number,
  height: number,
  options: SurfaceCorrectionOptions,
): SurfaceCorrectionResult {
  if (values.length !== width * height) throw new Error('Surface dimensions are invalid.')
  if (options.exclusionMask !== undefined && options.exclusionMask.length !== values.length)
    throw new Error('Surface exclusion mask dimensions are invalid.')
  const output = Float64Array.from(values)
  if (options.correction === 'none') {
    let count = 0
    for (let index = 0; index < output.length; index += 1)
      if (included(output[index] ?? Number.NaN, options.exclusionMask, index)) count += 1
    return { values: output, coefficients: new Float64Array(), includedCount: count }
  }
  if (options.correction === 'row-median') {
    let count = 0
    for (let y = 0; y < height; y += 1) {
      options.signal?.throwIfAborted()
      const row: number[] = []
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        const value = output[index] ?? Number.NaN
        if (included(value, options.exclusionMask, index)) row.push(value)
      }
      const rowMedian = median(row)
      count += row.length
      if (!Number.isFinite(rowMedian)) continue
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        if (Number.isFinite(output[index])) output[index] = (output[index] ?? 0) - rowMedian
      }
    }
    return { values: output, coefficients: new Float64Array(), includedCount: count }
  }
  const degree =
    options.correction === 'subtract-mean'
      ? 0
      : options.correction === 'first-order-plane'
        ? 1
        : options.polynomialDegree
  const fit = fitPolynomial(values, width, height, degree, options.exclusionMask, options.signal)
  const scaleX = Math.max(1, width - 1)
  const scaleY = Math.max(1, height - 1)
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      checkpoint(options.signal, index)
      if (!Number.isFinite(output[index])) continue
      const terms = polynomialTerms((2 * x) / scaleX - 1, (2 * y) / scaleY - 1, degree)
      let background = 0
      for (let term = 0; term < terms.length; term += 1)
        background += (terms[term] ?? 0) * (fit.coefficients[term] ?? 0)
      output[index] = (output[index] ?? 0) - background
    }
  return { values: output, coefficients: fit.coefficients, includedCount: fit.count }
}

export function surfaceRoughness(
  values: ArrayLike<number>,
  exclusionMask?: Uint8Array,
  signal?: AbortSignal,
): SurfaceRoughness {
  if (exclusionMask !== undefined && exclusionMask.length !== values.length)
    throw new Error('Surface exclusion mask dimensions are invalid.')
  let count = 0
  let sum = 0
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (let index = 0; index < values.length; index += 1) {
    checkpoint(signal, index)
    const value = Number(values[index])
    if (!included(value, exclusionMask, index)) continue
    count += 1
    sum += value
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  if (count === 0)
    throw new Error('Surface roughness requires at least one finite, unmasked sample.')
  const mean = sum / count
  let absolute = 0
  let square = 0
  for (let index = 0; index < values.length; index += 1) {
    checkpoint(signal, index)
    const value = Number(values[index])
    if (!included(value, exclusionMask, index)) continue
    const deviation = value - mean
    absolute += Math.abs(deviation)
    square += deviation * deviation
  }
  return {
    count,
    minimum,
    maximum,
    mean,
    ra: absolute / count,
    rq: Math.sqrt(square / count),
    rz: maximum - minimum,
  }
}

export function surfaceHistogram(
  values: ArrayLike<number>,
  bins: number,
  exclusionMask?: Uint8Array,
): SurfaceHistogram {
  if (!Number.isSafeInteger(bins) || bins < 2 || bins > 4_096)
    throw new Error('Surface histogram bins must be between 2 and 4096.')
  const roughness = surfaceRoughness(values, exclusionMask)
  const edges = new Float64Array(bins + 1)
  const counts = new Uint32Array(bins)
  const span = roughness.maximum - roughness.minimum
  for (let bin = 0; bin <= bins; bin += 1)
    edges[bin] = span === 0 ? roughness.minimum + bin : roughness.minimum + (span * bin) / bins
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index])
    if (!included(value, exclusionMask, index)) continue
    const bin =
      span === 0 ? 0 : Math.min(bins - 1, Math.floor(((value - roughness.minimum) / span) * bins))
    counts[bin] = (counts[bin] ?? 0) + 1
  }
  return { binEdges: edges, counts }
}

function bilinear(
  values: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)))
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const a = Number(values[y0 * width + x0])
  const b = Number(values[y0 * width + x1])
  const c = Number(values[y1 * width + x0])
  const d = Number(values[y1 * width + x1])
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
}

export function extractSurfaceProfile(
  values: ArrayLike<number>,
  width: number,
  height: number,
  options: Readonly<{
    x0: number
    y0: number
    x1: number
    y1: number
    samples: number
    xSpacing: number
    ySpacing: number
  }>,
): SurfaceProfile {
  if (!Number.isSafeInteger(options.samples) || options.samples < 2 || options.samples > 65_536)
    throw new Error('Surface profile samples must be between 2 and 65536.')
  const distance = new Float64Array(options.samples)
  const heightValues = new Float64Array(options.samples)
  const physicalLength = Math.hypot(
    (options.x1 - options.x0) * options.xSpacing,
    (options.y1 - options.y0) * options.ySpacing,
  )
  for (let sample = 0; sample < options.samples; sample += 1) {
    const ratio = sample / (options.samples - 1)
    const x = options.x0 + (options.x1 - options.x0) * ratio
    const y = options.y0 + (options.y1 - options.y0) * ratio
    distance[sample] = physicalLength * ratio
    heightValues[sample] = bilinear(values, width, height, x, y)
  }
  return { distance, height: heightValues }
}

export function surfaceGrainMask(
  values: ArrayLike<number>,
  width: number,
  height: number,
  options: Readonly<{
    method: Exclude<ThresholdMethod, 'sauvola'>
    polarity: 'light' | 'dark'
    lower: number
    upper: number
    histogramBins: number
    exclusionMask?: Uint8Array
    signal?: AbortSignal
  }>,
): Uint8Array {
  const roiMask =
    options.exclusionMask === undefined
      ? undefined
      : Uint8Array.from(options.exclusionMask, (excluded) => (excluded === 0 ? 1 : 0))
  const mask = applyThreshold(
    { width, height, components: 1, values: Float64Array.from(values) },
    0,
    {
      method: options.method,
      polarity: options.polarity,
      lower: options.lower,
      upper: options.upper,
      histogramBins: options.histogramBins,
      windowRadius: 1,
      sauvolaK: 0.2,
      dynamicRange: 1,
      noDataPolicy: 'background',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
    roiMask,
  ).mask
  return Uint8Array.from(mask, (sample) => (Number.isFinite(sample) && sample !== 0 ? 1 : 0))
}
