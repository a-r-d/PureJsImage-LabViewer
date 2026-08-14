import { type PhaseCorrelationResult, phaseCorrelation } from './frequency.js'

export type StackProjectionMode = 'min' | 'max' | 'mean' | 'sum'
export type RegistrationEdgePolicy = 'pad' | 'crop-overlap'

export interface StackPlaneStatistics {
  readonly index: number
  readonly count: number
  readonly minimum: number
  readonly maximum: number
  readonly mean: number
  readonly standardDeviation: number
}

export interface StackRegistrationFrame extends PhaseCorrelationResult {
  readonly index: number
}

export interface StackAlignmentResult {
  readonly values: Float64Array
  readonly width: number
  readonly height: number
  readonly frames: number
  readonly registrations: readonly StackRegistrationFrame[]
  readonly crop: Readonly<{ x: number; y: number; width: number; height: number }>
}

function assertStack(
  values: ArrayLike<number>,
  width: number,
  height: number,
  frames: number,
): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(frames) ||
    width < 1 ||
    height < 1 ||
    frames < 1 ||
    values.length !== width * height * frames
  )
    throw new Error('Stack dimensions are invalid.')
}

function checkpoint(signal: AbortSignal | undefined, index: number): void {
  if ((index & 1_023) === 0) signal?.throwIfAborted()
}

export function projectStack(
  values: ArrayLike<number>,
  width: number,
  height: number,
  frames: number,
  mode: StackProjectionMode,
  signal?: AbortSignal,
): Float64Array {
  assertStack(values, width, height, frames)
  const pixels = width * height
  const output = new Float64Array(pixels)
  if (mode === 'min') output.fill(Number.POSITIVE_INFINITY)
  if (mode === 'max') output.fill(Number.NEGATIVE_INFINITY)
  const counts = new Uint32Array(pixels)
  for (let frame = 0; frame < frames; frame += 1) {
    signal?.throwIfAborted()
    for (let index = 0; index < pixels; index += 1) {
      checkpoint(signal, index)
      const value = Number(values[frame * pixels + index])
      if (!Number.isFinite(value)) continue
      counts[index] = (counts[index] ?? 0) + 1
      if (mode === 'min') output[index] = Math.min(output[index] ?? value, value)
      else if (mode === 'max') output[index] = Math.max(output[index] ?? value, value)
      else output[index] = (output[index] ?? 0) + value
    }
  }
  for (let index = 0; index < pixels; index += 1) {
    const count = counts[index] ?? 0
    if (count === 0) output[index] = Number.NaN
    else if (mode === 'mean') output[index] = (output[index] ?? 0) / count
  }
  return output
}

export function stackStatistics(
  values: ArrayLike<number>,
  width: number,
  height: number,
  frames: number,
  signal?: AbortSignal,
): readonly StackPlaneStatistics[] {
  assertStack(values, width, height, frames)
  const pixels = width * height
  const output: StackPlaneStatistics[] = []
  for (let frame = 0; frame < frames; frame += 1) {
    signal?.throwIfAborted()
    let count = 0
    let sum = 0
    let sumSquare = 0
    let minimum = Number.POSITIVE_INFINITY
    let maximum = Number.NEGATIVE_INFINITY
    for (let index = 0; index < pixels; index += 1) {
      checkpoint(signal, index)
      const value = Number(values[frame * pixels + index])
      if (!Number.isFinite(value)) continue
      count += 1
      sum += value
      sumSquare += value * value
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
    }
    const mean = count === 0 ? Number.NaN : sum / count
    output.push({
      index: frame,
      count,
      minimum: count === 0 ? Number.NaN : minimum,
      maximum: count === 0 ? Number.NaN : maximum,
      mean,
      standardDeviation:
        count === 0 ? Number.NaN : Math.sqrt(Math.max(0, sumSquare / count - mean * mean)),
    })
  }
  return output
}

export function montageStack(
  values: ArrayLike<number>,
  width: number,
  height: number,
  frames: number,
  columns: number,
  signal?: AbortSignal,
): Readonly<{
  values: Float64Array
  width: number
  height: number
  columns: number
  rows: number
}> {
  assertStack(values, width, height, frames)
  if (!Number.isSafeInteger(columns) || columns < 1 || columns > frames)
    throw new Error('Montage column count is invalid.')
  const rows = Math.ceil(frames / columns)
  const outputWidth = width * columns
  const outputHeight = height * rows
  const output = new Float64Array(outputWidth * outputHeight)
  output.fill(Number.NaN)
  for (let frame = 0; frame < frames; frame += 1) {
    signal?.throwIfAborted()
    const column = frame % columns
    const row = Math.floor(frame / columns)
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1)
        output[(row * height + y) * outputWidth + column * width + x] = Number(
          values[frame * width * height + y * width + x],
        )
  }
  return { values: output, width: outputWidth, height: outputHeight, columns, rows }
}

function overlapCrop(
  width: number,
  height: number,
  registrations: readonly StackRegistrationFrame[],
): Readonly<{ x: number; y: number; width: number; height: number }> {
  let left = 0
  let top = 0
  let right = width
  let bottom = height
  for (const registration of registrations) {
    left = Math.max(left, registration.offsetX)
    top = Math.max(top, registration.offsetY)
    right = Math.min(right, width + registration.offsetX)
    bottom = Math.min(bottom, height + registration.offsetY)
  }
  const cropWidth = Math.max(0, right - left)
  const cropHeight = Math.max(0, bottom - top)
  if (cropWidth < 1 || cropHeight < 1)
    throw new Error('Registration shifts leave no common crop overlap.')
  return { x: left, y: top, width: cropWidth, height: cropHeight }
}

export function alignStack(
  values: ArrayLike<number>,
  width: number,
  height: number,
  frames: number,
  options: Readonly<{
    referenceIndex: number
    maximumShift: number
    minimumPeakRatio: number
    edgePolicy: RegistrationEdgePolicy
    fillValue: number
  }>,
  signal?: AbortSignal,
): StackAlignmentResult {
  assertStack(values, width, height, frames)
  if (
    !Number.isSafeInteger(options.referenceIndex) ||
    options.referenceIndex < 0 ||
    options.referenceIndex >= frames
  )
    throw new Error('Registration reference frame is invalid.')
  const pixels = width * height
  const reference = Array.prototype.slice.call(
    values,
    options.referenceIndex * pixels,
    (options.referenceIndex + 1) * pixels,
  ) as number[]
  const registrations: StackRegistrationFrame[] = []
  for (let frame = 0; frame < frames; frame += 1) {
    signal?.throwIfAborted()
    const registration =
      frame === options.referenceIndex
        ? { offsetX: 0, offsetY: 0, peak: 1, peakRatio: 1, accepted: true }
        : phaseCorrelation(
            reference,
            Array.prototype.slice.call(values, frame * pixels, (frame + 1) * pixels) as number[],
            width,
            height,
            { maximumShift: options.maximumShift, minimumPeakRatio: options.minimumPeakRatio },
            signal,
          )
    if (!registration.accepted)
      throw new Error(
        `Frame ${frame} registration failed tolerance: shift ${registration.offsetX},${registration.offsetY}; peak ratio ${registration.peakRatio.toFixed(3)}.`,
      )
    registrations.push({ index: frame, ...registration })
  }
  const crop =
    options.edgePolicy === 'crop-overlap'
      ? overlapCrop(width, height, registrations)
      : { x: 0, y: 0, width, height }
  const output = new Float64Array(crop.width * crop.height * frames)
  output.fill(options.fillValue)
  for (const registration of registrations) {
    signal?.throwIfAborted()
    for (let y = 0; y < crop.height; y += 1) {
      for (let x = 0; x < crop.width; x += 1) {
        const targetX = crop.x + x
        const targetY = crop.y + y
        const sourceX = targetX - registration.offsetX
        const sourceY = targetY - registration.offsetY
        if (sourceX < 0 || sourceY < 0 || sourceX >= width || sourceY >= height) continue
        output[registration.index * crop.width * crop.height + y * crop.width + x] = Number(
          values[registration.index * pixels + sourceY * width + sourceX],
        )
      }
    }
  }
  return {
    values: output,
    width: crop.width,
    height: crop.height,
    frames,
    registrations,
    crop,
  }
}

export function propagateStackRoi(
  roi: Readonly<{ x: number; y: number; width: number; height: number }>,
  registrations: readonly StackRegistrationFrame[],
): readonly Readonly<{ frame: number; x: number; y: number; width: number; height: number }>[] {
  return registrations.map((registration) => ({
    frame: registration.index,
    x: roi.x - registration.offsetX,
    y: roi.y - registration.offsetY,
    width: roi.width,
    height: roi.height,
  }))
}
