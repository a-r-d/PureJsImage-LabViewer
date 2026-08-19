import type { ActionHandler, JsonValue } from '@pji-workbench/actions'
import type {
  AnalysisCatalog,
  AnalysisOverlayView,
  OpenedDatasetDescriptor,
  PlaneSelection,
  RpcJsonObject,
} from '@pji-workbench/contracts'
import {
  commandAction,
  executeOnlyAction,
  fixtureAction,
  rpcObject,
} from '@pji-workbench/workbench-core'
import type { WorkspaceSnapshot } from '@pji-workbench/workspace'

import type { CommandContext } from './actions.js'

export interface ScienceActionPorts {
  openSample(): Promise<void> | void
  requestLocalFiles(): void
  requestRemoteUrl(): void
  newProject(): void
  openProjectBrowser(): void
  saveProject(): Promise<void> | void
  exportProject(): void
  undo(): void
  redo(): void
  fitViewport(): void
  oneToOneViewport(): void
  openAgentPanel(): void
  previewThreshold(): void
  commitThreshold(): Promise<void> | void
  planConnectedComponents(): Promise<void> | void
  runConnectedComponents(): void
  toggleTheme(): void
  openPalette(): void
  cancelAnalysis(reason: string): void
  currentWorkspace(): WorkspaceSnapshot
  openedDataset(): OpenedDatasetDescriptor | undefined
  currentSelection(): PlaneSelection | undefined
  calibratedDataset(): OpenedDatasetDescriptor | undefined
  particleOverlayView(): AnalysisOverlayView
  analysisCatalog(): AnalysisCatalog | undefined
  resolveCatalogOperation(
    catalog: AnalysisCatalog | undefined,
    operationId: string,
    operationVersion: number,
  ): { readonly id: string; readonly version: number } | undefined
  executeAnalysisGraph(
    graph: WorkspaceSnapshot['analysis']['graph'],
    options: {
      readonly roi?: WorkspaceSnapshot['analysis']['roiSet']['rois'][number]
      readonly overlay?: string
      readonly overlayView?: AnalysisOverlayView
      readonly overlayTableOutput?: string
      readonly commit?: boolean
    },
  ): Promise<unknown>
  wholePlaneRoi(
    opened: OpenedDatasetDescriptor,
    selection: PlaneSelection,
  ): WorkspaceSnapshot['analysis']['roiSet']['rois'][number]
  runToolboxOperation(
    operation: { readonly id: string; readonly version: number },
    parameters: RpcJsonObject,
    mode: 'preview' | 'apply',
  ): Promise<void>
}

export function createScienceActionHandlers(
  ports: ScienceActionPorts,
): ReadonlyMap<string, ActionHandler<CommandContext>> {
  return new Map<string, ActionHandler<CommandContext>>([
    [
      'workspace.openSample@1',
      commandAction(async () => {
        await ports.openSample()
      }),
    ],
    ['source.open-local@1', commandAction(() => ports.requestLocalFiles())],
    ['source.open-remote@1', commandAction(() => ports.requestRemoteUrl())],
    [
      'workspace.summary.read@1',
      fixtureAction(() => ({
        id: 'workspace:generated-particles',
        title: 'Generated calibrated particles',
        revision: 1,
        sourceCount: 1,
        datasetCount: 1,
        roiCount: 1,
      })),
    ],
    [
      'source.list@1',
      fixtureAction(() => [
        { id: 'source:generated-particles', label: 'Generated particles', kind: 'generated' },
      ]),
    ],
    [
      'dataset.list@1',
      fixtureAction(() => [
        { id: 'dataset:particles', name: 'Calibrated particles', axes: ['y', 'x'] },
      ]),
    ],
    [
      'dataset.describe@1',
      fixtureAction(() => ({
        id: 'dataset:particles',
        name: 'Calibrated particles',
        shape: [512, 512],
        components: 1,
        calibration: { x: 2.5, y: 2.5, unit: 'nm', source: 'generated fixture' },
      })),
    ],
    [
      'roi.list@1',
      fixtureAction(() => [
        {
          id: 'roi:known-region',
          kind: 'rectangle',
          label: 'Known particles',
          bounds: { x: 32, y: 40, width: 224, height: 192 },
        },
      ]),
    ],
    [
      'roi.create@1',
      fixtureAction((input) => ({
        proposalId: 'proposal:roi-1',
        status: 'requires-approval',
        normalized: input,
      })),
    ],
    [
      'roi.update@1',
      fixtureAction((input) => ({
        proposalId: 'proposal:roi-update',
        status: 'requires-approval',
        normalized: input,
      })),
    ],
    [
      'analysis.catalog.read@1',
      fixtureAction(() => ({
        operations: [
          { id: 'threshold.manual', version: 1, title: 'Manual threshold' },
          { id: 'measure.statistics', version: 1, title: 'ROI statistics' },
        ],
      })),
    ],
    [
      'analysis.describe@1',
      fixtureAction(() => ({
        id: 'threshold.manual',
        version: 1,
        acceptedDatasets: ['scalar-2d'],
        deterministic: true,
      })),
    ],
    [
      'analysis.normalize@1',
      fixtureAction((input) => ({ normalized: input, operationVersion: 1 })),
    ],
    [
      'analysis.dry-run@1',
      fixtureAction((input) => ({
        planId: 'plan:threshold-1',
        normalized: input,
        estimatedPeakBytes: 1_048_576,
        estimatedTiles: 4,
        status: 'reviewed-fixture-plan',
      })),
    ],
    [
      'analysis.graph.request-execute@1',
      {
        execute: async (input, _context, signal) => {
          signal.throwIfAborted()
          const request = rpcObject(input)
          const graph = rpcObject(request?.['graph'])
          const roiId = request?.['roiId']
          const opened = ports.openedDataset()
          const selection = ports.currentSelection()
          if (
            graph === undefined ||
            (roiId !== undefined && typeof roiId !== 'string') ||
            opened === undefined ||
            selection === undefined
          )
            throw new Error('Analysis graph action input is invalid.')
          const workspace = ports.currentWorkspace()
          const roi =
            typeof roiId === 'string'
              ? workspace.analysis.roiSet.rois.find(({ id }) => id === roiId)
              : ports.wholePlaneRoi(ports.calibratedDataset() ?? opened, selection)
          if (roi === undefined) throw new Error('The recipe ROI is no longer available.')
          await ports.executeAnalysisGraph(
            graph as unknown as WorkspaceSnapshot['analysis']['graph'],
            {
              roi,
              overlay: 'labels',
              overlayView: ports.particleOverlayView(),
              overlayTableOutput: 'objects',
              commit: true,
            },
          )
          return { status: 'completed' }
        },
      },
    ],
    [
      'analysis.request-execute@1',
      {
        execute: async (input, _context, signal) => {
          signal.throwIfAborted()
          const request = rpcObject(input)
          const operationId = request?.['operationId']
          const operationVersion = request?.['operationVersion']
          const parameters = rpcObject(request?.['parameters'])
          const mode = request?.['mode']
          if (
            typeof operationId !== 'string' ||
            typeof operationVersion !== 'number' ||
            parameters === undefined ||
            (mode !== 'preview' && mode !== 'apply')
          ) {
            throw new Error('Analysis action input is invalid.')
          }
          const operation = ports.resolveCatalogOperation(
            ports.analysisCatalog(),
            operationId,
            operationVersion,
          )
          if (operation === undefined) {
            throw new Error('Analysis operation is unavailable.')
          }
          await ports.runToolboxOperation(operation, parameters, mode)
          return {
            operationId,
            operationVersion,
            mode,
            status: mode === 'preview' ? 'previewed' : 'applied',
          }
        },
      },
    ],
    [
      'analysis.batch.request-execute@1',
      fixtureAction((input) => ({
        proposalId: 'proposal:batch',
        status: 'requires-approval',
        bounded: true,
        request: input,
      })),
    ],
    [
      'analysis.cancel@1',
      executeOnlyAction(() => {
        ports.cancelAnalysis('Cancelled by semantic action.')
        return { status: 'cancel-requested' }
      }),
    ],
    [
      'result.summary.read@1',
      fixtureAction(() => ({ resultId: 'result:fixture', rowCount: 12, bounded: true })),
    ],
    [
      'result.page.read@1',
      fixtureAction(() => ({ resultId: 'result:fixture', offset: 0, rows: [] })),
    ],
    [
      'pipeline.read@1',
      fixtureAction(() => ports.currentWorkspace().analysis.graph as unknown as JsonValue),
    ],
    [
      'result.export.propose@1',
      fixtureAction((input) => ({
        proposalId: 'proposal:result-export',
        status: 'requires-approval',
        format: 'csv',
        request: input,
      })),
    ],
    [
      'viewport.state.read@1',
      fixtureAction(() => ({ center: [256, 256], zoom: 1, datasetId: 'dataset:particles' })),
    ],
    [
      'viewport.state.propose@1',
      fixtureAction((input) => ({ proposalId: 'proposal:viewport-1', state: input })),
    ],
    [
      'panel.select@1',
      fixtureAction((input) => ({ proposalId: 'proposal:panel-1', panel: input })),
    ],
    ['workspace.new@1', commandAction(() => ports.newProject())],
    ['workspace.openProject@1', commandAction(() => ports.openProjectBrowser())],
    ['workspace.save@1', commandAction(ports.saveProject)],
    ['workspace.export@1', commandAction(() => ports.exportProject())],
    ['workspace.undo@1', commandAction(() => ports.undo())],
    ['workspace.redo@1', commandAction(() => ports.redo())],
    ['viewport.fit@1', commandAction(() => ports.fitViewport())],
    ['viewport.oneToOne@1', commandAction(() => ports.oneToOneViewport())],
    ['panel.agent@1', commandAction(() => ports.openAgentPanel())],
    ['analysis.threshold.preview@1', commandAction(() => ports.previewThreshold())],
    ['analysis.threshold.commit@1', commandAction(ports.commitThreshold)],
    ['analysis.connected-components.plan@1', commandAction(ports.planConnectedComponents)],
    ['analysis.connected-components.execute@1', commandAction(ports.runConnectedComponents)],
    ['theme.toggle@1', commandAction(() => ports.toggleTheme())],
    ['palette.open@1', commandAction(() => ports.openPalette())],
  ])
}
