import { scientificDatasetCharacteristics } from 'purejsimage/analysis'
import {
  histogramResultValueTypeId,
  profileResultValueTypeId,
  resultCollectionValueTypeId,
  scalarResultValueTypeId,
  tableResultValueTypeId,
  validateHistogramResult,
  validateProfileResult,
  validateResultCollection,
  validateScalarResult,
  validateTableResult,
} from 'purejsimage/analysis/results'
import { createRoiMask, normalizeRoi } from 'purejsimage/analysis/roi'
import {
  createOperationProvider,
  type OperationCostEstimate,
  type OperationExecutionRequest,
  type OperationImplementation,
  type OperationJsonObject,
  type OperationJsonValue,
} from 'purejsimage/operations'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
  numericTileSampleOffset,
  resolveNumericTileSource,
  type ScientificDataset,
} from 'purejsimage/scientific'

import { advancedMaterialsOperationDefinitions } from './advanced-definitions.js'
import { MATERIALS_OPERATION_IDS, type MaterialsOperationId } from './catalog.js'
import { createDenseScientificDataset } from './dense-dataset.js'
import {
  azimuthalFrequencyProfile,
  detectFrequencyPeaks,
  type FrequencyCalibration,
  fft2d,
  frequencyMask,
  frequencySpectrum,
  isEfficientFftLength,
  radialFrequencyProfile,
} from './frequency.js'
import { alignStack, montageStack, projectStack, stackStatistics } from './stack.js'
import {
  correctSurface,
  extractSurfaceProfile,
  type SurfaceCorrection,
  surfaceGrainMask,
  surfaceHistogram,
  surfaceRoughness,
} from './surface.js'

export const ADVANCED_MATERIALS_PROVIDER_ID = 'pji-workbench.materials.advanced-reference'
export const ADVANCED_MATERIALS_PROVIDER_VERSION = 1
export const ADVANCED_MAX_PLANE_PIXELS = 4_194_304
export const ADVANCED_MAX_STACK_SAMPLES = 8_388_608
export const ADVANCED_MAX_PEAK_BYTES = 512 * 1_024 * 1_024

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parameters(value: OperationJsonValue): OperationJsonObject {
  if (!isRecord(value)) throw new Error('Advanced materials parameters must be an object.')
  return value as OperationJsonObject
}

function datasetInput(request: OperationExecutionRequest): ScientificDataset {
  const value = request.inputs[0]
  if (
    typeof value !== 'object' ||
    value === null ||
    !('descriptor' in value) ||
    !('readPlane' in value) ||
    typeof value.readPlane !== 'function'
  )
    throw new Error('Advanced materials operation requires a scientific dataset.')
  return value as ScientificDataset
}

function descriptorFromCharacteristics(value: unknown) {
  if (!isRecord(value) || value['kind'] !== 'scientific-dataset')
    throw new Error('Scientific dataset characteristics are unavailable.')
  return normalizeScientificDatasetDescriptor(value['descriptor'])
}

function numberParameter(value: OperationJsonObject, name: string): number {
  const candidate = value[name]
  if (typeof candidate !== 'number' || !Number.isFinite(candidate))
    throw new Error(`${name} must be finite.`)
  return candidate
}

function stringParameter(value: OperationJsonObject, name: string): string {
  const candidate = value[name]
  if (typeof candidate !== 'string') throw new Error(`${name} must be a string.`)
  return candidate
}

function selection(value: OperationJsonObject) {
  const displayAxes = value['displayAxes']
  const fixedIndices = value['fixedIndices']
  const component = value['component']
  if (
    !Array.isArray(displayAxes) ||
    displayAxes.length !== 2 ||
    typeof displayAxes[0] !== 'string' ||
    typeof displayAxes[1] !== 'string' ||
    !Array.isArray(fixedIndices) ||
    !Number.isSafeInteger(component)
  )
    throw new Error('Advanced materials plane selection is invalid.')
  return {
    displayAxes: [displayAxes[0], displayAxes[1]] as const,
    fixedIndices: fixedIndices as readonly Readonly<{ axisId: string; index: number }>[],
    component: Number(component),
  }
}

async function readPlane(
  dataset: ScientificDataset,
  value: OperationJsonObject,
  signal: AbortSignal,
): Promise<Readonly<{ width: number; height: number; values: Float64Array }>> {
  const selected = selection(value)
  if (selected.component < 0 || selected.component >= dataset.descriptor.components.length)
    throw new Error('Selected component is unavailable.')
  const normalized = normalizeScientificPlaneReadRequest(dataset.descriptor, {
    displayAxes: selected.displayAxes,
    fixedIndices: selected.fixedIndices,
    resolutionLevel: 0,
  })
  const pixels = normalized.width * normalized.height
  if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > ADVANCED_MAX_PLANE_PIXELS)
    throw new Error(`Plane exceeds the ${ADVANCED_MAX_PLANE_PIXELS.toLocaleString()} pixel limit.`)
  const values = new Float64Array(pixels)
  values.fill(Number.NaN)
  const source = resolveNumericTileSource(dataset, { targetSampleType: 'float64' })
  for await (const tile of source.readNumericTiles({
    displayAxes: selected.displayAxes,
    fixedIndices: selected.fixedIndices,
    resolutionLevel: 0,
    x: 0,
    y: 0,
    width: normalized.width,
    height: normalized.height,
    targetSampleType: 'float64',
    signal,
  })) {
    try {
      for (let y = 0; y < tile.height; y += 1) {
        signal.throwIfAborted()
        for (let x = 0; x < tile.width; x += 1) {
          const sample = tile.data[numericTileSampleOffset(tile, x, y, selected.component)]
          values[(tile.y + y) * normalized.width + tile.x + x] =
            typeof sample === 'bigint' ? Number(sample) : (sample ?? Number.NaN)
        }
      }
    } finally {
      tile.release()
    }
  }
  return { width: normalized.width, height: normalized.height, values }
}

async function readPlaneRegion(
  dataset: ScientificDataset,
  value: OperationJsonObject,
  region: Readonly<{ x: number; y: number; width: number; height: number }>,
  signal: AbortSignal,
): Promise<Readonly<{ planeWidth: number; planeHeight: number; values: Float64Array }>> {
  const selected = selection(value)
  const plane = normalizeScientificPlaneReadRequest(dataset.descriptor, {
    displayAxes: selected.displayAxes,
    fixedIndices: selected.fixedIndices,
    resolutionLevel: 0,
  })
  if (
    !Number.isSafeInteger(region.x) ||
    !Number.isSafeInteger(region.y) ||
    !Number.isSafeInteger(region.width) ||
    !Number.isSafeInteger(region.height) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width < 1 ||
    region.height < 1 ||
    region.x + region.width > plane.width ||
    region.y + region.height > plane.height ||
    region.width * region.height > ADVANCED_MAX_PLANE_PIXELS
  )
    throw new Error('Requested analysis region is outside the admitted plane.')
  const values = new Float64Array(region.width * region.height)
  values.fill(Number.NaN)
  const source = resolveNumericTileSource(dataset, { targetSampleType: 'float64' })
  for await (const tile of source.readNumericTiles({
    displayAxes: selected.displayAxes,
    fixedIndices: selected.fixedIndices,
    resolutionLevel: 0,
    ...region,
    targetSampleType: 'float64',
    signal,
  })) {
    try {
      for (let y = 0; y < tile.height; y += 1) {
        signal.throwIfAborted()
        for (let x = 0; x < tile.width; x += 1) {
          const sample = tile.data[numericTileSampleOffset(tile, x, y, selected.component)]
          const destinationX = tile.x + x - region.x
          const destinationY = tile.y + y - region.y
          if (
            destinationX >= 0 &&
            destinationY >= 0 &&
            destinationX < region.width &&
            destinationY < region.height
          )
            values[destinationY * region.width + destinationX] =
              typeof sample === 'bigint' ? Number(sample) : (sample ?? Number.NaN)
        }
      }
    } finally {
      tile.release()
    }
  }
  return { planeWidth: plane.width, planeHeight: plane.height, values }
}

async function readStack(
  dataset: ScientificDataset,
  value: OperationJsonObject,
  signal: AbortSignal,
): Promise<Readonly<{ width: number; height: number; frames: number; values: Float64Array }>> {
  const selected = selection(value)
  const stackAxis = stringParameter(value, 'stackAxis')
  if (selected.displayAxes.includes(stackAxis))
    throw new Error('Stack axis must differ from both display axes.')
  const axis = dataset.descriptor.axes.find(({ id }) => id === stackAxis)
  if (axis === undefined) throw new Error('Stack axis is unavailable.')
  const start = numberParameter(value, 'startIndex')
  const end = numberParameter(value, 'endIndex')
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end >= axis.length
  )
    throw new Error('Stack index range is invalid.')
  const frameCount = end - start + 1
  const shape = normalizeScientificPlaneReadRequest(dataset.descriptor, {
    displayAxes: selected.displayAxes,
    fixedIndices: [
      ...selected.fixedIndices.filter(({ axisId }) => axisId !== stackAxis),
      { axisId: stackAxis, index: start },
    ],
    resolutionLevel: 0,
  })
  const samples = shape.width * shape.height * frameCount
  if (!Number.isSafeInteger(samples) || samples > ADVANCED_MAX_STACK_SAMPLES)
    throw new Error(
      `Stack exceeds the ${ADVANCED_MAX_STACK_SAMPLES.toLocaleString()} sample limit.`,
    )
  const values = new Float64Array(samples)
  for (let frame = 0; frame < frameCount; frame += 1) {
    signal.throwIfAborted()
    const plane = await readPlane(
      dataset,
      {
        ...value,
        fixedIndices: [
          ...selected.fixedIndices.filter(({ axisId }) => axisId !== stackAxis),
          { axisId: stackAxis, index: start + frame },
        ],
      },
      signal,
    )
    values.set(plane.values, frame * shape.width * shape.height)
  }
  return { width: shape.width, height: shape.height, frames: frameCount, values }
}

function outputDescriptor(request: OperationExecutionRequest, index: number) {
  const definition = advancedMaterialsOperationDefinitions.find(
    ({ descriptor }) => descriptor.id === request.descriptor.id,
  )
  const inferred = definition?.inferOutputShapes?.({
    parameters: request.parameters,
    inputs: request.plannedInputCharacteristics,
  })
  const characteristic = inferred?.value?.[index]
  if (!inferred?.valid || characteristic === undefined)
    throw new Error('Advanced materials output descriptor is unavailable.')
  return descriptorFromCharacteristics(characteristic)
}

function calibration(
  dataset: ScientificDataset,
  value: OperationJsonObject,
): FrequencyCalibration | undefined {
  const selected = selection(value)
  const x = dataset.descriptor.axes.find(({ id }) => id === selected.displayAxes[0])
  const y = dataset.descriptor.axes.find(({ id }) => id === selected.displayAxes[1])
  if (
    x?.coordinates.type !== 'linear' ||
    y?.coordinates.type !== 'linear' ||
    x.unit === undefined ||
    x.unit !== y.unit
  )
    return undefined
  return {
    xSpacing: Math.abs(x.coordinates.step),
    ySpacing: Math.abs(y.coordinates.step),
    spatialUnit: x.unit,
  }
}

function roiExclusionMask(
  request: OperationExecutionRequest,
  dataset: ScientificDataset,
  width: number,
  height: number,
  signal: AbortSignal,
  tile: Readonly<{ x: number; y: number; width: number; height: number }> = {
    x: 0,
    y: 0,
    width,
    height,
  },
): Uint8Array {
  const rawRoi = request.inputs[1]
  const availableAxes = new Set(dataset.descriptor.axes.map(({ id }) => id))
  const normalizedInput = isRecord(rawRoi)
    ? {
        ...rawRoi,
        fixedIndices: Array.isArray(rawRoi['fixedIndices'])
          ? rawRoi['fixedIndices'].filter(
              (entry) =>
                isRecord(entry) &&
                typeof entry['axisId'] === 'string' &&
                availableAxes.has(entry['axisId']),
            )
          : [],
      }
    : rawRoi
  const roi = normalizeRoi(normalizedInput, dataset.descriptor)
  const mask = createRoiMask(roi, dataset.descriptor, {
    plane: { width, height },
    tile,
    maxMaskPixels: ADVANCED_MAX_PLANE_PIXELS,
    signal,
  })
  return Uint8Array.from(mask.data, (selected) => (selected === 0 ? 1 : 0))
}

function estimate(
  operationId: string,
  descriptor: ReturnType<typeof normalizeScientificDatasetDescriptor>,
  value: OperationJsonObject,
): OperationCostEstimate {
  const selected = selection(value)
  const x = descriptor.axes.find(({ id }) => id === selected.displayAxes[0])
  const y = descriptor.axes.find(({ id }) => id === selected.displayAxes[1])
  const planePixels =
    operationId === MATERIALS_OPERATION_IDS.fft2d
      ? Number(value['roiWidth']) * Number(value['roiHeight'])
      : (x?.length ?? 1) * (y?.length ?? 1)
  const axis = descriptor.axes.find(({ id }) => id === value['stackAxis'])
  const frames =
    axis === undefined ? 1 : Number(value['endIndex']) - Number(value['startIndex']) + 1
  const samples = operationId.startsWith('pji-workbench.materials.stack.')
    ? planePixels * frames
    : planePixels
  const multiplier =
    operationId === MATERIALS_OPERATION_IDS.fft2d
      ? 112
      : operationId === MATERIALS_OPERATION_IDS.stackAlignment
        ? 96
        : 48
  return {
    setupMilliseconds: 2,
    transferMilliseconds: 0,
    computeMilliseconds: Math.max(4, samples / 20_000),
    readbackMilliseconds: 0,
    retainedBytes: samples * 4,
    peakWorkingBytes: samples * multiplier,
    transferBytes: 0,
    outputBytes: samples * 4,
    confidence: 0.75,
  }
}

function frequencyImplementation(): OperationImplementation {
  return {
    descriptor: {
      operationId: MATERIALS_OPERATION_IDS.fft2d,
      operationVersion: 1,
      implementationVersion: '1.0.0',
    },
    supportsPlan(request) {
      try {
        const source = descriptorFromCharacteristics(request.inputCharacteristics[0])
        const value = parameters(request.parameters)
        const plan = estimate(MATERIALS_OPERATION_IDS.fft2d, source, value)
        return (
          source.sampleType !== 'uint64' &&
          isEfficientFftLength(Number(value['roiWidth'])) &&
          isEfficientFftLength(Number(value['roiHeight'])) &&
          plan.peakWorkingBytes <= ADVANCED_MAX_PEAK_BYTES
        )
      } catch {
        return false
      }
    },
    estimatePlan(request) {
      return estimate(
        MATERIALS_OPERATION_IDS.fft2d,
        descriptorFromCharacteristics(request.inputCharacteristics[0]),
        parameters(request.parameters),
      )
    },
    async execute(request) {
      request.signal.throwIfAborted()
      const dataset = datasetInput(request)
      const value = parameters(request.parameters)
      const roiX = numberParameter(value, 'roiX')
      const roiY = numberParameter(value, 'roiY')
      const width = numberParameter(value, 'roiWidth')
      const height = numberParameter(value, 'roiHeight')
      const region = { x: roiX, y: roiY, width, height }
      const plane = await readPlaneRegion(dataset, value, region, request.signal)
      const exclusion = roiExclusionMask(
        request,
        dataset,
        plane.planeWidth,
        plane.planeHeight,
        request.signal,
        region,
      )
      const cropped = plane.values.slice()
      let invalidCount = 0
      for (let index = 0; index < cropped.length; index += 1) {
        const sample = cropped[index] ?? Number.NaN
        if (!Number.isFinite(sample) || exclusion[index] !== 0) invalidCount += 1
        cropped[index] = Number.isFinite(sample) && exclusion[index] === 0 ? sample : 0
      }
      const transform = fft2d(cropped, width, height, request.signal)
      const magnitude = frequencySpectrum(
        transform,
        { mode: 'magnitude', centered: true },
        request.signal,
      )
      const power = frequencySpectrum(transform, { mode: 'power', centered: true }, request.signal)
      const display = stringParameter(value, 'spectrumDisplay')
      const presentationMagnitude =
        display === 'log1p'
          ? Float64Array.from(magnitude, (sample) => Math.log1p(Math.max(0, sample)))
          : magnitude
      const mask = frequencyMask(width, height, {
        kind: stringParameter(value, 'maskKind') as 'none' | 'bandpass' | 'notch',
        minimumRadius: numberParameter(value, 'minimumRadius'),
        maximumRadius: numberParameter(value, 'maximumRadius'),
        notchX: numberParameter(value, 'notchX'),
        notchY: numberParameter(value, 'notchY'),
        notchRadius: numberParameter(value, 'notchRadius'),
      })
      const calibrated = calibration(dataset, value)
      const radial = radialFrequencyProfile(
        magnitude,
        width,
        height,
        numberParameter(value, 'radialBins'),
        calibrated,
        request.signal,
      )
      const azimuthal = azimuthalFrequencyProfile(
        magnitude,
        width,
        height,
        numberParameter(value, 'azimuthalBins'),
        numberParameter(value, 'azimuthalMinimumRadius'),
        numberParameter(value, 'azimuthalMaximumRadius'),
        calibrated,
        request.signal,
      )
      let maximumMagnitude = 0
      for (let index = 0; index < magnitude.length; index += 1) {
        if ((index & 4_095) === 0) request.signal.throwIfAborted()
        maximumMagnitude = Math.max(maximumMagnitude, magnitude[index] ?? 0)
      }
      const threshold =
        numberParameter(value, 'peakThreshold') > 0
          ? numberParameter(value, 'peakThreshold')
          : maximumMagnitude * 0.1
      const peaks = detectFrequencyPeaks(
        magnitude,
        width,
        height,
        {
          threshold,
          minimumDistance: numberParameter(value, 'minimumPeakDistance'),
          maximumPeaks: numberParameter(value, 'maximumPeaks'),
          ...(calibrated === undefined ? {} : { calibration: calibrated }),
        },
        request.signal,
      )
      const magnitudeDataset = createDenseScientificDataset(
        outputDescriptor(request, 0),
        Float32Array.from(presentationMagnitude),
      )
      const powerDataset = createDenseScientificDataset(
        outputDescriptor(request, 1),
        Float32Array.from(power),
      )
      const maskDataset = createDenseScientificDataset(outputDescriptor(request, 2), mask)
      const radialResult = validateProfileResult({
        kind: 'profile',
        valueType: profileResultValueTypeId,
        axis: {
          name: 'spatialFrequency',
          values: radial.axis,
          unit: radial.axisUnit,
          nanPolicy: 'forbid',
        },
        series: [{ name: 'radialMeanMagnitude', values: radial.values, nanPolicy: 'allow' }],
        metadata: { integration: 'annular-mean', centered: true },
      })
      const azimuthalResult = validateProfileResult({
        kind: 'profile',
        valueType: profileResultValueTypeId,
        axis: {
          name: 'azimuth',
          values: azimuthal.axis,
          unit: azimuthal.axisUnit,
          nanPolicy: 'forbid',
        },
        series: [{ name: 'azimuthalMeanMagnitude', values: azimuthal.values, nanPolicy: 'allow' }],
        metadata: {
          minimumRadius: numberParameter(value, 'azimuthalMinimumRadius'),
          maximumRadius: numberParameter(value, 'azimuthalMaximumRadius'),
        },
      })
      const peakTable = validateTableResult({
        kind: 'table',
        valueType: tableResultValueTypeId,
        rowCount: peaks.length,
        columns: [
          {
            name: 'x',
            kind: 'numeric',
            values: Float64Array.from(peaks, ({ x }) => x),
            nanPolicy: 'forbid',
          },
          {
            name: 'y',
            kind: 'numeric',
            values: Float64Array.from(peaks, ({ y }) => y),
            nanPolicy: 'forbid',
          },
          {
            name: 'magnitude',
            kind: 'numeric',
            values: Float64Array.from(peaks, ({ magnitude: sample }) => sample),
            nanPolicy: 'forbid',
          },
          {
            name: 'frequencyX',
            kind: 'numeric',
            values: Float64Array.from(peaks, ({ frequencyX }) => frequencyX),
            ...(calibrated === undefined ? {} : { unit: `1/${calibrated.spatialUnit}` }),
            nanPolicy: 'forbid',
          },
          {
            name: 'frequencyY',
            kind: 'numeric',
            values: Float64Array.from(peaks, ({ frequencyY }) => frequencyY),
            ...(calibrated === undefined ? {} : { unit: `1/${calibrated.spatialUnit}` }),
            nanPolicy: 'forbid',
          },
          {
            name: 'radialFrequency',
            kind: 'numeric',
            values: Float64Array.from(peaks, ({ radialFrequency }) => radialFrequency),
            ...(calibrated === undefined ? {} : { unit: `1/${calibrated.spatialUnit}` }),
            nanPolicy: 'forbid',
          },
          {
            name: 'dSpacing',
            kind: 'numeric',
            values: Float64Array.from(peaks, ({ dSpacing }) => dSpacing ?? Number.NaN),
            ...(calibrated === undefined ? {} : { unit: calibrated.spatialUnit }),
            nanPolicy: 'allow',
          },
        ],
        metadata: { threshold, minimumPeakDistance: value['minimumPeakDistance'] as number },
      })
      const summary = validateResultCollection({
        kind: 'collection',
        valueType: resultCollectionValueTypeId,
        results: [
          {
            name: 'invalidInputSamples',
            result: validateScalarResult({
              kind: 'scalar',
              valueType: scalarResultValueTypeId,
              value: invalidCount,
              nanPolicy: 'forbid',
            }),
          },
          {
            name: 'peakCount',
            result: validateScalarResult({
              kind: 'scalar',
              valueType: scalarResultValueTypeId,
              value: peaks.length,
              nanPolicy: 'forbid',
            }),
          },
        ],
        metadata: {
          complexContract: 'internal-forward-transform-only',
          inverseFftExposed: false,
          displayMapping: display,
          beamCenterX: Math.floor(width / 2),
          beamCenterY: Math.floor(height / 2),
        },
      })
      return [
        {
          value: magnitudeDataset.dataset,
          ownershipIdentity: presentationMagnitude,
          release: magnitudeDataset.release,
        },
        { value: powerDataset.dataset, ownershipIdentity: power, release: powerDataset.release },
        { value: maskDataset.dataset, ownershipIdentity: mask, release: maskDataset.release },
        { value: radialResult, release: () => undefined },
        { value: azimuthalResult, release: () => undefined },
        { value: peakTable, release: () => undefined },
        { value: summary, release: () => undefined },
      ]
    },
  }
}

function stackImplementation(operationId: MaterialsOperationId): OperationImplementation {
  return {
    descriptor: { operationId, operationVersion: 1, implementationVersion: '1.0.0' },
    supportsPlan(request) {
      try {
        const descriptor = descriptorFromCharacteristics(request.inputCharacteristics[0])
        const value = parameters(request.parameters)
        const plan = estimate(operationId, descriptor, value)
        const selected = selection(value)
        const horizontal = descriptor.axes.find(({ id }) => id === selected.displayAxes[0])
        const vertical = descriptor.axes.find(({ id }) => id === selected.displayAxes[1])
        const registrationShapeSupported =
          operationId !== MATERIALS_OPERATION_IDS.stackAlignment ||
          (horizontal !== undefined &&
            vertical !== undefined &&
            isEfficientFftLength(horizontal.length) &&
            isEfficientFftLength(vertical.length))
        return (
          descriptor.sampleType !== 'uint64' &&
          registrationShapeSupported &&
          plan.peakWorkingBytes <= ADVANCED_MAX_PEAK_BYTES
        )
      } catch {
        return false
      }
    },
    estimatePlan(request) {
      return estimate(
        operationId,
        descriptorFromCharacteristics(request.inputCharacteristics[0]),
        parameters(request.parameters),
      )
    },
    async execute(request) {
      const value = parameters(request.parameters)
      const stack = await readStack(datasetInput(request), value, request.signal)
      const startIndex = numberParameter(value, 'startIndex')
      if (operationId === MATERIALS_OPERATION_IDS.stackSumProjection) {
        const projection = projectStack(
          stack.values,
          stack.width,
          stack.height,
          stack.frames,
          'sum',
          request.signal,
        )
        const output = createDenseScientificDataset(
          outputDescriptor(request, 0),
          Float32Array.from(projection),
        )
        return [{ value: output.dataset, ownershipIdentity: projection, release: output.release }]
      }
      if (operationId === MATERIALS_OPERATION_IDS.stackMontage) {
        const montage = montageStack(
          stack.values,
          stack.width,
          stack.height,
          stack.frames,
          numberParameter(value, 'columns'),
          request.signal,
        )
        const output = createDenseScientificDataset(
          outputDescriptor(request, 0),
          Float32Array.from(montage.values),
        )
        return [
          { value: output.dataset, ownershipIdentity: montage.values, release: output.release },
        ]
      }
      if (operationId === MATERIALS_OPERATION_IDS.stackStatistics) {
        const rows = stackStatistics(
          stack.values,
          stack.width,
          stack.height,
          stack.frames,
          request.signal,
        )
        const table = validateTableResult({
          kind: 'table',
          valueType: tableResultValueTypeId,
          rowCount: rows.length,
          columns: [
            {
              name: 'frame',
              kind: 'numeric',
              values: Uint32Array.from(rows, ({ index }) => index + startIndex),
              nanPolicy: 'forbid',
            },
            {
              name: 'count',
              kind: 'numeric',
              values: Uint32Array.from(rows, ({ count }) => count),
              nanPolicy: 'forbid',
            },
            {
              name: 'minimum',
              kind: 'numeric',
              values: Float64Array.from(rows, ({ minimum }) => minimum),
              nanPolicy: 'allow',
            },
            {
              name: 'maximum',
              kind: 'numeric',
              values: Float64Array.from(rows, ({ maximum }) => maximum),
              nanPolicy: 'allow',
            },
            {
              name: 'mean',
              kind: 'numeric',
              values: Float64Array.from(rows, ({ mean }) => mean),
              nanPolicy: 'allow',
            },
            {
              name: 'standardDeviation',
              kind: 'numeric',
              values: Float64Array.from(rows, ({ standardDeviation }) => standardDeviation),
              nanPolicy: 'allow',
            },
          ],
        })
        return [{ value: table, release: () => undefined }]
      }
      const requestedPolicy = stringParameter(value, 'edgePolicy') as 'pad' | 'crop-overlap'
      const maximumShift = numberParameter(value, 'maximumShift')
      const aligned = alignStack(
        stack.values,
        stack.width,
        stack.height,
        stack.frames,
        {
          referenceIndex: numberParameter(value, 'referenceIndex') - startIndex,
          maximumShift,
          minimumPeakRatio: numberParameter(value, 'minimumPeakRatio'),
          edgePolicy: 'pad',
          fillValue: numberParameter(value, 'fillValue'),
        },
        request.signal,
      )
      const crop =
        requestedPolicy === 'crop-overlap'
          ? {
              x: maximumShift,
              y: maximumShift,
              width: stack.width - 2 * maximumShift,
              height: stack.height - 2 * maximumShift,
            }
          : { x: 0, y: 0, width: stack.width, height: stack.height }
      if (crop.width < 1 || crop.height < 1)
        throw new Error('Maximum shift leaves no deterministic crop area.')
      const values =
        requestedPolicy === 'pad'
          ? aligned.values
          : Float64Array.from(
              { length: crop.width * crop.height * stack.frames },
              (_unused, index) => {
                const frame = Math.floor(index / (crop.width * crop.height))
                const local = index % (crop.width * crop.height)
                const x = local % crop.width
                const y = Math.floor(local / crop.width)
                return (
                  aligned.values[
                    frame * stack.width * stack.height + (crop.y + y) * stack.width + crop.x + x
                  ] ?? Number.NaN
                )
              },
            )
      const output = createDenseScientificDataset(
        outputDescriptor(request, 0),
        Float32Array.from(values),
      )
      const drift = validateTableResult({
        kind: 'table',
        valueType: tableResultValueTypeId,
        rowCount: aligned.registrations.length,
        columns: [
          {
            name: 'frame',
            kind: 'numeric',
            values: Uint32Array.from(aligned.registrations, ({ index }) => index + startIndex),
            nanPolicy: 'forbid',
          },
          {
            name: 'offsetX',
            kind: 'numeric',
            values: Int32Array.from(aligned.registrations, ({ offsetX }) => offsetX),
            unit: 'pixel',
            nanPolicy: 'forbid',
          },
          {
            name: 'offsetY',
            kind: 'numeric',
            values: Int32Array.from(aligned.registrations, ({ offsetY }) => offsetY),
            unit: 'pixel',
            nanPolicy: 'forbid',
          },
          {
            name: 'peak',
            kind: 'numeric',
            values: Float64Array.from(aligned.registrations, ({ peak }) => peak),
            nanPolicy: 'forbid',
          },
          {
            name: 'peakRatio',
            kind: 'numeric',
            values: Float64Array.from(aligned.registrations, ({ peakRatio }) => peakRatio),
            nanPolicy: 'forbid',
          },
        ],
        metadata: { edgePolicy: requestedPolicy, maximumShift, crop },
      })
      return [
        { value: output.dataset, ownershipIdentity: values, release: output.release },
        { value: drift, release: () => undefined },
      ]
    },
  }
}

function surfaceImplementation(operationId: MaterialsOperationId): OperationImplementation {
  return {
    descriptor: { operationId, operationVersion: 1, implementationVersion: '1.0.0' },
    supportsPlan(request) {
      try {
        const descriptor = descriptorFromCharacteristics(request.inputCharacteristics[0])
        return (
          descriptor.components.length > 0 &&
          estimate(operationId, descriptor, parameters(request.parameters)).peakWorkingBytes <=
            ADVANCED_MAX_PEAK_BYTES
        )
      } catch {
        return false
      }
    },
    estimatePlan(request) {
      return estimate(
        operationId,
        descriptorFromCharacteristics(request.inputCharacteristics[0]),
        parameters(request.parameters),
      )
    },
    async execute(request) {
      const dataset = datasetInput(request)
      const value = parameters(request.parameters)
      const plane = await readPlane(dataset, value, request.signal)
      const exclusion = roiExclusionMask(
        request,
        dataset,
        plane.width,
        plane.height,
        request.signal,
      )
      if (operationId === MATERIALS_OPERATION_IDS.surfaceCorrect) {
        const corrected = correctSurface(plane.values, plane.width, plane.height, {
          correction: stringParameter(value, 'correction') as SurfaceCorrection,
          polynomialDegree: numberParameter(value, 'polynomialDegree') as 0 | 1 | 2,
          exclusionMask: exclusion,
          signal: request.signal,
        })
        const output = createDenseScientificDataset(
          outputDescriptor(request, 0),
          Float32Array.from(corrected.values),
        )
        return [
          { value: output.dataset, ownershipIdentity: corrected.values, release: output.release },
        ]
      }
      const roughness = surfaceRoughness(plane.values, exclusion, request.signal)
      const histogram = surfaceHistogram(
        plane.values,
        numberParameter(value, 'histogramBins'),
        exclusion,
      )
      const selected = selection(value)
      const xAxis = dataset.descriptor.axes.find(({ id }) => id === selected.displayAxes[0])
      const yAxis = dataset.descriptor.axes.find(({ id }) => id === selected.displayAxes[1])
      const xSpacing = xAxis?.coordinates.type === 'linear' ? Math.abs(xAxis.coordinates.step) : 1
      const ySpacing = yAxis?.coordinates.type === 'linear' ? Math.abs(yAxis.coordinates.step) : 1
      const xyUnit = xAxis?.unit === yAxis?.unit ? xAxis?.unit : undefined
      const zUnit = dataset.descriptor.components[selected.component]?.unit
      const profile = extractSurfaceProfile(plane.values, plane.width, plane.height, {
        x0: numberParameter(value, 'profileX0'),
        y0: numberParameter(value, 'profileY0'),
        x1: numberParameter(value, 'profileX1'),
        y1: numberParameter(value, 'profileY1'),
        samples: numberParameter(value, 'profileSamples'),
        xSpacing,
        ySpacing,
      })
      const grainMask = surfaceGrainMask(plane.values, plane.width, plane.height, {
        method: stringParameter(value, 'grainMethod') as
          | 'manual'
          | 'otsu'
          | 'triangle'
          | 'yen'
          | 'li'
          | 'mean',
        polarity: stringParameter(value, 'grainPolarity') as 'light' | 'dark',
        lower: numberParameter(value, 'grainLower'),
        upper: numberParameter(value, 'grainUpper'),
        histogramBins: numberParameter(value, 'histogramBins'),
        exclusionMask: exclusion,
        signal: request.signal,
      })
      const histogramResult = validateHistogramResult({
        kind: 'histogram',
        valueType: histogramResultValueTypeId,
        binEdges: histogram.binEdges,
        counts: histogram.counts,
        underflow: 0,
        overflow: 0,
        ...(zUnit === undefined ? {} : { unit: zUnit }),
      })
      const roughnessResult = validateResultCollection({
        kind: 'collection',
        valueType: resultCollectionValueTypeId,
        results: [
          ['Ra', roughness.ra],
          ['Rq', roughness.rq],
          ['Rz', roughness.rz],
          ['mean', roughness.mean],
          ['minimum', roughness.minimum],
          ['maximum', roughness.maximum],
        ].map(([name, metric]) => ({
          name: String(name),
          result: validateScalarResult({
            kind: 'scalar',
            valueType: scalarResultValueTypeId,
            value: Number(metric),
            ...(zUnit === undefined ? {} : { unit: zUnit }),
            nanPolicy: 'forbid',
          }),
        })),
        metadata: {
          count: roughness.count,
          rzDefinition: 'maximum minus minimum over admitted area',
          xyUnit: xyUnit ?? 'pixel',
          zUnit: zUnit ?? 'dataset value',
        },
      })
      const profileResult = validateProfileResult({
        kind: 'profile',
        valueType: profileResultValueTypeId,
        axis: {
          name: 'distance',
          values: profile.distance,
          ...(xyUnit === undefined ? { unit: 'pixel' } : { unit: xyUnit }),
          nanPolicy: 'forbid',
        },
        series: [
          {
            name: 'height',
            values: profile.height,
            ...(zUnit === undefined ? {} : { unit: zUnit }),
            nanPolicy: 'allow',
          },
        ],
      })
      const output = createDenseScientificDataset(outputDescriptor(request, 3), grainMask)
      return [
        { value: histogramResult, release: () => undefined },
        { value: roughnessResult, release: () => undefined },
        { value: profileResult, release: () => undefined },
        { value: output.dataset, ownershipIdentity: grainMask, release: output.release },
      ]
    },
  }
}

export function createAdvancedMaterialsProvider() {
  return createOperationProvider({
    descriptor: {
      id: ADVANCED_MATERIALS_PROVIDER_ID,
      version: ADVANCED_MATERIALS_PROVIDER_VERSION,
      kind: 'reference',
      buildFingerprint: 'pji-workbench-advanced-materials-typescript-v1',
      title: 'PureJsImage Lab advanced materials reference provider',
    },
    prepare: () =>
      Promise.resolve([
        frequencyImplementation(),
        stackImplementation(MATERIALS_OPERATION_IDS.stackSumProjection),
        stackImplementation(MATERIALS_OPERATION_IDS.stackMontage),
        stackImplementation(MATERIALS_OPERATION_IDS.stackStatistics),
        stackImplementation(MATERIALS_OPERATION_IDS.stackAlignment),
        surfaceImplementation(MATERIALS_OPERATION_IDS.surfaceCorrect),
        surfaceImplementation(MATERIALS_OPERATION_IDS.surfaceAnalyze),
      ]),
  })
}

export function advancedDatasetCharacteristics(dataset: ScientificDataset): OperationJsonObject {
  return scientificDatasetCharacteristics(dataset)
}
