import {
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
} from 'purejsimage/analysis'
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
  type ScientificAxisCoordinates,
} from 'purejsimage/scientific'

import { MATERIALS_OPERATION_IDS, type MaterialsOperationId } from './catalog.js'

const datasetPort = (name: string) => ({
  name,
  valueType: { id: scientificDatasetValueTypeId, version: 1 },
})

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

const number = (title: string, defaultValue?: number, minimum?: number, maximum?: number) => ({
  type: 'number' as const,
  title,
  finiteOnly: true,
  ...(defaultValue === undefined ? {} : { default: defaultValue }),
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

const boundaryProperties = {
  boundary: choice('Boundary', ['clamp', 'mirror', 'constant'] as const, 'mirror'),
  constantValue: number('Constant fill', 0),
  invalidPolicy: choice('No-data handling', ['propagate', 'ignore'] as const, 'propagate'),
}

const selectionProperties = { displayAxes: axisSchema, fixedIndices: fixedIndicesSchema }

const objectSchema = (
  properties: Readonly<Record<string, ParameterSchema>>,
  required: readonly string[] = ['displayAxes', 'fixedIndices'],
) => ({
  type: 'object' as const,
  properties: { ...selectionProperties, ...properties },
  required,
  closed: true,
})

interface DefinitionSpec {
  readonly id: MaterialsOperationId
  readonly title: string
  readonly description: string
  readonly category: 'geometry' | 'numeric' | 'filters'
  readonly tags: readonly string[]
  readonly parameters: ReturnType<typeof objectSchema>
  readonly execution: 'tile-local' | 'neighborhood' | 'dataset-transform'
  readonly outputDescriptor?: (
    descriptor: NormalizedScientificDatasetDescriptor,
    parameters: OperationJsonObject,
  ) => NormalizedScientificDatasetDescriptor
  readonly secondInput?: boolean
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function descriptorFromCharacteristics(value: unknown): NormalizedScientificDatasetDescriptor {
  if (!isRecord(value) || value['kind'] !== 'scientific-dataset')
    throw new Error('Scientific dataset characteristics are required.')
  return normalizeScientificDatasetDescriptor(value['descriptor'])
}

function parametersRecord(value: OperationJsonValue): OperationJsonObject {
  if (!isRecord(value)) throw new Error('Operation parameters must be an object.')
  return value as OperationJsonObject
}

function selectedAxes(
  descriptor: NormalizedScientificDatasetDescriptor,
  parameters: OperationJsonObject,
) {
  const displayAxes = parameters['displayAxes']
  if (!Array.isArray(displayAxes) || displayAxes.length !== 2)
    throw new Error('Two display axes are required.')
  const horizontal = descriptor.axes.find(({ id }) => id === displayAxes[0])
  const vertical = descriptor.axes.find(({ id }) => id === displayAxes[1])
  if (horizontal === undefined || vertical === undefined || horizontal.id === vertical.id)
    throw new Error('Display axes are invalid for this dataset.')
  return { displayAxes, horizontal, vertical }
}

function reversedCoordinates(
  coordinates: ScientificAxisCoordinates,
  length: number,
): ScientificAxisCoordinates {
  if (coordinates.type === 'linear')
    return {
      type: 'linear',
      origin: coordinates.origin + (length - 1) * coordinates.step,
      step: -coordinates.step,
    }
  if (coordinates.type === 'labels')
    return { type: 'labels', values: [...coordinates.values].reverse() }
  if (coordinates.type === 'lookup')
    return { type: 'lookup', values: [...coordinates.values].reverse() }
  return coordinates
}

function rotateDescriptor(
  descriptor: NormalizedScientificDatasetDescriptor,
  parameters: OperationJsonObject,
): NormalizedScientificDatasetDescriptor {
  const degrees = parameters['degrees']
  if (degrees !== 90 && degrees !== 180 && degrees !== 270)
    throw new Error('Rotation must be 90, 180, or 270 degrees.')
  const { horizontal, vertical } = selectedAxes(descriptor, parameters)
  const axes =
    degrees === 180
      ? descriptor.axes.map((axis) =>
          axis.id === horizontal.id || axis.id === vertical.id
            ? { ...axis, coordinates: reversedCoordinates(axis.coordinates, axis.length) }
            : axis,
        )
      : descriptor.axes.map((axis) =>
          axis.id === horizontal.id
            ? {
                ...axis,
                length: vertical.length,
                unit: vertical.unit,
                coordinates:
                  degrees === 90
                    ? reversedCoordinates(vertical.coordinates, vertical.length)
                    : vertical.coordinates,
              }
            : axis.id === vertical.id
              ? {
                  ...axis,
                  length: horizontal.length,
                  unit: horizontal.unit,
                  coordinates:
                    degrees === 270
                      ? reversedCoordinates(horizontal.coordinates, horizontal.length)
                      : horizontal.coordinates,
                }
              : axis,
        )
  return normalizeScientificDatasetDescriptor({
    ...descriptor,
    axes,
    levels: [
      {
        level: 0,
        axisLengths: axes.map(({ id, length }) => ({ axisId: id, length })),
      },
    ],
    capabilities: { ...descriptor.capabilities, resolutionLevels: false },
  })
}

function flipDescriptor(
  descriptor: NormalizedScientificDatasetDescriptor,
  parameters: OperationJsonObject,
): NormalizedScientificDatasetDescriptor {
  const direction = parameters['direction']
  if (direction !== 'horizontal' && direction !== 'vertical')
    throw new Error('Flip direction is invalid.')
  const { horizontal, vertical } = selectedAxes(descriptor, parameters)
  const flipped = direction === 'horizontal' ? horizontal.id : vertical.id
  const axes = descriptor.axes.map((axis) =>
    axis.id === flipped
      ? { ...axis, coordinates: reversedCoordinates(axis.coordinates, axis.length) }
      : axis,
  )
  return normalizeScientificDatasetDescriptor({
    ...descriptor,
    axes,
    levels: [
      {
        level: 0,
        axisLengths: axes.map(({ id, length }) => ({ axisId: id, length })),
      },
    ],
    capabilities: { ...descriptor.capabilities, resolutionLevels: false },
  })
}

function convertedDescriptor(
  descriptor: NormalizedScientificDatasetDescriptor,
  parameters: OperationJsonObject,
): NormalizedScientificDatasetDescriptor {
  const sampleType = parameters['sampleType']
  if (!['uint8', 'uint16', 'int16', 'float32', 'float64'].includes(String(sampleType)))
    throw new Error('Unsupported conversion sample type.')
  return normalizeScientificDatasetDescriptor({ ...descriptor, sampleType })
}

function floatingDescriptor(
  descriptor: NormalizedScientificDatasetDescriptor,
): NormalizedScientificDatasetDescriptor {
  const { noDataValue: _noDataValue, ...withoutNoData } = descriptor
  return normalizeScientificDatasetDescriptor({ ...withoutNoData, sampleType: 'float32' })
}

const specs: readonly DefinitionSpec[] = [
  {
    id: MATERIALS_OPERATION_IDS.rotateRightAngle,
    title: 'Rotate right angle',
    description: 'Rotate the selected scientific plane clockwise without interpolation.',
    category: 'geometry',
    tags: ['rotate', '90', '180', '270'],
    parameters: objectSchema({ degrees: choice('Clockwise degrees', [90, 180, 270] as const, 90) }),
    execution: 'dataset-transform',
    outputDescriptor: rotateDescriptor,
  },
  {
    id: MATERIALS_OPERATION_IDS.flip,
    title: 'Flip plane',
    description: 'Flip the selected plane horizontally or vertically.',
    category: 'geometry',
    tags: ['flip', 'mirror', 'horizontal', 'vertical'],
    parameters: objectSchema({
      direction: choice('Direction', ['horizontal', 'vertical'] as const, 'horizontal'),
    }),
    execution: 'dataset-transform',
    outputDescriptor: flipDescriptor,
  },
  {
    id: MATERIALS_OPERATION_IDS.translate,
    title: 'Translate plane',
    description: 'Translate pixels by integer X/Y offsets with explicit fill.',
    category: 'geometry',
    tags: ['translate', 'shift', 'registration'],
    parameters: objectSchema({
      offsetX: integer('X offset', 0, -1_000_000, 1_000_000),
      offsetY: integer('Y offset', 0, -1_000_000, 1_000_000),
      constantValue: number('Outside fill', 0),
    }),
    execution: 'dataset-transform',
  },
  {
    id: MATERIALS_OPERATION_IDS.convert,
    title: 'Convert numeric type',
    description: 'Convert numeric storage with explicit clipping or input-range scaling.',
    category: 'numeric',
    tags: ['convert', 'sample type', 'clip', 'scale'],
    parameters: objectSchema({
      sampleType: choice(
        'Output sample type',
        ['uint8', 'uint16', 'int16', 'float32', 'float64'] as const,
        'float32',
      ),
      mode: choice('Conversion policy', ['clip', 'scale'] as const, 'clip'),
      inputMinimum: number('Scale input minimum', 0),
      inputMaximum: number('Scale input maximum', 255),
    }),
    execution: 'tile-local',
    outputDescriptor: convertedDescriptor,
  },
  {
    id: MATERIALS_OPERATION_IDS.normalize,
    title: 'Normalize range',
    description: 'Linearly map one finite interval to another.',
    category: 'numeric',
    tags: ['normalize', 'range', 'contrast'],
    parameters: objectSchema({
      inputMinimum: number('Input minimum', 0),
      inputMaximum: number('Input maximum', 255),
      outputMinimum: number('Output minimum', 0),
      outputMaximum: number('Output maximum', 1),
      clip: { type: 'boolean', title: 'Clip outside input range', default: true },
    }),
    execution: 'tile-local',
  },
  {
    id: MATERIALS_OPERATION_IDS.clamp,
    title: 'Clamp',
    description: 'Clamp finite values to an inclusive interval.',
    category: 'numeric',
    tags: ['clamp', 'range'],
    parameters: objectSchema({ minimum: number('Minimum', 0), maximum: number('Maximum', 255) }),
    execution: 'tile-local',
  },
  {
    id: MATERIALS_OPERATION_IDS.invert,
    title: 'Invert data',
    description: 'Invert quantitative values around an explicit interval.',
    category: 'numeric',
    tags: ['invert', 'negative'],
    parameters: objectSchema({ minimum: number('Minimum', 0), maximum: number('Maximum', 255) }),
    execution: 'tile-local',
  },
  {
    id: MATERIALS_OPERATION_IDS.gamma,
    title: 'Gamma transform',
    description: 'Apply a normalized power-law transform.',
    category: 'numeric',
    tags: ['gamma', 'power'],
    parameters: objectSchema({
      gamma: number('Gamma', 1, 0.000001, 100),
      minimum: number('Range minimum', 0),
      maximum: number('Range maximum', 255),
    }),
    execution: 'tile-local',
  },
  {
    id: MATERIALS_OPERATION_IDS.log,
    title: 'Log transform',
    description: 'Apply natural or base-10 logarithm.',
    category: 'numeric',
    tags: ['log', 'logarithm'],
    parameters: objectSchema({
      base: choice('Base', ['natural', '10'] as const, 'natural'),
      nonPositive: choice('Non-positive values', ['nan', 'clamp'] as const, 'nan'),
      epsilon: number('Clamp epsilon', 0.000001, 0.000000000001),
    }),
    execution: 'tile-local',
  },
  {
    id: MATERIALS_OPERATION_IDS.squareRoot,
    title: 'Square-root transform',
    description: 'Apply square root with explicit negative handling.',
    category: 'numeric',
    tags: ['sqrt', 'square root'],
    parameters: objectSchema({
      negative: choice('Negative values', ['nan', 'clamp'] as const, 'nan'),
    }),
    execution: 'tile-local',
  },
  ...(
    [
      [MATERIALS_OPERATION_IDS.addConstant, 'Add constant', 'Add a finite constant.', 'add'],
      [
        MATERIALS_OPERATION_IDS.subtractConstant,
        'Subtract constant',
        'Subtract a finite constant.',
        'subtract',
      ],
      [
        MATERIALS_OPERATION_IDS.multiplyConstant,
        'Multiply constant',
        'Multiply by a finite constant.',
        'multiply',
      ],
      [
        MATERIALS_OPERATION_IDS.divideConstant,
        'Divide constant',
        'Divide by a non-zero finite constant.',
        'divide',
      ],
    ] as const
  ).map(([id, title, description, tag]) => ({
    id,
    title,
    description,
    category: 'numeric' as const,
    tags: [tag, 'constant'],
    parameters: objectSchema({
      value: number('Constant', tag === 'multiply' || tag === 'divide' ? 1 : 0),
    }),
    execution: 'tile-local' as const,
  })),
  {
    id: MATERIALS_OPERATION_IDS.imageCalculator,
    title: 'Image calculator',
    description: 'Combine two compatible datasets pixel-by-pixel.',
    category: 'numeric',
    tags: ['calculator', 'arithmetic', 'two images'],
    parameters: objectSchema({
      operator: choice('Operator', ['add', 'subtract', 'multiply', 'divide'] as const, 'add'),
    }),
    execution: 'tile-local',
    secondInput: true,
  },
  {
    id: MATERIALS_OPERATION_IDS.box,
    title: 'Mean / box filter',
    description: 'Average an odd square neighborhood.',
    category: 'filters',
    tags: ['mean', 'box', 'blur'],
    parameters: objectSchema({ radius: integer('Radius', 1, 1, 64), ...boundaryProperties }),
    execution: 'neighborhood',
  },
  ...(
    [
      [MATERIALS_OPERATION_IDS.median, 'Median filter', 'median'],
      [MATERIALS_OPERATION_IDS.minimum, 'Minimum filter', 'minimum'],
      [MATERIALS_OPERATION_IDS.maximum, 'Maximum filter', 'maximum'],
    ] as const
  ).map(([id, title, tag]) => ({
    id,
    title,
    description: `${title} over an odd square neighborhood.`,
    category: 'filters' as const,
    tags: [tag, 'rank'],
    parameters: objectSchema({ radius: integer('Radius', 1, 1, 16), ...boundaryProperties }),
    execution: 'neighborhood' as const,
  })),
  {
    id: MATERIALS_OPERATION_IDS.convolution,
    title: 'Convolution kernel',
    description: 'Apply a bounded odd square convolution kernel.',
    category: 'filters',
    tags: ['kernel', 'convolution', 'custom'],
    parameters: objectSchema({
      kernelWidth: choice('Kernel width', [1, 3, 5, 7, 9] as const, 3),
      kernel: {
        type: 'array',
        title: 'Kernel coefficients',
        items: { type: 'number', finiteOnly: true },
        minItems: 1,
        maxItems: 81,
        default: [0, -1, 0, -1, 5, -1, 0, -1, 0],
      },
      ...boundaryProperties,
    }),
    execution: 'neighborhood',
  },
  {
    id: MATERIALS_OPERATION_IDS.unsharp,
    title: 'Unsharp mask',
    description: 'Subtract a Gaussian background and add scaled detail.',
    category: 'filters',
    tags: ['sharpen', 'unsharp'],
    parameters: objectSchema({
      sigma: number('Sigma', 1.25, 0.01, 16),
      amount: number('Amount', 0.8, 0, 8),
      invalidPolicy: boundaryProperties.invalidPolicy,
    }),
    execution: 'neighborhood',
  },
  {
    id: MATERIALS_OPERATION_IDS.gradient,
    title: 'Sobel / Scharr gradient',
    description: 'Compute X, Y, or magnitude gradient.',
    category: 'filters',
    tags: ['sobel', 'scharr', 'gradient', 'edge'],
    parameters: objectSchema({
      operator: choice('Operator', ['sobel', 'scharr'] as const, 'sobel'),
      output: choice('Output', ['magnitude', 'x', 'y'] as const, 'magnitude'),
    }),
    execution: 'neighborhood',
  },
  {
    id: MATERIALS_OPERATION_IDS.laplacian,
    title: 'Laplacian',
    description: 'Apply a discrete Laplacian edge kernel.',
    category: 'filters',
    tags: ['laplacian', 'edge'],
    parameters: objectSchema({ neighborhood: choice('Neighborhood', [4, 8] as const, 4) }),
    execution: 'neighborhood',
  },
  {
    id: MATERIALS_OPERATION_IDS.outlier,
    title: 'Outlier / despeckle filter',
    description: 'Replace samples that differ from the local median.',
    category: 'filters',
    tags: ['outlier', 'despeckle', 'median'],
    parameters: objectSchema({
      radius: integer('Radius', 1, 1, 16),
      threshold: number('Difference threshold', 10, 0),
    }),
    execution: 'neighborhood',
  },
  {
    id: MATERIALS_OPERATION_IDS.background,
    title: 'Local background subtraction',
    description: 'Subtract a bounded local mean background.',
    category: 'filters',
    tags: ['background', 'subtract', 'correction'],
    parameters: objectSchema({
      radius: integer('Background radius', 16, 1, 64),
      offset: number('Output offset', 0),
      invalidPolicy: boundaryProperties.invalidPolicy,
    }),
    execution: 'neighborhood',
  },
]

function createDefinition(spec: DefinitionSpec): OperationDefinition {
  const descriptor = {
    id: spec.id,
    version: 1,
    title: spec.title,
    description: spec.description,
    category: spec.category,
    tags: ['scientific', ...spec.tags],
    inputs: spec.secondInput
      ? [datasetPort('left'), datasetPort('right')]
      : [datasetPort('dataset')],
    outputs: [datasetPort('dataset')],
    parameters: spec.parameters,
    execution: spec.execution,
    reproducibility: { class: 'tolerance-based' as const, absolute: 0.000001, relative: 0.000001 },
    builtIn: false,
  }
  const base = createOperationDefinition({
    descriptor,
    inferOutputShapes(request) {
      try {
        const source = descriptorFromCharacteristics(request.inputs[0])
        const parameters = parametersRecord(request.parameters)
        const output =
          spec.outputDescriptor?.(source, parameters) ??
          (spec.category === 'numeric' || spec.category === 'filters'
            ? floatingDescriptor(source)
            : source)
        return { valid: true, issues: [], value: [scientificDatasetCharacteristics(output)] }
      } catch (error) {
        return {
          valid: false,
          issues: [
            {
              code: 'invalid-value',
              path: '',
              message: error instanceof Error ? error.message : 'Unable to infer output.',
            },
          ],
        }
      }
    },
  })
  return {
    ...base,
    normalizeParameters(input, limits) {
      const normalized = validateOperationParameters(descriptor, input, limits)
      if (!normalized.valid || normalized.value === undefined) return normalized
      const value = parametersRecord(normalized.value)
      if (
        (spec.id === MATERIALS_OPERATION_IDS.divideConstant && value['value'] === 0) ||
        ((spec.id === MATERIALS_OPERATION_IDS.normalize ||
          spec.id === MATERIALS_OPERATION_IDS.gamma ||
          spec.id === MATERIALS_OPERATION_IDS.convert) &&
          Number(value['inputMaximum'] ?? value['maximum']) <=
            Number(value['inputMinimum'] ?? value['minimum'])) ||
        (spec.id === MATERIALS_OPERATION_IDS.clamp &&
          Number(value['maximum']) < Number(value['minimum'])) ||
        (spec.id === MATERIALS_OPERATION_IDS.invert &&
          Number(value['maximum']) <= Number(value['minimum'])) ||
        (spec.id === MATERIALS_OPERATION_IDS.convolution &&
          Array.isArray(value['kernel']) &&
          value['kernel'].length !== Number(value['kernelWidth']) ** 2)
      )
        return {
          valid: false,
          issues: [
            {
              code: 'invalid-value',
              path: '',
              message: 'Operation parameter relationship is invalid.',
            },
          ],
        }
      return normalized
    },
  }
}

export const materialsOperationDefinitions: readonly OperationDefinition[] = Object.freeze(
  specs.map(createDefinition),
)

export const materialsOperationDescriptors = Object.freeze(
  materialsOperationDefinitions.map(({ descriptor }) => descriptor),
)
