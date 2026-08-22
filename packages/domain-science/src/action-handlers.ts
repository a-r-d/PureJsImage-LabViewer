import type { ActionAbortSignal, ActionHandler, JsonValue } from '@pji-workbench/actions'
import type {
  AnalysisCatalog,
  AnalysisOverlayView,
  OpenedDatasetDescriptor,
  PlaneSelection,
  RpcJsonObject,
} from '@pji-workbench/contracts'
import { commandAction, executeOnlyAction, rpcObject } from '@pji-workbench/workbench-core'
import type { WorkspaceSnapshot } from '@pji-workbench/workspace'

import type { CommandContext } from './actions.js'

function symmetricAction<Context>(
  execute: (input: JsonValue) => JsonValue | Promise<JsonValue>,
): ActionHandler<Context> {
  return { dryRun: execute, execute }
}

export interface ScienceActionPorts {
  openSample(): Promise<void> | void
  requestLocalFiles(): void
  requestRemoteUrl(): void
  requestOmeZarrRemoteUrl(): void
  requestOmeZarrDirectory(): void
  requestOmeZarrZip(): void
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
      readonly signal?: ActionAbortSignal
      readonly throwOnError?: boolean
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
    signal?: ActionAbortSignal,
  ): Promise<void>
  workspaceSummary(): JsonValue
  sourceList(): JsonValue
  datasetList(): JsonValue
  datasetDescription(input: JsonValue): JsonValue
  roiList(): JsonValue
  analysisCatalogSummary(input: JsonValue): JsonValue
  analysisDescription(input: JsonValue): JsonValue
  resultSummary(): JsonValue
  resultPage(input: JsonValue, signal: ActionAbortSignal): Promise<JsonValue>
  viewportState(): JsonValue
  particleSettings(): JsonValue
  planParticleAnalysis(input: JsonValue, signal: ActionAbortSignal): Promise<JsonValue>
  executeParticleAnalysis(input: JsonValue, signal: ActionAbortSignal): Promise<JsonValue>
  particleQuality(): JsonValue
  runNamedAnalysis(
    kind:
      | 'roi-statistics'
      | 'histogram'
      | 'line-profile'
      | 'fft'
      | 'surface-level'
      | 'stack-align'
      | 'result-compare',
    signal: ActionAbortSignal,
  ): Promise<JsonValue>
  createModelPreview(input: JsonValue, signal: ActionAbortSignal): Promise<JsonValue>
  omeZarrStoreDescription(): JsonValue
  omeZarrDatasetList(): JsonValue
  omeZarrDatasetDescription(input: JsonValue): JsonValue
  omeZarrStorageDescription(): JsonValue
  omeZarrNetworkDescription(): JsonValue
  displayChannels(): JsonValue
  setDisplayChannels(input: JsonValue): JsonValue
  selectDataset(input: JsonValue): JsonValue
  selectPlane(input: JsonValue): JsonValue
  normalizeAnalysis(input: JsonValue, signal: ActionAbortSignal): Promise<JsonValue>
  dryRunAnalysis(input: JsonValue, signal: ActionAbortSignal): Promise<JsonValue>
  selectRoi(input: JsonValue): JsonValue
  removeRoi(input: JsonValue): JsonValue
  removePipelineNode(input: JsonValue): JsonValue
  selectPanel(input: JsonValue): JsonValue
  createRoi(input: JsonValue, signal: ActionAbortSignal): Promise<JsonValue>
  updateRoi(input: JsonValue, signal: ActionAbortSignal): Promise<JsonValue>
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
    ['source.open-ome-zarr-remote@1', commandAction(() => ports.requestOmeZarrRemoteUrl())],
    [
      'source.open-ome-zarr-local-resource@1',
      {
        execute: (input) => {
          const kind =
            typeof input === 'object' &&
            input !== null &&
            'kind' in input &&
            input['kind'] === 'zip'
              ? 'zip'
              : 'directory'
          if (kind === 'zip') ports.requestOmeZarrZip()
          else ports.requestOmeZarrDirectory()
          return null
        },
      },
    ],
    ['ome-zarr.store.describe@1', symmetricAction(() => ports.omeZarrStoreDescription())],
    ['ome-zarr.dataset.list@1', symmetricAction(() => ports.omeZarrDatasetList())],
    [
      'ome-zarr.dataset.describe@1',
      symmetricAction((input) => ports.omeZarrDatasetDescription(input)),
    ],
    ['ome-zarr.storage.describe@1', symmetricAction(() => ports.omeZarrStorageDescription())],
    ['ome-zarr.network.describe@1', symmetricAction(() => ports.omeZarrNetworkDescription())],
    ['dataset.select@1', executeOnlyAction((input) => ports.selectDataset(input))],
    ['plane.select@1', executeOnlyAction((input) => ports.selectPlane(input))],
    ['display.channels.read@1', symmetricAction(() => ports.displayChannels())],
    ['display.channels.set@1', executeOnlyAction((input) => ports.setDisplayChannels(input))],
    ['workspace.summary.read@1', symmetricAction(() => ports.workspaceSummary())],
    ['source.list@1', symmetricAction(() => ports.sourceList())],
    ['dataset.list@1', symmetricAction(() => ports.datasetList())],
    ['dataset.describe@1', symmetricAction((input) => ports.datasetDescription(input))],
    ['roi.list@1', symmetricAction(() => ports.roiList())],
    [
      'roi.create@1',
      {
        execute: (input, _context, signal) => ports.createRoi(input, signal),
      },
    ],
    [
      'roi.update@1',
      {
        execute: (input, _context, signal) => ports.updateRoi(input, signal),
      },
    ],
    ['analysis.catalog.read@1', symmetricAction((input) => ports.analysisCatalogSummary(input))],
    ['analysis.describe@1', symmetricAction((input) => ports.analysisDescription(input))],
    [
      'analysis.normalize@1',
      {
        execute: (input, _context, signal) => ports.normalizeAnalysis(input, signal),
      },
    ],
    [
      'analysis.dry-run@1',
      {
        execute: (input, _context, signal) => ports.dryRunAnalysis(input, signal),
      },
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
              commit: true,
              signal,
              throwOnError: true,
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
          await ports.runToolboxOperation(operation, parameters, mode, signal)
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
      symmetricAction((input) => ({
        proposalId: 'proposal:batch',
        status: 'requires-approval',
        bounded: true,
        request: input,
      })),
    ],
    ['analysis.particle.settings.read@1', symmetricAction(() => ports.particleSettings())],
    [
      'analysis.particle.plan@1',
      {
        execute: (input, _context, signal) => ports.planParticleAnalysis(input, signal),
      },
    ],
    [
      'analysis.particle.execute@1',
      {
        execute: (input, _context, signal) => ports.executeParticleAnalysis(input, signal),
      },
    ],
    ['analysis.particle.quality.read@1', symmetricAction(() => ports.particleQuality())],
    [
      'analysis.roi.statistics.read@1',
      {
        execute: (_input, _context, signal) => ports.runNamedAnalysis('roi-statistics', signal),
      },
    ],
    [
      'analysis.histogram.read@1',
      {
        execute: (_input, _context, signal) => ports.runNamedAnalysis('histogram', signal),
      },
    ],
    [
      'analysis.line-profile.read@1',
      {
        execute: (_input, _context, signal) => ports.runNamedAnalysis('line-profile', signal),
      },
    ],
    [
      'analysis.fft.read@1',
      {
        execute: (_input, _context, signal) => ports.runNamedAnalysis('fft', signal),
      },
    ],
    [
      'analysis.surface.level.execute@1',
      {
        execute: (_input, _context, signal) => ports.runNamedAnalysis('surface-level', signal),
      },
    ],
    [
      'analysis.stack.align.execute@1',
      {
        execute: (_input, _context, signal) => ports.runNamedAnalysis('stack-align', signal),
      },
    ],
    [
      'analysis.result.compare.read@1',
      {
        execute: (_input, _context, signal) => ports.runNamedAnalysis('result-compare', signal),
      },
    ],
    [
      'analysis.cancel@1',
      executeOnlyAction(() => {
        ports.cancelAnalysis('Cancelled by semantic action.')
        return { status: 'cancel-requested' }
      }),
    ],
    ['result.summary.read@1', symmetricAction(() => ports.resultSummary())],
    [
      'result.page.read@1',
      {
        execute: (input, _context, signal) => ports.resultPage(input, signal),
      },
    ],
    [
      'pipeline.read@1',
      symmetricAction(() => ports.currentWorkspace().analysis.graph as unknown as JsonValue),
    ],
    ['pipeline.node.remove@1', executeOnlyAction((input) => ports.removePipelineNode(input))],
    [
      'result.export.propose@1',
      symmetricAction((input) => ({
        proposalId: 'proposal:result-export',
        status: 'requires-approval',
        format: 'csv',
        request: input,
      })),
    ],
    ['viewport.state.read@1', symmetricAction(() => ports.viewportState())],
    [
      'viewport.preview.create@1',
      {
        execute: (input, _context, signal) => ports.createModelPreview(input, signal),
      },
    ],
    [
      'viewport.state.propose@1',
      symmetricAction((input) => ({ proposalId: 'proposal:viewport-1', state: input })),
    ],
    ['panel.select@1', executeOnlyAction((input) => ports.selectPanel(input))],
    ['roi.select@1', executeOnlyAction((input) => ports.selectRoi(input))],
    ['roi.remove@1', executeOnlyAction((input) => ports.removeRoi(input))],
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
