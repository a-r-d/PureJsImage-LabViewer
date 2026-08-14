export interface DensePlane {
  readonly width: number
  readonly height: number
  readonly components: number
  readonly values: Float64Array
  readonly noDataValue?: number
}

export type BoundaryPolicy = 'clamp' | 'mirror' | 'constant'
export type InvalidPolicy = 'propagate' | 'ignore'

export interface KernelOptions {
  readonly boundary: BoundaryPolicy
  readonly constantValue: number
  readonly invalidPolicy: InvalidPolicy
  readonly signal?: AbortSignal
}

function assertPlane(plane: DensePlane): void {
  if (
    !Number.isSafeInteger(plane.width) ||
    plane.width < 1 ||
    !Number.isSafeInteger(plane.height) ||
    plane.height < 1 ||
    !Number.isSafeInteger(plane.components) ||
    plane.components < 1 ||
    plane.values.length !== plane.width * plane.height * plane.components
  )
    throw new Error('Dense plane shape is invalid.')
}

function invalid(value: number, noDataValue: number | undefined): boolean {
  return !Number.isFinite(value) || (noDataValue !== undefined && value === noDataValue)
}

function mappedCoordinate(
  value: number,
  length: number,
  boundary: BoundaryPolicy,
): number | undefined {
  if (value >= 0 && value < length) return value
  if (boundary === 'constant') return undefined
  if (boundary === 'clamp') return Math.max(0, Math.min(length - 1, value))
  let mirrored = value
  while (mirrored < 0 || mirrored >= length)
    mirrored = mirrored < 0 ? -mirrored - 1 : 2 * length - mirrored - 1
  return mirrored
}

function sample(
  plane: DensePlane,
  x: number,
  y: number,
  component: number,
  boundary: BoundaryPolicy,
  constantValue: number,
): number {
  const mappedX = mappedCoordinate(x, plane.width, boundary)
  const mappedY = mappedCoordinate(y, plane.height, boundary)
  if (mappedX === undefined || mappedY === undefined) return constantValue
  return (
    plane.values[(mappedY * plane.width + mappedX) * plane.components + component] ?? Number.NaN
  )
}

export function mapPlane(
  plane: DensePlane,
  transform: (value: number, component: number) => number,
  signal?: AbortSignal,
): DensePlane {
  assertPlane(plane)
  const values = new Float64Array(plane.values.length)
  for (let index = 0; index < values.length; index += 1) {
    if (index % 16_384 === 0) signal?.throwIfAborted()
    const value = plane.values[index] ?? Number.NaN
    values[index] = invalid(value, plane.noDataValue)
      ? Number.NaN
      : transform(value, index % plane.components)
  }
  return { ...plane, values, noDataValue: Number.NaN }
}

export function convolvePlane(
  plane: DensePlane,
  kernel: readonly number[],
  kernelWidth: number,
  options: KernelOptions,
): DensePlane {
  assertPlane(plane)
  if (
    !Number.isSafeInteger(kernelWidth) ||
    kernelWidth < 1 ||
    kernelWidth > 129 ||
    kernelWidth % 2 === 0 ||
    kernel.length !== kernelWidth * kernelWidth ||
    kernel.some((value) => !Number.isFinite(value))
  )
    throw new Error('Convolution kernel must be a finite odd matrix no larger than 129 by 129.')
  const radius = Math.floor(kernelWidth / 2)
  const values = new Float64Array(plane.values.length)
  for (let y = 0; y < plane.height; y += 1) {
    options.signal?.throwIfAborted()
    for (let x = 0; x < plane.width; x += 1) {
      for (let component = 0; component < plane.components; component += 1) {
        let total = 0
        let weight = 0
        let invalidOutput = false
        for (let ky = -radius; ky <= radius; ky += 1) {
          for (let kx = -radius; kx <= radius; kx += 1) {
            const coefficient = kernel[(ky + radius) * kernelWidth + kx + radius] ?? 0
            const value = sample(
              plane,
              x + kx,
              y + ky,
              component,
              options.boundary,
              options.constantValue,
            )
            if (invalid(value, plane.noDataValue)) {
              if (options.invalidPolicy === 'propagate') invalidOutput = true
              continue
            }
            total += value * coefficient
            weight += coefficient
          }
        }
        const index = (y * plane.width + x) * plane.components + component
        values[index] =
          invalidOutput || (options.invalidPolicy === 'ignore' && weight === 0)
            ? Number.NaN
            : options.invalidPolicy === 'ignore'
              ? total / weight
              : total
      }
    }
  }
  return { ...plane, values, noDataValue: Number.NaN }
}

export function rankFilterPlane(
  plane: DensePlane,
  radius: number,
  mode: 'median' | 'minimum' | 'maximum',
  options: KernelOptions,
): DensePlane {
  assertPlane(plane)
  if (!Number.isSafeInteger(radius) || radius < 1 || radius > 16)
    throw new Error('Rank-filter radius must be an integer from 1 to 16.')
  const values = new Float64Array(plane.values.length)
  const neighborhood: number[] = []
  for (let y = 0; y < plane.height; y += 1) {
    options.signal?.throwIfAborted()
    for (let x = 0; x < plane.width; x += 1) {
      for (let component = 0; component < plane.components; component += 1) {
        neighborhood.length = 0
        let invalidOutput = false
        for (let ky = -radius; ky <= radius; ky += 1) {
          for (let kx = -radius; kx <= radius; kx += 1) {
            const value = sample(
              plane,
              x + kx,
              y + ky,
              component,
              options.boundary,
              options.constantValue,
            )
            if (invalid(value, plane.noDataValue)) {
              if (options.invalidPolicy === 'propagate') invalidOutput = true
            } else neighborhood.push(value)
          }
        }
        neighborhood.sort((left, right) => left - right)
        const outputIndex = (y * plane.width + x) * plane.components + component
        values[outputIndex] =
          invalidOutput || neighborhood.length === 0
            ? Number.NaN
            : mode === 'minimum'
              ? (neighborhood[0] ?? Number.NaN)
              : mode === 'maximum'
                ? (neighborhood.at(-1) ?? Number.NaN)
                : neighborhood.length % 2 === 1
                  ? (neighborhood[Math.floor(neighborhood.length / 2)] ?? Number.NaN)
                  : ((neighborhood[neighborhood.length / 2 - 1] ?? 0) +
                      (neighborhood[neighborhood.length / 2] ?? 0)) /
                    2
      }
    }
  }
  return { ...plane, values, noDataValue: Number.NaN }
}

export function boxFilterPlane(
  plane: DensePlane,
  radius: number,
  options: KernelOptions,
): DensePlane {
  if (!Number.isSafeInteger(radius) || radius < 1 || radius > 64)
    throw new Error('Box-filter radius must be an integer from 1 to 64.')
  const width = radius * 2 + 1
  const coefficient = 1 / (width * width)
  return convolvePlane(
    plane,
    Array.from({ length: width * width }, () => coefficient),
    width,
    options,
  )
}

export function gaussianKernel(sigma: number): readonly number[] {
  if (!Number.isFinite(sigma) || sigma <= 0 || sigma > 16)
    throw new Error('Gaussian sigma must be greater than zero and at most 16.')
  const radius = Math.min(16, Math.ceil(sigma * 3))
  const width = radius * 2 + 1
  const kernel = Array.from({ length: width * width }, (_value, index) => {
    const x = (index % width) - radius
    const y = Math.floor(index / width) - radius
    return Math.exp(-(x * x + y * y) / (2 * sigma * sigma))
  })
  const total = kernel.reduce((sum, value) => sum + value, 0)
  return kernel.map((value) => value / total)
}

export function unsharpPlane(
  plane: DensePlane,
  sigma: number,
  amount: number,
  invalidPolicy: InvalidPolicy,
  signal?: AbortSignal,
): DensePlane {
  if (!Number.isFinite(amount) || amount < 0 || amount > 8)
    throw new Error('Unsharp amount must be finite from 0 to 8.')
  const kernel = gaussianKernel(sigma)
  const width = Math.round(Math.sqrt(kernel.length))
  const blurred = convolvePlane(plane, kernel, width, {
    boundary: 'mirror',
    constantValue: 0,
    invalidPolicy,
    ...(signal === undefined ? {} : { signal }),
  })
  const values = new Float64Array(plane.values.length)
  for (let index = 0; index < values.length; index += 1) {
    if (index % 16_384 === 0) signal?.throwIfAborted()
    const original = plane.values[index] ?? Number.NaN
    const background = blurred.values[index] ?? Number.NaN
    values[index] =
      invalid(original, plane.noDataValue) || !Number.isFinite(background)
        ? Number.NaN
        : original + amount * (original - background)
  }
  return { ...plane, values, noDataValue: Number.NaN }
}

export function gradientPlane(
  plane: DensePlane,
  operator: 'sobel' | 'scharr',
  output: 'x' | 'y' | 'magnitude',
  signal?: AbortSignal,
): DensePlane {
  const factor = operator === 'sobel' ? 1 : 3
  const center = operator === 'sobel' ? 2 : 10
  const xKernel = [-factor, 0, factor, -center, 0, center, -factor, 0, factor]
  const yKernel = [-factor, -center, -factor, 0, 0, 0, factor, center, factor]
  const options: KernelOptions = {
    boundary: 'mirror',
    constantValue: 0,
    invalidPolicy: 'propagate',
    ...(signal === undefined ? {} : { signal }),
  }
  const gx = convolvePlane(plane, xKernel, 3, options)
  if (output === 'x') return gx
  const gy = convolvePlane(plane, yKernel, 3, options)
  if (output === 'y') return gy
  const values = new Float64Array(plane.values.length)
  for (let index = 0; index < values.length; index += 1) {
    if (index % 16_384 === 0) signal?.throwIfAborted()
    values[index] = Math.hypot(gx.values[index] ?? Number.NaN, gy.values[index] ?? Number.NaN)
  }
  return { ...plane, values, noDataValue: Number.NaN }
}

export function outlierPlane(
  plane: DensePlane,
  radius: number,
  threshold: number,
  signal?: AbortSignal,
): DensePlane {
  if (!Number.isFinite(threshold) || threshold < 0)
    throw new Error('Outlier threshold must be finite and non-negative.')
  const median = rankFilterPlane(plane, radius, 'median', {
    boundary: 'mirror',
    constantValue: 0,
    invalidPolicy: 'ignore',
    ...(signal === undefined ? {} : { signal }),
  })
  const values = Float64Array.from(plane.values)
  for (let index = 0; index < values.length; index += 1) {
    if (index % 16_384 === 0) signal?.throwIfAborted()
    const value = values[index] ?? Number.NaN
    const replacement = median.values[index] ?? Number.NaN
    if (
      Number.isFinite(value) &&
      Number.isFinite(replacement) &&
      Math.abs(value - replacement) > threshold
    )
      values[index] = replacement
  }
  return { ...plane, values, noDataValue: Number.NaN }
}

export function rotateRightAngle(
  plane: DensePlane,
  degrees: 90 | 180 | 270,
  signal?: AbortSignal,
): DensePlane {
  assertPlane(plane)
  const width = degrees === 180 ? plane.width : plane.height
  const height = degrees === 180 ? plane.height : plane.width
  const values = new Float64Array(width * height * plane.components)
  for (let y = 0; y < height; y += 1) {
    signal?.throwIfAborted()
    for (let x = 0; x < width; x += 1) {
      const source =
        degrees === 90
          ? { x: y, y: plane.height - 1 - x }
          : degrees === 180
            ? { x: plane.width - 1 - x, y: plane.height - 1 - y }
            : { x: plane.width - 1 - y, y: x }
      for (let component = 0; component < plane.components; component += 1)
        values[(y * width + x) * plane.components + component] =
          plane.values[(source.y * plane.width + source.x) * plane.components + component] ??
          Number.NaN
    }
  }
  return { ...plane, width, height, values }
}

export function flipPlane(
  plane: DensePlane,
  direction: 'horizontal' | 'vertical',
  signal?: AbortSignal,
): DensePlane {
  assertPlane(plane)
  const values = new Float64Array(plane.values.length)
  for (let y = 0; y < plane.height; y += 1) {
    signal?.throwIfAborted()
    for (let x = 0; x < plane.width; x += 1) {
      const sourceX = direction === 'horizontal' ? plane.width - 1 - x : x
      const sourceY = direction === 'vertical' ? plane.height - 1 - y : y
      for (let component = 0; component < plane.components; component += 1)
        values[(y * plane.width + x) * plane.components + component] =
          plane.values[(sourceY * plane.width + sourceX) * plane.components + component] ??
          Number.NaN
    }
  }
  return { ...plane, values }
}

export function translatePlane(
  plane: DensePlane,
  offsetX: number,
  offsetY: number,
  constantValue: number,
  signal?: AbortSignal,
): DensePlane {
  assertPlane(plane)
  if (
    !Number.isSafeInteger(offsetX) ||
    !Number.isSafeInteger(offsetY) ||
    !Number.isFinite(constantValue)
  )
    throw new Error('Translation offsets must be integers and fill must be finite.')
  const values = new Float64Array(plane.values.length)
  values.fill(constantValue)
  for (let y = 0; y < plane.height; y += 1) {
    signal?.throwIfAborted()
    for (let x = 0; x < plane.width; x += 1) {
      const sourceX = x - offsetX
      const sourceY = y - offsetY
      if (sourceX < 0 || sourceY < 0 || sourceX >= plane.width || sourceY >= plane.height) continue
      for (let component = 0; component < plane.components; component += 1)
        values[(y * plane.width + x) * plane.components + component] =
          plane.values[(sourceY * plane.width + sourceX) * plane.components + component] ??
          Number.NaN
    }
  }
  return { ...plane, values }
}

export function calculatePlanes(
  left: DensePlane,
  right: DensePlane,
  operator: 'add' | 'subtract' | 'multiply' | 'divide',
  signal?: AbortSignal,
): DensePlane {
  assertPlane(left)
  assertPlane(right)
  if (
    left.width !== right.width ||
    left.height !== right.height ||
    left.components !== right.components
  )
    throw new Error('Image calculator inputs must have identical shapes.')
  const values = new Float64Array(left.values.length)
  for (let index = 0; index < values.length; index += 1) {
    if (index % 16_384 === 0) signal?.throwIfAborted()
    const a = left.values[index] ?? Number.NaN
    const b = right.values[index] ?? Number.NaN
    values[index] =
      invalid(a, left.noDataValue) ||
      invalid(b, right.noDataValue) ||
      (operator === 'divide' && b === 0)
        ? Number.NaN
        : operator === 'add'
          ? a + b
          : operator === 'subtract'
            ? a - b
            : operator === 'multiply'
              ? a * b
              : a / b
  }
  return { ...left, values, noDataValue: Number.NaN }
}
