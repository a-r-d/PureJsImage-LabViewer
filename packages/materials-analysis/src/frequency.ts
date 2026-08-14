export interface ComplexPlane {
  readonly width: number
  readonly height: number
  readonly real: Float64Array
  readonly imaginary: Float64Array
}

export interface FrequencyCalibration {
  readonly xSpacing: number
  readonly ySpacing: number
  readonly spatialUnit: string
}

export interface FrequencyProfile {
  readonly axis: Float64Array
  readonly values: Float64Array
  readonly counts: Uint32Array
  readonly axisUnit: string
}

export interface FrequencyPeak {
  readonly x: number
  readonly y: number
  readonly magnitude: number
  readonly frequencyX: number
  readonly frequencyY: number
  readonly radialFrequency: number
  readonly dSpacing?: number
}

export interface SpectrumOptions {
  readonly mode: 'magnitude' | 'power'
  readonly centered?: boolean
  readonly displayMapping?: 'raw' | 'log1p'
}

function checkpoint(signal: AbortSignal | undefined, index: number): void {
  if ((index & 255) === 0) signal?.throwIfAborted()
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0
}

export function isEfficientFftLength(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && (isPowerOfTwo(value) || value <= 512)
}

function reverseBits(value: number, bits: number): number {
  let output = 0
  for (let index = 0; index < bits; index += 1) {
    output = (output << 1) | (value & 1)
    value >>>= 1
  }
  return output
}

function radix2(
  real: Float64Array,
  imaginary: Float64Array,
  inverse: boolean,
  signal?: AbortSignal,
): void {
  const length = real.length
  const bits = Math.round(Math.log2(length))
  for (let index = 0; index < length; index += 1) {
    checkpoint(signal, index)
    const reversed = reverseBits(index, bits)
    if (reversed <= index) continue
    const realValue = real[index] ?? 0
    const imaginaryValue = imaginary[index] ?? 0
    real[index] = real[reversed] ?? 0
    imaginary[index] = imaginary[reversed] ?? 0
    real[reversed] = realValue
    imaginary[reversed] = imaginaryValue
  }
  for (let size = 2; size <= length; size *= 2) {
    const half = size / 2
    const direction = inverse ? 1 : -1
    for (let offset = 0; offset < length; offset += size) {
      for (let index = 0; index < half; index += 1) {
        checkpoint(signal, offset + index)
        const angle = (direction * 2 * Math.PI * index) / size
        const cosine = Math.cos(angle)
        const sine = Math.sin(angle)
        const even = offset + index
        const odd = even + half
        const oddReal = real[odd] ?? 0
        const oddImaginary = imaginary[odd] ?? 0
        const rotatedReal = oddReal * cosine - oddImaginary * sine
        const rotatedImaginary = oddReal * sine + oddImaginary * cosine
        const evenReal = real[even] ?? 0
        const evenImaginary = imaginary[even] ?? 0
        real[even] = evenReal + rotatedReal
        imaginary[even] = evenImaginary + rotatedImaginary
        real[odd] = evenReal - rotatedReal
        imaginary[odd] = evenImaginary - rotatedImaginary
      }
    }
  }
  if (inverse) {
    for (let index = 0; index < length; index += 1) {
      real[index] = (real[index] ?? 0) / length
      imaginary[index] = (imaginary[index] ?? 0) / length
    }
  }
}

function directDft(
  real: Float64Array,
  imaginary: Float64Array,
  inverse: boolean,
  signal?: AbortSignal,
): void {
  const length = real.length
  const outputReal = new Float64Array(length)
  const outputImaginary = new Float64Array(length)
  const direction = inverse ? 1 : -1
  for (let frequency = 0; frequency < length; frequency += 1) {
    checkpoint(signal, frequency)
    let sumReal = 0
    let sumImaginary = 0
    for (let sample = 0; sample < length; sample += 1) {
      const angle = (direction * 2 * Math.PI * frequency * sample) / length
      const cosine = Math.cos(angle)
      const sine = Math.sin(angle)
      const sampleReal = real[sample] ?? 0
      const sampleImaginary = imaginary[sample] ?? 0
      sumReal += sampleReal * cosine - sampleImaginary * sine
      sumImaginary += sampleReal * sine + sampleImaginary * cosine
    }
    outputReal[frequency] = inverse ? sumReal / length : sumReal
    outputImaginary[frequency] = inverse ? sumImaginary / length : sumImaginary
  }
  real.set(outputReal)
  imaginary.set(outputImaginary)
}

function transform1d(
  real: Float64Array,
  imaginary: Float64Array,
  inverse: boolean,
  signal?: AbortSignal,
): void {
  if (real.length !== imaginary.length || real.length < 1)
    throw new Error('FFT vectors must be non-empty and have equal lengths.')
  if (!isEfficientFftLength(real.length))
    throw new Error(
      'Non-power-of-two FFT axes are limited to 512 samples; select a smaller ROI or a power-of-two size.',
    )
  if (isPowerOfTwo(real.length)) radix2(real, imaginary, inverse, signal)
  else directDft(real, imaginary, inverse, signal)
}

function transform2d(plane: ComplexPlane, inverse: boolean, signal?: AbortSignal): ComplexPlane {
  const { width, height } = plane
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    plane.real.length !== width * height ||
    plane.imaginary.length !== width * height
  )
    throw new Error('FFT plane dimensions are invalid.')
  const real = plane.real.slice()
  const imaginary = plane.imaginary.slice()
  for (let y = 0; y < height; y += 1) {
    signal?.throwIfAborted()
    const rowReal = real.slice(y * width, (y + 1) * width)
    const rowImaginary = imaginary.slice(y * width, (y + 1) * width)
    transform1d(rowReal, rowImaginary, inverse, signal)
    real.set(rowReal, y * width)
    imaginary.set(rowImaginary, y * width)
  }
  const columnReal = new Float64Array(height)
  const columnImaginary = new Float64Array(height)
  for (let x = 0; x < width; x += 1) {
    signal?.throwIfAborted()
    for (let y = 0; y < height; y += 1) {
      columnReal[y] = real[y * width + x] ?? 0
      columnImaginary[y] = imaginary[y * width + x] ?? 0
    }
    transform1d(columnReal, columnImaginary, inverse, signal)
    for (let y = 0; y < height; y += 1) {
      real[y * width + x] = columnReal[y] ?? 0
      imaginary[y * width + x] = columnImaginary[y] ?? 0
    }
  }
  return { width, height, real, imaginary }
}

export function fft2d(
  values: ArrayLike<number>,
  width: number,
  height: number,
  signal?: AbortSignal,
): ComplexPlane {
  if (values.length !== width * height) throw new Error('FFT input length is invalid.')
  const real = Float64Array.from(values, (value) => (Number.isFinite(value) ? value : 0))
  return transform2d(
    { width, height, real, imaginary: new Float64Array(width * height) },
    false,
    signal,
  )
}

export function inverseFft2d(plane: ComplexPlane, signal?: AbortSignal): ComplexPlane {
  return transform2d(plane, true, signal)
}

function centeredSourceIndex(x: number, y: number, width: number, height: number): number {
  return ((y + Math.ceil(height / 2)) % height) * width + ((x + Math.ceil(width / 2)) % width)
}

export function frequencySpectrum(
  plane: ComplexPlane,
  options: SpectrumOptions,
  signal?: AbortSignal,
): Float64Array {
  const output = new Float64Array(plane.width * plane.height)
  for (let y = 0; y < plane.height; y += 1) {
    for (let x = 0; x < plane.width; x += 1) {
      const index =
        options.centered === false
          ? y * plane.width + x
          : centeredSourceIndex(x, y, plane.width, plane.height)
      checkpoint(signal, y * plane.width + x)
      const real = plane.real[index] ?? 0
      const imaginary = plane.imaginary[index] ?? 0
      const power = real * real + imaginary * imaginary
      const raw = options.mode === 'power' ? power : Math.sqrt(power)
      output[y * plane.width + x] =
        options.displayMapping === 'log1p' ? Math.log1p(Math.max(0, raw)) : raw
    }
  }
  return output
}

export function frequencyMask(
  width: number,
  height: number,
  options: Readonly<{
    kind: 'none' | 'bandpass' | 'notch'
    minimumRadius: number
    maximumRadius: number
    notchX: number
    notchY: number
    notchRadius: number
  }>,
): Uint8Array {
  const output = new Uint8Array(width * height)
  const centerX = Math.floor(width / 2)
  const centerY = Math.floor(height / 2)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const fx = (x - centerX) / width
      const fy = (y - centerY) / height
      const radius = Math.hypot(fx, fy)
      const notchDistance = Math.min(
        Math.hypot(fx - options.notchX, fy - options.notchY),
        Math.hypot(fx + options.notchX, fy + options.notchY),
      )
      output[y * width + x] =
        options.kind === 'none'
          ? 1
          : options.kind === 'bandpass'
            ? Number(radius >= options.minimumRadius && radius <= options.maximumRadius)
            : Number(notchDistance > options.notchRadius)
    }
  }
  return output
}

function frequencySteps(
  width: number,
  height: number,
  calibration?: FrequencyCalibration,
): Readonly<{ x: number; y: number; unit: string }> {
  return calibration === undefined
    ? { x: 1 / width, y: 1 / height, unit: 'cycles/pixel' }
    : {
        x: 1 / (width * calibration.xSpacing),
        y: 1 / (height * calibration.ySpacing),
        unit: `1/${calibration.spatialUnit}`,
      }
}

export function radialFrequencyProfile(
  values: ArrayLike<number>,
  width: number,
  height: number,
  bins: number,
  calibration?: FrequencyCalibration,
  signal?: AbortSignal,
): FrequencyProfile {
  if (!Number.isSafeInteger(bins) || bins < 2 || bins > 4_096)
    throw new Error('Radial profile bin count must be between 2 and 4096.')
  const steps = frequencySteps(width, height, calibration)
  const centerX = Math.floor(width / 2)
  const centerY = Math.floor(height / 2)
  const maximumRadius = Math.hypot(centerX * steps.x, centerY * steps.y)
  const sums = new Float64Array(bins)
  const counts = new Uint32Array(bins)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      checkpoint(signal, index)
      const value = Number(values[index])
      if (!Number.isFinite(value)) continue
      const radius = Math.hypot((x - centerX) * steps.x, (y - centerY) * steps.y)
      const bin = Math.min(bins - 1, Math.floor((radius / maximumRadius) * bins))
      sums[bin] = (sums[bin] ?? 0) + value
      counts[bin] = (counts[bin] ?? 0) + 1
    }
  }
  const axis = new Float64Array(bins)
  const profile = new Float64Array(bins)
  for (let bin = 0; bin < bins; bin += 1) {
    axis[bin] = ((bin + 0.5) / bins) * maximumRadius
    profile[bin] = (counts[bin] ?? 0) === 0 ? Number.NaN : (sums[bin] ?? 0) / (counts[bin] ?? 1)
  }
  return { axis, values: profile, counts, axisUnit: steps.unit }
}

export function azimuthalFrequencyProfile(
  values: ArrayLike<number>,
  width: number,
  height: number,
  bins: number,
  minimumRadius: number,
  maximumRadius: number,
  calibration?: FrequencyCalibration,
  signal?: AbortSignal,
): FrequencyProfile {
  if (!Number.isSafeInteger(bins) || bins < 8 || bins > 1_440)
    throw new Error('Azimuthal profile bin count must be between 8 and 1440.')
  const steps = frequencySteps(width, height, calibration)
  const centerX = Math.floor(width / 2)
  const centerY = Math.floor(height / 2)
  const sums = new Float64Array(bins)
  const counts = new Uint32Array(bins)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      checkpoint(signal, index)
      const dx = (x - centerX) * steps.x
      const dy = (y - centerY) * steps.y
      const radius = Math.hypot(dx, dy)
      const value = Number(values[index])
      if (!Number.isFinite(value) || radius < minimumRadius || radius > maximumRadius) continue
      const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2)
      const bin = Math.min(bins - 1, Math.floor((angle / (Math.PI * 2)) * bins))
      sums[bin] = (sums[bin] ?? 0) + value
      counts[bin] = (counts[bin] ?? 0) + 1
    }
  }
  const axis = new Float64Array(bins)
  const profile = new Float64Array(bins)
  for (let bin = 0; bin < bins; bin += 1) {
    axis[bin] = ((bin + 0.5) / bins) * 360
    profile[bin] = (counts[bin] ?? 0) === 0 ? Number.NaN : (sums[bin] ?? 0) / (counts[bin] ?? 1)
  }
  return { axis, values: profile, counts, axisUnit: 'degrees' }
}

export function detectFrequencyPeaks(
  values: ArrayLike<number>,
  width: number,
  height: number,
  options: Readonly<{
    threshold: number
    minimumDistance: number
    maximumPeaks: number
    calibration?: FrequencyCalibration
  }>,
  signal?: AbortSignal,
): readonly FrequencyPeak[] {
  const steps = frequencySteps(width, height, options.calibration)
  const centerX = Math.floor(width / 2)
  const centerY = Math.floor(height / 2)
  const candidates: FrequencyPeak[] = []
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      checkpoint(signal, index)
      const magnitude = Number(values[index])
      if (!Number.isFinite(magnitude) || magnitude < options.threshold) continue
      let maximum = true
      for (let dy = -1; dy <= 1 && maximum; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1)
          if ((dx !== 0 || dy !== 0) && Number(values[(y + dy) * width + x + dx]) > magnitude)
            maximum = false
      if (!maximum) continue
      const frequencyX = (x - centerX) * steps.x
      const frequencyY = (y - centerY) * steps.y
      const radialFrequency = Math.hypot(frequencyX, frequencyY)
      candidates.push({
        x,
        y,
        magnitude,
        frequencyX,
        frequencyY,
        radialFrequency,
        ...(options.calibration === undefined || radialFrequency <= 0
          ? {}
          : { dSpacing: 1 / radialFrequency }),
      })
    }
  }
  candidates.sort(
    (left, right) => right.magnitude - left.magnitude || left.y - right.y || left.x - right.x,
  )
  const accepted: FrequencyPeak[] = []
  for (const candidate of candidates) {
    if (
      accepted.every(
        (peak) => Math.hypot(peak.x - candidate.x, peak.y - candidate.y) >= options.minimumDistance,
      )
    )
      accepted.push(candidate)
    if (accepted.length >= options.maximumPeaks) break
  }
  return accepted
}

export interface PhaseCorrelationResult {
  readonly offsetX: number
  readonly offsetY: number
  readonly peak: number
  readonly peakRatio: number
  readonly accepted: boolean
}

export function phaseCorrelation(
  reference: ArrayLike<number>,
  moving: ArrayLike<number>,
  width: number,
  height: number,
  options: Readonly<{ maximumShift: number; minimumPeakRatio: number }>,
  signal?: AbortSignal,
): PhaseCorrelationResult {
  if (reference.length !== width * height || moving.length !== width * height)
    throw new Error('Registration planes must have equal dimensions.')
  const referenceFft = fft2d(reference, width, height, signal)
  const movingFft = fft2d(moving, width, height, signal)
  const real = new Float64Array(width * height)
  const imaginary = new Float64Array(width * height)
  for (let index = 0; index < real.length; index += 1) {
    checkpoint(signal, index)
    const ar = referenceFft.real[index] ?? 0
    const ai = referenceFft.imaginary[index] ?? 0
    const br = movingFft.real[index] ?? 0
    const bi = movingFft.imaginary[index] ?? 0
    const productReal = ar * br + ai * bi
    const productImaginary = ai * br - ar * bi
    const magnitude = Math.hypot(productReal, productImaginary)
    real[index] = magnitude <= Number.EPSILON ? 0 : productReal / magnitude
    imaginary[index] = magnitude <= Number.EPSILON ? 0 : productImaginary / magnitude
  }
  const correlation = inverseFft2d({ width, height, real, imaginary }, signal).real
  let peakIndex = 0
  let peak = Number.NEGATIVE_INFINITY
  let second = Number.NEGATIVE_INFINITY
  for (let index = 0; index < correlation.length; index += 1) {
    const value = correlation[index] ?? Number.NEGATIVE_INFINITY
    if (value > peak) {
      second = peak
      peak = value
      peakIndex = index
    } else if (value > second) second = value
  }
  const rawX = peakIndex % width
  const rawY = Math.floor(peakIndex / width)
  const offsetX = rawX > width / 2 ? rawX - width : rawX
  const offsetY = rawY > height / 2 ? rawY - height : rawY
  const peakRatio = peak / Math.max(Number.EPSILON, second)
  return {
    offsetX,
    offsetY,
    peak,
    peakRatio,
    accepted:
      Math.abs(offsetX) <= options.maximumShift &&
      Math.abs(offsetY) <= options.maximumShift &&
      peakRatio >= options.minimumPeakRatio,
  }
}
