import { scientificDatasetCharacteristics } from 'purejsimage/analysis'
import {
  createOperationProvider,
  type OperationCostEstimate,
  type OperationExecutionRequest,
  type OperationImplementation,
  type OperationJsonObject,
  type OperationJsonValue,
} from 'purejsimage/operations'
import {
  type NumericArray,
  type NumericSampleType,
  type NumericTile,
  type NumericTileReadRequest,
  type NumericTileSource,
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
  numericTileSampleOffset,
  resolveNumericTileSource,
  type ScientificDataset,
} from 'purejsimage/scientific'

import { MATERIALS_OPERATION_IDS } from './catalog.js'
import { materialsOperationDefinitions } from './definitions.js'
import type { InvalidPolicy } from './kernels.js'
import {
  boxFilterPlane,
  calculatePlanes,
  convolvePlane,
  type DensePlane,
  flipPlane,
  gradientPlane,
  mapPlane,
  outlierPlane,
  rankFilterPlane,
  rotateRightAngle,
  unsharpPlane,
} from './kernels.js'

export const MATERIALS_REFERENCE_PROVIDER_ID = 'pji-workbench.materials.reference'
export const MATERIALS_REFERENCE_PROVIDER_VERSION = 1

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parameters(value: OperationJsonValue): OperationJsonObject {
  if (!isRecord(value)) throw new Error('Operation parameters must be an object.')
  return value as OperationJsonObject
}

function datasetInput(request: OperationExecutionRequest, index = 0): ScientificDataset {
  const value = request.inputs[index]
  if (
    typeof value !== 'object' ||
    value === null ||
    !('descriptor' in value) ||
    !('readPlane' in value) ||
    typeof value.readPlane !== 'function'
  )
    throw new Error('Materials operation requires a scientific dataset input.')
  return value as ScientificDataset
}

function descriptorFromCharacteristics(value: unknown) {
  if (!isRecord(value) || value['kind'] !== 'scientific-dataset')
    throw new Error('Scientific dataset characteristics are unavailable.')
  return normalizeScientificDatasetDescriptor(value['descriptor'])
}

function outputDescriptor(request: OperationExecutionRequest) {
  const definition = materialsOperationDefinitions.find(
    ({ descriptor }) => descriptor.id === request.descriptor.id,
  )
  const inferred = definition?.inferOutputShapes?.({
    parameters: request.parameters,
    inputs: request.plannedInputCharacteristics,
  })
  const first = inferred?.value?.[0]
  if (!inferred?.valid || first === undefined)
    throw new Error('Materials operation output descriptor is unavailable.')
  return descriptorFromCharacteristics(first)
}

function sampleTypeArray(sampleType: NumericSampleType, length: number): NumericArray {
  if (sampleType === 'uint8') return new Uint8Array(length)
  if (sampleType === 'uint16') return new Uint16Array(length)
  if (sampleType === 'uint32') return new Uint32Array(length)
  if (sampleType === 'uint64') return new BigUint64Array(length)
  if (sampleType === 'int8') return new Int8Array(length)
  if (sampleType === 'int16') return new Int16Array(length)
  if (sampleType === 'int32') return new Int32Array(length)
  if (sampleType === 'float32') return new Float32Array(length)
  return new Float64Array(length)
}

function sampleRange(sampleType: NumericSampleType): readonly [number, number] | undefined {
  if (sampleType === 'uint8') return [0, 255]
  if (sampleType === 'uint16') return [0, 65_535]
  if (sampleType === 'uint32' || sampleType === 'uint64') return [0, 4_294_967_295]
  if (sampleType === 'int8') return [-128, 127]
  if (sampleType === 'int16') return [-32_768, 32_767]
  if (sampleType === 'int32') return [-2_147_483_648, 2_147_483_647]
  return undefined
}

function writeNumeric(array: NumericArray, index: number, value: number): void {
  if (array instanceof BigUint64Array) array[index] = BigInt(Math.max(0, Math.round(value)))
  else array[index] = value
}

async function readDense(
  dataset: ScientificDataset,
  request: NumericTileReadRequest,
): Promise<DensePlane> {
  const { targetSampleType: _targetSampleType, ...planeRequest } = request
  const normalized = normalizeScientificPlaneReadRequest(dataset.descriptor, planeRequest)
  const components = dataset.descriptor.components.length
  const values = new Float64Array(normalized.width * normalized.height * components)
  values.fill(Number.NaN)
  const source = resolveNumericTileSource(dataset, { targetSampleType: 'float64' })
  for await (const tile of source.readNumericTiles({
    ...normalized,
    targetSampleType: 'float64',
  })) {
    try {
      normalized.signal?.throwIfAborted()
      for (let y = 0; y < tile.height; y += 1) {
        normalized.signal?.throwIfAborted()
        const destinationY = tile.y + y - normalized.y
        if (destinationY < 0 || destinationY >= normalized.height) continue
        for (let x = 0; x < tile.width; x += 1) {
          const destinationX = tile.x + x - normalized.x
          if (destinationX < 0 || destinationX >= normalized.width) continue
          for (let component = 0; component < components; component += 1) {
            const sourceIndex = numericTileSampleOffset(tile, x, y, component)
            const raw = tile.data[sourceIndex]
            values[(destinationY * normalized.width + destinationX) * components + component] =
              typeof raw === 'bigint' ? Number(raw) : (raw ?? Number.NaN)
          }
        }
      }
    } finally {
      tile.release()
    }
  }
  return {
    width: normalized.width,
    height: normalized.height,
    components,
    values,
    ...(dataset.descriptor.noDataValue === undefined
      ? {}
      : { noDataValue: dataset.descriptor.noDataValue }),
  }
}

function cropDense(
  plane: DensePlane,
  x: number,
  y: number,
  width: number,
  height: number,
): DensePlane {
  const values = new Float64Array(width * height * plane.components)
  for (let outputY = 0; outputY < height; outputY += 1)
    for (let outputX = 0; outputX < width; outputX += 1)
      for (let component = 0; component < plane.components; component += 1)
        values[(outputY * width + outputX) * plane.components + component] =
          plane.values[
            ((outputY + y) * plane.width + outputX + x) * plane.components + component
          ] ?? Number.NaN
  return { ...plane, width, height, values }
}

function numberParameter(value: OperationJsonObject, name: string): number {
  const entry = value[name]
  if (typeof entry !== 'number' || !Number.isFinite(entry))
    throw new Error(`${name} must be finite.`)
  return entry
}

function stringParameter(value: OperationJsonObject, name: string): string {
  const entry = value[name]
  if (typeof entry !== 'string') throw new Error(`${name} must be a string.`)
  return entry
}

function axisLength(dataset: ScientificDataset, axisId: string, resolutionLevel: number): number {
  return (
    dataset.descriptor.levels
      .find(({ level }) => level === resolutionLevel)
      ?.axisLengths.find((axis) => axis.axisId === axisId)?.length ??
    dataset.descriptor.axes.find(({ id }) => id === axisId)?.length ??
    1
  )
}

function processPointwise(
  operationId: string,
  plane: DensePlane,
  value: OperationJsonObject,
  signal: AbortSignal | undefined,
): DensePlane {
  if (operationId === MATERIALS_OPERATION_IDS.normalize) {
    const inputMinimum = numberParameter(value, 'inputMinimum')
    const inputMaximum = numberParameter(value, 'inputMaximum')
    const outputMinimum = numberParameter(value, 'outputMinimum')
    const outputMaximum = numberParameter(value, 'outputMaximum')
    const shouldClip = value['clip'] === true
    return mapPlane(
      plane,
      (sample) => {
        const ratio = (sample - inputMinimum) / (inputMaximum - inputMinimum)
        const normalized = shouldClip ? Math.max(0, Math.min(1, ratio)) : ratio
        return outputMinimum + normalized * (outputMaximum - outputMinimum)
      },
      signal,
    )
  }
  if (operationId === MATERIALS_OPERATION_IDS.clamp) {
    const minimum = numberParameter(value, 'minimum')
    const maximum = numberParameter(value, 'maximum')
    return mapPlane(plane, (sample) => Math.max(minimum, Math.min(maximum, sample)), signal)
  }
  if (operationId === MATERIALS_OPERATION_IDS.invert) {
    const minimum = numberParameter(value, 'minimum')
    const maximum = numberParameter(value, 'maximum')
    return mapPlane(plane, (sample) => minimum + maximum - sample, signal)
  }
  if (operationId === MATERIALS_OPERATION_IDS.gamma) {
    const gamma = numberParameter(value, 'gamma')
    const minimum = numberParameter(value, 'minimum')
    const maximum = numberParameter(value, 'maximum')
    return mapPlane(
      plane,
      (sample) =>
        minimum +
        Math.max(0, Math.min(1, (sample - minimum) / (maximum - minimum))) ** gamma *
          (maximum - minimum),
      signal,
    )
  }
  if (operationId === MATERIALS_OPERATION_IDS.log) {
    const base = stringParameter(value, 'base')
    const nonPositive = stringParameter(value, 'nonPositive')
    const epsilon = numberParameter(value, 'epsilon')
    return mapPlane(
      plane,
      (sample) => {
        const candidate = sample <= 0 ? (nonPositive === 'clamp' ? epsilon : Number.NaN) : sample
        return base === '10' ? Math.log10(candidate) : Math.log(candidate)
      },
      signal,
    )
  }
  if (operationId === MATERIALS_OPERATION_IDS.squareRoot) {
    const negative = stringParameter(value, 'negative')
    return mapPlane(
      plane,
      (sample) => Math.sqrt(sample < 0 && negative === 'clamp' ? 0 : sample),
      signal,
    )
  }
  const constant = numberParameter(value, 'value')
  return mapPlane(
    plane,
    (sample) =>
      operationId === MATERIALS_OPERATION_IDS.addConstant
        ? sample + constant
        : operationId === MATERIALS_OPERATION_IDS.subtractConstant
          ? sample - constant
          : operationId === MATERIALS_OPERATION_IDS.multiplyConstant
            ? sample * constant
            : sample / constant,
    signal,
  )
}

function processNeighborhood(
  operationId: string,
  plane: DensePlane,
  value: OperationJsonObject,
  signal: AbortSignal | undefined,
): DensePlane {
  const invalidPolicy: InvalidPolicy = value['invalidPolicy'] === 'ignore' ? 'ignore' : 'propagate'
  const common = {
    boundary: (value['boundary'] ?? 'mirror') as 'clamp' | 'mirror' | 'constant',
    constantValue: Number(value['constantValue'] ?? 0),
    invalidPolicy,
    ...(signal === undefined ? {} : { signal }),
  }
  if (operationId === MATERIALS_OPERATION_IDS.box)
    return boxFilterPlane(plane, numberParameter(value, 'radius'), common)
  if (
    operationId === MATERIALS_OPERATION_IDS.median ||
    operationId === MATERIALS_OPERATION_IDS.minimum ||
    operationId === MATERIALS_OPERATION_IDS.maximum
  )
    return rankFilterPlane(
      plane,
      numberParameter(value, 'radius'),
      operationId === MATERIALS_OPERATION_IDS.median
        ? 'median'
        : operationId === MATERIALS_OPERATION_IDS.minimum
          ? 'minimum'
          : 'maximum',
      common,
    )
  if (operationId === MATERIALS_OPERATION_IDS.convolution) {
    const kernel = value['kernel']
    if (!Array.isArray(kernel) || kernel.some((entry) => typeof entry !== 'number'))
      throw new Error('Convolution kernel is invalid.')
    return convolvePlane(
      plane,
      kernel as readonly number[],
      numberParameter(value, 'kernelWidth'),
      common,
    )
  }
  if (operationId === MATERIALS_OPERATION_IDS.unsharp)
    return unsharpPlane(
      plane,
      numberParameter(value, 'sigma'),
      numberParameter(value, 'amount'),
      invalidPolicy,
      signal,
    )
  if (operationId === MATERIALS_OPERATION_IDS.gradient)
    return gradientPlane(
      plane,
      stringParameter(value, 'operator') as 'sobel' | 'scharr',
      stringParameter(value, 'output') as 'x' | 'y' | 'magnitude',
      signal,
    )
  if (operationId === MATERIALS_OPERATION_IDS.laplacian) {
    const kernel =
      value['neighborhood'] === 8 ? [1, 1, 1, 1, -8, 1, 1, 1, 1] : [0, 1, 0, 1, -4, 1, 0, 1, 0]
    return convolvePlane(plane, kernel, 3, { ...common, boundary: 'mirror' })
  }
  if (operationId === MATERIALS_OPERATION_IDS.outlier)
    return outlierPlane(
      plane,
      numberParameter(value, 'radius'),
      numberParameter(value, 'threshold'),
      signal,
    )
  if (operationId === MATERIALS_OPERATION_IDS.background) {
    const background = boxFilterPlane(plane, numberParameter(value, 'radius'), {
      ...common,
      boundary: 'mirror',
    })
    const offset = numberParameter(value, 'offset')
    const values = new Float64Array(plane.values.length)
    for (let index = 0; index < values.length; index += 1) {
      if (index % 16_384 === 0) signal?.throwIfAborted()
      values[index] =
        (plane.values[index] ?? Number.NaN) - (background.values[index] ?? Number.NaN) + offset
    }
    return { ...plane, values, noDataValue: Number.NaN }
  }
  throw new Error(`Unknown neighborhood operation: ${operationId}`)
}

function operationRadius(operationId: string, value: OperationJsonObject): number {
  if (
    operationId === MATERIALS_OPERATION_IDS.box ||
    operationId === MATERIALS_OPERATION_IDS.median ||
    operationId === MATERIALS_OPERATION_IDS.minimum ||
    operationId === MATERIALS_OPERATION_IDS.maximum ||
    operationId === MATERIALS_OPERATION_IDS.outlier ||
    operationId === MATERIALS_OPERATION_IDS.background
  )
    return numberParameter(value, 'radius')
  if (operationId === MATERIALS_OPERATION_IDS.convolution)
    return Math.floor(numberParameter(value, 'kernelWidth') / 2)
  if (operationId === MATERIALS_OPERATION_IDS.unsharp)
    return Math.min(48, Math.ceil(numberParameter(value, 'sigma') * 3))
  return 1
}

async function processRequest(
  operationId: string,
  source: ScientificDataset,
  second: ScientificDataset | undefined,
  value: OperationJsonObject,
  request: NumericTileReadRequest,
  outputSampleType: NumericSampleType,
  outputDescriptorValue: ReturnType<typeof normalizeScientificDatasetDescriptor>,
): Promise<NumericTile> {
  const { targetSampleType: _targetSampleType, ...planeRequest } = request
  const normalized = normalizeScientificPlaneReadRequest(outputDescriptorValue, planeRequest)
  let plane: DensePlane
  if (operationId === MATERIALS_OPERATION_IDS.rotateRightAngle) {
    const degrees = numberParameter(value, 'degrees') as 90 | 180 | 270
    const sourceWidth = axisLength(source, normalized.displayAxes[0], normalized.resolutionLevel)
    const sourceHeight = axisLength(source, normalized.displayAxes[1], normalized.resolutionLevel)
    const sourceRegion =
      degrees === 90
        ? {
            x: normalized.y,
            y: sourceHeight - normalized.x - normalized.width,
            width: normalized.height,
            height: normalized.width,
          }
        : degrees === 180
          ? {
              x: sourceWidth - normalized.x - normalized.width,
              y: sourceHeight - normalized.y - normalized.height,
              width: normalized.width,
              height: normalized.height,
            }
          : {
              x: sourceWidth - normalized.y - normalized.height,
              y: normalized.x,
              width: normalized.height,
              height: normalized.width,
            }
    const sourcePlane = await readDense(source, {
      displayAxes: normalized.displayAxes,
      fixedIndices: normalized.fixedIndices,
      resolutionLevel: normalized.resolutionLevel,
      ...sourceRegion,
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    })
    plane = rotateRightAngle(sourcePlane, degrees, normalized.signal)
  } else if (operationId === MATERIALS_OPERATION_IDS.flip) {
    const direction = stringParameter(value, 'direction') as 'horizontal' | 'vertical'
    const horizontalLength = axisLength(
      source,
      normalized.displayAxes[0],
      normalized.resolutionLevel,
    )
    const verticalLength = axisLength(source, normalized.displayAxes[1], normalized.resolutionLevel)
    const sourcePlane = await readDense(source, {
      displayAxes: normalized.displayAxes,
      fixedIndices: normalized.fixedIndices,
      resolutionLevel: normalized.resolutionLevel,
      x:
        direction === 'horizontal'
          ? horizontalLength - normalized.x - normalized.width
          : normalized.x,
      y:
        direction === 'vertical' ? verticalLength - normalized.y - normalized.height : normalized.y,
      width: normalized.width,
      height: normalized.height,
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    })
    plane = flipPlane(sourcePlane, direction, normalized.signal)
  } else if (operationId === MATERIALS_OPERATION_IDS.translate) {
    const offsetX = numberParameter(value, 'offsetX')
    const offsetY = numberParameter(value, 'offsetY')
    const horizontalLength = axisLength(
      source,
      normalized.displayAxes[0],
      normalized.resolutionLevel,
    )
    const verticalLength = axisLength(source, normalized.displayAxes[1], normalized.resolutionLevel)
    const sourceX = Math.max(0, normalized.x - offsetX)
    const sourceY = Math.max(0, normalized.y - offsetY)
    const sourceRight = Math.min(horizontalLength, normalized.x + normalized.width - offsetX)
    const sourceBottom = Math.min(verticalLength, normalized.y + normalized.height - offsetY)
    const values = new Float64Array(
      normalized.width * normalized.height * source.descriptor.components.length,
    )
    values.fill(numberParameter(value, 'constantValue'))
    plane = {
      width: normalized.width,
      height: normalized.height,
      components: source.descriptor.components.length,
      values,
    }
    if (sourceRight > sourceX && sourceBottom > sourceY) {
      const sourcePlane = await readDense(source, {
        displayAxes: normalized.displayAxes,
        fixedIndices: normalized.fixedIndices,
        resolutionLevel: normalized.resolutionLevel,
        x: sourceX,
        y: sourceY,
        width: sourceRight - sourceX,
        height: sourceBottom - sourceY,
        ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
      })
      const destinationX = sourceX + offsetX - normalized.x
      const destinationY = sourceY + offsetY - normalized.y
      for (let y = 0; y < sourcePlane.height; y += 1) {
        normalized.signal?.throwIfAborted()
        for (let x = 0; x < sourcePlane.width; x += 1)
          for (let component = 0; component < plane.components; component += 1)
            values[
              ((y + destinationY) * plane.width + x + destinationX) * plane.components + component
            ] =
              sourcePlane.values[(y * sourcePlane.width + x) * plane.components + component] ??
              Number.NaN
      }
    }
  } else if (operationId === MATERIALS_OPERATION_IDS.imageCalculator) {
    if (second === undefined) throw new Error('Image calculator requires a second dataset.')
    const left = await readDense(source, normalized)
    const right = await readDense(second, normalized)
    plane = calculatePlanes(
      left,
      right,
      stringParameter(value, 'operator') as 'add' | 'subtract' | 'multiply' | 'divide',
      normalized.signal,
    )
  } else if (operationId.startsWith('pji-workbench.materials.filter.')) {
    const radius = operationRadius(operationId, value)
    const horizontalLength = axisLength(
      source,
      normalized.displayAxes[0],
      normalized.resolutionLevel,
    )
    const verticalLength = axisLength(source, normalized.displayAxes[1], normalized.resolutionLevel)
    const sourceX = Math.max(0, normalized.x - radius)
    const sourceY = Math.max(0, normalized.y - radius)
    const sourceRight = Math.min(horizontalLength, normalized.x + normalized.width + radius)
    const sourceBottom = Math.min(verticalLength, normalized.y + normalized.height + radius)
    const expanded = await readDense(source, {
      ...normalized,
      x: sourceX,
      y: sourceY,
      width: sourceRight - sourceX,
      height: sourceBottom - sourceY,
    })
    const filtered = processNeighborhood(operationId, expanded, value, normalized.signal)
    plane = cropDense(
      filtered,
      normalized.x - sourceX,
      normalized.y - sourceY,
      normalized.width,
      normalized.height,
    )
  } else {
    const input = await readDense(source, normalized)
    plane =
      operationId === MATERIALS_OPERATION_IDS.convert
        ? input
        : processPointwise(operationId, input, value, normalized.signal)
  }

  const data = sampleTypeArray(outputSampleType, plane.values.length)
  const range = sampleRange(outputSampleType)
  for (let index = 0; index < plane.values.length; index += 1) {
    if (index % 16_384 === 0) normalized.signal?.throwIfAborted()
    let sample = plane.values[index] ?? Number.NaN
    if (operationId === MATERIALS_OPERATION_IDS.convert && value['mode'] === 'scale') {
      const minimum = numberParameter(value, 'inputMinimum')
      const maximum = numberParameter(value, 'inputMaximum')
      const outputRange = range ?? [0, 1]
      sample =
        outputRange[0] +
        Math.max(0, Math.min(1, (sample - minimum) / (maximum - minimum))) *
          (outputRange[1] - outputRange[0])
    }
    if (range !== undefined)
      sample = Math.round(
        Math.max(range[0], Math.min(range[1], Number.isFinite(sample) ? sample : range[0])),
      )
    writeNumeric(data, index, sample)
  }
  return {
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height,
    sampleType: outputSampleType,
    componentCount: plane.components,
    layout: 'interleaved',
    rowStrideElements: normalized.width * plane.components,
    data,
    release: () => undefined,
  }
}

function bytesPerSample(sampleType: NumericSampleType): number {
  return sampleType === 'uint8' || sampleType === 'int8'
    ? 1
    : sampleType === 'uint16' || sampleType === 'int16'
      ? 2
      : sampleType === 'uint64' || sampleType === 'float64'
        ? 8
        : 4
}

function rasterBytes(tile: NumericTile): Uint8Array {
  const bytes = new Uint8Array(
    tile.width * tile.height * tile.componentCount * bytesPerSample(tile.sampleType),
  )
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (const raw of tile.data) {
    const value = typeof raw === 'bigint' ? raw : Number(raw)
    if (tile.sampleType === 'uint8') view.setUint8(offset, Number(value))
    else if (tile.sampleType === 'int8') view.setInt8(offset, Number(value))
    else if (tile.sampleType === 'uint16') view.setUint16(offset, Number(value), false)
    else if (tile.sampleType === 'int16') view.setInt16(offset, Number(value), false)
    else if (tile.sampleType === 'uint32') view.setUint32(offset, Number(value), false)
    else if (tile.sampleType === 'int32') view.setInt32(offset, Number(value), false)
    else if (tile.sampleType === 'uint64') view.setBigUint64(offset, BigInt(value), false)
    else if (tile.sampleType === 'float32') view.setFloat32(offset, Number(value), false)
    else view.setFloat64(offset, Number(value), false)
    offset += bytesPerSample(tile.sampleType)
  }
  return bytes
}

function derivedDataset(
  operationId: string,
  source: ScientificDataset,
  second: ScientificDataset | undefined,
  value: OperationJsonObject,
  descriptor: ReturnType<typeof normalizeScientificDatasetDescriptor>,
): ScientificDataset {
  const nativeSampleType = descriptor.sampleType === 'float16' ? 'float32' : descriptor.sampleType
  const numericTileSource: NumericTileSource = {
    descriptor,
    directSemantics: {
      sourceSampleType: descriptor.sampleType,
      nativeSampleType,
      componentCount: descriptor.components.length,
      layout: 'interleaved',
      supportedTargetSampleTypes: [nativeSampleType],
    },
    planRead(request) {
      const { targetSampleType: _targetSampleType, ...planeRequest } = request
      const normalized = normalizeScientificPlaneReadRequest(descriptor, planeRequest)
      return {
        maximumEmittedTileRetainedBytes:
          normalized.width *
          normalized.height *
          descriptor.components.length *
          bytesPerSample(nativeSampleType),
        delivery: 'single-exact',
      }
    },
    async *readNumericTiles(request) {
      yield await processRequest(
        operationId,
        source,
        second,
        value,
        request,
        nativeSampleType,
        descriptor,
      )
    },
  }
  return {
    descriptor,
    numericTileSource,
    async *readPlane(request) {
      for await (const tile of numericTileSource.readNumericTiles(request)) {
        const data = rasterBytes(tile)
        yield {
          x: tile.x,
          y: tile.y,
          width: tile.width,
          height: tile.height,
          stride: tile.width * tile.componentCount * bytesPerSample(tile.sampleType),
          format: {
            sampleType: tile.sampleType,
            channels: tile.componentCount,
            planar: false,
          },
          data,
          release: tile.release,
        }
      }
    },
  } as ScientificDataset
}

const ZERO_COST: OperationCostEstimate = {
  setupMilliseconds: 0.1,
  transferMilliseconds: 0,
  computeMilliseconds: 4,
  readbackMilliseconds: 0,
  retainedBytes: 0,
  peakWorkingBytes: 4 * 1024 * 1024,
  transferBytes: 0,
  outputBytes: 0,
  confidence: 0.6,
}

function implementation(operationId: string): OperationImplementation {
  return {
    descriptor: {
      operationId,
      operationVersion: 1,
      implementationVersion: '1.0.0',
    },
    supportsPlan(request) {
      try {
        const descriptor = descriptorFromCharacteristics(request.inputCharacteristics[0])
        if (descriptor.sampleType === 'uint64') return false
        if (
          operationId === MATERIALS_OPERATION_IDS.imageCalculator &&
          request.inputCharacteristics.length !== 2
        )
          return false
        return true
      } catch {
        return false
      }
    },
    estimatePlan(request) {
      const descriptor = descriptorFromCharacteristics(request.inputCharacteristics[0])
      const components = descriptor.components.length
      return {
        ...ZERO_COST,
        peakWorkingBytes: 384 * 384 * components * 16,
        outputBytes: 256 * 256 * components * 4,
        retainedBytes: 256 * 256 * components * 4,
      }
    },
    async execute(request) {
      request.signal.throwIfAborted()
      const source = datasetInput(request)
      const second =
        operationId === MATERIALS_OPERATION_IDS.imageCalculator
          ? datasetInput(request, 1)
          : undefined
      const descriptor = outputDescriptor(request)
      const dataset = derivedDataset(
        operationId,
        source,
        second,
        parameters(request.parameters),
        descriptor,
      )
      return [{ value: dataset, release: () => undefined }]
    },
  }
}

export function createMaterialsAnalysisProvider() {
  return createOperationProvider({
    descriptor: {
      id: MATERIALS_REFERENCE_PROVIDER_ID,
      version: MATERIALS_REFERENCE_PROVIDER_VERSION,
      kind: 'reference',
      buildFingerprint: 'pji-workbench-materials-typescript-v1',
      title: 'PureJsImage Lab materials reference provider',
    },
    prepare: () =>
      Promise.resolve(
        materialsOperationDefinitions.map(({ descriptor }) => implementation(descriptor.id)),
      ),
  })
}

export function materialsDatasetCharacteristics(dataset: ScientificDataset): OperationJsonObject {
  return scientificDatasetCharacteristics(dataset)
}
