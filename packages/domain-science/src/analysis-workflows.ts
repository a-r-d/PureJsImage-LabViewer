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
  preferredOutput?: string,
): AnalysisGraph {
  if (base.nodes.length === 0) return measurement
  const baseOutput =
    (preferredOutput === undefined
      ? undefined
      : base.outputs.find(({ name }) => name === preferredOutput)) ?? base.outputs[0]
  if (baseOutput === undefined)
    throw new Error('The current analysis graph has no dataset output to measure.')
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

export interface FftWorkflowOptions {
  readonly selection: PlaneSelection
  readonly component: number
  readonly roi: Readonly<{ x: number; y: number; width: number; height: number }>
  readonly spectrumDisplay: 'raw' | 'log1p'
  readonly radialBins: number
  readonly azimuthalBins: number
  readonly azimuthalMinimumRadius: number
  readonly azimuthalMaximumRadius: number
  readonly peakThreshold: number
  readonly minimumPeakDistance: number
  readonly maximumPeaks: number
  readonly maskKind: 'none' | 'bandpass' | 'notch'
  readonly minimumRadius: number
  readonly maximumRadius: number
  readonly notchX: number
  readonly notchY: number
  readonly notchRadius: number
}

export function fftWorkflowGraph(options: FftWorkflowOptions): AnalysisGraph {
  const nodeId = 'materials-fft-workspace'
  return {
    schemaVersion: 1,
    inputs: [SOURCE_INPUT, ROI_INPUT],
    nodes: [
      {
        id: nodeId,
        label: '2D FFT workspace',
        operation: { id: MATERIALS_OPERATION_IDS.fft2d, version: 1 },
        inputs: [sourcePort(), roiPort()],
        parameters: {
          ...planeParameters(options.selection, options.component),
          roiX: Math.floor(options.roi.x),
          roiY: Math.floor(options.roi.y),
          roiWidth: Math.floor(options.roi.width),
          roiHeight: Math.floor(options.roi.height),
          spectrumDisplay: options.spectrumDisplay,
          radialBins: options.radialBins,
          azimuthalBins: options.azimuthalBins,
          azimuthalMinimumRadius: options.azimuthalMinimumRadius,
          azimuthalMaximumRadius: options.azimuthalMaximumRadius,
          peakThreshold: options.peakThreshold,
          minimumPeakDistance: options.minimumPeakDistance,
          maximumPeaks: options.maximumPeaks,
          maskKind: options.maskKind,
          minimumRadius: options.minimumRadius,
          maximumRadius: options.maximumRadius,
          notchX: options.notchX,
          notchY: options.notchY,
          notchRadius: options.notchRadius,
        },
      },
    ],
    outputs: [
      { name: 'magnitude', source: { kind: 'node', nodeId, output: 'magnitude' } },
      { name: 'power', source: { kind: 'node', nodeId, output: 'power' } },
      { name: 'frequencyMask', source: { kind: 'node', nodeId, output: 'frequencyMask' } },
      { name: 'radialProfile', source: { kind: 'node', nodeId, output: 'radialProfile' } },
      { name: 'azimuthalProfile', source: { kind: 'node', nodeId, output: 'azimuthalProfile' } },
      { name: 'peaks', source: { kind: 'node', nodeId, output: 'peaks' } },
      { name: 'frequencySummary', source: { kind: 'node', nodeId, output: 'frequencySummary' } },
    ],
  }
}

export interface StackWorkflowOptions {
  readonly selection: PlaneSelection
  readonly component: number
  readonly stackAxis: string
  readonly startIndex: number
  readonly endIndex: number
  readonly mode: 'min' | 'max' | 'mean' | 'sum' | 'montage' | 'statistics' | 'align'
  readonly columns: number
  readonly referenceIndex: number
  readonly maximumShift: number
  readonly minimumPeakRatio: number
  readonly edgePolicy: 'pad' | 'crop-overlap'
  readonly fillValue: number
}

export function stackAxesForSelection<T extends { readonly id: string; readonly length: number }>(
  axes: readonly T[],
  displayAxes: readonly string[],
): readonly T[] {
  return axes.filter(({ id, length }) => !displayAxes.includes(id) && length > 1)
}

export function stackAxisForSelection<T extends { readonly id: string; readonly length: number }>(
  axes: readonly T[],
  displayAxes: readonly string[],
): T | undefined {
  return stackAxesForSelection(axes, displayAxes)[0]
}

export function stackWorkflowGraph(options: StackWorkflowOptions): AnalysisGraph {
  const nodeId = `materials-stack-${options.mode}`
  const builtInProjection =
    options.mode === 'min' || options.mode === 'max' || options.mode === 'mean'
  const operationId = builtInProjection
    ? 'purejsimage.analysis.projection'
    : options.mode === 'sum'
      ? MATERIALS_OPERATION_IDS.stackSumProjection
      : options.mode === 'montage'
        ? MATERIALS_OPERATION_IDS.stackMontage
        : options.mode === 'statistics'
          ? MATERIALS_OPERATION_IDS.stackStatistics
          : MATERIALS_OPERATION_IDS.stackAlignment
  const parameters: RpcJsonObject = builtInProjection
    ? {
        displayAxes: [...options.selection.displayAxes],
        fixedIndices: options.selection.fixedIndices
          .filter(({ axisId }) => axisId !== options.stackAxis)
          .map(({ axisId, index }) => ({ axisId, index })),
        reductionAxis: options.stackAxis,
        mode: options.mode,
        invalidPolicy: 'ignore',
        outputSampleType: 'float32',
      }
    : {
        ...planeParameters(options.selection, options.component),
        stackAxis: options.stackAxis,
        startIndex: options.startIndex,
        endIndex: options.endIndex,
        ...(options.mode === 'montage' ? { columns: options.columns } : {}),
        ...(options.mode === 'align'
          ? {
              referenceIndex: options.referenceIndex,
              maximumShift: options.maximumShift,
              minimumPeakRatio: options.minimumPeakRatio,
              edgePolicy: options.edgePolicy,
              fillValue: options.fillValue,
            }
          : {}),
      }
  const outputNames =
    builtInProjection || options.mode === 'sum'
      ? [builtInProjection ? 'dataset' : 'projection']
      : options.mode === 'montage'
        ? ['montage']
        : options.mode === 'statistics'
          ? ['statistics']
          : ['alignedStack', 'drift']
  return {
    schemaVersion: 1,
    inputs: [SOURCE_INPUT],
    nodes: [
      {
        id: nodeId,
        label: builtInProjection ? `${options.mode} projection` : `Stack ${options.mode}`,
        operation: { id: operationId, version: 1 },
        inputs: [sourcePort()],
        parameters,
      },
    ],
    outputs: outputNames.map((name) => ({
      name,
      source: { kind: 'node' as const, nodeId, output: name },
    })),
  }
}

export interface SurfaceWorkflowOptions {
  readonly selection: PlaneSelection
  readonly component: number
  readonly correction: 'none' | 'subtract-mean' | 'first-order-plane' | 'row-median' | 'polynomial'
  readonly polynomialDegree: 0 | 1 | 2
  readonly histogramBins: number
  readonly profileX0: number
  readonly profileY0: number
  readonly profileX1: number
  readonly profileY1: number
  readonly profileSamples: number
  readonly grainMethod: 'manual' | 'otsu' | 'triangle' | 'yen' | 'li' | 'mean'
  readonly grainPolarity: 'light' | 'dark'
  readonly grainLower: number
  readonly grainUpper: number
}

export function surfaceWorkflowGraph(options: SurfaceWorkflowOptions): AnalysisGraph {
  const correctionNode = 'materials-surface-correction'
  const analysisNode = 'materials-surface-analysis'
  return {
    schemaVersion: 1,
    inputs: [SOURCE_INPUT, ROI_INPUT],
    nodes: [
      {
        id: correctionNode,
        label: `Surface correction: ${options.correction}`,
        operation: { id: MATERIALS_OPERATION_IDS.surfaceCorrect, version: 1 },
        inputs: [sourcePort(), roiPort()],
        parameters: {
          ...planeParameters(options.selection, options.component),
          correction: options.correction,
          polynomialDegree: options.polynomialDegree,
        },
      },
      {
        id: analysisNode,
        label: 'Surface roughness, profile, and grains',
        operation: { id: MATERIALS_OPERATION_IDS.surfaceAnalyze, version: 1 },
        inputs: [
          {
            port: 'dataset',
            source: { kind: 'node', nodeId: correctionNode, output: 'corrected' },
          },
          roiPort(),
        ],
        parameters: {
          ...planeParameters(options.selection, 0),
          histogramBins: options.histogramBins,
          profileX0: options.profileX0,
          profileY0: options.profileY0,
          profileX1: options.profileX1,
          profileY1: options.profileY1,
          profileSamples: options.profileSamples,
          grainMethod: options.grainMethod,
          grainPolarity: options.grainPolarity,
          grainLower: options.grainLower,
          grainUpper: options.grainUpper,
        },
      },
    ],
    outputs: [
      { name: 'corrected', source: { kind: 'node', nodeId: correctionNode, output: 'corrected' } },
      {
        name: 'heightHistogram',
        source: { kind: 'node', nodeId: analysisNode, output: 'heightHistogram' },
      },
      { name: 'roughness', source: { kind: 'node', nodeId: analysisNode, output: 'roughness' } },
      {
        name: 'surfaceProfile',
        source: { kind: 'node', nodeId: analysisNode, output: 'surfaceProfile' },
      },
      { name: 'grainMask', source: { kind: 'node', nodeId: analysisNode, output: 'grainMask' } },
    ],
  }
}
