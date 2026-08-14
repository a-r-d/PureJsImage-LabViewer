import type { PlaneSelection, RpcJsonObject } from '@pji-workbench/contracts'
import type { WorkspaceSnapshot } from '@pji-workbench/workspace'

export const ANALYSIS_OPERATIONS = Object.freeze({
  threshold: 'purejsimage.analysis.threshold',
  connectedComponents: 'purejsimage.analysis.connected-components',
  statistics: 'purejsimage.analysis.statistics',
  histogram: 'purejsimage.analysis.histogram',
  lineProfile: 'purejsimage.analysis.line-profile',
})

type AnalysisGraph = WorkspaceSnapshot['analysis']['graph']

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
