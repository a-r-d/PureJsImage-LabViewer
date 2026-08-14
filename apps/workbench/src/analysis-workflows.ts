import type { PlaneSelection, RpcJsonObject } from '@pji-workbench/contracts'
import { MATERIALS_OPERATION_IDS } from '@pji-workbench/materials-analysis'
import type { WorkspaceSnapshot } from '@pji-workbench/workspace'

export const ANALYSIS_OPERATIONS = Object.freeze({
  threshold: 'purejsimage.analysis.threshold',
  connectedComponents: 'purejsimage.analysis.connected-components',
  statistics: 'purejsimage.analysis.statistics',
  histogram: 'purejsimage.analysis.histogram',
  lineProfile: 'purejsimage.analysis.line-profile',
})

type AnalysisGraph = WorkspaceSnapshot['analysis']['graph']

export interface ParticleAnalysisGraphOptions {
  readonly selection: PlaneSelection
  readonly component: number
  readonly thresholdMethod: 'manual' | 'otsu' | 'triangle' | 'yen' | 'li' | 'mean' | 'sauvola'
  readonly polarity: 'light' | 'dark'
  readonly lower: number
  readonly upper: number
  readonly histogramBins: number
  readonly windowRadius: number
  readonly sauvolaK: number
  readonly dynamicRange: number
  readonly noDataPolicy: 'background' | 'foreground' | 'propagate'
  readonly backgroundRadius: number
  readonly openRadius: number
  readonly closeRadius: number
  readonly fillHoles: boolean
  readonly clearBorder: boolean
  readonly minimumObjectPixels: number
  readonly watershed: boolean
  readonly minimumPeakDistance: number
  readonly connectivity: 4 | 8
  readonly edgePolicy: 'include' | 'exclude'
  readonly minimumArea: number
  readonly maximumArea: number
  readonly minimumCircularity: number
  readonly maximumCircularity: number
  readonly minimumAspectRatio: number
  readonly maximumAspectRatio: number
  readonly minimumSolidity: number
  readonly maximumSolidity: number
}

const SOURCE_INPUT = Object.freeze({
  name: 'source',
  valueType: { id: 'purejsimage.scientific.dataset', version: 1 },
})

const ROI_INPUT = Object.freeze({
  name: 'selection',
  valueType: { id: 'purejsimage.roi', version: 1 },
})

const sourcePort = (port = 'dataset') =>
  Object.freeze({ port, source: { kind: 'input' as const, input: 'source' } })

const roiPort = () =>
  Object.freeze({ port: 'roi', source: { kind: 'input' as const, input: 'selection' } })

const planeParameters = (selection: PlaneSelection, component: number) => ({
  displayAxes: [...selection.displayAxes],
  fixedIndices: selection.fixedIndices.map(({ axisId, index }) => ({ axisId, index })),
  component,
})

export function particleThresholdGraph(options: ParticleAnalysisGraphOptions): AnalysisGraph {
  const nodes: AnalysisGraph['nodes'][number][] = []
  let datasetSource: AnalysisGraph['nodes'][number]['inputs'][number]['source'] = {
    kind: 'input',
    input: 'source',
  }
  if (options.backgroundRadius > 0) {
    nodes.push({
      id: 'particle-background',
      label: 'Correct uneven background',
      operation: { id: MATERIALS_OPERATION_IDS.background, version: 1 },
      inputs: [{ port: 'dataset', source: datasetSource }],
      parameters: {
        ...planeParameters(options.selection, options.component),
        radius: options.backgroundRadius,
        offset: 0,
        invalidPolicy: 'ignore',
      },
    })
    datasetSource = { kind: 'node', nodeId: 'particle-background', output: 'dataset' }
  }
  nodes.push({
    id: 'particle-threshold',
    label: `${options.thresholdMethod} threshold`,
    operation: { id: MATERIALS_OPERATION_IDS.thresholdReference, version: 1 },
    inputs: [{ port: 'dataset', source: datasetSource }, roiPort()],
    parameters: {
      ...planeParameters(options.selection, options.component),
      method: options.thresholdMethod,
      polarity: options.polarity,
      lower: options.lower,
      upper: options.upper,
      histogramBins: options.histogramBins,
      windowRadius: options.windowRadius,
      sauvolaK: options.sauvolaK,
      dynamicRange: options.dynamicRange,
      noDataPolicy: options.noDataPolicy,
    },
  })
  return {
    schemaVersion: 1,
    inputs: [SOURCE_INPUT, ROI_INPUT],
    nodes,
    outputs: [
      {
        name: 'mask',
        source: { kind: 'node', nodeId: 'particle-threshold', output: 'mask' },
      },
      {
        name: 'thresholdHistogram',
        source: { kind: 'node', nodeId: 'particle-threshold', output: 'histogram' },
      },
      {
        name: 'foregroundFraction',
        source: { kind: 'node', nodeId: 'particle-threshold', output: 'foregroundFraction' },
      },
      {
        name: 'resolvedThreshold',
        source: { kind: 'node', nodeId: 'particle-threshold', output: 'resolvedThreshold' },
      },
    ],
  }
}

export function particleAnalysisGraph(options: ParticleAnalysisGraphOptions): AnalysisGraph {
  const threshold = particleThresholdGraph(options)
  const nodes = [...threshold.nodes]
  let maskSource: AnalysisGraph['nodes'][number]['inputs'][number]['source'] = {
    kind: 'node',
    nodeId: 'particle-threshold',
    output: 'mask',
  }
  const addBinaryNode = (
    id: string,
    label: string,
    operationId: string,
    parameters: RpcJsonObject,
  ): void => {
    nodes.push({
      id,
      label,
      operation: { id: operationId, version: 1 },
      inputs: [{ port: 'dataset', source: maskSource }],
      parameters: { ...planeParameters(options.selection, 0), ...parameters },
    })
    maskSource = { kind: 'node', nodeId: id, output: 'dataset' }
  }
  if (options.openRadius > 0)
    addBinaryNode('particle-open', 'Binary open', MATERIALS_OPERATION_IDS.binaryOpen, {
      radius: options.openRadius,
      minimumSize: 1,
      connectivity: options.connectivity,
    })
  if (options.closeRadius > 0)
    addBinaryNode('particle-close', 'Binary close', MATERIALS_OPERATION_IDS.binaryClose, {
      radius: options.closeRadius,
      minimumSize: 1,
      connectivity: options.connectivity,
    })
  if (options.fillHoles)
    addBinaryNode('particle-fill-holes', 'Fill holes', MATERIALS_OPERATION_IDS.binaryFillHoles, {
      radius: 1,
      minimumSize: 1,
      connectivity: options.connectivity,
    })
  if (options.clearBorder)
    addBinaryNode(
      'particle-clear-border',
      'Clear border objects',
      MATERIALS_OPERATION_IDS.binaryClearBorder,
      { radius: 1, minimumSize: 1, connectivity: options.connectivity },
    )
  if (options.minimumObjectPixels > 1)
    addBinaryNode(
      'particle-remove-small',
      'Remove small objects',
      MATERIALS_OPERATION_IDS.binaryRemoveSmall,
      { radius: 1, minimumSize: options.minimumObjectPixels, connectivity: options.connectivity },
    )
  if (options.watershed)
    addBinaryNode(
      'particle-watershed',
      'Separate touching particles',
      MATERIALS_OPERATION_IDS.watershed,
      {
        minimumPeakDistance: options.minimumPeakDistance,
      },
    )
  nodes.push({
    id: 'particle-components',
    label: 'Connected components',
    operation: { id: ANALYSIS_OPERATIONS.connectedComponents, version: 1 },
    inputs: [{ port: 'dataset', source: maskSource }],
    parameters: { ...planeParameters(options.selection, 0), connectivity: options.connectivity },
  })
  nodes.push({
    id: 'particle-measurements',
    label: 'Filter and measure particles',
    operation: { id: MATERIALS_OPERATION_IDS.particleAnalysis, version: 1 },
    inputs: [
      {
        port: 'labels',
        source: { kind: 'node', nodeId: 'particle-components', output: 'labels' },
      },
      { port: 'source', source: { kind: 'input', input: 'source' } },
      { port: 'roi', source: { kind: 'input', input: 'selection' } },
    ],
    parameters: {
      ...planeParameters(options.selection, 0),
      sourceComponent: options.component,
      edgePolicy: options.edgePolicy,
      minimumArea: options.minimumArea,
      maximumArea: options.maximumArea,
      minimumCircularity: options.minimumCircularity,
      maximumCircularity: options.maximumCircularity,
      minimumAspectRatio: options.minimumAspectRatio,
      maximumAspectRatio: options.maximumAspectRatio,
      minimumSolidity: options.minimumSolidity,
      maximumSolidity: options.maximumSolidity,
    },
  })
  return {
    schemaVersion: 1,
    inputs: threshold.inputs,
    nodes,
    outputs: [
      { name: 'mask', source: maskSource },
      {
        name: 'labels',
        source: { kind: 'node', nodeId: 'particle-measurements', output: 'filteredLabels' },
      },
      {
        name: 'objects',
        source: { kind: 'node', nodeId: 'particle-measurements', output: 'objects' },
      },
      {
        name: 'particleSummary',
        source: { kind: 'node', nodeId: 'particle-measurements', output: 'summary' },
      },
      {
        name: 'sizeDistribution',
        source: { kind: 'node', nodeId: 'particle-measurements', output: 'distribution' },
      },
    ],
  }
}

export function thresholdGraph(options: {
  readonly component: number
  readonly threshold: number
  readonly mode: 'greater-than' | 'greater-than-or-equal' | 'less-than' | 'less-than-or-equal'
}): AnalysisGraph {
  return {
    schemaVersion: 1,
    inputs: [SOURCE_INPUT],
    nodes: [
      {
        id: 'threshold',
        label: 'Threshold',
        operation: { id: ANALYSIS_OPERATIONS.threshold, version: 1 },
        inputs: [sourcePort()],
        parameters: {
          mode: options.mode,
          component: options.component,
          threshold: options.threshold,
        },
      },
    ],
    outputs: [
      {
        name: 'mask',
        source: { kind: 'node', nodeId: 'threshold', output: 'dataset' },
      },
    ],
  }
}

export function connectedComponentsGraph(options: {
  readonly component: number
  readonly threshold: number
  readonly mode: 'greater-than' | 'greater-than-or-equal' | 'less-than' | 'less-than-or-equal'
  readonly selection: PlaneSelection
  readonly connectivity: 4 | 8
}): AnalysisGraph {
  const graph = thresholdGraph(options)
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: 'connected-components',
        label: 'Connected components',
        operation: { id: ANALYSIS_OPERATIONS.connectedComponents, version: 1 },
        inputs: [
          {
            port: 'dataset',
            source: { kind: 'node', nodeId: 'threshold', output: 'dataset' },
          },
        ],
        parameters: {
          displayAxes: [...options.selection.displayAxes],
          fixedIndices: options.selection.fixedIndices.map(({ axisId, index }) => ({
            axisId,
            index,
          })),
          component: 0,
          connectivity: options.connectivity,
        },
      },
    ],
    outputs: [
      { name: 'mask', source: { kind: 'node', nodeId: 'threshold', output: 'dataset' } },
      {
        name: 'labels',
        source: { kind: 'node', nodeId: 'connected-components', output: 'labels' },
      },
      {
        name: 'objects',
        source: { kind: 'node', nodeId: 'connected-components', output: 'objects' },
      },
    ],
  }
}

function roiGraph(
  operation: string,
  output: string,
  selection: PlaneSelection,
  component: number,
  parameters: RpcJsonObject,
): AnalysisGraph {
  return {
    schemaVersion: 1,
    inputs: [SOURCE_INPUT, ROI_INPUT],
    nodes: [
      {
        id: output,
        label: output === 'profile' ? 'Line profile' : `ROI ${output}`,
        operation: { id: operation, version: 1 },
        inputs: [sourcePort(), roiPort()],
        parameters: {
          displayAxes: [...selection.displayAxes],
          fixedIndices: selection.fixedIndices.map(({ axisId, index }) => ({ axisId, index })),
          component,
          ...parameters,
        },
      },
    ],
    outputs: [{ name: output, source: { kind: 'node', nodeId: output, output } }],
  }
}

export function statisticsGraph(selection: PlaneSelection, component: number): AnalysisGraph {
  return roiGraph(ANALYSIS_OPERATIONS.statistics, 'statistics', selection, component, {
    percentiles: [5, 25, 50, 75, 95],
    percentileMaxSamples: 65_536,
    emptyPolicy: 'error',
  })
}

export function histogramGraph(selection: PlaneSelection, component: number): AnalysisGraph {
  return roiGraph(ANALYSIS_OPERATIONS.histogram, 'histogram', selection, component, { bins: 64 })
}

export function lineProfileGraph(selection: PlaneSelection, component: number): AnalysisGraph {
  return roiGraph(ANALYSIS_OPERATIONS.lineProfile, 'profile', selection, component, {
    components: [component],
    interpolation: 'bilinear',
    spacing: 1,
    spacingSpace: 'pixel',
    maxSamples: 65_536,
    outside: 'nan',
    invalidPolicy: 'nan',
  })
}

export function appendDatasetAnalysisGraph(
  base: AnalysisGraph,
  measurement: AnalysisGraph,
): AnalysisGraph {
  if (base.nodes.length === 0) return measurement
  const baseOutput = base.outputs[0]
  if (base.outputs.length !== 1 || baseOutput === undefined)
    throw new Error('The current analysis graph must have one dataset output.')
  const sourceInput = measurement.inputs.find(({ name }) => name === SOURCE_INPUT.name)
  if (sourceInput === undefined) throw new Error('The measurement graph has no dataset input.')
  const measurementNodeIds = new Set(measurement.nodes.map(({ id }) => id))
  if (base.nodes.some(({ id }) => measurementNodeIds.has(id)))
    throw new Error('The analysis graphs contain conflicting node IDs.')
  return {
    schemaVersion: 1,
    inputs: [
      ...base.inputs,
      ...measurement.inputs.filter(
        ({ name }) =>
          name !== SOURCE_INPUT.name && !base.inputs.some((input) => input.name === name),
      ),
    ],
    nodes: [
      ...base.nodes,
      ...measurement.nodes.map((node) => ({
        ...node,
        inputs: node.inputs.map((input) =>
          input.source.kind === 'input' && input.source.input === sourceInput.name
            ? { ...input, source: baseOutput.source }
            : input,
        ),
      })),
    ],
    outputs: [baseOutput, ...measurement.outputs],
  }
}

export function toolboxOperationGraph(options: {
  readonly operation: Readonly<{
    id: string
    version: number
    title: string
    inputs: readonly RpcJsonObject[]
    outputs: readonly RpcJsonObject[]
    parameters: RpcJsonObject
  }>
  readonly parameters: RpcJsonObject
  readonly selection: PlaneSelection
  readonly baseGraph?: AnalysisGraph
}): AnalysisGraph {
  if (options.operation.inputs.length !== 1)
    throw new Error('The operation requires a second dataset binding.')
  const inputName = options.operation.inputs[0]?.['name']
  const outputName = options.operation.outputs[0]?.['name']
  if (typeof inputName !== 'string' || typeof outputName !== 'string')
    throw new Error('The operation descriptor has no usable dataset port.')
  const properties = options.operation.parameters['properties']
  const injectSelection =
    typeof properties === 'object' && properties !== null && !Array.isArray(properties)
  const base = options.baseGraph
  const appendBase =
    base !== undefined && base.nodes.length > 0 && base.outputs.length === 1 ? base : undefined
  const nodeId = `toolbox-${options.operation.id.replace(/[^a-z0-9-]/giu, '-')}-${appendBase?.nodes.length ?? 0}`
  return {
    schemaVersion: 1,
    inputs: appendBase?.inputs ?? [SOURCE_INPUT],
    nodes: [
      ...(appendBase?.nodes ?? []),
      {
        id: nodeId,
        label: options.operation.title,
        operation: { id: options.operation.id, version: options.operation.version },
        inputs: [
          {
            port: inputName,
            source: appendBase?.outputs[0]?.source ?? sourcePort().source,
          },
        ],
        parameters: {
          ...options.parameters,
          ...(injectSelection && 'displayAxes' in properties
            ? { displayAxes: [...options.selection.displayAxes] }
            : {}),
          ...(injectSelection && 'fixedIndices' in properties
            ? {
                fixedIndices: options.selection.fixedIndices.map(({ axisId, index }) => ({
                  axisId,
                  index,
                })),
              }
            : {}),
        },
      },
    ],
    outputs: [
      {
        name: outputName,
        source: { kind: 'node', nodeId, output: outputName },
      },
    ],
  }
}
