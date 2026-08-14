import { scientificDatasetCharacteristics } from 'purejsimage/analysis'
import {
  histogramResultValueTypeId,
  scalarResultValueTypeId,
  validateHistogramResult,
  validateScalarResult,
} from 'purejsimage/analysis/results'
import { createRoiMask, normalizeRoi, type Roi } from 'purejsimage/analysis/roi'
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
  type NumericTileSource,
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
  numericTileSampleOffset,
  resolveNumericTileSource,
  type ScientificDataset,
} from 'purejsimage/scientific'

import { MATERIALS_OPERATION_IDS, type MaterialsOperationId } from './catalog.js'
import type { DensePlane } from './kernels.js'
import { analyzeParticles, type ParticleCalibration } from './particles.js'
import { numericTileRasterBytes } from './provider.js'
import {
  applyThreshold,
  binaryMorphology,
  euclideanDistanceTransform,
  type ForegroundPolarity,
  type ThresholdMethod,
  type ThresholdNoDataPolicy,
  watershedSeparate,
} from './segmentation.js'
import { segmentationOperationDefinitions } from './segmentation-definitions.js'

export const SEGMENTATION_REFERENCE_PROVIDER_ID = 'pji-workbench.materials.segmentation-reference'
export const SEGMENTATION_REFERENCE_PROVIDER_VERSION = 1
export const SEGMENTATION_MAX_PLANE_PIXELS = 4_194_304
export const SEGMENTATION_MAX_PEAK_BYTES = 384 * 1_024 * 1_024

const morphologyKinds = new Map<
  MaterialsOperationId,
  Parameters<typeof binaryMorphology>[3]['kind']
>([
  [MATERIALS_OPERATION_IDS.binaryErode, 'erode'],
  [MATERIALS_OPERATION_IDS.binaryDilate, 'dilate'],
  [MATERIALS_OPERATION_IDS.binaryOpen, 'open'],
  [MATERIALS_OPERATION_IDS.binaryClose, 'close'],
  [MATERIALS_OPERATION_IDS.binaryFillHoles, 'fill-holes'],
  [MATERIALS_OPERATION_IDS.binaryClearBorder, 'clear-border'],
  [MATERIALS_OPERATION_IDS.binaryRemoveSmall, 'remove-small-objects'],
  [MATERIALS_OPERATION_IDS.binaryOutline, 'outline'],
])

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parameters(value: OperationJsonValue): OperationJsonObject {
  if (!isRecord(value)) throw new Error('Segmentation parameters must be an object.')
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
    throw new Error('Segmentation operation requires a scientific dataset input.')
  return value as ScientificDataset
}

function roiInput(request: OperationExecutionRequest, dataset: ScientificDataset, index = 1): Roi {
  const value = request.inputs[index]
  return normalizeRoi(value, dataset.descriptor)
}

function descriptorFromCharacteristics(value: unknown) {
  if (!isRecord(value) || value['kind'] !== 'scientific-dataset')
    throw new Error('Scientific dataset characteristics are unavailable.')
  return normalizeScientificDatasetDescriptor(value['descriptor'])
}

function outputDescriptor(request: OperationExecutionRequest, index = 0) {
  const definition = segmentationOperationDefinitions.find(
    ({ descriptor }) => descriptor.id === request.descriptor.id,
  )
  const inferred = definition?.inferOutputShapes?.({
    parameters: request.parameters,
    inputs: request.plannedInputCharacteristics,
  })
  const value = inferred?.value?.[index]
  if (!inferred?.valid || value === undefined)
    throw new Error('Segmentation output descriptor is unavailable.')
  return descriptorFromCharacteristics(value)
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
    !Number.isSafeInteger(component) ||
    Number(component) < 0
  )
    throw new Error('Segmentation plane selection is invalid.')
  return {
    displayAxes: [displayAxes[0], displayAxes[1]] as const,
    fixedIndices: fixedIndices as readonly Readonly<{ axisId: string; index: number }>[],
    component: Number(component),
  }
}

function planeShape(dataset: ScientificDataset, value: OperationJsonObject) {
  const selected = selection(value)
  const request = normalizeScientificPlaneReadRequest(dataset.descriptor, {
    displayAxes: selected.displayAxes,
    fixedIndices: selected.fixedIndices,
    resolutionLevel: 0,
  })
  const pixels = request.width * request.height
  if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > SEGMENTATION_MAX_PLANE_PIXELS)
    throw new Error(
      `Segmentation plane exceeds the ${SEGMENTATION_MAX_PLANE_PIXELS.toLocaleString()} pixel admission limit.`,
    )
  return { ...selected, width: request.width, height: request.height, pixels }
}

async function readComponentPlane(
  dataset: ScientificDataset,
  value: OperationJsonObject,
  signal: AbortSignal,
): Promise<DensePlane> {
  const shape = planeShape(dataset, value)
  if (shape.component >= dataset.descriptor.components.length)
    throw new Error('Selected source component is unavailable.')
  const values = new Float64Array(shape.pixels)
  values.fill(Number.NaN)
  const source = resolveNumericTileSource(dataset, { targetSampleType: 'float64' })
  for await (const tile of source.readNumericTiles({
    displayAxes: shape.displayAxes,
    fixedIndices: shape.fixedIndices,
    resolutionLevel: 0,
    x: 0,
    y: 0,
    width: shape.width,
    height: shape.height,
    targetSampleType: 'float64',
    signal,
  })) {
    try {
      for (let y = 0; y < tile.height; y += 1) {
        signal.throwIfAborted()
        for (let x = 0; x < tile.width; x += 1) {
          const raw = tile.data[numericTileSampleOffset(tile, x, y, shape.component)]
          values[(tile.y + y) * shape.width + tile.x + x] =
            typeof raw === 'bigint' ? Number(raw) : (raw ?? Number.NaN)
        }
      }
    } finally {
      tile.release()
    }
  }
  return {
    width: shape.width,
    height: shape.height,
    components: 1,
    values,
    ...(dataset.descriptor.noDataValue === undefined
      ? {}
      : { noDataValue: dataset.descriptor.noDataValue }),
  }
}

async function readBinaryPlane(
  dataset: ScientificDataset,
  value: OperationJsonObject,
  signal: AbortSignal,
): Promise<{ readonly data: Uint8Array; readonly width: number; readonly height: number }> {
  const plane = await readComponentPlane(dataset, value, signal)
  return {
    width: plane.width,
    height: plane.height,
    data: Uint8Array.from(plane.values, (sample) =>
      Number.isFinite(sample) && sample !== 0 ? 1 : 0,
    ),
  }
}

async function readLabelPlane(
  dataset: ScientificDataset,
  value: OperationJsonObject,
  signal: AbortSignal,
): Promise<{ readonly data: Uint32Array; readonly width: number; readonly height: number }> {
  const plane = await readComponentPlane(dataset, { ...value, component: 0 }, signal)
  return {
    width: plane.width,
    height: plane.height,
    data: Uint32Array.from(plane.values, (sample) =>
      Number.isFinite(sample) && sample > 0 ? Math.round(sample) : 0,
    ),
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

function materializedDataset(
  descriptor: ReturnType<typeof normalizeScientificDatasetDescriptor>,
  values: NumericArray,
): { readonly dataset: ScientificDataset; release(): void } {
  let retained: NumericArray | undefined = values
  const sampleType = descriptor.sampleType === 'float16' ? 'float32' : descriptor.sampleType
  const numericTileSource: NumericTileSource = {
    descriptor,
    directSemantics: {
      sourceSampleType: descriptor.sampleType,
      nativeSampleType: sampleType,
      componentCount: 1,
      layout: 'interleaved',
      supportedTargetSampleTypes: [sampleType],
    },
    planRead(request) {
      const { targetSampleType: _targetSampleType, ...planeRequest } = request
      const normalized = normalizeScientificPlaneReadRequest(descriptor, planeRequest)
      return {
        maximumEmittedTileRetainedBytes:
          normalized.width * normalized.height * bytesPerSample(sampleType),
        delivery: 'single-exact',
      }
    },
    async *readNumericTiles(request) {
      const data = retained
      if (data === undefined) throw new Error('Segmentation output was released.')
      const { targetSampleType: _targetSampleType, ...planeRequest } = request
      const normalized = normalizeScientificPlaneReadRequest(descriptor, planeRequest)
      const horizontal = descriptor.axes.find(({ id }) => id === normalized.displayAxes[0])
      if (horizontal === undefined) throw new Error('Segmentation output axis is unavailable.')
      const output =
        sampleType === 'uint8'
          ? new Uint8Array(normalized.width * normalized.height)
          : sampleType === 'uint32'
            ? new Uint32Array(normalized.width * normalized.height)
            : new Float32Array(normalized.width * normalized.height)
      for (let y = 0; y < normalized.height; y += 1) {
        normalized.signal?.throwIfAborted()
        for (let x = 0; x < normalized.width; x += 1)
          output[y * normalized.width + x] = Number(
            data[(normalized.y + y) * horizontal.length + normalized.x + x] ?? 0,
          )
      }
      yield {
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
        sampleType,
        componentCount: 1,
        layout: 'interleaved',
        rowStrideElements: normalized.width,
        data: output,
        release: () => undefined,
      } as NumericTile
    },
  }
  const dataset = {
    descriptor,
    numericTileSource,
    async *readPlane(request) {
      for await (const tile of numericTileSource.readNumericTiles(request)) {
        const data = numericTileRasterBytes(tile)
        yield {
          x: tile.x,
          y: tile.y,
          width: tile.width,
          height: tile.height,
          stride: tile.width * bytesPerSample(tile.sampleType),
          format: { sampleType: tile.sampleType, channels: 1, planar: false },
          data,
          release: tile.release,
        }
      }
    },
  } as ScientificDataset
  return {
    dataset,
    release() {
      retained = undefined
    },
  }
}

function calibration(
  dataset: ScientificDataset,
  value: OperationJsonObject,
): ParticleCalibration | undefined {
  const selected = selection(value)
  const horizontal = dataset.descriptor.axes.find(({ id }) => id === selected.displayAxes[0])
  const vertical = dataset.descriptor.axes.find(({ id }) => id === selected.displayAxes[1])
  if (
    horizontal?.coordinates.type !== 'linear' ||
    vertical?.coordinates.type !== 'linear' ||
    horizontal.unit === undefined ||
    horizontal.unit !== vertical.unit
  )
    return undefined
  return {
    xSpacing: Math.abs(horizontal.coordinates.step),
    ySpacing: Math.abs(vertical.coordinates.step),
    unit: horizontal.unit,
  }
}

function estimate(
  operationId: string,
  descriptor: ReturnType<typeof normalizeScientificDatasetDescriptor>,
  value: OperationJsonObject,
): OperationCostEstimate {
  const displayAxes = value['displayAxes']
  const horizontal = Array.isArray(displayAxes)
    ? descriptor.axes.find(({ id }) => id === displayAxes[0])
    : undefined
  const vertical = Array.isArray(displayAxes)
    ? descriptor.axes.find(({ id }) => id === displayAxes[1])
    : undefined
  const pixels = (horizontal?.length ?? 1) * (vertical?.length ?? 1)
  const multiplier =
    operationId === MATERIALS_OPERATION_IDS.watershed
      ? 56
      : operationId === MATERIALS_OPERATION_IDS.distanceTransform
        ? 32
        : operationId === MATERIALS_OPERATION_IDS.thresholdReference &&
            value['method'] === 'sauvola'
          ? 64
          : operationId === MATERIALS_OPERATION_IDS.thresholdReference
            ? 32
            : operationId === MATERIALS_OPERATION_IDS.particleAnalysis
              ? 104
              : 16
  const peakWorkingBytes = pixels * multiplier
  const outputBytes = pixels * (operationId === MATERIALS_OPERATION_IDS.particleAnalysis ? 4 : 1)
  return {
    setupMilliseconds: 1,
    transferMilliseconds: 0,
    computeMilliseconds: Math.max(2, pixels / 40_000),
    readbackMilliseconds: 0,
    retainedBytes: outputBytes,
    peakWorkingBytes,
    transferBytes: 0,
    outputBytes,
    confidence: 0.8,
  }
}

function particleInputsSupported(
  labels: ReturnType<typeof normalizeScientificDatasetDescriptor>,
  source: ReturnType<typeof normalizeScientificDatasetDescriptor>,
  value: OperationJsonObject,
): boolean {
  const sourceComponent = value['sourceComponent']
  return (
    source.sampleType !== 'uint64' &&
    Number.isSafeInteger(sourceComponent) &&
    Number(sourceComponent) >= 0 &&
    Number(sourceComponent) < source.components.length &&
    labels.axes.length === source.axes.length &&
    labels.axes.every((axis, index) => {
      const candidate = source.axes[index]
      return candidate?.id === axis.id && candidate.length === axis.length
    })
  )
}

function implementation(operationId: MaterialsOperationId): OperationImplementation {
  return {
    descriptor: {
      operationId,
      operationVersion: 1,
      implementationVersion: '1.0.0',
      ...(morphologyKinds.has(operationId) || operationId === MATERIALS_OPERATION_IDS.watershed
        ? { bitExactConformance: true }
        : {}),
    },
    supportsPlan(request) {
      try {
        const descriptor = descriptorFromCharacteristics(request.inputCharacteristics[0])
        const value = parameters(request.parameters)
        const plan = estimate(operationId, descriptor, value)
        const displayAxes = value['displayAxes']
        const horizontal = Array.isArray(displayAxes)
          ? descriptor.axes.find(({ id }) => id === displayAxes[0])
          : undefined
        const vertical = Array.isArray(displayAxes)
          ? descriptor.axes.find(({ id }) => id === displayAxes[1])
          : undefined
        const pixels = (horizontal?.length ?? 0) * (vertical?.length ?? 0)
        return (
          descriptor.sampleType !== 'uint64' &&
          (operationId !== MATERIALS_OPERATION_IDS.particleAnalysis ||
            particleInputsSupported(
              descriptor,
              descriptorFromCharacteristics(request.inputCharacteristics[1]),
              value,
            )) &&
          pixels > 0 &&
          pixels <= SEGMENTATION_MAX_PLANE_PIXELS &&
          plan.peakWorkingBytes <= SEGMENTATION_MAX_PEAK_BYTES
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
      request.signal.throwIfAborted()
      const source = datasetInput(request)
      const value = parameters(request.parameters)
      if (operationId === MATERIALS_OPERATION_IDS.thresholdReference) {
        const plane = await readComponentPlane(source, value, request.signal)
        const roi = roiInput(request, source)
        const roiMask = createRoiMask(roi, source.descriptor, {
          plane: { width: plane.width, height: plane.height },
          tile: { x: 0, y: 0, width: plane.width, height: plane.height },
          maxMaskPixels: SEGMENTATION_MAX_PLANE_PIXELS,
          signal: request.signal,
        })
        const result = applyThreshold(
          plane,
          0,
          {
            method: stringParameter(value, 'method') as ThresholdMethod,
            polarity: stringParameter(value, 'polarity') as ForegroundPolarity,
            lower: numberParameter(value, 'lower'),
            upper: numberParameter(value, 'upper'),
            histogramBins: numberParameter(value, 'histogramBins'),
            windowRadius: numberParameter(value, 'windowRadius'),
            sauvolaK: numberParameter(value, 'sauvolaK'),
            dynamicRange: numberParameter(value, 'dynamicRange'),
            noDataPolicy: stringParameter(value, 'noDataPolicy') as ThresholdNoDataPolicy,
            signal: request.signal,
          },
          roiMask.data,
        )
        const owned = materializedDataset(outputDescriptor(request), result.mask)
        const histogram = validateHistogramResult({
          kind: 'histogram',
          valueType: histogramResultValueTypeId,
          binEdges: result.histogram.binEdges,
          counts: result.histogram.counts,
          underflow: 0,
          overflow: 0,
          metadata: {
            finiteCount: result.histogram.finiteCount,
            invalidCount: result.histogram.invalidCount,
            method: value['method'] as OperationJsonValue,
          },
        })
        const foregroundFraction = validateScalarResult({
          kind: 'scalar',
          valueType: scalarResultValueTypeId,
          value: result.selectedCount === 0 ? 0 : result.foregroundCount / result.selectedCount,
          nanPolicy: 'forbid',
        })
        const resolvedThreshold = validateScalarResult({
          kind: 'scalar',
          valueType: scalarResultValueTypeId,
          value: result.threshold,
          nanPolicy: Number.isNaN(result.threshold) ? 'allow' : 'forbid',
          metadata: { adaptive: value['method'] === 'sauvola' },
        })
        return [
          { value: owned.dataset, ownershipIdentity: result.mask, release: () => owned.release() },
          { value: histogram, release: () => undefined },
          { value: foregroundFraction, release: () => undefined },
          { value: resolvedThreshold, release: () => undefined },
        ]
      }
      if (operationId === MATERIALS_OPERATION_IDS.particleAnalysis) {
        const labelsSource = source
        const intensitySource = datasetInput(request, 1)
        const labels = await readLabelPlane(labelsSource, value, request.signal)
        const intensity = await readComponentPlane(
          intensitySource,
          { ...value, component: numberParameter(value, 'sourceComponent') },
          request.signal,
        )
        const roi = roiInput(request, intensitySource, 2)
        const fieldMask = createRoiMask(roi, intensitySource.descriptor, {
          plane: { width: labels.width, height: labels.height },
          tile: { x: 0, y: 0, width: labels.width, height: labels.height },
          maxMaskPixels: SEGMENTATION_MAX_PLANE_PIXELS,
          signal: request.signal,
        })
        const analysis = analyzeParticles(
          labels.data,
          intensity.values,
          labels.width,
          labels.height,
          {
            filters: {
              edgePolicy: stringParameter(value, 'edgePolicy') as 'include' | 'exclude',
              minimumArea: numberParameter(value, 'minimumArea'),
              maximumArea: numberParameter(value, 'maximumArea'),
              minimumCircularity: numberParameter(value, 'minimumCircularity'),
              maximumCircularity: numberParameter(value, 'maximumCircularity'),
              minimumAspectRatio: numberParameter(value, 'minimumAspectRatio'),
              maximumAspectRatio: numberParameter(value, 'maximumAspectRatio'),
              minimumSolidity: numberParameter(value, 'minimumSolidity'),
              maximumSolidity: numberParameter(value, 'maximumSolidity'),
            },
            ...(calibration(intensitySource, value) === undefined
              ? {}
              : { calibration: calibration(intensitySource, value) as ParticleCalibration }),
            ...(intensitySource.descriptor.components[numberParameter(value, 'sourceComponent')]
              ?.unit === undefined
              ? {}
              : {
                  intensityUnit: intensitySource.descriptor.components[
                    numberParameter(value, 'sourceComponent')
                  ]?.unit as string,
                }),
            fieldMask: fieldMask.data,
            signal: request.signal,
          },
        )
        const owned = materializedDataset(outputDescriptor(request), analysis.filteredLabels)
        return [
          {
            value: owned.dataset,
            ownershipIdentity: analysis.filteredLabels,
            release: () => owned.release(),
          },
          { value: analysis.table, release: () => undefined },
          { value: analysis.summary, release: () => undefined },
          { value: analysis.distribution, release: () => undefined },
        ]
      }
      const binary = await readBinaryPlane(source, value, request.signal)
      if (operationId === MATERIALS_OPERATION_IDS.distanceTransform) {
        const distances = euclideanDistanceTransform(
          binary.data,
          binary.width,
          binary.height,
          request.signal,
        )
        const output = Float32Array.from(distances)
        const owned = materializedDataset(outputDescriptor(request), output)
        return [{ value: owned.dataset, ownershipIdentity: output, release: () => owned.release() }]
      }
      const output =
        operationId === MATERIALS_OPERATION_IDS.watershed
          ? watershedSeparate(binary.data, binary.width, binary.height, {
              minimumPeakDistance: numberParameter(value, 'minimumPeakDistance'),
              signal: request.signal,
            })
          : binaryMorphology(binary.data, binary.width, binary.height, {
              kind: morphologyKinds.get(operationId) ?? 'outline',
              radius: numberParameter(value, 'radius'),
              minimumSize: numberParameter(value, 'minimumSize'),
              connectivity: numberParameter(value, 'connectivity') as 4 | 8,
              signal: request.signal,
            })
      const owned = materializedDataset(outputDescriptor(request), output)
      return [{ value: owned.dataset, ownershipIdentity: output, release: () => owned.release() }]
    },
  }
}

export function createSegmentationAnalysisProvider() {
  return createOperationProvider({
    descriptor: {
      id: SEGMENTATION_REFERENCE_PROVIDER_ID,
      version: SEGMENTATION_REFERENCE_PROVIDER_VERSION,
      kind: 'reference',
      buildFingerprint: 'pji-workbench-segmentation-typescript-v1',
      title: 'PureJsImage Lab bounded segmentation reference provider',
    },
    prepare: () =>
      Promise.resolve(
        segmentationOperationDefinitions.map(({ descriptor }) =>
          implementation(descriptor.id as MaterialsOperationId),
        ),
      ),
  })
}

export function segmentationDatasetCharacteristics(
  dataset: ScientificDataset,
): OperationJsonObject {
  return scientificDatasetCharacteristics(dataset)
}
