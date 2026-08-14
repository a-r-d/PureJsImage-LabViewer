import type { DensePlane } from './kernels.js'

export type ThresholdMethod = 'manual' | 'otsu' | 'triangle' | 'yen' | 'li' | 'mean' | 'sauvola'
export type ForegroundPolarity = 'light' | 'dark'
export type ThresholdNoDataPolicy = 'background' | 'foreground' | 'propagate'
export type BinaryMorphologyKind =
  | 'erode'
  | 'dilate'
  | 'open'
  | 'close'
  | 'fill-holes'
  | 'clear-border'
  | 'remove-small-objects'
  | 'outline'

export interface ThresholdHistogram {
  readonly minimum: number
  readonly maximum: number
  readonly binEdges: Float64Array
  readonly counts: Float64Array
  readonly finiteCount: number
  readonly invalidCount: number
}

export interface ThresholdOptions {
  readonly method: ThresholdMethod
  readonly polarity: ForegroundPolarity
  readonly lower: number
  readonly upper: number
  readonly histogramBins: number
  readonly windowRadius: number
  readonly sauvolaK: number
  readonly dynamicRange: number
  readonly noDataPolicy: ThresholdNoDataPolicy
  readonly signal?: AbortSignal
}

export interface ThresholdResult {
  readonly mask: Float32Array
  readonly threshold: number
  readonly foregroundCount: number
  readonly selectedCount: number
}

const checkpoint = (signal: AbortSignal | undefined, ordinal: number): void => {
  if ((ordinal & 16_383) === 0) signal?.throwIfAborted()
}

function finiteSelectedValues(
  plane: DensePlane,
  component: number,
  selection: Uint8Array | undefined,
  signal?: AbortSignal,
): Float64Array {
  if (!Number.isSafeInteger(component) || component < 0 || component >= plane.components)
    throw new Error('Threshold component is unavailable.')
  const pixels = plane.width * plane.height
  if (selection !== undefined && selection.length !== pixels)
    throw new Error('Threshold selection mask has the wrong size.')
  const values = new Float64Array(pixels)
  let count = 0
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    checkpoint(signal, pixel)
    if (selection?.[pixel] === 0) continue
    const value = plane.values[pixel * plane.components + component] ?? Number.NaN
    if (!Number.isFinite(value) || value === plane.noDataValue) continue
    values[count] = value
    count += 1
  }
  return values.slice(0, count)
}

export function thresholdHistogram(
  plane: DensePlane,
  component: number,
  bins: number,
  selection?: Uint8Array,
  signal?: AbortSignal,
): ThresholdHistogram {
  if (!Number.isSafeInteger(bins) || bins < 2 || bins > 4_096)
    throw new Error('Threshold histogram bins must be between 2 and 4096.')
  const values = finiteSelectedValues(plane, component, selection, signal)
  if (values.length === 0) throw new Error('Threshold selection contains no finite samples.')
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (let index = 0; index < values.length; index += 1) {
    checkpoint(signal, index)
    const value = values[index] ?? Number.NaN
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  if (minimum === maximum) {
    minimum -= 0.5
    maximum += 0.5
  }
  const counts = new Float64Array(bins)
  const edges = new Float64Array(bins + 1)
  const width = (maximum - minimum) / bins
  for (let index = 0; index <= bins; index += 1)
    edges[index] = index === bins ? maximum : minimum + index * width
  for (let index = 0; index < values.length; index += 1) {
    checkpoint(signal, index)
    const value = values[index] ?? minimum
    const bin = value === maximum ? bins - 1 : Math.floor((value - minimum) / width)
    const bounded = Math.max(0, Math.min(bins - 1, bin))
    counts[bounded] = (counts[bounded] ?? 0) + 1
  }
  const selectedCount =
    selection === undefined
      ? plane.width * plane.height
      : selection.reduce((total, value) => total + (value === 0 ? 0 : 1), 0)
  return {
    minimum,
    maximum,
    binEdges: edges,
    counts,
    finiteCount: values.length,
    invalidCount: selectedCount - values.length,
  }
}

const binCenter = (histogram: ThresholdHistogram, index: number): number =>
  ((histogram.binEdges[index] ?? histogram.minimum) +
    (histogram.binEdges[index + 1] ?? histogram.maximum)) /
  2

function otsuThreshold(histogram: ThresholdHistogram): number {
  const total = histogram.finiteCount
  let sum = 0
  for (let index = 0; index < histogram.counts.length; index += 1)
    sum += (histogram.counts[index] ?? 0) * binCenter(histogram, index)
  let backgroundWeight = 0
  let backgroundSum = 0
  let bestVariance = -1
  let best = 0
  for (let index = 0; index < histogram.counts.length - 1; index += 1) {
    const count = histogram.counts[index] ?? 0
    backgroundWeight += count
    if (backgroundWeight === 0) continue
    const foregroundWeight = total - backgroundWeight
    if (foregroundWeight === 0) break
    backgroundSum += count * binCenter(histogram, index)
    const backgroundMean = backgroundSum / backgroundWeight
    const foregroundMean = (sum - backgroundSum) / foregroundWeight
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      best = index
    }
  }
  return histogram.binEdges[best + 1] ?? histogram.maximum
}

function triangleThreshold(histogram: ThresholdHistogram): number {
  let first = 0
  while (first < histogram.counts.length && (histogram.counts[first] ?? 0) === 0) first += 1
  let last = histogram.counts.length - 1
  while (last > first && (histogram.counts[last] ?? 0) === 0) last -= 1
  let peak = first
  for (let index = first + 1; index <= last; index += 1)
    if ((histogram.counts[index] ?? 0) > (histogram.counts[peak] ?? 0)) peak = index
  const endpoint = peak - first >= last - peak ? first : last
  if (endpoint === peak) return binCenter(histogram, peak)
  const x1 = peak
  const y1 = histogram.counts[peak] ?? 0
  const x2 = endpoint
  const y2 = histogram.counts[endpoint] ?? 0
  const denominator = Math.hypot(y2 - y1, x2 - x1)
  let best = peak
  let bestDistance = -1
  const start = Math.min(peak, endpoint)
  const end = Math.max(peak, endpoint)
  for (let index = start; index <= end; index += 1) {
    const y = histogram.counts[index] ?? 0
    const distance = Math.abs((y2 - y1) * index - (x2 - x1) * y + x2 * y1 - y2 * x1) / denominator
    if (distance > bestDistance) {
      bestDistance = distance
      best = index
    }
  }
  return binCenter(histogram, best)
}

function yenThreshold(histogram: ThresholdHistogram): number {
  const total = histogram.finiteCount
  const length = histogram.counts.length
  const probability = Float64Array.from(histogram.counts, (count) => count / total)
  const cumulative = new Float64Array(length)
  const cumulativeSquares = new Float64Array(length)
  const reverseSquares = new Float64Array(length)
  for (let index = 0; index < length; index += 1) {
    const value = probability[index] ?? 0
    cumulative[index] = (cumulative[index - 1] ?? 0) + value
    cumulativeSquares[index] = (cumulativeSquares[index - 1] ?? 0) + value * value
  }
  for (let index = length - 1; index >= 0; index -= 1) {
    const value = probability[index] ?? 0
    reverseSquares[index] = (reverseSquares[index + 1] ?? 0) + value * value
  }
  let best = 0
  let bestCriterion = Number.NEGATIVE_INFINITY
  for (let index = 0; index < length - 1; index += 1) {
    const p = cumulative[index] ?? 0
    const left = cumulativeSquares[index] ?? 0
    const right = reverseSquares[index + 1] ?? 0
    if (p <= 0 || p >= 1 || left <= 0 || right <= 0) continue
    const criterion = -Math.log(left * right) + 2 * Math.log(p * (1 - p))
    if (criterion > bestCriterion) {
      bestCriterion = criterion
      best = index
    }
  }
  return histogram.binEdges[best + 1] ?? histogram.maximum
}

function liThreshold(values: Float64Array): number {
  let minimum = Number.POSITIVE_INFINITY
  let mean = 0
  for (const value of values) {
    minimum = Math.min(minimum, value)
    mean += value
  }
  const shift = minimum <= 0 ? 1 - minimum : 0
  let threshold = mean / values.length + shift
  for (let iteration = 0; iteration < 100; iteration += 1) {
    let background = 0
    let foreground = 0
    let backgroundCount = 0
    let foregroundCount = 0
    for (const raw of values) {
      const value = raw + shift
      if (value <= threshold) {
        background += value
        backgroundCount += 1
      } else {
        foreground += value
        foregroundCount += 1
      }
    }
    if (backgroundCount === 0 || foregroundCount === 0) break
    const backgroundMean = background / backgroundCount
    const foregroundMean = foreground / foregroundCount
    if (backgroundMean <= 0 || foregroundMean <= 0 || backgroundMean === foregroundMean) break
    const next =
      (backgroundMean - foregroundMean) / (Math.log(backgroundMean) - Math.log(foregroundMean))
    if (Math.abs(next - threshold) <= 0.5) {
      threshold = next
      break
    }
    threshold = next
  }
  return threshold - shift
}

export function referenceThreshold(
  method: Exclude<ThresholdMethod, 'manual' | 'sauvola'>,
  histogram: ThresholdHistogram,
  values?: Float64Array,
): number {
  if (method === 'otsu') return otsuThreshold(histogram)
  if (method === 'triangle') return triangleThreshold(histogram)
  if (method === 'yen') return yenThreshold(histogram)
  if (method === 'li') {
    if (values === undefined || values.length === 0) throw new Error('Li threshold needs samples.')
    return liThreshold(values)
  }
  let sum = 0
  for (let index = 0; index < histogram.counts.length; index += 1)
    sum += (histogram.counts[index] ?? 0) * binCenter(histogram, index)
  return sum / histogram.finiteCount
}

function sauvolaThresholds(
  values: Float64Array,
  width: number,
  height: number,
  radius: number,
  k: number,
  dynamicRange: number,
  signal?: AbortSignal,
): Float64Array {
  if (!Number.isSafeInteger(radius) || radius < 1 || radius > 128)
    throw new Error('Sauvola radius must be between 1 and 128.')
  if (!Number.isFinite(dynamicRange) || dynamicRange <= 0)
    throw new Error('Sauvola dynamic range must be positive.')
  const stride = width + 1
  const sums = new Float64Array((width + 1) * (height + 1))
  const squares = new Float64Array(sums.length)
  const counts = new Uint32Array(sums.length)
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0
    let rowSquares = 0
    let rowCount = 0
    for (let x = 0; x < width; x += 1) {
      checkpoint(signal, y * width + x)
      const value = values[y * width + x] ?? Number.NaN
      if (Number.isFinite(value)) {
        rowSum += value
        rowSquares += value * value
        rowCount += 1
      }
      const index = (y + 1) * stride + x + 1
      sums[index] = (sums[index - stride] ?? 0) + rowSum
      squares[index] = (squares[index - stride] ?? 0) + rowSquares
      counts[index] = (counts[index - stride] ?? 0) + rowCount
    }
  }
  const output = new Float64Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius)
    const bottom = Math.min(height, y + radius + 1)
    for (let x = 0; x < width; x += 1) {
      checkpoint(signal, y * width + x)
      const left = Math.max(0, x - radius)
      const right = Math.min(width, x + radius + 1)
      const a = top * stride + left
      const b = top * stride + right
      const c = bottom * stride + left
      const d = bottom * stride + right
      const count = (counts[d] ?? 0) - (counts[b] ?? 0) - (counts[c] ?? 0) + (counts[a] ?? 0)
      if (count === 0) {
        output[y * width + x] = Number.NaN
        continue
      }
      const sum = (sums[d] ?? 0) - (sums[b] ?? 0) - (sums[c] ?? 0) + (sums[a] ?? 0)
      const square = (squares[d] ?? 0) - (squares[b] ?? 0) - (squares[c] ?? 0) + (squares[a] ?? 0)
      const mean = sum / count
      const deviation = Math.sqrt(Math.max(0, square / count - mean * mean))
      output[y * width + x] = mean * (1 + k * (deviation / dynamicRange - 1))
    }
  }
  return output
}

export function applyThreshold(
  plane: DensePlane,
  component: number,
  options: ThresholdOptions,
  selection?: Uint8Array,
): ThresholdResult & { readonly histogram: ThresholdHistogram } {
  const pixels = plane.width * plane.height
  const selectedValues = finiteSelectedValues(plane, component, selection, options.signal)
  const histogram = thresholdHistogram(
    plane,
    component,
    options.histogramBins,
    selection,
    options.signal,
  )
  const threshold =
    options.method === 'manual'
      ? (options.lower + options.upper) / 2
      : options.method === 'sauvola'
        ? Number.NaN
        : referenceThreshold(options.method, histogram, selectedValues)
  const componentValues = new Float64Array(pixels)
  for (let pixel = 0; pixel < pixels; pixel += 1)
    componentValues[pixel] = plane.values[pixel * plane.components + component] ?? Number.NaN
  const localThresholds =
    options.method === 'sauvola'
      ? sauvolaThresholds(
          componentValues,
          plane.width,
          plane.height,
          options.windowRadius,
          options.sauvolaK,
          options.dynamicRange,
          options.signal,
        )
      : undefined
  const mask = new Float32Array(pixels)
  let foregroundCount = 0
  let selectedCount = 0
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    checkpoint(options.signal, pixel)
    if (selection?.[pixel] === 0) continue
    selectedCount += 1
    const value = componentValues[pixel] ?? Number.NaN
    if (!Number.isFinite(value) || value === plane.noDataValue) {
      mask[pixel] =
        options.noDataPolicy === 'foreground'
          ? 1
          : options.noDataPolicy === 'propagate'
            ? Number.NaN
            : 0
      if (mask[pixel] === 1) foregroundCount += 1
      continue
    }
    const automatic = localThresholds?.[pixel] ?? threshold
    const foreground =
      options.method === 'manual'
        ? value >= options.lower && value <= options.upper
        : options.polarity === 'light'
          ? value >= automatic
          : value <= automatic
    const selectedForeground =
      options.method === 'manual' && options.polarity === 'dark' ? !foreground : foreground
    mask[pixel] = selectedForeground ? 1 : 0
    if (selectedForeground) foregroundCount += 1
  }
  return { mask, threshold, foregroundCount, selectedCount, histogram }
}

const neighbors = (connectivity: 4 | 8): readonly (readonly [number, number])[] =>
  connectivity === 4
    ? [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
    : [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
      ]

function localMorphology(
  input: Uint8Array,
  width: number,
  height: number,
  radius: number,
  kind: 'erode' | 'dilate',
  signal?: AbortSignal,
): Uint8Array {
  if (!Number.isSafeInteger(radius) || radius < 1 || radius > 64)
    throw new Error('Morphology radius must be between 1 and 64.')
  const output = new Uint8Array(input.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      checkpoint(signal, y * width + x)
      let value = kind === 'erode' ? 1 : 0
      outer: for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius) continue
          const sx = x + dx
          const sy = y + dy
          const sample =
            sx < 0 || sy < 0 || sx >= width || sy >= height ? 0 : input[sy * width + sx]
          if (kind === 'erode' ? sample === 0 : sample !== 0) {
            value = kind === 'erode' ? 0 : 1
            break outer
          }
        }
      }
      output[y * width + x] = value
    }
  }
  return output
}

function floodExterior(
  input: Uint8Array,
  width: number,
  height: number,
  signal?: AbortSignal,
): Uint8Array {
  const exterior = new Uint8Array(input.length)
  const queue = new Uint32Array(input.length)
  let head = 0
  let tail = 0
  const enqueue = (index: number): void => {
    if (input[index] !== 0 || exterior[index] !== 0) return
    exterior[index] = 1
    queue[tail] = index
    tail += 1
  }
  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }
  for (; head < tail; head += 1) {
    checkpoint(signal, head)
    const index = queue[head] ?? 0
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) enqueue(index - 1)
    if (x + 1 < width) enqueue(index + 1)
    if (y > 0) enqueue(index - width)
    if (y + 1 < height) enqueue(index + width)
  }
  return exterior
}

function clearBorder(
  input: Uint8Array,
  width: number,
  height: number,
  connectivity: 4 | 8,
  signal?: AbortSignal,
): Uint8Array {
  const removed = new Uint8Array(input.length)
  const queue = new Uint32Array(input.length)
  let head = 0
  let tail = 0
  const enqueue = (index: number): void => {
    if (input[index] === 0 || removed[index] !== 0) return
    removed[index] = 1
    queue[tail] = index
    tail += 1
  }
  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }
  const offsets = neighbors(connectivity)
  for (; head < tail; head += 1) {
    checkpoint(signal, head)
    const index = queue[head] ?? 0
    const x = index % width
    const y = Math.floor(index / width)
    for (const [dx, dy] of offsets) {
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) enqueue(ny * width + nx)
    }
  }
  return Uint8Array.from(input, (value, index) => (value !== 0 && removed[index] === 0 ? 1 : 0))
}

function removeSmallObjects(
  input: Uint8Array,
  width: number,
  height: number,
  minimumSize: number,
  connectivity: 4 | 8,
  signal?: AbortSignal,
): Uint8Array {
  if (!Number.isSafeInteger(minimumSize) || minimumSize < 1)
    throw new Error('Minimum object size must be a positive integer.')
  const visited = new Uint8Array(input.length)
  const queue = new Uint32Array(input.length)
  const output = new Uint8Array(input.length)
  const offsets = neighbors(connectivity)
  for (let start = 0; start < input.length; start += 1) {
    checkpoint(signal, start)
    if (input[start] === 0 || visited[start] !== 0) continue
    let head = 0
    let tail = 0
    queue[tail] = start
    tail += 1
    visited[start] = 1
    while (head < tail) {
      const index = queue[head] ?? 0
      head += 1
      const x = index % width
      const y = Math.floor(index / width)
      for (const [dx, dy] of offsets) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const next = ny * width + nx
        if (input[next] === 0 || visited[next] !== 0) continue
        visited[next] = 1
        queue[tail] = next
        tail += 1
      }
    }
    if (tail >= minimumSize)
      for (let index = 0; index < tail; index += 1) output[queue[index] ?? 0] = 1
  }
  return output
}

export function binaryMorphology(
  input: Uint8Array,
  width: number,
  height: number,
  options: Readonly<{
    kind: BinaryMorphologyKind
    radius?: number
    minimumSize?: number
    connectivity?: 4 | 8
    signal?: AbortSignal
  }>,
): Uint8Array {
  if (input.length !== width * height) throw new Error('Binary plane dimensions are invalid.')
  const connectivity = options.connectivity ?? 8
  const radius = options.radius ?? 1
  if (options.kind === 'erode' || options.kind === 'dilate')
    return localMorphology(input, width, height, radius, options.kind, options.signal)
  if (options.kind === 'open')
    return localMorphology(
      localMorphology(input, width, height, radius, 'erode', options.signal),
      width,
      height,
      radius,
      'dilate',
      options.signal,
    )
  if (options.kind === 'close')
    return localMorphology(
      localMorphology(input, width, height, radius, 'dilate', options.signal),
      width,
      height,
      radius,
      'erode',
      options.signal,
    )
  if (options.kind === 'fill-holes') {
    const exterior = floodExterior(input, width, height, options.signal)
    return Uint8Array.from(input, (value, index) => (value !== 0 || exterior[index] === 0 ? 1 : 0))
  }
  if (options.kind === 'clear-border')
    return clearBorder(input, width, height, connectivity, options.signal)
  if (options.kind === 'remove-small-objects')
    return removeSmallObjects(
      input,
      width,
      height,
      options.minimumSize ?? 1,
      connectivity,
      options.signal,
    )
  const eroded = localMorphology(input, width, height, 1, 'erode', options.signal)
  return Uint8Array.from(input, (value, index) => (value !== 0 && eroded[index] === 0 ? 1 : 0))
}

function edtOneDimension(input: Float64Array, output: Float64Array): void {
  const length = input.length
  const locations = new Int32Array(length)
  const boundaries = new Float64Array(length + 1)
  let k = 0
  locations[0] = 0
  boundaries[0] = Number.NEGATIVE_INFINITY
  boundaries[1] = Number.POSITIVE_INFINITY
  for (let q = 1; q < length; q += 1) {
    let intersection: number
    while (true) {
      const location = locations[k] ?? 0
      intersection =
        ((input[q] ?? 0) + q * q - ((input[location] ?? 0) + location * location)) /
        (2 * q - 2 * location)
      if (intersection > (boundaries[k] ?? Number.NEGATIVE_INFINITY)) break
      k -= 1
    }
    k += 1
    locations[k] = q
    boundaries[k] = intersection
    boundaries[k + 1] = Number.POSITIVE_INFINITY
  }
  k = 0
  for (let q = 0; q < length; q += 1) {
    while ((boundaries[k + 1] ?? Number.POSITIVE_INFINITY) < q) k += 1
    const location = locations[k] ?? 0
    output[q] = (q - location) ** 2 + (input[location] ?? 0)
  }
}

export function euclideanDistanceTransform(
  input: Uint8Array,
  width: number,
  height: number,
  signal?: AbortSignal,
): Float64Array {
  if (input.length !== width * height) throw new Error('Distance plane dimensions are invalid.')
  const infinity = (width + height + 1) ** 2
  const intermediate = new Float64Array(input.length)
  const maximum = Math.max(width, height)
  const source = new Float64Array(maximum)
  const destination = new Float64Array(maximum)
  for (let x = 0; x < width; x += 1) {
    signal?.throwIfAborted()
    for (let y = 0; y < height; y += 1) source[y] = input[y * width + x] === 0 ? 0 : infinity
    edtOneDimension(source.subarray(0, height), destination.subarray(0, height))
    for (let y = 0; y < height; y += 1) intermediate[y * width + x] = destination[y] ?? 0
  }
  const output = new Float64Array(input.length)
  for (let y = 0; y < height; y += 1) {
    signal?.throwIfAborted()
    source.set(intermediate.subarray(y * width, (y + 1) * width), 0)
    edtOneDimension(source.subarray(0, width), destination.subarray(0, width))
    for (let x = 0; x < width; x += 1)
      output[y * width + x] = input[y * width + x] === 0 ? 0 : Math.sqrt(destination[x] ?? 0)
  }
  return output
}

interface HeapEntry {
  readonly index: number
  readonly priority: number
  readonly label: number
}

class MaxHeap {
  readonly #indices: Uint32Array
  readonly #priorities: Float64Array
  readonly #labels: Int32Array
  #length = 0

  constructor(capacity: number) {
    this.#indices = new Uint32Array(capacity)
    this.#priorities = new Float64Array(capacity)
    this.#labels = new Int32Array(capacity)
  }

  #entry(index: number): HeapEntry {
    return {
      index: this.#indices[index] ?? 0,
      priority: this.#priorities[index] ?? 0,
      label: this.#labels[index] ?? 0,
    }
  }

  #set(index: number, value: HeapEntry): void {
    this.#indices[index] = value.index
    this.#priorities[index] = value.priority
    this.#labels[index] = value.label
  }

  push(value: HeapEntry): void {
    if (this.#length >= this.#indices.length) throw new Error('Watershed heap capacity exceeded.')
    let index = this.#length
    this.#length += 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      const parentValue = this.#entry(parent)
      if (
        parentValue.priority > value.priority ||
        (parentValue.priority === value.priority && parentValue.index < value.index)
      )
        break
      this.#set(index, parentValue)
      index = parent
    }
    this.#set(index, value)
  }

  pop(): HeapEntry | undefined {
    if (this.#length === 0) return undefined
    const first = this.#entry(0)
    this.#length -= 1
    if (this.#length === 0) return first
    const last = this.#entry(this.#length)
    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      if (left >= this.#length) break
      const leftValue = this.#entry(left)
      const rightValue = right < this.#length ? this.#entry(right) : undefined
      const child =
        rightValue !== undefined &&
        (rightValue.priority > leftValue.priority ||
          (rightValue.priority === leftValue.priority && rightValue.index < leftValue.index))
          ? right
          : left
      const childValue = this.#entry(child)
      if (
        last.priority > childValue.priority ||
        (last.priority === childValue.priority && last.index < childValue.index)
      )
        break
      this.#set(index, childValue)
      index = child
    }
    this.#set(index, last)
    return first
  }

  get size(): number {
    return this.#length
  }
}

export function watershedSeparate(
  input: Uint8Array,
  width: number,
  height: number,
  options: Readonly<{ minimumPeakDistance: number; signal?: AbortSignal }>,
): Uint8Array {
  const distances = euclideanDistanceTransform(input, width, height, options.signal)
  const offsets = neighbors(8)
  const candidates = new Uint32Array(input.length)
  let candidateCount = 0
  for (let index = 0; index < input.length; index += 1) {
    checkpoint(options.signal, index)
    if (input[index] === 0 || (distances[index] ?? 0) <= 0) continue
    const x = index % width
    const y = Math.floor(index / width)
    let maximum = true
    for (const [dx, dy] of offsets) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const neighbor = ny * width + nx
      const neighborDistance = distances[neighbor] ?? 0
      const currentDistance = distances[index] ?? 0
      if (
        neighborDistance > currentDistance ||
        (neighborDistance === currentDistance && neighbor < index)
      ) {
        maximum = false
        break
      }
    }
    if (maximum) {
      candidates[candidateCount] = index
      candidateCount += 1
    }
  }
  const rankedCandidates = candidates.subarray(0, candidateCount)
  rankedCandidates.sort(
    (left, right) => (distances[right] ?? 0) - (distances[left] ?? 0) || left - right,
  )
  const seeds = new Uint32Array(candidateCount)
  const seedMask = new Uint8Array(input.length)
  let seedCount = 0
  const minimumDistanceSquared = options.minimumPeakDistance ** 2
  for (const candidate of rankedCandidates) {
    const x = candidate % width
    const y = Math.floor(candidate / width)
    let separated = true
    const radius = options.minimumPeakDistance - 1
    for (let dy = -radius; dy <= radius && separated; dy += 1) {
      const sy = y + dy
      if (sy < 0 || sy >= height) continue
      const remaining = minimumDistanceSquared - dy * dy
      const span = Math.ceil(Math.sqrt(Math.max(0, remaining))) - 1
      for (let dx = -span; dx <= span; dx += 1) {
        const sx = x + dx
        if (sx >= 0 && sx < width && seedMask[sy * width + sx] !== 0) {
          separated = false
          break
        }
      }
    }
    if (separated) {
      seeds[seedCount] = candidate
      seedCount += 1
      seedMask[candidate] = 1
    }
  }
  if (seedCount < 2) return input.slice()
  const labels = new Int32Array(input.length)
  const heap = new MaxHeap(input.length)
  for (let ordinal = 0; ordinal < seedCount; ordinal += 1) {
    const index = seeds[ordinal] ?? 0
    const label = ordinal + 1
    labels[index] = label
    heap.push({ index, priority: distances[index] ?? 0, label })
  }
  let processed = 0
  while (heap.size > 0) {
    checkpoint(options.signal, processed)
    processed += 1
    const entry = heap.pop()
    if (entry === undefined || labels[entry.index] !== entry.label) continue
    const x = entry.index % width
    const y = Math.floor(entry.index / width)
    for (const [dx, dy] of offsets) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const neighbor = ny * width + nx
      if (input[neighbor] === 0 || labels[neighbor] === -1) continue
      if (labels[neighbor] === 0) {
        labels[neighbor] = entry.label
        heap.push({ index: neighbor, priority: distances[neighbor] ?? 0, label: entry.label })
      } else if (labels[neighbor] !== entry.label) labels[neighbor] = -1
    }
  }
  return Uint8Array.from(input, (value, index) => (value !== 0 && (labels[index] ?? 0) > 0 ? 1 : 0))
}
