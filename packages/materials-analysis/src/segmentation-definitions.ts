import {
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
} from 'purejsimage/analysis'
import {
  histogramResultValueTypeId,
  profileResultValueTypeId,
  resultCollectionValueTypeId,
  scalarResultValueTypeId,
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

function parameterObject(value: OperationJsonValue): OperationJsonObject {
  if (!isRecord(value)) throw new Error('Segmentation parameters must be an object.')
  return value as OperationJsonObject
}

function descriptorFromCharacteristics(value: unknown): NormalizedScientificDatasetDescriptor {
  if (!isRecord(value) || value['kind'] !== 'scientific-dataset')
    throw new Error('A scientific dataset is required.')
  return normalizeScientificDatasetDescriptor(value['descriptor'])
}

function outputDescriptor(
  input: unknown,
  sampleType: 'uint8' | 'uint32' | 'float32',
): NormalizedScientificDatasetDescriptor {
  const source = descriptorFromCharacteristics(input)
  const { noDataValue: _noDataValue, ...rest } = source
  return normalizeScientificDatasetDescriptor({
    ...rest,
    sampleType,
    components: [
      {
        id: sampleType === 'uint8' ? 'mask' : sampleType === 'uint32' ? 'label' : 'value',
        kind: 'scalar',
      },
    ],
  })
}

function assertParticleInputs(inputs: readonly unknown[]): NormalizedScientificDatasetDescriptor {
  const labels = descriptorFromCharacteristics(inputs[0])
  const source = descriptorFromCharacteristics(inputs[1])
  if (
    labels.axes.length !== source.axes.length ||
    labels.axes.some((axis, index) => {
      const candidate = source.axes[index]
      return candidate?.id !== axis.id || candidate.length !== axis.length
    })
  )
    throw new Error('Particle labels and intensity source must have identical axes and lengths.')
  return labels
}

function invalid(error: unknown) {
  return {
    valid: false as const,
    issues: [
      {
        code: 'invalid-value' as const,
        path: '',
        message: error instanceof Error ? error.message : 'Segmentation operation is invalid.',
      },
    ],
  }
}

const thresholdDescriptor = {
  id: MATERIALS_OPERATION_IDS.thresholdReference,
  version: 1,
  title: 'Reference threshold methods',
  description:
    'Manual, global reference, and adaptive Sauvola thresholding inside an explicit ROI.',
  category: 'segmentation',
  tags: ['scientific', 'threshold', 'otsu', 'triangle', 'yen', 'li', 'mean', 'sauvola'],
  inputs: [datasetPort('dataset'), roiPort],
  outputs: [
    datasetPort('mask'),
    resultPort('histogram', histogramResultValueTypeId),
    resultPort('foregroundFraction', scalarResultValueTypeId),
    resultPort('resolvedThreshold', scalarResultValueTypeId),
  ],
  parameters: objectSchema({
    method: choice(
      'Method',
      ['manual', 'otsu', 'triangle', 'yen', 'li', 'mean', 'sauvola'] as const,
      'otsu',
    ),
    polarity: choice('Foreground', ['light', 'dark'] as const, 'light'),
    lower: number('Manual lower', 0),
    upper: number('Manual upper', 255),
    histogramBins: integer('Histogram bins', 256, 16, 4_096),
    windowRadius: integer('Sauvola window radius', 15, 1, 128),
    sauvolaK: number('Sauvola k', 0.2, -1, 1),
    dynamicRange: number('Sauvola dynamic range', 128, 0.000001),
    noDataPolicy: choice(
      'No-data handling',
      ['background', 'foreground', 'propagate'] as const,
      'background',
    ),
  }),
  execution: 'global-transform' as const,
  reproducibility: { class: 'tolerance-based' as const, absolute: 1e-9, relative: 1e-9 },
  builtIn: false,
}

const thresholdBase = createOperationDefinition({
  descriptor: thresholdDescriptor,
  inferOutputShapes(request) {
    try {
      const descriptor = outputDescriptor(request.inputs[0], 'float32')
      const parameters = parameterObject(request.parameters)
      return {
        valid: true,
        issues: [],
        value: [
          scientificDatasetCharacteristics(descriptor),
          {
            kind: 'analysis-result',
            valueType: histogramResultValueTypeId,
            bins: parameters['histogramBins'] ?? 256,
          },
          { kind: 'analysis-result', valueType: scalarResultValueTypeId },
          { kind: 'analysis-result', valueType: scalarResultValueTypeId },
        ],
      }
    } catch (error) {
      return invalid(error)
    }
  },
})

export const thresholdOperationDefinition: OperationDefinition = {
  ...thresholdBase,
  normalizeParameters(input, limits) {
    const normalized = validateOperationParameters(thresholdDescriptor, input, limits)
    if (!normalized.valid || normalized.value === undefined) return normalized
    const value = parameterObject(normalized.value)
    if (Number(value['upper']) < Number(value['lower']))
      return invalid(new Error('Manual threshold upper must be greater than or equal to lower.'))
    return normalized
  },
}

const morphologySpecs = [
  [MATERIALS_OPERATION_IDS.binaryErode, 'Binary erode', 'erode'],
  [MATERIALS_OPERATION_IDS.binaryDilate, 'Binary dilate', 'dilate'],
  [MATERIALS_OPERATION_IDS.binaryOpen, 'Binary open', 'open'],
  [MATERIALS_OPERATION_IDS.binaryClose, 'Binary close', 'close'],
  [MATERIALS_OPERATION_IDS.binaryFillHoles, 'Fill binary holes', 'fill-holes'],
  [MATERIALS_OPERATION_IDS.binaryClearBorder, 'Clear border objects', 'clear-border'],
  [MATERIALS_OPERATION_IDS.binaryRemoveSmall, 'Remove small objects', 'remove-small-objects'],
  [MATERIALS_OPERATION_IDS.binaryOutline, 'Binary outline', 'outline'],
] as const

function morphologyDefinition(
  id: (typeof morphologySpecs)[number][0],
  title: string,
  kind: (typeof morphologySpecs)[number][2],
): OperationDefinition {
  const descriptor = {
    id,
    version: 1,
    title,
    description: `${title} using deterministic binary foreground semantics.`,
    category: 'segmentation',
    tags: ['scientific', 'binary', 'morphology', kind],
    inputs: [datasetPort('dataset')],
    outputs: [datasetPort('dataset')],
    parameters: objectSchema({
      radius: integer('Disk radius', 1, 1, 64),
      minimumSize: integer('Minimum object pixels', 16, 1, 16_777_216),
      connectivity: choice('Connectivity', [4, 8] as const, 8),
    }),
    execution: 'global-transform' as const,
    reproducibility: { class: 'bit-exact' as const },
    builtIn: false,
  }
  return createOperationDefinition({
    descriptor,
    inferOutputShapes(request) {
      try {
        return {
          valid: true,
          issues: [],
          value: [scientificDatasetCharacteristics(outputDescriptor(request.inputs[0], 'uint8'))],
        }
      } catch (error) {
        return invalid(error)
      }
    },
  })
}

export const morphologyOperationDefinitions: readonly OperationDefinition[] = Object.freeze(
  morphologySpecs.map(([id, title, kind]) => morphologyDefinition(id, title, kind)),
)

const distanceDescriptor = {
  id: MATERIALS_OPERATION_IDS.distanceTransform,
  version: 1,
  title: 'Euclidean distance transform',
  description: 'Compute exact foreground distance to the nearest background sample.',
  category: 'segmentation',
  tags: ['scientific', 'binary', 'distance', 'euclidean'],
  inputs: [datasetPort('dataset')],
  outputs: [datasetPort('distance')],
  parameters: objectSchema({}),
  execution: 'global-transform' as const,
  reproducibility: { class: 'tolerance-based' as const, absolute: 1e-9, relative: 1e-9 },
  builtIn: false,
}

export const distanceTransformOperationDefinition = createOperationDefinition({
  descriptor: distanceDescriptor,
  inferOutputShapes(request) {
    try {
      return {
        valid: true,
        issues: [],
        value: [scientificDatasetCharacteristics(outputDescriptor(request.inputs[0], 'float32'))],
      }
    } catch (error) {
      return invalid(error)
    }
  },
})

const watershedDescriptor = {
  id: MATERIALS_OPERATION_IDS.watershed,
  version: 1,
  title: 'Watershed touching particles',
  description: 'Separate touching binary objects by deterministic distance-surface flooding.',
  category: 'segmentation',
  tags: ['scientific', 'binary', 'watershed', 'touching particles'],
  inputs: [datasetPort('dataset')],
  outputs: [datasetPort('dataset')],
  parameters: objectSchema({
    minimumPeakDistance: integer('Minimum peak distance', 3, 1, 1_024),
  }),
  execution: 'global-transform' as const,
  reproducibility: { class: 'bit-exact' as const },
  builtIn: false,
}

export const watershedOperationDefinition = createOperationDefinition({
  descriptor: watershedDescriptor,
  inferOutputShapes(request) {
    try {
      return {
        valid: true,
        issues: [],
        value: [scientificDatasetCharacteristics(outputDescriptor(request.inputs[0], 'uint8'))],
      }
    } catch (error) {
      return invalid(error)
    }
  },
})

const particleDescriptor = {
  id: MATERIALS_OPERATION_IDS.particleAnalysis,
  version: 1,
  title: 'Particle filtering and measurements',
  description: 'Filter connected labels and measure calibrated shape and source intensity.',
  category: 'particles',
  tags: ['scientific', 'particles', 'measurements', 'solidity', 'intensity'],
  inputs: [datasetPort('labels'), datasetPort('source'), roiPort],
  outputs: [
    datasetPort('filteredLabels'),
    resultPort('objects', tableResultValueTypeId),
    resultPort('summary', resultCollectionValueTypeId),
    resultPort('distribution', profileResultValueTypeId),
  ],
  parameters: objectSchema({
    sourceComponent: integer('Intensity component', 0, 0, 63),
    edgePolicy: choice('Edge objects', ['include', 'exclude'] as const, 'exclude'),
    minimumArea: number('Minimum area', 0, 0),
    maximumArea: number('Maximum area', 1_000_000_000, 0),
    minimumCircularity: number('Minimum circularity', 0, 0, 1),
    maximumCircularity: number('Maximum circularity', 1, 0, 1),
    minimumAspectRatio: number('Minimum aspect ratio', 1, 1),
    maximumAspectRatio: number('Maximum aspect ratio', 1_000_000, 1),
    minimumSolidity: number('Minimum solidity', 0, 0, 1),
    maximumSolidity: number('Maximum solidity', 1, 0, 1),
  }),
  execution: 'global-transform' as const,
  reproducibility: { class: 'tolerance-based' as const, absolute: 1e-9, relative: 1e-9 },
  builtIn: false,
}

const particleBase = createOperationDefinition({
  descriptor: particleDescriptor,
  inferOutputShapes(request) {
    try {
      assertParticleInputs(request.inputs)
      const descriptor = outputDescriptor(request.inputs[0], 'uint32')
      return {
        valid: true,
        issues: [],
        value: [
          scientificDatasetCharacteristics(descriptor),
          { kind: 'analysis-result', valueType: tableResultValueTypeId },
          { kind: 'analysis-result', valueType: resultCollectionValueTypeId },
          { kind: 'analysis-result', valueType: profileResultValueTypeId },
        ],
      }
    } catch (error) {
      return invalid(error)
    }
  },
})

export const particleAnalysisOperationDefinition: OperationDefinition = {
  ...particleBase,
  normalizeParameters(input, limits) {
    const normalized = validateOperationParameters(particleDescriptor, input, limits)
    if (!normalized.valid || normalized.value === undefined) return normalized
    const value = parameterObject(normalized.value)
    for (const [minimum, maximum] of [
      ['minimumArea', 'maximumArea'],
      ['minimumCircularity', 'maximumCircularity'],
      ['minimumAspectRatio', 'maximumAspectRatio'],
      ['minimumSolidity', 'maximumSolidity'],
    ] as const)
      if (Number(value[maximum]) < Number(value[minimum]))
        return invalid(new Error(`${maximum} must be greater than or equal to ${minimum}.`))
    return normalized
  },
}

export const segmentationOperationDefinitions: readonly OperationDefinition[] = Object.freeze([
  thresholdOperationDefinition,
  ...morphologyOperationDefinitions,
  distanceTransformOperationDefinition,
  watershedOperationDefinition,
  particleAnalysisOperationDefinition,
])
