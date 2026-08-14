import {
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
} from 'purejsimage/analysis'
import {
  histogramResultValueTypeId,
  profileResultValueTypeId,
  resultCollectionValueTypeId,
  tableResultValueTypeId,
} from 'purejsimage/analysis/results'
import { roiValueTypeId } from 'purejsimage/analysis/roi'
import {
  createOperationDefinition,
  type OperationDefinition,
  type OperationJsonObject,
  type OperationJsonValue,
  type ParameterSchema,
  validateOperationParameters,
} from 'purejsimage/operations'
import {
  type NormalizedScientificDatasetDescriptor,
  normalizeScientificDatasetDescriptor,
} from 'purejsimage/scientific'

import { MATERIALS_OPERATION_IDS } from './catalog.js'
import { isEfficientFftLength } from './frequency.js'

const datasetPort = (name: string) => ({
  name,
  valueType: { id: scientificDatasetValueTypeId, version: 1 },
})
const resultPort = (name: string, id: string) => ({ name, valueType: { id, version: 1 } })
const roiPort = { name: 'roi', valueType: { id: roiValueTypeId, version: 1 } }
const axisSchema = {
  type: 'array',
  items: { type: 'string', minLength: 1, maxLength: 4_096 },
  minItems: 2,
  maxItems: 2,
} as const
const fixedIndicesSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      axisId: { type: 'string', minLength: 1, maxLength: 4_096 },
      index: { type: 'integer', minimum: 0 },
    },
    required: ['axisId', 'index'],
    closed: true,
  },
  maxItems: 64,
} as const
const number = (title: string, defaultValue: number, minimum?: number, maximum?: number) => ({
  type: 'number' as const,
  title,
  default: defaultValue,
  finiteOnly: true,
  ...(minimum === undefined ? {} : { minimum }),
  ...(maximum === undefined ? {} : { maximum }),
})
const integer = (title: string, defaultValue: number, minimum: number, maximum: number) => ({
  type: 'integer' as const,
  title,
  default: defaultValue,
  minimum,
  maximum,
})
const choice = <Values extends readonly (string | number)[]>(
  title: string,
  values: Values,
  defaultValue: Values[number],
) => ({ type: 'enum' as const, title, values, default: defaultValue })
const planeProperties = {
  displayAxes: axisSchema,
  fixedIndices: fixedIndicesSchema,
  component: integer('Component', 0, 0, 63),
}
const objectSchema = (
  properties: Readonly<Record<string, ParameterSchema>>,
  required: readonly string[] = ['displayAxes', 'fixedIndices'],
) => ({
  type: 'object' as const,
  properties: { ...planeProperties, ...properties },
  required,
  closed: true,
})

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parameters(value: OperationJsonValue): OperationJsonObject {
  if (!isRecord(value)) throw new Error('Advanced materials parameters must be an object.')
  return value as OperationJsonObject
}

function descriptor(value: unknown): NormalizedScientificDatasetDescriptor {
  if (!isRecord(value) || value['kind'] !== 'scientific-dataset')
    throw new Error('A scientific dataset is required.')
  return normalizeScientificDatasetDescriptor(value['descriptor'])
}

function selectedAxes(source: NormalizedScientificDatasetDescriptor, value: OperationJsonObject) {
  const ids = value['displayAxes']
  if (
    !Array.isArray(ids) ||
    ids.length !== 2 ||
    typeof ids[0] !== 'string' ||
    typeof ids[1] !== 'string'
  )
    throw new Error('Two display axes are required.')
  const horizontal = source.axes.find(({ id }) => id === ids[0])
  const vertical = source.axes.find(({ id }) => id === ids[1])
  if (horizontal === undefined || vertical === undefined || horizontal.id === vertical.id)
    throw new Error('Display axes are unavailable.')
  return { horizontal, vertical }
}

function scalarPlaneDescriptor(
  source: NormalizedScientificDatasetDescriptor,
  value: OperationJsonObject,
  sampleType: 'uint8' | 'float32',
  override?: Readonly<{ width: number; height: number; name: string }>,
): NormalizedScientificDatasetDescriptor {
  const { horizontal, vertical } = selectedAxes(source, value)
  const width = override?.width ?? horizontal.length
  const height = override?.height ?? vertical.length
  const axes = [
    { ...horizontal, length: width },
    { ...vertical, length: height },
  ]
  return normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    sampleType,
    axes,
    components: [{ id: sampleType === 'uint8' ? 'mask' : 'value', kind: 'scalar' }],
    levels: [{ level: 0, axisLengths: axes.map(({ id, length }) => ({ axisId: id, length })) }],
    capabilities: {
      regionReads: true,
      resolutionLevels: false,
      planeReads: { kind: 'any-axis-pair' },
    },
  })
}

function fftDescriptor(
  source: NormalizedScientificDatasetDescriptor,
  value: OperationJsonObject,
  sampleType: 'uint8' | 'float32',
  name: string,
): NormalizedScientificDatasetDescriptor {
  const width = Number(value['roiWidth'])
  const height = Number(value['roiHeight'])
  const output = scalarPlaneDescriptor(source, value, sampleType, { width, height, name })
  const sourceAxes = selectedAxes(source, value)
  return normalizeScientificDatasetDescriptor({
    ...output,
    axes: output.axes.map((axis, index) => {
      const original = index === 0 ? sourceAxes.horizontal : sourceAxes.vertical
      const length = index === 0 ? width : height
      return original.coordinates.type === 'linear' && original.unit !== undefined
        ? {
            ...axis,
            name: `${original.name ?? original.id} spatial frequency`,
            unit: `1/${original.unit}`,
            coordinates: {
              type: 'linear' as const,
              origin: -Math.floor(length / 2) / (length * Math.abs(original.coordinates.step)),
              step: 1 / (length * Math.abs(original.coordinates.step)),
            },
          }
        : {
            ...axis,
            name: `${original.name ?? original.id} spatial frequency`,
            unit: 'cycles/pixel',
            coordinates: {
              type: 'linear' as const,
              origin: -Math.floor(length / 2) / length,
              step: 1 / length,
            },
          }
    }),
  })
}

function resultCharacteristics(valueType: string): OperationJsonObject {
  return { kind: 'analysis-result', valueType }
}

function invalid(error: unknown) {
  return {
    valid: false as const,
    issues: [
      {
        code: 'invalid-value' as const,
        path: '',
        message:
          error instanceof Error ? error.message : 'Advanced materials operation is invalid.',
      },
    ],
  }
}

const fftDescriptorSpec = {
  id: MATERIALS_OPERATION_IDS.fft2d,
  version: 1,
  title: '2D FFT workspace',
  description: 'Centered quantitative magnitude/power spectra, masks, profiles, and peaks.',
  category: 'frequency',
  tags: ['fft', 'frequency', 'diffraction', 'radial', 'azimuthal', 'd-spacing'],
  inputs: [datasetPort('dataset'), roiPort],
  outputs: [
    datasetPort('magnitude'),
    datasetPort('power'),
    datasetPort('frequencyMask'),
    resultPort('radialProfile', profileResultValueTypeId),
    resultPort('azimuthalProfile', profileResultValueTypeId),
    resultPort('peaks', tableResultValueTypeId),
    resultPort('frequencySummary', resultCollectionValueTypeId),
  ],
  parameters: objectSchema({
    roiX: integer('ROI X', 0, 0, 16_777_216),
    roiY: integer('ROI Y', 0, 0, 16_777_216),
    roiWidth: integer('ROI width', 256, 2, 2_048),
    roiHeight: integer('ROI height', 256, 2, 2_048),
    spectrumDisplay: choice('Presentation mapping', ['raw', 'log1p'] as const, 'log1p'),
    radialBins: integer('Radial bins', 128, 2, 4_096),
    azimuthalBins: integer('Azimuthal bins', 180, 8, 1_440),
    azimuthalMinimumRadius: number('Azimuthal minimum frequency', 0, 0),
    azimuthalMaximumRadius: number('Azimuthal maximum frequency', 1, 0),
    peakThreshold: number('Peak threshold', 0, 0),
    minimumPeakDistance: number('Peak separation', 4, 1, 2_048),
    maximumPeaks: integer('Maximum peaks', 32, 1, 2_048),
    maskKind: choice('Frequency mask', ['none', 'bandpass', 'notch'] as const, 'none'),
    minimumRadius: number('Bandpass minimum', 0, 0, 1),
    maximumRadius: number('Bandpass maximum', 0.5, 0, 1),
    notchX: number('Notch X', 0, -0.5, 0.5),
    notchY: number('Notch Y', 0, -0.5, 0.5),
    notchRadius: number('Notch radius', 0.02, 0, 0.5),
  }),
  execution: 'global-transform' as const,
  reproducibility: { class: 'tolerance-based' as const, absolute: 1e-8, relative: 1e-8 },
  builtIn: false,
}

const fftBase = createOperationDefinition({
  descriptor: fftDescriptorSpec,
  inferOutputShapes(request) {
    try {
      const source = descriptor(request.inputs[0])
      const value = parameters(request.parameters)
      return {
        valid: true,
        issues: [],
        value: [
          scientificDatasetCharacteristics(
            fftDescriptor(source, value, 'float32', 'fft-magnitude'),
          ),
          scientificDatasetCharacteristics(fftDescriptor(source, value, 'float32', 'fft-power')),
          scientificDatasetCharacteristics(fftDescriptor(source, value, 'uint8', 'frequency-mask')),
          resultCharacteristics(profileResultValueTypeId),
          resultCharacteristics(profileResultValueTypeId),
          resultCharacteristics(tableResultValueTypeId),
          resultCharacteristics(resultCollectionValueTypeId),
        ],
      }
    } catch (error) {
      return invalid(error)
    }
  },
})

export const fftOperationDefinition: OperationDefinition = {
  ...fftBase,
  normalizeParameters(input, limits) {
    const normalized = validateOperationParameters(fftDescriptorSpec, input, limits)
    if (!normalized.valid || normalized.value === undefined) return normalized
    const value = parameters(normalized.value)
    if (Number(value['maximumRadius']) < Number(value['minimumRadius']))
      return invalid(new Error('Bandpass maximum radius must be at least its minimum.'))
    if (Number(value['azimuthalMaximumRadius']) < Number(value['azimuthalMinimumRadius']))
      return invalid(new Error('Azimuthal maximum radius must be at least its minimum.'))
    if (
      !isEfficientFftLength(Number(value['roiWidth'])) ||
      !isEfficientFftLength(Number(value['roiHeight']))
    )
      return invalid(
        new Error(
          'Non-power-of-two FFT axes are limited to 512 samples; select a smaller ROI or a power-of-two size.',
        ),
      )
    return normalized
  },
}

const stackParameters = {
  stackAxis: { type: 'string' as const, title: 'Stack axis', minLength: 1, maxLength: 4_096 },
  startIndex: integer('First plane', 0, 0, 1_000_000),
  endIndex: integer('Last plane', 0, 0, 1_000_000),
}

function stackPlaneDescriptor(
  source: NormalizedScientificDatasetDescriptor,
  value: OperationJsonObject,
  name: string,
) {
  return scalarPlaneDescriptor(source, value, 'float32', {
    width: selectedAxes(source, value).horizontal.length,
    height: selectedAxes(source, value).vertical.length,
    name,
  })
}

function stackDefinition(
  id:
    | typeof MATERIALS_OPERATION_IDS.stackSumProjection
    | typeof MATERIALS_OPERATION_IDS.stackMontage
    | typeof MATERIALS_OPERATION_IDS.stackStatistics
    | typeof MATERIALS_OPERATION_IDS.stackAlignment,
  title: string,
  outputs: readonly ReturnType<typeof datasetPort | typeof resultPort>[],
  extra: Readonly<Record<string, ParameterSchema>>,
  infer: (
    source: NormalizedScientificDatasetDescriptor,
    value: OperationJsonObject,
  ) => readonly OperationJsonObject[],
): OperationDefinition {
  const descriptorSpec = {
    id,
    version: 1,
    title,
    description: title,
    category: 'stack',
    tags: ['stack', 'volume', 'projection', 'registration', 'drift'],
    inputs: [datasetPort('dataset')],
    outputs,
    parameters: objectSchema({ ...stackParameters, ...extra }),
    execution: 'global-transform' as const,
    reproducibility: { class: 'tolerance-based' as const, absolute: 1e-8, relative: 1e-8 },
    builtIn: false,
  }
  return createOperationDefinition({
    descriptor: descriptorSpec,
    inferOutputShapes(request) {
      try {
        const source = descriptor(request.inputs[0])
        const value = parameters(request.parameters)
        const axis = source.axes.find(({ id: axisId }) => axisId === value['stackAxis'])
        if (axis === undefined) throw new Error('Stack axis is unavailable.')
        if (
          Number(value['endIndex']) < Number(value['startIndex']) ||
          Number(value['endIndex']) >= axis.length
        )
          throw new Error('Stack index range is invalid.')
        return { valid: true, issues: [], value: infer(source, value) }
      } catch (error) {
        return invalid(error)
      }
    },
  })
}

export const stackSumProjectionOperationDefinition = stackDefinition(
  MATERIALS_OPERATION_IDS.stackSumProjection,
  'Stack sum projection',
  [datasetPort('projection')],
  {},
  (source, value) => [
    scientificDatasetCharacteristics(stackPlaneDescriptor(source, value, 'sum-projection')),
  ],
)

export const stackMontageOperationDefinition = stackDefinition(
  MATERIALS_OPERATION_IDS.stackMontage,
  'Stack montage',
  [datasetPort('montage')],
  { columns: integer('Montage columns', 4, 1, 256) },
  (source, value) => {
    const frameCount = Number(value['endIndex']) - Number(value['startIndex']) + 1
    const columns = Math.min(Number(value['columns']), frameCount)
    const axes = selectedAxes(source, value)
    return [
      scientificDatasetCharacteristics(
        scalarPlaneDescriptor(source, value, 'float32', {
          width: axes.horizontal.length * columns,
          height: axes.vertical.length * Math.ceil(frameCount / columns),
          name: 'stack-montage',
        }),
      ),
    ]
  },
)

export const stackStatisticsOperationDefinition = stackDefinition(
  MATERIALS_OPERATION_IDS.stackStatistics,
  'Stack statistics',
  [resultPort('statistics', tableResultValueTypeId)],
  {},
  () => [resultCharacteristics(tableResultValueTypeId)],
)

export const stackAlignmentOperationDefinition = stackDefinition(
  MATERIALS_OPERATION_IDS.stackAlignment,
  'Phase-correlation stack alignment',
  [datasetPort('alignedStack'), resultPort('drift', tableResultValueTypeId)],
  {
    referenceIndex: integer('Reference plane', 0, 0, 1_000_000),
    maximumShift: integer('Maximum shift', 32, 0, 2_048),
    minimumPeakRatio: number('Minimum peak ratio', 1.2, 1),
    edgePolicy: choice('Edge policy', ['pad', 'crop-overlap'] as const, 'crop-overlap'),
    fillValue: number('Pad fill', 0),
  },
  (source, value) => {
    const axes = selectedAxes(source, value)
    const stackAxis = source.axes.find(({ id }) => id === value['stackAxis'])
    if (stackAxis === undefined) throw new Error('Stack axis is unavailable.')
    const frameCount = Number(value['endIndex']) - Number(value['startIndex']) + 1
    const margin = value['edgePolicy'] === 'crop-overlap' ? Number(value['maximumShift']) : 0
    if (axes.horizontal.length <= 2 * margin || axes.vertical.length <= 2 * margin)
      throw new Error('Maximum shift leaves no deterministic crop area.')
    const outputAxes = [
      { ...axes.horizontal, length: axes.horizontal.length - 2 * margin },
      { ...axes.vertical, length: axes.vertical.length - 2 * margin },
      { ...stackAxis, length: frameCount },
    ]
    const output = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      sampleType: 'float32',
      axes: outputAxes,
      components: [{ id: 'value', kind: 'scalar' }],
      levels: [
        { level: 0, axisLengths: outputAxes.map(({ id, length }) => ({ axisId: id, length })) },
      ],
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'any-axis-pair' },
      },
    })
    return [scientificDatasetCharacteristics(output), resultCharacteristics(tableResultValueTypeId)]
  },
)

const surfaceCorrectionDescriptor = {
  id: MATERIALS_OPERATION_IDS.surfaceCorrect,
  version: 1,
  title: 'AFM/SPM surface correction',
  description: 'Subtract a mean, fitted plane, row median, or bounded polynomial background.',
  category: 'surface',
  tags: ['afm', 'spm', 'level', 'plane', 'background'],
  inputs: [datasetPort('dataset'), roiPort],
  outputs: [datasetPort('corrected')],
  parameters: objectSchema({
    correction: choice(
      'Correction',
      ['none', 'subtract-mean', 'first-order-plane', 'row-median', 'polynomial'] as const,
      'first-order-plane',
    ),
    polynomialDegree: choice('Polynomial degree', [0, 1, 2] as const, 1),
  }),
  execution: 'global-transform' as const,
  reproducibility: { class: 'tolerance-based' as const, absolute: 1e-9, relative: 1e-9 },
  builtIn: false,
}

export const surfaceCorrectionOperationDefinition = createOperationDefinition({
  descriptor: surfaceCorrectionDescriptor,
  inferOutputShapes(request) {
    try {
      return {
        valid: true,
        issues: [],
        value: [
          scientificDatasetCharacteristics(
            scalarPlaneDescriptor(
              descriptor(request.inputs[0]),
              parameters(request.parameters),
              'float32',
              undefined,
            ),
          ),
        ],
      }
    } catch (error) {
      return invalid(error)
    }
  },
})

const surfaceAnalysisDescriptor = {
  id: MATERIALS_OPERATION_IDS.surfaceAnalyze,
  version: 1,
  title: 'AFM/SPM surface analysis',
  description: 'Height histogram, roughness, profile, and shared-threshold grain mask.',
  category: 'surface',
  tags: ['afm', 'spm', 'roughness', 'ra', 'rq', 'rz', 'grain', 'profile'],
  inputs: [datasetPort('dataset'), roiPort],
  outputs: [
    resultPort('heightHistogram', histogramResultValueTypeId),
    resultPort('roughness', resultCollectionValueTypeId),
    resultPort('surfaceProfile', profileResultValueTypeId),
    datasetPort('grainMask'),
  ],
  parameters: objectSchema({
    histogramBins: integer('Height bins', 128, 2, 4_096),
    profileX0: number('Profile X start', 0, 0),
    profileY0: number('Profile Y start', 0, 0),
    profileX1: number('Profile X end', 1, 0),
    profileY1: number('Profile Y end', 1, 0),
    profileSamples: integer('Profile samples', 256, 2, 65_536),
    grainMethod: choice(
      'Grain threshold',
      ['manual', 'otsu', 'triangle', 'yen', 'li', 'mean'] as const,
      'otsu',
    ),
    grainPolarity: choice('Grain polarity', ['light', 'dark'] as const, 'light'),
    grainLower: number('Grain lower', 0),
    grainUpper: number('Grain upper', 1),
  }),
  execution: 'global-transform' as const,
  reproducibility: { class: 'tolerance-based' as const, absolute: 1e-9, relative: 1e-9 },
  builtIn: false,
}

export const surfaceAnalysisOperationDefinition = createOperationDefinition({
  descriptor: surfaceAnalysisDescriptor,
  inferOutputShapes(request) {
    try {
      const source = descriptor(request.inputs[0])
      const value = parameters(request.parameters)
      return {
        valid: true,
        issues: [],
        value: [
          resultCharacteristics(histogramResultValueTypeId),
          resultCharacteristics(resultCollectionValueTypeId),
          resultCharacteristics(profileResultValueTypeId),
          scientificDatasetCharacteristics(
            scalarPlaneDescriptor(source, value, 'uint8', undefined),
          ),
        ],
      }
    } catch (error) {
      return invalid(error)
    }
  },
})

export const advancedMaterialsOperationDefinitions: readonly OperationDefinition[] = Object.freeze([
  fftOperationDefinition,
  stackSumProjectionOperationDefinition,
  stackMontageOperationDefinition,
  stackStatisticsOperationDefinition,
  stackAlignmentOperationDefinition,
  surfaceCorrectionOperationDefinition,
  surfaceAnalysisOperationDefinition,
])
