import {
  type ActionAbortSignal,
  type ActionHandler,
  type JsonValue,
  WorkbenchActionHost,
} from '@pji-workbench/actions'
import type {
  AnalysisCatalog,
  AnalysisDryRunResponse,
  AnalysisExecutionResponse,
  AnalysisOverlayView,
  AnalysisResultHandleId,
  AnalysisSeriesExport,
  AnalysisTableFilter,
  AnalysisTablePage,
  AnalysisTableSort,
  DisplayMapping,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  PlaneSelection,
  RenderTile,
  RpcJsonObject,
} from '@pji-workbench/contracts'
import {
  createImagingWorkerClient,
  ImagingRpcError,
  type ImagingWorkerClient,
  SUPPORTED_FILE_ACCEPT,
} from '@pji-workbench/imaging'
import { type BatchRecipeRow, runBatchRecipe } from '@pji-workbench/materials-analysis'
import {
  type AnalysisScriptDocumentV1,
  normalizeStudioDocument,
  type RecipeDocumentV1,
  recipeContentIntegrity,
  validateRecipeDocument,
} from '@pji-workbench/plugin-sdk'
import { generateScriptApi, type ScriptActionInvoker } from '@pji-workbench/scripts'
import {
  type ExampleScenarioV1,
  type ExampleWorkflowV1,
  resolveExampleFixture,
} from '@pji-workbench/test-corpus'
import {
  Button,
  CommandPalette,
  Icon,
  IconButton,
  type PaletteCommand,
  Panel,
  Splitter,
  StatusItem,
  Tabs,
  type ThemeName,
  ThemeRoot,
  Toolbar,
  TreeRow,
} from '@pji-workbench/ui'
import {
  type CalibrationOverride,
  datasetReferenceId,
  importWorkspaceProject,
  type ProjectId,
  type ProjectSummary,
  type SemanticSourceId,
  semanticIdentityEqual,
  serializeWorkspaceProject,
  validateSemanticIdentity,
  type WorkspaceDatasetReference,
  type WorkspaceMutation,
  type WorkspaceSnapshot,
  type WorkspaceSourceReference,
} from '@pji-workbench/workspace'
import {
  type FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AdvancedMaterialsWorkflows,
  type AdvancedPlanState,
  type FftWorkspaceSettings,
  type StackWorkspaceSettings,
  type SurfaceWorkspaceSettings,
} from '../AdvancedMaterialsWorkflows.js'
import {
  ANALYSIS_OPERATIONS,
  appendDatasetAnalysisGraph,
  connectedComponentsGraph,
  fftWorkflowGraph,
  histogramGraph,
  lineProfileGraph,
  particleAnalysisGraph,
  particleThresholdGraph,
  stackWorkflowGraph,
  statisticsGraph,
  surfaceWorkflowGraph,
  thresholdGraph,
  toolboxOperationGraph,
} from '../analysis-workflows.js'
import {
  type CommandContext,
  type CommandId,
  getCommandAvailability,
  resolveShortcut,
  type WorkbenchActionId,
  workbenchActionRegistry,
  workbenchCommands,
} from '../commands.js'
import type { PublicEnvironment } from '../environment.js'
import { ExampleGallery } from '../features/examples/ExampleGallery.js'
import {
  InspectorContent,
  type InspectorTab,
  inspectorTabs,
} from '../features/inspector/InspectorContent.js'
import { type ResizeConfig, startPanelResize } from '../features/layout/panel-resize.js'
import { BottomContent, type BottomTab, bottomTabs } from '../features/pipeline/BottomContent.js'
import {
  createProject,
  downloadProject,
  LAST_PROJECT_KEY,
  mutationsToReplaceOpenSource,
  projectSourceMutation,
  snapshotWithVisibleWorkflow,
} from '../features/project/project-actions.js'
import { useWorkspaceHistory } from '../features/project/useWorkspaceHistory.js'
import { useWorkbenchPreferences } from '../features/settings/useWorkbenchPreferences.js'
import {
  calibrationLabel,
  fileSize,
  RECENT_SOURCE_KEY,
  readRecentSources,
  sourceLocatorDetail,
} from '../features/source/source-model.js'
import {
  AnalysisInspector,
  AnalysisResults,
  formatRoughnessHeadline,
  frequencyPeakAnnotations,
  type MaterialsPanelState,
  RoiInspector,
} from '../MaterialsPanels.js'
import {
  DEFAULT_PARTICLE_WORKFLOW,
  ParticleAnalysisWorkflow,
  type ParticleWorkflowSettings,
} from '../ParticleAnalysisWorkflow.js'
import { PREFERENCE_BOUNDS } from '../preferences.js'
import {
  type AnalysisDatasetSelection,
  type AnalysisOverlaySelection,
  displayRangeFromTile,
  quantitativeRangeFromValues,
  type RoiTool,
  ScientificViewport,
  type ScientificViewportApi,
  type ViewportRoi,
} from '../ScientificViewport.js'
import {
  beginUxTask,
  initializeUxInstrumentation,
  measureUxNextPaint,
} from '../ux-instrumentation.js'
import { handleDialogKeyDown } from './dialog-keyboard.js'
import { WorkbenchProviders, type WorkbenchServices } from './WorkbenchProviders.js'
import { WorkbenchShell } from './WorkbenchShell.js'

type OpenStatus = 'ready' | 'opening' | 'crashed'
const MAX_EXPORT_ROWS = 100_000
const MAX_EXPORT_BYTES = 16 * 1_024 * 1_024

function wholePlaneRoi(opened: OpenedDatasetDescriptor, selection: PlaneSelection): ViewportRoi {
  const level = opened.dataset.levels.find(({ level }) => level === selection.resolutionLevel)
  const horizontal =
    level?.axisLengths.find(({ axisId }) => axisId === selection.displayAxes[0])?.length ??
    opened.dataset.axes.find(({ id }) => id === selection.displayAxes[0])?.length
  const vertical =
    level?.axisLengths.find(({ axisId }) => axisId === selection.displayAxes[1])?.length ??
    opened.dataset.axes.find(({ id }) => id === selection.displayAxes[1])?.length
  if (horizontal === undefined || vertical === undefined)
    throw new Error('The active plane dimensions are unavailable.')
  return {
    schemaVersion: 1,
    id: 'particle-whole-plane',
    name: 'Whole active plane',
    axisIds: selection.displayAxes,
    fixedIndices: selection.fixedIndices,
    coordinateSpace: 'pixel',
    geometry: { kind: 'rectangle', x: 0, y: 0, width: horizontal, height: vertical },
    presentation: { style: { visible: false } },
  } as ViewportRoi
}

interface ToolboxOperation {
  readonly id: string
  readonly version: number
  readonly title: string
  readonly inputs: readonly RpcJsonObject[]
  readonly outputs: readonly RpcJsonObject[]
  readonly parameters: RpcJsonObject
}

function rpcObject(value: unknown): RpcJsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RpcJsonObject)
    : undefined
}

function catalogOperation(
  catalog: AnalysisCatalog | undefined,
  operationId: string,
  operationVersion: number,
): ToolboxOperation | undefined {
  const descriptors = catalog?.capabilities['operationDescriptors']
  if (!Array.isArray(descriptors)) return undefined
  for (const candidate of descriptors) {
    const descriptor = rpcObject(candidate)
    if (
      descriptor?.['id'] !== operationId ||
      descriptor['version'] !== operationVersion ||
      typeof descriptor['title'] !== 'string' ||
      !Array.isArray(descriptor['inputs']) ||
      !Array.isArray(descriptor['outputs'])
    )
      continue
    const inputs: RpcJsonObject[] = []
    const outputs: RpcJsonObject[] = []
    for (const input of descriptor['inputs']) {
      const normalized = rpcObject(input)
      if (normalized === undefined) return undefined
      inputs.push(normalized)
    }
    for (const output of descriptor['outputs']) {
      const normalized = rpcObject(output)
      if (normalized === undefined) return undefined
      outputs.push(normalized)
    }
    const parameters = rpcObject(descriptor['parameters'])
    if (parameters === undefined) return undefined
    return {
      id: operationId,
      version: operationVersion,
      title: descriptor['title'],
      inputs,
      outputs,
      parameters,
    }
  }
  return undefined
}

function withCalibrationOverride(
  opened: OpenedDatasetDescriptor | undefined,
  calibration: CalibrationOverride | undefined,
): OpenedDatasetDescriptor | undefined {
  if (opened === undefined || calibration === undefined) return opened
  return {
    ...opened,
    dataset: {
      ...opened.dataset,
      axes: opened.dataset.axes.map((axis) => {
        const index = calibration.axisIds.indexOf(axis.id)
        if (index < 0) return axis
        const magnitude = calibration.unitsPerPixel[index]
        if (magnitude === undefined) return axis
        const direction = axis.coordinates.type === 'linear' && axis.coordinates.step < 0 ? -1 : 1
        return {
          ...axis,
          unit: calibration.unit,
          coordinates: {
            type: 'linear' as const,
            origin: axis.coordinates.type === 'linear' ? axis.coordinates.origin : 0,
            step: magnitude * direction,
          },
        }
      }),
    },
  }
}

const ScriptStudioSurface = lazy(() =>
  import('../features/scripts/ScriptStudioSurface.js').then(({ ScriptStudioSurface: Surface }) => ({
    default: Surface,
  })),
)

const ACTIVE_ACTION_SIGNAL: ActionAbortSignal = {
  aborted: false,
  throwIfAborted: () => undefined,
}

function commandAction(execute: () => Promise<void> | void): ActionHandler<CommandContext> {
  return {
    execute: async () => {
      await execute()
      return null
    },
  }
}

function fixtureAction(
  execute: (input: JsonValue) => JsonValue | Promise<JsonValue>,
): ActionHandler<CommandContext> {
  return {
    dryRun: (input) => execute(input),
    execute: (input) => execute(input),
  }
}

function executeOnlyAction(
  execute: (input: JsonValue) => JsonValue | Promise<JsonValue>,
): ActionHandler<CommandContext> {
  return { execute: (input) => execute(input) }
}

function analysisOutputLabel(output: string): string {
  switch (output) {
    case 'magnitude':
      return 'FFT magnitude'
    case 'power':
      return 'FFT power'
    case 'frequencyMask':
      return 'frequency mask'
    case 'corrected':
      return 'leveled surface'
    case 'grainMask':
      return 'grain mask'
    default:
      return output
  }
}

export function WorkbenchApp({ environment }: { readonly environment: PublicEnvironment }) {
  return (
    <WorkbenchProviders>
      {(services) => <WorkbenchRuntime environment={environment} services={services} />}
    </WorkbenchProviders>
  )
}

function WorkbenchRuntime({
  environment,
  services: { client, preferenceStore, projectStore, scriptStore, runtime, reconciler },
}: {
  readonly environment: PublicEnvironment
  readonly services: WorkbenchServices
}) {
  const uxInstrumentationInitialized = useRef(false)
  if (!uxInstrumentationInitialized.current) {
    initializeUxInstrumentation(environment.appEnvironment === 'test')
    uxInstrumentationInitialized.current = true
  }
  if (window.__PJI_WORKBENCH_METRICS__ === undefined) {
    window.__PJI_WORKBENCH_METRICS__ = {
      reactRenders: 0,
      viewportFrames: 0,
      tilesTransferred: 0,
      tileBytesTransferred: 0,
      tilePixelsTransferred: 0,
      largestTilePixels: 0,
      sourceBytes: 0,
      datasetPixels: 0,
      firstTileMilliseconds: null,
      projectId: '',
      invocationIds: [],
    }
  }
  window.__PJI_WORKBENCH_METRICS__.reactRenders += 1
  const initialWorkspace = useMemo(() => createProject(), [])
  const { applyProjectMutation, currentSnapshot, historyState, replaceWorkspace, stepHistory } =
    useWorkspaceHistory(initialWorkspace)
  const workspace = historyState.snapshot
  const [savedProjectJson, setSavedProjectJson] = useState<string>()
  const [recentProjects, setRecentProjects] = useState<readonly ProjectSummary[]>([])
  const [projectDialog, setProjectDialog] = useState(false)
  const projectDialogRoot = useRef<HTMLElement>(null)
  const projectDialogReturnFocus = useRef<HTMLElement>(null)
  const [rebindSourceId, setRebindSourceId] = useState<SemanticSourceId>()
  const [identityMismatch, setIdentityMismatch] = useState<{
    readonly sourceId: SemanticSourceId
    readonly expected: WorkspaceSourceReference['identity']
    readonly actual: WorkspaceSourceReference['identity']
    readonly files: readonly File[]
    readonly openedSource: OpenedSourceDescriptor
    readonly openedDataset: OpenedDatasetDescriptor
  }>()
  const { preferences, preferenceStyle, updatePreferences } =
    useWorkbenchPreferences(preferenceStore)
  const [source, setSource] = useState<OpenedSourceDescriptor>()
  const [opened, setOpened] = useState<OpenedDatasetDescriptor>()
  const [selection, setSelection] = useState<PlaneSelection>()
  const [component, setComponent] = useState(0)
  const [mapping, setMapping] = useState<DisplayMapping>({ mode: 'linear', range: 'auto' })
  const [histogram, setHistogram] = useState<readonly number[]>([])
  const [status, setStatus] = useState<OpenStatus>('ready')
  const [workerReady, setWorkerReady] = useState(false)
  const [error, setError] = useState<string>()
  const [urlDialog, setUrlDialog] = useState(false)
  const urlInput = useRef<HTMLInputElement>(null)
  const urlDialogReturnFocus = useRef<HTMLElement>(null)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('info')
  const [bottomTab, setBottomTab] = useState<BottomTab>('histogram')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteOperationId, setPaletteOperationId] = useState<string>()
  const [exampleGalleryOpen, setExampleGalleryOpen] = useState(false)
  const exampleGalleryReturnFocus = useRef<HTMLElement>(null)
  const [scriptStudioOpen, setScriptStudioOpen] = useState(false)
  const [recentSources, setRecentSources] = useState(() => readRecentSources(window.localStorage))
  const [log, setLog] = useState<readonly string[]>([])
  const [roiTool, setRoiTool] = useState<RoiTool>('select')
  const [threshold, setThreshold] = useState(128)
  const [thresholdMode, setThresholdMode] = useState<
    'greater-than' | 'greater-than-or-equal' | 'less-than' | 'less-than-or-equal'
  >('greater-than')
  const [connectivity, setConnectivity] = useState<4 | 8>(8)
  const [connectedPlanReady, setConnectedPlanReady] = useState(false)
  const [particleSettings, setParticleSettings] =
    useState<ParticleWorkflowSettings>(DEFAULT_PARTICLE_WORKFLOW)
  const [scriptRecipe, setScriptRecipe] = useState<RecipeDocumentV1>()
  const [scriptArtifactId, setScriptArtifactId] = useState<string>()
  const [analysisCatalog, setAnalysisCatalog] = useState<AnalysisCatalog>()
  const [analysisState, setAnalysisState] = useState<MaterialsPanelState>({
    busy: false,
    tableOffset: 0,
  })
  const [particleMessage, setParticleMessage] = useState<string>()
  const [particleDryRun, setParticleDryRun] = useState<AnalysisDryRunResponse>()
  const [particleDryRunIdentity, setParticleDryRunIdentity] = useState<string>()
  const [advancedPlan, setAdvancedPlan] = useState<AdvancedPlanState>()
  const [advancedMessage, setAdvancedMessage] = useState<string>()
  const [batchRows, setBatchRows] = useState<readonly BatchRecipeRow<unknown>[]>([])
  const [analysisOverlay, setAnalysisOverlay] = useState<AnalysisOverlaySelection>()
  const [analysisDataset, setAnalysisDataset] = useState<AnalysisDatasetSelection>()
  const [previewEnabled, setPreviewEnabled] = useState(false)
  const [tableFilter, setTableFilter] = useState<AnalysisTableFilter>()
  const [tableSort, setTableSort] = useState<AnalysisTableSort>()
  const openedRef = useRef<OpenedDatasetDescriptor | undefined>(undefined)
  const analysisAbort = useRef<AbortController | undefined>(undefined)
  const batchCancel = useRef<(() => void) | undefined>(undefined)
  const batchCancelItem = useRef<((itemId: string) => boolean) | undefined>(undefined)
  const previewResult = useRef<AnalysisResultHandleId | undefined>(undefined)
  const activeResult = useRef<AnalysisResultHandleId | undefined>(undefined)
  const viewportApi = useRef<ScientificViewportApi | null>(null)
  const workbenchRoot = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const projectImportInput = useRef<HTMLInputElement>(null)
  const rebindInput = useRef<HTMLInputElement>(null)
  const openAbort = useRef<AbortController | undefined>(undefined)
  const generation = useRef(0)
  const openedAt = useRef(0)
  const autoRangeLocked = useRef(false)
  const firstTileWaiters = useRef<Array<() => void>>([])
  const displayedRasterKey =
    analysisDataset === undefined
      ? 'source'
      : `analysis:${analysisDataset.resultHandleId}:${analysisDataset.output}`
  useEffect(() => {
    autoRangeLocked.current = displayedRasterKey.length === 0
    setMapping({ mode: 'linear', range: 'auto' })
  }, [displayedRasterKey])
  const openUrlDialog = useCallback((): void => {
    if (!urlDialogReturnFocus.current?.isConnected)
      urlDialogReturnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    setUrlDialog(true)
  }, [])
  const closeUrlDialog = useCallback((): void => {
    const target = urlDialogReturnFocus.current
    setUrlDialog(false)
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus()
      urlDialogReturnFocus.current = null
    })
  }, [])
  const openProjectDialog = useCallback((): void => {
    if (!projectDialogReturnFocus.current?.isConnected)
      projectDialogReturnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    setProjectDialog(true)
  }, [])
  const closeProjectDialog = useCallback((): void => {
    const target = projectDialogReturnFocus.current
    setProjectDialog(false)
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus()
      projectDialogReturnFocus.current = null
    })
  }, [])
  useEffect(() => {
    if (urlDialog) urlInput.current?.focus()
    else urlDialogReturnFocus.current = null
  }, [urlDialog])
  useEffect(() => {
    if (!projectDialog) {
      projectDialogReturnFocus.current = null
      return
    }
    projectDialogRoot.current
      ?.querySelector<HTMLElement>('[data-dialog-initial-focus="true"]')
      ?.focus()
  }, [projectDialog])
  openedRef.current = opened
  window.__PJI_WORKBENCH_METRICS__.projectId = workspace.project.id
  window.__PJI_WORKBENCH_METRICS__.invocationIds = [
    ...new Set(
      [previewResult.current, activeResult.current].flatMap((id) =>
        id === undefined ? [] : [String(id)],
      ),
    ),
  ]
  const hasDataset = opened !== undefined && selection !== undefined
  const activeCalibration = workspace.calibrations.find(
    ({ datasetReferenceId: id }) => id === workspace.active?.datasetReferenceId,
  )
  const calibratedOpened = useMemo(
    () => withCalibrationOverride(opened, activeCalibration),
    [activeCalibration, opened],
  )
  const analysisCalibration =
    activeCalibration === undefined
      ? undefined
      : {
          axisIds: activeCalibration.axisIds,
          unitsPerPixel: activeCalibration.unitsPerPixel,
          unit: activeCalibration.unit,
        }

  const advancedContextIdentity = JSON.stringify({
    datasetHandleId: opened?.handleId,
    generation: opened?.generation,
    selection,
    component,
  })
  const advancedPlanIdentity = (settings: unknown): string =>
    JSON.stringify({ context: advancedContextIdentity, settings })

  const setRenderSettled = useCallback((settled: boolean): void => {
    workbenchRoot.current?.setAttribute('data-render-settled', settled ? 'true' : 'false')
  }, [])

  useEffect(() => {
    if (!hasDataset) setRenderSettled(true)
  }, [hasDataset, setRenderSettled])

  const refreshRecentProjects = useCallback(async (): Promise<void> => {
    setRecentProjects(await projectStore.list())
  }, [projectStore])

  const appendLog = useCallback((message: string): void => {
    setLog((current) => [...current.slice(-20), `${new Date().toLocaleTimeString()} · ${message}`])
  }, [])

  const releaseAnalysisHandle = useCallback(
    async (
      handle: AnalysisResultHandleId | undefined,
      dataset = opened,
      workerClient = client,
    ): Promise<void> => {
      if (handle === undefined || dataset === undefined) return
      try {
        await workerClient.releaseAnalysis({
          datasetHandleId: dataset.handleId,
          generation: dataset.generation,
          resultHandleId: handle,
        })
      } catch (releaseError) {
        appendLog(
          `Analysis result was already released: ${releaseError instanceof Error ? releaseError.message : 'stale handle'}`,
        )
      }
    },
    [appendLog, client, opened],
  )

  const cancelPreview = useCallback((): void => {
    setPreviewEnabled(false)
    analysisAbort.current?.abort(new DOMException('Threshold preview cancelled', 'AbortError'))
    analysisAbort.current = undefined
    const handle = previewResult.current
    previewResult.current = undefined
    setAnalysisOverlay((current) => (current?.resultHandleId === handle ? undefined : current))
    setAnalysisDataset((current) => (current?.resultHandleId === handle ? undefined : current))
    void releaseAnalysisHandle(handle)
    setAnalysisState((current) => ({
      ...current,
      busy: false,
      message: 'Preview cancelled. The committed project is unchanged.',
    }))
  }, [releaseAnalysisHandle])

  const previewThreshold = useCallback(async (): Promise<void> => {
    if (opened === undefined) return
    measureUxNextPaint('threshold.preview')
    const finishUxTask = beginUxTask('threshold.preview')
    analysisAbort.current?.abort(new DOMException('Superseded threshold preview', 'AbortError'))
    const controller = new AbortController()
    analysisAbort.current = controller
    const previous = previewResult.current
    previewResult.current = undefined
    if (previous !== undefined) await releaseAnalysisHandle(previous)
    const graph = thresholdGraph({ component, threshold, mode: thresholdMode })
    setAnalysisState((current) => ({
      ...current,
      busy: true,
      message: 'Validating a bounded threshold preview…',
    }))
    try {
      const normalized = await client.normalizeAnalysisParameters(
        {
          datasetHandleId: opened.handleId,
          generation: opened.generation,
          operation: { id: ANALYSIS_OPERATIONS.threshold, version: 1 },
          parameters: graph.nodes[0]?.parameters ?? {},
        },
        controller.signal,
      )
      if (!normalized.valid) {
        setAnalysisState((current) => ({
          ...current,
          busy: false,
          message: String(normalized.issues[0]?.['message'] ?? 'Threshold parameters are invalid.'),
        }))
        return
      }
      const dryRun = await client.dryRunAnalysis(
        {
          datasetHandleId: opened.handleId,
          generation: opened.generation,
          graph: graph as unknown as RpcJsonObject,
          ...(analysisCalibration === undefined ? {} : { calibration: analysisCalibration }),
        },
        controller.signal,
      )
      setAnalysisState((current) => ({ ...current, dryRun }))
      if (!dryRun.valid) {
        setAnalysisState((current) => ({
          ...current,
          busy: false,
          message: 'Preview plan is invalid.',
        }))
        return
      }
      const execution = await client.executeAnalysis(
        {
          datasetHandleId: opened.handleId,
          generation: opened.generation,
          graph: graph as unknown as RpcJsonObject,
          ...(analysisCalibration === undefined ? {} : { calibration: analysisCalibration }),
        },
        controller.signal,
      )
      previewResult.current = execution.resultHandleId
      setAnalysisOverlay({ resultHandleId: execution.resultHandleId, output: 'mask' })
      setAnalysisState((current) => ({
        ...current,
        busy: false,
        message: `Preview ready in ${execution.elapsedMilliseconds.toFixed(1)} ms. No history entry was created.`,
      }))
    } catch (previewError) {
      if (!controller.signal.aborted) {
        setAnalysisState((current) => ({
          ...current,
          busy: false,
          message: `${previewError instanceof Error ? previewError.message : 'Preview failed.'} The committed project is unchanged.`,
        }))
      }
    } finally {
      finishUxTask()
    }
  }, [
    analysisCalibration,
    client,
    component,
    opened,
    releaseAnalysisHandle,
    threshold,
    thresholdMode,
  ])

  useEffect(() => {
    if (!previewEnabled || opened === undefined) return
    const timer = window.setTimeout(() => void previewThreshold(), 250)
    return () => window.clearTimeout(timer)
  }, [opened, previewEnabled, previewThreshold])

  useEffect(() => {
    if (opened === undefined) {
      setAnalysisCatalog(undefined)
      return
    }
    const controller = new AbortController()
    void client
      .analysisCatalog(
        { datasetHandleId: opened.handleId, generation: opened.generation },
        controller.signal,
      )
      .then(setAnalysisCatalog)
      .catch((catalogError: unknown) => {
        if (!controller.signal.aborted)
          appendLog(`Analysis catalog failed: ${String(catalogError)}`)
      })
    return () => controller.abort()
  }, [appendLog, client, opened])

  useEffect(() => {
    const trackedAbort = analysisAbort.current
    const trackedOpened = opened
    return () => {
      const preview = previewResult.current
      const active = activeResult.current
      previewResult.current = undefined
      activeResult.current = undefined
      if (trackedAbort !== undefined && analysisAbort.current === trackedAbort)
        trackedAbort.abort(new DOMException('Dataset changed', 'AbortError'))
      if (trackedOpened !== undefined) {
        for (const handle of [preview, active]) {
          if (handle !== undefined) {
            void client
              .releaseAnalysis({
                datasetHandleId: trackedOpened.handleId,
                generation: trackedOpened.generation,
                resultHandleId: handle,
              })
              .catch(() => undefined)
          }
        }
      }
    }
  }, [client, opened])

  const loadTablePage = useCallback(
    async (
      execution: AnalysisExecutionResponse,
      offset: number,
      filter = tableFilter,
      sort = tableSort,
      dataset = opened,
      workerClient = client,
    ): Promise<AnalysisTablePage | undefined> => {
      const output = execution.outputs.find(
        (candidate) => candidate.kind === 'result' && candidate.summary['kind'] === 'table',
      )
      if (dataset === undefined || output === undefined) return undefined
      return workerClient.requestAnalysisTablePage({
        datasetHandleId: dataset.handleId,
        generation: dataset.generation,
        resultHandleId: execution.resultHandleId,
        output: output.name,
        offset,
        limit: 50,
        ...(filter === undefined ? {} : { filter }),
        ...(sort === undefined ? {} : { sort }),
      })
    },
    [client, opened, tableFilter, tableSort],
  )

  const executeAnalysisGraph = useCallback(
    async (
      graph: WorkspaceSnapshot['analysis']['graph'],
      options: {
        readonly roi?: ViewportRoi
        readonly overlay?: string
        readonly overlayView?: AnalysisOverlayView
        readonly overlayTableOutput?: string
        readonly commit?: boolean
        readonly preview?: boolean
        readonly throwOnError?: boolean
        readonly surface?: 'general' | 'particle' | 'advanced'
        readonly dataset?: OpenedDatasetDescriptor
        readonly workerClient?: ImagingWorkerClient
      } = {},
    ): Promise<boolean> => {
      const target = options.dataset ?? opened
      const targetClient = options.workerClient ?? client
      if (target === undefined) return false
      cancelPreview()
      const controller = new AbortController()
      analysisAbort.current = controller
      const reportParticleMessage = (message: string): void => {
        if (options.surface === 'particle') setParticleMessage(message)
        if (options.surface === 'advanced') setAdvancedMessage(message)
      }
      reportParticleMessage('Planning analysis…')
      setAnalysisState((current) => ({ ...current, busy: true, message: 'Planning analysis…' }))
      try {
        const request = {
          datasetHandleId: target.handleId,
          generation: target.generation,
          graph: graph as unknown as RpcJsonObject,
          ...(analysisCalibration === undefined ? {} : { calibration: analysisCalibration }),
          ...(options.roi === undefined ? {} : { roi: options.roi as unknown as RpcJsonObject }),
        }
        const dryRun = await targetClient.dryRunAnalysis(request, controller.signal)
        setAnalysisState((current) => ({ ...current, dryRun }))
        if (!dryRun.valid) {
          reportParticleMessage('Analysis validation failed. The committed project is unchanged.')
          setAnalysisState((current) => ({
            ...current,
            busy: false,
            message: 'Analysis validation failed. The committed project is unchanged.',
          }))
          return false
        }
        const execution = await targetClient.executeAnalysis(request, controller.signal)
        const previous = options.preview === true ? previewResult.current : activeResult.current
        if (options.preview === true) previewResult.current = execution.resultHandleId
        else activeResult.current = execution.resultHandleId
        if (previous !== undefined) await releaseAnalysisHandle(previous, target, targetClient)
        if (options.commit === true) applyProjectMutation({ kind: 'analysis.set-graph', graph })
        const table = await loadTablePage(execution, 0, undefined, undefined, target, targetClient)
        const tableOutput = execution.outputs.find(
          (candidate) => candidate.kind === 'result' && candidate.summary['kind'] === 'table',
        )?.name
        const seriesOutputs = execution.outputs.filter(
          ({ kind, name }) =>
            kind === 'result' &&
            [
              'sizeDistribution',
              'distribution',
              'radialProfile',
              'azimuthalProfile',
              'surfaceProfile',
              'profile',
              'histogram',
              'heightHistogram',
            ].includes(name),
        )
        const seriesExports = await Promise.all(
          seriesOutputs.map(async ({ name }) => ({
            name,
            data: (await targetClient.requestAnalysisSeriesExport(
              {
                datasetHandleId: target.handleId,
                generation: target.generation,
                resultHandleId: execution.resultHandleId,
                output: name,
                maxRows: 100_000,
              },
              controller.signal,
            )) as AnalysisSeriesExport,
          })),
        )
        const distribution = seriesExports.find(
          ({ name }) => name === 'sizeDistribution' || name === 'distribution',
        )?.data
        const derivedDataset =
          options.overlay === undefined
            ? execution.outputs.find(({ kind }) => kind === 'dataset')
            : undefined
        setAnalysisDataset(
          derivedDataset?.kind === 'dataset'
            ? {
                resultHandleId: execution.resultHandleId,
                output: derivedDataset.name,
                descriptor:
                  derivedDataset.descriptor as unknown as OpenedDatasetDescriptor['dataset'],
              }
            : undefined,
        )
        autoRangeLocked.current = false
        setMapping({ mode: 'linear', range: 'auto' })
        const counted =
          table !== undefined && (tableOutput === undefined || tableOutput === 'objects')
            ? table.totalRows
            : undefined
        const roughness = formatRoughnessHeadline(execution)
        const completionMessage =
          options.preview === true
            ? `Preview ready in ${execution.elapsedMilliseconds.toFixed(1)} ms. No project revision was created.`
            : counted === undefined
              ? roughness === undefined
                ? `Analysis completed in ${execution.elapsedMilliseconds.toFixed(1)} ms.`
                : `Leveled surface · ${roughness} in ${execution.elapsedMilliseconds.toFixed(1)} ms.`
              : counted === 0
                ? 'No particles remained. If objects touch the ROI edge, set Edge objects to Include.'
                : `Counted ${counted.toLocaleString()} particles in ${(execution.elapsedMilliseconds / 1_000).toFixed(1)} s.`
        reportParticleMessage(completionMessage)
        setAnalysisState({
          busy: false,
          execution,
          dryRun,
          tableOffset: 0,
          ...(table === undefined ? {} : { table }),
          ...(tableOutput === undefined ? {} : { tableOutput }),
          ...(distribution === undefined ? {} : { distribution }),
          ...(seriesExports.length === 0 ? {} : { seriesExports }),
          message: completionMessage,
        })
        setAnalysisOverlay(
          options.overlay === undefined
            ? undefined
            : {
                resultHandleId: execution.resultHandleId,
                output: options.overlay,
                ...(options.overlayView === undefined ? {} : { view: options.overlayView }),
                ...(options.overlayTableOutput === undefined
                  ? {}
                  : { tableOutput: options.overlayTableOutput }),
              },
        )
        setBottomTab(
          graph.outputs.some(({ name }) => name === 'profile')
            ? 'profile'
            : table === undefined
              ? 'results'
              : 'results',
        )
        appendLog(
          `Executed ${graph.nodes.map(({ label, operation }) => label ?? operation.id).join(' → ')}`,
        )
        return true
      } catch (executionError) {
        if (!controller.signal.aborted) {
          const failureMessage = `${executionError instanceof Error ? executionError.message : 'Analysis failed.'} The previous committed project remains intact.`
          reportParticleMessage(failureMessage)
          setAnalysisState((current) => ({
            ...current,
            busy: false,
            message: failureMessage,
          }))
        }
        if (options.throwOnError === true) throw executionError
        return false
      }
    },
    [
      appendLog,
      applyProjectMutation,
      cancelPreview,
      client,
      loadTablePage,
      opened,
      releaseAnalysisHandle,
      analysisCalibration,
    ],
  )

  const runToolboxOperation = useCallback(
    async (
      operation: ToolboxOperation,
      parameters: RpcJsonObject,
      mode: 'preview' | 'apply',
    ): Promise<void> => {
      if (selection === undefined) throw new Error('No dataset plane is selected.')
      try {
        const graph = toolboxOperationGraph({
          operation,
          parameters,
          selection,
          baseGraph: workspace.analysis.graph,
        })
        await executeAnalysisGraph(graph, {
          preview: mode === 'preview',
          commit: mode === 'apply',
        })
      } catch (operationError) {
        setAnalysisState((current) => ({
          ...current,
          message: operationError instanceof Error ? operationError.message : 'Operation failed.',
        }))
        throw operationError
      }
    },
    [executeAnalysisGraph, selection, workspace.analysis.graph],
  )

  const createRoi = useCallback(
    async (geometry: ViewportRoi['geometry']): Promise<void> => {
      if (opened === undefined || selection === undefined) return
      const id = `roi-${crypto.randomUUID()}`
      const normalized = await client.normalizeRoi({
        datasetHandleId: opened.handleId,
        generation: opened.generation,
        roi: {
          schemaVersion: 1,
          id,
          name: `${geometry.kind} ROI`,
          axisIds: selection.displayAxes,
          fixedIndices: selection.fixedIndices,
          coordinateSpace: 'pixel',
          geometry,
          presentation: { style: { visible: true } },
        } as unknown as RpcJsonObject,
      })
      if (!normalized.valid || normalized.roi === undefined) {
        setError(String(normalized.issues[0]?.['message'] ?? 'The ROI is invalid.'))
        return
      }
      const roi = normalized.roi as unknown as ViewportRoi
      applyProjectMutation({ kind: 'roi.add', roi })
      applyProjectMutation({ kind: 'roi.select', roiId: roi.id })
      setRoiTool('select')
    },
    [applyProjectMutation, client, opened, selection],
  )

  const updateRoi = useCallback(
    async (roi: ViewportRoi): Promise<void> => {
      if (opened === undefined) return
      const normalized = await client.normalizeRoi({
        datasetHandleId: opened.handleId,
        generation: opened.generation,
        roi: roi as unknown as RpcJsonObject,
      })
      if (normalized.valid && normalized.roi !== undefined) {
        applyProjectMutation({
          kind: 'roi.update',
          roiId: roi.id,
          roi: normalized.roi as unknown as ViewportRoi,
        })
      }
    },
    [applyProjectMutation, client, opened],
  )

  const selectRoi = useCallback(
    (roiId?: string): void => {
      applyProjectMutation({ kind: 'roi.select', ...(roiId === undefined ? {} : { roiId }) })
    },
    [applyProjectMutation],
  )

  const deleteRoi = useCallback(
    (roiId: string): void => {
      applyProjectMutation({ kind: 'roi.remove', roiId })
    },
    [applyProjectMutation],
  )

  const handleCreateRoi = useCallback(
    (geometry: ViewportRoi['geometry']): void => {
      measureUxNextPaint('roi.create')
      const finish = beginUxTask('roi.create')
      void createRoi(geometry).finally(finish)
    },
    [createRoi],
  )

  const applyThreshold = useCallback(async (): Promise<void> => {
    if (opened === undefined) return
    measureUxNextPaint('threshold.commit')
    const finishUxTask = beginUxTask('threshold.commit')
    try {
      const graph = thresholdGraph({ component, threshold, mode: thresholdMode })
      const dryRun = await client.dryRunAnalysis({
        datasetHandleId: opened.handleId,
        generation: opened.generation,
        graph: graph as unknown as RpcJsonObject,
        ...(analysisCalibration === undefined ? {} : { calibration: analysisCalibration }),
      })
      setAnalysisState((current) => ({ ...current, dryRun }))
      if (!dryRun.valid) {
        setAnalysisState((current) => ({
          ...current,
          message: 'Threshold was not applied because validation failed.',
        }))
        return
      }
      cancelPreview()
      applyProjectMutation({ kind: 'analysis.set-graph', graph })
      setAnalysisState((current) => ({
        ...current,
        message: 'Threshold committed as one semantic project revision.',
      }))
      setBottomTab('pipeline')
    } finally {
      finishUxTask()
    }
  }, [
    analysisCalibration,
    applyProjectMutation,
    cancelPreview,
    client,
    component,
    opened,
    threshold,
    thresholdMode,
  ])

  const runConnectedComponents = useCallback((): void => {
    if (selection === undefined) return
    const graph = connectedComponentsGraph({
      component,
      threshold,
      mode: thresholdMode,
      selection,
      connectivity,
    })
    void executeAnalysisGraph(graph, { overlay: 'labels', commit: true })
  }, [component, connectivity, executeAnalysisGraph, selection, threshold, thresholdMode])

  const planConnectedComponents = useCallback(async (): Promise<void> => {
    if (opened === undefined || selection === undefined) return
    const graph = connectedComponentsGraph({
      component,
      threshold,
      mode: thresholdMode,
      selection,
      connectivity,
    })
    setAnalysisState((current) => ({
      ...current,
      busy: true,
      message: 'Planning connected components…',
    }))
    try {
      const dryRun = await client.dryRunAnalysis({
        datasetHandleId: opened.handleId,
        generation: opened.generation,
        graph: graph as unknown as RpcJsonObject,
        ...(analysisCalibration === undefined ? {} : { calibration: analysisCalibration }),
      })
      setAnalysisState((current) => ({
        ...current,
        busy: false,
        dryRun,
        message: dryRun.valid
          ? 'Connected-components plan ready. Review the resource estimate before running.'
          : 'Connected-components plan is invalid.',
      }))
      setConnectedPlanReady(dryRun.valid)
    } catch (planError) {
      setConnectedPlanReady(false)
      setAnalysisState((current) => ({
        ...current,
        busy: false,
        message: planError instanceof Error ? planError.message : 'Planning failed.',
      }))
    }
  }, [
    analysisCalibration,
    client,
    component,
    connectivity,
    opened,
    selection,
    threshold,
    thresholdMode,
  ])

  const particleRoi = useMemo(() => {
    if (opened === undefined || selection === undefined) return undefined
    const selected = workspace.analysis.roiSet.rois.find(({ id }) => id === particleSettings.roiId)
    if (
      selected !== undefined &&
      selected.geometry.kind !== 'point' &&
      selected.geometry.kind !== 'line-segment' &&
      selected.geometry.kind !== 'polyline'
    )
      return selected
    return wholePlaneRoi(calibratedOpened ?? opened, selection)
  }, [calibratedOpened, opened, particleSettings.roiId, selection, workspace.analysis.roiSet.rois])

  useEffect(() => {
    const selectedId = workspace.workflow.selectedRoiId
    if (selectedId === undefined) return
    const selected = workspace.analysis.roiSet.rois.find(({ id }) => id === selectedId)
    if (
      selected === undefined ||
      selected.geometry.kind === 'point' ||
      selected.geometry.kind === 'line-segment' ||
      selected.geometry.kind === 'polyline'
    )
      return
    if (particleSettings.roiId === selectedId) return
    setParticleSettings((current) => ({
      ...current,
      roiId: selectedId,
      edgePolicy: 'include',
    }))
    setParticleDryRun(undefined)
    setParticleDryRunIdentity(undefined)
  }, [particleSettings.roiId, workspace.analysis.roiSet.rois, workspace.workflow.selectedRoiId])

  const particleGraph = useMemo(() => {
    if (selection === undefined) return undefined
    const { roiId: _roiId, overlayView: _overlayView, ...settings } = particleSettings
    return particleAnalysisGraph({ ...settings, selection })
  }, [particleSettings, selection])
  const particlePlanIdentity = useMemo(
    () =>
      opened === undefined || particleGraph === undefined || particleRoi === undefined
        ? undefined
        : JSON.stringify({
            datasetHandleId: opened.handleId,
            generation: opened.generation,
            graph: particleGraph,
            roi: particleRoi,
          }),
    [opened, particleGraph, particleRoi],
  )
  const currentParticleDryRun =
    particleDryRunIdentity === particlePlanIdentity ? particleDryRun : undefined

  const previewParticleThreshold = useCallback((): void => {
    if (selection === undefined || particleRoi === undefined) return
    const { roiId: _roiId, overlayView: _overlayView, ...settings } = particleSettings
    const graph = particleThresholdGraph({ ...settings, selection })
    void executeAnalysisGraph(graph, {
      roi: particleRoi,
      overlay: 'mask',
      preview: true,
      surface: 'particle',
    })
  }, [executeAnalysisGraph, particleRoi, particleSettings, selection])

  const planParticleAnalysis = useCallback(async (): Promise<void> => {
    if (
      opened === undefined ||
      particleGraph === undefined ||
      particleRoi === undefined ||
      particlePlanIdentity === undefined
    )
      return
    const controller = new AbortController()
    analysisAbort.current?.abort(new DOMException('Superseded particle plan', 'AbortError'))
    analysisAbort.current = controller
    const planningMessage = 'Planning the complete particle workflow with hard memory admission…'
    setParticleMessage(planningMessage)
    setAnalysisState((current) => ({
      ...current,
      busy: true,
      message: planningMessage,
    }))
    try {
      const dryRun = await client.dryRunAnalysis(
        {
          datasetHandleId: opened.handleId,
          generation: opened.generation,
          graph: particleGraph as unknown as RpcJsonObject,
          roi: particleRoi as unknown as RpcJsonObject,
          ...(analysisCalibration === undefined ? {} : { calibration: analysisCalibration }),
        },
        controller.signal,
      )
      const planMessage = dryRun.valid
        ? 'Particle workflow plan is ready. Review the visible graph and memory estimate before running.'
        : 'Particle workflow was refused by validation or resource admission.'
      setParticleMessage(planMessage)
      setParticleDryRun(dryRun)
      setParticleDryRunIdentity(particlePlanIdentity)
      setAnalysisState((current) => ({
        ...current,
        busy: false,
        dryRun,
        message: planMessage,
      }))
    } catch (planError) {
      if (!controller.signal.aborted) {
        const failureMessage =
          planError instanceof Error ? planError.message : 'Particle planning failed.'
        setParticleMessage(failureMessage)
        setAnalysisState((current) => ({
          ...current,
          busy: false,
          message: failureMessage,
        }))
      }
    }
  }, [analysisCalibration, client, opened, particleGraph, particlePlanIdentity, particleRoi])

  const runParticleAnalysis = useCallback((): void => {
    if (
      particleGraph === undefined ||
      particleRoi === undefined ||
      currentParticleDryRun?.valid !== true
    )
      return
    void executeAnalysisGraph(particleGraph, {
      roi: particleRoi,
      overlay: 'labels',
      overlayView: particleSettings.overlayView,
      overlayTableOutput: 'objects',
      commit: true,
      surface: 'particle',
    })
  }, [
    executeAnalysisGraph,
    currentParticleDryRun?.valid,
    particleGraph,
    particleRoi,
    particleSettings.overlayView,
  ])

  useEffect(() => {
    setAnalysisOverlay((current) =>
      current?.output === 'labels'
        ? {
            ...current,
            view: particleSettings.overlayView,
            tableOutput: 'objects',
          }
        : current,
    )
  }, [particleSettings.overlayView])

  const createParticleRecipe = useCallback(async (): Promise<RecipeDocumentV1 | undefined> => {
    if (particleGraph === undefined) return undefined
    const base: Omit<RecipeDocumentV1, 'integrity'> = {
      schemaVersion: 1,
      kind: 'recipe',
      id: 'particle-analysis',
      version: '1.0.0',
      title: 'Particle analysis',
      description:
        'Visible correction, threshold, binary cleanup, watershed, connected-components, filtering, and measurement graph.',
      operations: [
        {
          actionId: 'analysis.graph.request-execute',
          actionVersion: 1,
          input: {
            graph: particleGraph as unknown as JsonValue,
            ...(particleSettings.roiId === undefined ? {} : { roiId: particleSettings.roiId }),
          },
        },
      ],
      requestedCapabilities: ['analysis.execute'],
      compatibility: { pureJsImage: '^0.11.0', workbench: '>=0.0.0 <1.0.0' },
    }
    const recipe: RecipeDocumentV1 = {
      ...base,
      integrity: await recipeContentIntegrity(base),
    }
    const validated = validateRecipeDocument(recipe)
    if (!validated.ok || validated.value === undefined) {
      setError(validated.issues[0]?.message ?? 'Particle recipe validation failed.')
      return undefined
    }
    return validated.value
  }, [particleGraph, particleSettings.roiId])

  const saveParticleRecipe = useCallback(async (): Promise<void> => {
    const recipe = await createParticleRecipe()
    if (recipe === undefined) return
    const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'particle-analysis.recipe.json'
    anchor.click()
    URL.revokeObjectURL(url)
    appendLog('Saved the particle workflow as a validated declarative recipe')
  }, [appendLog, createParticleRecipe])

  const openParticleRecipeInScripts = useCallback(async (): Promise<void> => {
    const recipe = await createParticleRecipe()
    if (recipe === undefined) return
    setScriptArtifactId(undefined)
    setScriptRecipe(recipe)
    setScriptStudioOpen(true)
  }, [createParticleRecipe])

  const advancedRoi = useCallback(
    (roiId: string): ViewportRoi | undefined => {
      if (opened === undefined || selection === undefined) return undefined
      if (roiId === 'whole-plane') return wholePlaneRoi(calibratedOpened ?? opened, selection)
      return workspace.analysis.roiSet.rois.find(({ id }) => id === roiId)
    },
    [calibratedOpened, opened, selection, workspace.analysis.roiSet.rois],
  )

  const planAdvanced = useCallback(
    async (
      kind: AdvancedPlanState['kind'],
      identity: string,
      graph: WorkspaceSnapshot['analysis']['graph'],
      roi?: ViewportRoi,
    ): Promise<void> => {
      if (opened === undefined) return
      analysisAbort.current?.abort(new DOMException('Superseded advanced plan', 'AbortError'))
      const controller = new AbortController()
      analysisAbort.current = controller
      setAdvancedPlan(undefined)
      setAdvancedMessage(`Planning ${kind} workflow…`)
      setAnalysisState((current) => ({ ...current, busy: true }))
      try {
        const dryRun = await client.dryRunAnalysis(
          {
            datasetHandleId: opened.handleId,
            generation: opened.generation,
            graph: graph as unknown as RpcJsonObject,
            ...(roi === undefined ? {} : { roi: roi as unknown as RpcJsonObject }),
            ...(analysisCalibration === undefined ? {} : { calibration: analysisCalibration }),
          },
          controller.signal,
        )
        setAdvancedPlan({ kind, identity, dryRun })
        setAdvancedMessage(
          dryRun.valid
            ? `${kind.toUpperCase()} plan admitted. Review memory/work and run when ready.`
            : `${kind.toUpperCase()} plan refused; the project is unchanged.`,
        )
        setAnalysisState((current) => ({ ...current, busy: false, dryRun }))
      } catch (planError) {
        if (!controller.signal.aborted)
          setAdvancedMessage(
            planError instanceof Error ? planError.message : 'Advanced planning failed.',
          )
        setAnalysisState((current) => ({ ...current, busy: false }))
      }
    },
    [analysisCalibration, client, opened],
  )

  const fftGraphFor = useCallback(
    (settings: FftWorkspaceSettings) => {
      if (selection === undefined) return undefined
      const roi = advancedRoi(settings.roiId)
      if (roi?.geometry.kind !== 'rectangle') return undefined
      return {
        roi,
        graph: fftWorkflowGraph({
          selection,
          component,
          roi: roi.geometry,
          spectrumDisplay: settings.spectrumDisplay,
          radialBins: settings.radialBins,
          azimuthalBins: settings.azimuthalBins,
          azimuthalMinimumRadius: 0,
          azimuthalMaximumRadius: 1,
          peakThreshold: settings.peakThreshold,
          minimumPeakDistance: settings.minimumPeakDistance,
          maximumPeaks: settings.maximumPeaks,
          maskKind: settings.maskKind,
          minimumRadius: settings.minimumRadius,
          maximumRadius: settings.maximumRadius,
          notchX: settings.notchX,
          notchY: settings.notchY,
          notchRadius: settings.notchRadius,
        }),
      }
    },
    [advancedRoi, component, selection],
  )

  const stackGraphFor = useCallback(
    (settings: StackWorkspaceSettings) =>
      selection === undefined
        ? undefined
        : stackWorkflowGraph({ ...settings, selection, component }),
    [component, selection],
  )

  const surfaceGraphFor = useCallback(
    (settings: SurfaceWorkspaceSettings) => {
      if (selection === undefined) return undefined
      const roi = advancedRoi(settings.roiId)
      if (roi === undefined) return undefined
      return {
        roi,
        graph: surfaceWorkflowGraph({
          selection,
          component,
          correction: settings.correction,
          polynomialDegree: settings.polynomialDegree,
          histogramBins: settings.histogramBins,
          profileX0: settings.profileX0,
          profileY0: settings.profileY0,
          profileX1: settings.profileX1,
          profileY1: settings.profileY1,
          profileSamples: settings.profileSamples,
          grainMethod: settings.grainMethod,
          grainPolarity: settings.grainPolarity,
          grainLower: settings.grainLower,
          grainUpper: settings.grainUpper,
        }),
      }
    },
    [advancedRoi, component, selection],
  )

  const runBatchFiles = useCallback(
    async (files: readonly File[], concurrency: number): Promise<void> => {
      if (files.length === 0) return
      const graph = workspace.analysis.graph
      if (graph.nodes.length === 0) {
        setAdvancedMessage('Commit a validated recipe graph before starting a file batch.')
        return
      }
      const encoded = new TextEncoder().encode(JSON.stringify(graph))
      const digest = await crypto.subtle.digest('SHA-256', encoded)
      const recipeHash = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
      const items = files.map((file, index) => ({
        id: `batch-${index}-${file.name}-${file.size}-${file.lastModified}`,
        sourceIdentity: `local-file:${file.name}:${file.size}:${file.lastModified}`,
        sourceName: file.name,
        input: file,
      }))
      setBatchRows([])
      setAdvancedMessage(
        `Running ${items.length} local batch items with concurrency ${concurrency}…`,
      )
      setAnalysisState((current) => ({ ...current, busy: true }))
      try {
        const runner = runBatchRecipe<
          File,
          Readonly<{
            sourceIdentity: string
            outputs: readonly Readonly<{ kind: string; name: string }>[]
          }>
        >(items, {
          runId: crypto.randomUUID(),
          recipeHash,
          concurrency,
          outputSourceIdentity: (output) => output.sourceIdentity,
          onRow(row) {
            setBatchRows((current) => {
              const index = items.findIndex(({ id }) => id === row.itemId)
              const next = [...current]
              next[index] = row
              return next.filter(
                (candidate): candidate is BatchRecipeRow<unknown> => candidate !== undefined,
              )
            })
          },
          async execute(item, signal) {
            const batchClient = createImagingWorkerClient()
            try {
              await batchClient.initialize()
              const source = await batchClient.openLocal([item.input], item.input, 1, signal)
              const descriptor = source.datasets[0]
              if (descriptor === undefined)
                throw new Error('Batch source has no scientific dataset.')
              const openedDataset = await batchClient.openDataset(
                source.documentId,
                descriptor.id,
                1,
                signal,
              )
              const roi = wholePlaneRoi(openedDataset, openedDataset.selection)
              const request = {
                datasetHandleId: openedDataset.handleId,
                generation: openedDataset.generation,
                graph: graph as unknown as RpcJsonObject,
                roi: roi as unknown as RpcJsonObject,
              }
              const dryRun = await batchClient.dryRunAnalysis(request, signal)
              if (!dryRun.valid) {
                const detail = dryRun.issues
                  .map((issue) => {
                    if (typeof issue === 'string') return issue
                    if (typeof issue === 'object' && issue !== null) {
                      if ('message' in issue) return String(issue['message'])
                      return JSON.stringify(issue)
                    }
                    return ''
                  })
                  .filter((message) => message.length > 0)
                  .slice(0, 3)
                  .join(' ')
                throw new Error(
                  detail.length > 0
                    ? `Recipe is not valid for this dataset. ${detail}`
                    : 'Recipe is not valid for this dataset.',
                )
              }
              const execution = await batchClient.executeAnalysis(request, signal)
              await batchClient.releaseAnalysis({
                datasetHandleId: openedDataset.handleId,
                generation: openedDataset.generation,
                resultHandleId: execution.resultHandleId,
              })
              return {
                sourceIdentity: JSON.stringify(source.identity),
                outputs: execution.outputs.map(({ kind, name }) => ({ kind, name })),
              }
            } finally {
              batchClient.dispose()
            }
          },
        })
        batchCancel.current = () => runner.cancelAll()
        batchCancelItem.current = (itemId) => runner.cancelItem(itemId)
        const result = await runner.result
        setBatchRows(result.rows)
        const succeeded = result.rows.filter(({ status }) => status === 'succeeded').length
        const failed = result.rows.filter(({ status }) => status === 'failed').length
        const cancelled = result.rows.filter(({ status }) => status === 'cancelled').length
        setAdvancedMessage(
          `Batch complete: ${succeeded} succeeded, ${failed} failed, ${cancelled} cancelled. Unrelated items remained isolated.`,
        )
      } catch (batchError) {
        setAdvancedMessage(batchError instanceof Error ? batchError.message : 'Batch setup failed.')
      } finally {
        batchCancel.current = undefined
        batchCancelItem.current = undefined
        setAnalysisState((current) => ({ ...current, busy: false }))
      }
    },
    [workspace.analysis.graph],
  )

  const measureSelectedRoi = useCallback(
    (kind: 'statistics' | 'histogram' | 'profile'): void => {
      if (selection === undefined) return
      const roi = workspace.analysis.roiSet.rois.find(
        ({ id }) => id === workspace.workflow.selectedRoiId,
      )
      if (roi === undefined) return
      const graph =
        kind === 'statistics'
          ? statisticsGraph(selection, component)
          : kind === 'histogram'
            ? histogramGraph(selection, component)
            : lineProfileGraph(selection, component)
      try {
        const canReuseAnalysis =
          analysisDataset !== undefined && workspace.analysis.graph.outputs.length === 1
        if (!canReuseAnalysis && analysisDataset !== undefined) {
          setAnalysisDataset(undefined)
          setAnalysisOverlay(undefined)
        }
        const activeGraph =
          canReuseAnalysis && analysisDataset !== undefined
            ? appendDatasetAnalysisGraph(workspace.analysis.graph, graph, analysisDataset.output)
            : graph
        void executeAnalysisGraph(activeGraph, { roi, commit: false })
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'The selected measurement could not be attached to the current analysis.'
        setAnalysisState((current) => ({ ...current, busy: false, message }))
      }
    },
    [
      analysisDataset,
      component,
      executeAnalysisGraph,
      selection,
      workspace.analysis.graph,
      workspace.analysis.roiSet.rois,
      workspace.workflow.selectedRoiId,
    ],
  )

  const changeTablePage = useCallback(
    (offset: number): void => {
      const execution = analysisState.execution
      if (execution === undefined) return
      void loadTablePage(execution, offset).then((table) => {
        if (table !== undefined) {
          setAnalysisState((current) => ({ ...current, table, tableOffset: table.offset }))
        }
      })
    },
    [analysisState.execution, loadTablePage],
  )

  const changeTableSort = useCallback(
    (column: string): void => {
      const execution = analysisState.execution
      if (execution === undefined) return
      const next: AnalysisTableSort =
        tableSort?.column === column && tableSort.direction === 'ascending'
          ? { column, direction: 'descending' }
          : { column, direction: 'ascending' }
      setTableSort(next)
      void loadTablePage(execution, 0, tableFilter, next).then((table) => {
        if (table !== undefined)
          setAnalysisState((current) => ({ ...current, table, tableOffset: 0 }))
      })
    },
    [analysisState.execution, loadTablePage, tableFilter, tableSort],
  )

  const changeTableFilter = useCallback(
    (column: string, minimum?: number): void => {
      const execution = analysisState.execution
      if (execution === undefined) return
      const next = minimum === undefined ? undefined : { column, minimum }
      setTableFilter(next)
      void loadTablePage(execution, 0, next, tableSort).then((table) => {
        if (table !== undefined)
          setAnalysisState((current) => ({ ...current, table, tableOffset: 0 }))
      })
    },
    [analysisState.execution, loadTablePage, tableSort],
  )

  const analysisPageRows = useCallback((page: AnalysisTablePage) => {
    return Array.from({ length: page.rowCount }, (_value, row) =>
      Object.fromEntries(page.columns.map((column) => [column.name, column.values[row] ?? null])),
    )
  }, [])

  const frequencyAnnotations = useMemo(() => {
    if (analysisState.tableOutput !== 'peaks' || analysisState.table === undefined) return []
    return frequencyPeakAnnotations(analysisState.table)
  }, [analysisState.table, analysisState.tableOutput])

  const downloadAnalysis = useCallback(
    async (scope: 'selected' | 'all', format: 'csv' | 'json'): Promise<void> => {
      const execution = analysisState.execution
      if (execution === undefined) return
      if (scope === 'all' && (analysisState.table?.totalRows ?? 0) > MAX_EXPORT_ROWS) {
        setError(
          `Export is limited to ${MAX_EXPORT_ROWS.toLocaleString()} rows. Apply a result filter or export the current page.`,
        )
        return
      }
      const parts: string[] = []
      let exportBytes = 0
      let jsonRowCount = 0
      const appendPart = (part: string): boolean => {
        exportBytes += new TextEncoder().encode(part).byteLength
        if (exportBytes > MAX_EXPORT_BYTES) return false
        parts.push(part)
        return true
      }
      if (analysisState.table === undefined || opened === undefined) {
        const resultOutput = execution.outputs.find(({ kind }) => kind === 'result')
        if (opened !== undefined && resultOutput?.kind === 'result') {
          const series = await client.requestAnalysisSeriesExport({
            datasetHandleId: opened.handleId,
            generation: opened.generation,
            resultHandleId: execution.resultHandleId,
            output: resultOutput.name,
            maxRows: MAX_EXPORT_ROWS,
          })
          const headers = series.columns.map(({ name, unit }) =>
            unit === undefined ? name : `${name} (${unit})`,
          )
          const rows = Array.from({ length: series.rowCount }, (_value, row) =>
            Object.fromEntries(
              series.columns.map((column, columnIndex) => [
                headers[columnIndex] ?? column.name,
                column.values[row] ?? null,
              ]),
            ),
          )
          if (format === 'csv') {
            appendPart(`${headers.map((header) => JSON.stringify(header)).join(',')}\n`)
            appendPart(
              `${rows
                .map((row) => headers.map((header) => JSON.stringify(row[header] ?? '')).join(','))
                .join('\n')}\n`,
            )
          } else appendPart(JSON.stringify(rows))
        } else appendPart(JSON.stringify(execution.outputs, null, 2))
      } else {
        const headers = analysisState.table.columns.map(({ name }) => name)
        const collect = (page: AnalysisTablePage): void => {
          const pageRows = analysisPageRows(page)
          if (format === 'csv') {
            if (parts.length === 0) appendPart(`${headers.join(',')}\n`)
            appendPart(
              `${pageRows
                .map((row) => headers.map((header) => JSON.stringify(row[header] ?? '')).join(','))
                .join('\n')}\n`,
            )
          } else {
            if (parts.length === 0) appendPart('[')
            for (const row of pageRows) {
              if (!appendPart(`${jsonRowCount === 0 ? '' : ','}${JSON.stringify(row)}`)) break
              jsonRowCount += 1
            }
          }
        }
        if (scope === 'selected') collect(analysisState.table)
        else {
          let offset = 0
          while (offset < analysisState.table.totalRows) {
            const page = await client.requestAnalysisTablePage({
              datasetHandleId: opened.handleId,
              generation: opened.generation,
              resultHandleId: execution.resultHandleId,
              output: analysisState.tableOutput ?? 'objects',
              offset,
              limit: 200,
              ...(tableFilter === undefined ? {} : { filter: tableFilter }),
              ...(tableSort === undefined ? {} : { sort: tableSort }),
            })
            collect(page)
            if (exportBytes > MAX_EXPORT_BYTES) break
            offset += page.rowCount
            if (page.rowCount === 0) break
          }
        }
        if (format === 'json' && exportBytes <= MAX_EXPORT_BYTES) appendPart(']')
      }
      if (exportBytes > MAX_EXPORT_BYTES) {
        setError(
          'Export exceeded the 16 MiB byte limit. Apply a result filter or export the current page.',
        )
        return
      }
      const blob = new Blob(parts, {
        type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `purejsimage-analysis.${format}`
      anchor.click()
      URL.revokeObjectURL(url)
      appendLog(`Exported ${scope} analysis rows as ${format.toUpperCase()}`)
    },
    [
      analysisPageRows,
      analysisState.execution,
      analysisState.table,
      analysisState.tableOutput,
      appendLog,
      client,
      opened,
      tableFilter,
      tableSort,
    ],
  )

  const pinAnalysisResult = useCallback((): void => {
    const execution = analysisState.execution
    const first = execution?.outputs[0]
    if (execution === undefined || first === undefined) return
    applyProjectMutation({
      kind: 'result.pin',
      result: {
        id: `result-${crypto.randomUUID()}` as WorkspaceSnapshot['pinnedResults'][number]['id'],
        graphOutput: first.name,
        label: `${first.name} result`,
        kind: first.kind,
        summary: {
          outputCount: execution.outputs.length,
          elapsedMilliseconds: execution.elapsedMilliseconds,
          outputs: execution.outputs.map(({ name, kind }) => ({ name, kind })),
        },
        createdAt: new Date().toISOString(),
      },
    })
  }, [analysisState.execution, applyProjectMutation])

  const selectAnalysisLabel = useCallback((selectedLabel?: number): void => {
    setAnalysisState((current) => ({
      ...current,
      ...(selectedLabel === undefined ? { selectedLabel: undefined } : { selectedLabel }),
    }))
  }, [])

  const deletePipelineNode = useCallback(
    (nodeId: string): void => {
      const graph = workspace.analysis.graph
      if (
        graph.nodes.some((node) =>
          node.inputs.some(
            (input) => input.source.kind === 'node' && input.source.nodeId === nodeId,
          ),
        )
      ) {
        setError(
          'Delete downstream analysis steps before deleting this step. The graph is unchanged.',
        )
        return
      }
      applyProjectMutation({
        kind: 'analysis.set-graph',
        graph: {
          ...graph,
          nodes: graph.nodes.filter(({ id }) => id !== nodeId),
          outputs: graph.outputs.filter(
            ({ source }) => source.kind !== 'node' || source.nodeId !== nodeId,
          ),
        },
      })
    },
    [applyProjectMutation, workspace.analysis.graph],
  )

  useEffect(() => {
    void client
      .initialize()
      .then(() => setWorkerReady(true))
      .catch((initializationError: unknown) => {
        setWorkerReady(false)
        setError(
          initializationError instanceof Error
            ? initializationError.message
            : 'Worker failed to start',
        )
        setStatus('crashed')
      })
    return client.onCrash((crash) => {
      setWorkerReady(false)
      setStatus('crashed')
      setError(`${crash.message} Your project state is unchanged; restart and reopen the source.`)
    })
  }, [client])

  useEffect(() => {
    if (environment.appEnvironment !== 'test') return
    window.__PJI_TEST_CRASH_WORKER__ = () => client.crashForTest()
    return () => {
      delete window.__PJI_TEST_CRASH_WORKER__
    }
  }, [client, environment.appEnvironment])

  const rememberSource = useCallback((name: string): void => {
    setRecentSources((current) => {
      const next = [name, ...current.filter((candidate) => candidate !== name)].slice(0, 6)
      window.localStorage.setItem(RECENT_SOURCE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const finishOpen = useCallback(
    async (
      nextSource: OpenedSourceDescriptor,
      locator: WorkspaceSourceReference['locator'],
      signal: AbortSignal,
      workerClient: ImagingWorkerClient,
      preparedDataset?: OpenedDatasetDescriptor,
    ): Promise<OpenedDatasetDescriptor> => {
      const summary = nextSource.datasets[0]
      if (summary === undefined) throw new Error('The document contains no scientific datasets.')
      const nextDataset =
        preparedDataset ??
        (await workerClient.openDataset(
          nextSource.documentId,
          summary.id,
          nextSource.generation,
          signal,
        ))
      const sourceMutation = projectSourceMutation(nextSource, locator)
      const dataset = sourceMutation.datasets[0]
      if (dataset === undefined) throw new Error('The document contains no scientific datasets.')
      const mutation: WorkspaceMutation = {
        ...sourceMutation,
        activate: {
          sourceId: sourceMutation.source.id,
          datasetReferenceId: dataset.id,
          plane: nextDataset.selection,
          component: 0,
        },
      }
      const previous = currentSnapshot()
      const leftoverRois = previous.analysis.roiSet.rois
      const previousSemanticId = runtime.current?.semanticSourceId
      for (const leftover of mutationsToReplaceOpenSource(previous)) {
        applyProjectMutation(leftover)
      }
      applyProjectMutation(mutation)
      for (const roi of leftoverRois) applyProjectMutation({ kind: 'roi.remove', roiId: roi.id })
      if (leftoverRois.length > 0 || currentSnapshot().workflow.selectedRoiId !== undefined)
        applyProjectMutation({ kind: 'roi.select' })
      setParticleSettings(DEFAULT_PARTICLE_WORKFLOW)
      setAnalysisDataset(undefined)
      setAnalysisOverlay(undefined)
      setAnalysisState({ busy: false, tableOffset: 0 })
      setBatchRows([])
      setAdvancedPlan(undefined)
      setAdvancedMessage(undefined)
      if (previousSemanticId !== undefined && previousSemanticId !== sourceMutation.source.id) {
        void runtime.releaseSource(previousSemanticId)
      }
      runtime.adopt(sourceMutation.source.id, nextSource, nextDataset)
      setSource(nextSource)
      setOpened(nextDataset)
      setSelection(nextDataset.selection)
      setComponent(0)
      setMapping({ mode: 'linear', range: 'auto' })
      autoRangeLocked.current = false
      setHistogram([])
      setInspectorTab('info')
      window.__PJI_WORKBENCH_METRICS__.sourceBytes = nextSource.source.size
      const horizontal = nextDataset.dataset.axes.find(
        ({ id }) => id === nextDataset.selection.displayAxes[0],
      )
      const vertical = nextDataset.dataset.axes.find(
        ({ id }) => id === nextDataset.selection.displayAxes[1],
      )
      window.__PJI_WORKBENCH_METRICS__.datasetPixels =
        (horizontal?.length ?? 0) * (vertical?.length ?? 0)
      openedAt.current = performance.now()
      window.__PJI_WORKBENCH_METRICS__.firstTileMilliseconds = null
      firstTileWaiters.current = []
      rememberSource(nextSource.source.name)
      appendLog(`Opened ${nextSource.source.name} with ${nextSource.reader.id}`)
      return nextDataset
    },
    [appendLog, applyProjectMutation, currentSnapshot, rememberSource, runtime],
  )

  const runOpen = useCallback(
    async (
      opener: (
        nextGeneration: number,
        signal: AbortSignal,
      ) => Promise<
        | OpenedSourceDescriptor
        | Readonly<{ source: OpenedSourceDescriptor; dataset: OpenedDatasetDescriptor }>
      >,
      locator: WorkspaceSourceReference['locator'],
      throwOnError = false,
      workerClient = client,
    ): Promise<OpenedDatasetDescriptor | undefined> => {
      const finishUxTask = beginUxTask('source.open')
      openAbort.current?.abort()
      const controller = new AbortController()
      openAbort.current = controller
      const nextGeneration = generation.current + 1
      setStatus('opening')
      setError(undefined)
      try {
        const openedResult = await opener(nextGeneration, controller.signal)
        const nextSource = 'dataset' in openedResult ? openedResult.source : openedResult
        const preparedDataset = 'dataset' in openedResult ? openedResult.dataset : undefined
        const nextDataset = await finishOpen(
          nextSource,
          locator,
          controller.signal,
          workerClient,
          preparedDataset,
        )
        generation.current = nextGeneration
        setStatus('ready')
        return nextDataset
      } catch (openError) {
        if (controller.signal.aborted) {
          appendLog('Source opening cancelled; the previous workspace was retained')
        } else {
          const message =
            openError instanceof ImagingRpcError
              ? `${openError.message}${openError.detail.guidance === undefined ? '' : ` ${openError.detail.guidance}`}`
              : openError instanceof Error
                ? openError.message
                : 'Unable to open the source.'
          setError(`${message} The previous workspace remains unchanged.`)
        }
        setStatus('ready')
        if (throwOnError) throw openError
        return undefined
      } finally {
        finishUxTask()
      }
    },
    [appendLog, client, finishOpen],
  )

  const openSample = useCallback(
    (sampleId = 'generated.calibrated-particles', throwOnError = false) => {
      return runOpen(
        (nextGeneration, signal) => client.openSample(nextGeneration, signal, sampleId),
        {
          kind: 'sample',
          sampleId,
        },
        throwOnError,
      )
    },
    [client, runOpen],
  )

  const waitForFirstUsefulTile = useCallback((signal: AbortSignal): Promise<void> => {
    if (autoRangeLocked.current || window.__PJI_WORKBENCH_METRICS__.firstTileMilliseconds !== null)
      return Promise.resolve()
    return new Promise((resolve, reject) => {
      const finish = (): void => {
        signal.removeEventListener('abort', onAbort)
        window.clearTimeout(timeout)
        resolve()
      }
      const onAbort = (): void => {
        firstTileWaiters.current = firstTileWaiters.current.filter((waiter) => waiter !== finish)
        signal.removeEventListener('abort', onAbort)
        window.clearTimeout(timeout)
        reject(new DOMException('Example action cancelled', 'AbortError'))
      }
      const timeout = window.setTimeout(finish, 15_000)
      firstTileWaiters.current.push(finish)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }, [])

  const openExample = useCallback(
    async (scenario: ExampleScenarioV1, signal: AbortSignal): Promise<void> => {
      const fixture = resolveExampleFixture(scenario.id)
      const cancel = (): void => {
        openAbort.current?.abort()
        analysisAbort.current?.abort(new DOMException('Example action cancelled', 'AbortError'))
      }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        let openedExample: OpenedDatasetDescriptor | undefined
        if (fixture.locator.kind === 'sample') {
          openedExample = await openSample(fixture.locator.sampleId, true)
        } else {
          const locator = fixture.locator
          openedExample = await runOpen(
            (nextGeneration, openSignal) => client.openBundled(locator, nextGeneration, openSignal),
            locator,
            true,
            client,
          )
        }
        signal.throwIfAborted()
        setParticleSettings(
          scenario.id === 'generated.touching-particles'
            ? { ...DEFAULT_PARTICLE_WORKFLOW, watershed: true }
            : DEFAULT_PARTICLE_WORKFLOW,
        )
        const preset = scenario.initialAnalysis
        if (preset !== undefined && openedExample !== undefined) {
          await waitForFirstUsefulTile(signal)
          signal.throwIfAborted()
          setInspectorTab('analysis')
          const runPreset = (): Promise<boolean> =>
            preset.kind === 'histogram'
              ? executeAnalysisGraph(histogramGraph(openedExample.selection, preset.component), {
                  roi: wholePlaneRoi(openedExample, openedExample.selection),
                  commit: true,
                  throwOnError: true,
                  dataset: openedExample,
                  workerClient: client,
                })
              : executeAnalysisGraph(
                  connectedComponentsGraph({
                    component: preset.component,
                    threshold: preset.threshold,
                    mode: preset.mode,
                    selection: openedExample.selection,
                    connectivity: preset.connectivity,
                  }),
                  {
                    overlay: preset.overlay,
                    commit: true,
                    throwOnError: true,
                    dataset: openedExample,
                    workerClient: client,
                  },
                )
          let succeeded = false
          try {
            succeeded = await runPreset()
          } catch (presetError) {
            const aborted = presetError instanceof DOMException && presetError.name === 'AbortError'
            if (!aborted) throw presetError
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
            signal.throwIfAborted()
            succeeded = await runPreset()
          }
          if (!succeeded)
            throw new Error(`${preset.title} could not be applied to ${scenario.title}.`)
          appendLog(`Opened ${scenario.title} with ${preset.title} already applied`)
        }
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    },
    [appendLog, client, executeAnalysisGraph, openSample, runOpen, waitForFirstUsefulTile],
  )

  const runExampleWorkflow = useCallback(
    async (
      scenario: ExampleScenarioV1,
      workflow: ExampleWorkflowV1,
      signal: AbortSignal,
    ): Promise<void> => {
      await openExample(scenario, signal)
      signal.throwIfAborted()
      setInspectorTab('analysis')
      setScriptRecipe(undefined)
      setScriptArtifactId(workflow.artifactId)
      setScriptStudioOpen(true)
      appendLog(`Prepared example workflow ${workflow.title} for review`)
    },
    [appendLog, openExample],
  )

  const openFiles = useCallback(
    (files: readonly File[]): void => {
      const primary = files[0]
      if (primary === undefined) return
      void runOpen(
        (nextGeneration, signal) => client.openLocal(files, primary, nextGeneration, signal),
        {
          kind: 'local',
          name: primary.name,
          size: primary.size,
          lastModified: primary.lastModified,
          companionNames: files.slice(1).map(({ name }) => name),
        },
      )
    },
    [client, runOpen],
  )

  const replayWorkspace = useCallback(
    async (snapshot: WorkspaceSnapshot, previous: WorkspaceSnapshot | undefined): Promise<void> => {
      setStatus('opening')
      setError(undefined)
      analysisAbort.current?.abort(new DOMException('Workspace replayed', 'AbortError'))
      analysisAbort.current = undefined
      const handles = [...new Set([previewResult.current, activeResult.current])].filter(
        (handle): handle is AnalysisResultHandleId => handle !== undefined,
      )
      previewResult.current = undefined
      activeResult.current = undefined
      const openedAtReplay = openedRef.current
      if (openedAtReplay !== undefined) {
        await Promise.all(
          handles.map((resultHandleId) =>
            client
              .releaseAnalysis({
                datasetHandleId: openedAtReplay.handleId,
                generation: openedAtReplay.generation,
                resultHandleId,
              })
              .catch(() => undefined),
          ),
        )
      }
      setAnalysisOverlay(undefined)
      setAnalysisDataset(undefined)
      setAnalysisState({ busy: false, tableOffset: 0 })
      setTableFilter(undefined)
      setTableSort(undefined)
      setConnectedPlanReady(false)
      try {
        const result = await reconciler.reconcile(previous, snapshot)
        if (result.status === 'needs-rebind') {
          setSource(undefined)
          setOpened(undefined)
          setSelection(undefined)
          setRebindSourceId(result.source?.id)
          setError(
            `${result.source?.label ?? 'The local source'} must be rebound. Select the original file; its identity will be checked before replay.`,
          )
        } else if (result.status === 'identity-mismatch') {
          setSource(undefined)
          setOpened(undefined)
          setSelection(undefined)
          setError(
            `${result.identity?.kind === 'mismatch' ? result.identity.message : 'Source identity mismatch'} Nothing was replayed.`,
          )
        } else if (result.status === 'ready') {
          const materialized = runtime.current
          if (materialized === undefined)
            throw new Error('The imaging runtime was not materialized.')
          setSource(materialized.source)
          setOpened(materialized.dataset)
          setSelection(snapshot.active?.plane)
          setComponent(snapshot.active?.component ?? 0)
          const layer = snapshot.layers.find(
            ({ datasetReferenceId }) => datasetReferenceId === snapshot.active?.datasetReferenceId,
          )
          setMapping(layer?.mapping ?? { mode: 'linear', range: 'auto' })
          generation.current = materialized.source.generation
          appendLog(
            `Replayed ${materialized.source.source.name} from project revision ${snapshot.revision}`,
          )
          if (snapshot.analysis.graph.nodes.length > 0) {
            const calibration = snapshot.calibrations.find(
              ({ datasetReferenceId: id }) => id === snapshot.active?.datasetReferenceId,
            )
            const request = {
              datasetHandleId: materialized.dataset.handleId,
              generation: materialized.dataset.generation,
              graph: snapshot.analysis.graph as unknown as RpcJsonObject,
              ...(calibration === undefined
                ? {}
                : {
                    calibration: {
                      axisIds: calibration.axisIds,
                      unitsPerPixel: calibration.unitsPerPixel,
                      unit: calibration.unit,
                    },
                  }),
            }
            const dryRun = await client.dryRunAnalysis(request)
            if (!dryRun.valid)
              throw new Error('The saved analysis graph no longer produces a valid replay plan.')
            const execution = await client.executeAnalysis(request)
            activeResult.current = execution.resultHandleId
            const derived = execution.outputs.find(({ kind }) => kind === 'dataset')
            setAnalysisDataset(
              derived?.kind === 'dataset'
                ? {
                    resultHandleId: execution.resultHandleId,
                    output: derived.name,
                    descriptor: derived.descriptor as unknown as OpenedDatasetDescriptor['dataset'],
                  }
                : undefined,
            )
            autoRangeLocked.current = false
            setMapping({ mode: 'linear', range: 'auto' })
            setAnalysisState({
              busy: false,
              dryRun,
              execution,
              tableOffset: 0,
              message: `Replayed saved numerical analysis in ${execution.elapsedMilliseconds.toFixed(1)} ms.`,
            })
            appendLog(`Replayed ${snapshot.analysis.graph.nodes.length} saved analysis steps.`)
          }
        } else {
          setSource(undefined)
          setOpened(undefined)
          setSelection(undefined)
        }
      } catch (replayError) {
        setError(
          `${replayError instanceof Error ? replayError.message : 'Project replay failed'} Project history remains unchanged.`,
        )
      } finally {
        setStatus('ready')
      }
    },
    [appendLog, client, reconciler, runtime],
  )

  const loadProject = useCallback(
    async (snapshot: WorkspaceSnapshot): Promise<void> => {
      const previous = currentSnapshot()
      replaceWorkspace(snapshot)
      setSavedProjectJson(serializeWorkspaceProject(snapshot))
      window.localStorage.setItem(LAST_PROJECT_KEY, snapshot.project.id)
      setInspectorTab(snapshot.workflow.inspector)
      setBottomTab(snapshot.workflow.bottom)
      setProjectDialog(false)
      await replayWorkspace(snapshot, previous)
    },
    [currentSnapshot, replaceWorkspace, replayWorkspace],
  )

  const visibleWorkspace = useCallback(
    (): WorkspaceSnapshot =>
      snapshotWithVisibleWorkflow(currentSnapshot(), {
        inspector: inspectorTab,
        bottom: bottomTab,
      }),
    [bottomTab, currentSnapshot, inspectorTab],
  )
  const projectJson = useMemo(
    () =>
      serializeWorkspaceProject(
        snapshotWithVisibleWorkflow(workspace, {
          inspector: inspectorTab,
          bottom: bottomTab,
        }),
      ),
    [bottomTab, inspectorTab, workspace],
  )

  const saveProject = useCallback(async (): Promise<void> => {
    try {
      const saved = visibleWorkspace()
      await projectStore.save(saved)
      setSavedProjectJson(serializeWorkspaceProject(saved))
      window.localStorage.setItem(LAST_PROJECT_KEY, saved.project.id)
      await refreshRecentProjects()
      appendLog(`Saved ${saved.project.title}`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the project.')
    }
  }, [appendLog, projectStore, refreshRecentProjects, visibleWorkspace])

  const saveProjectAs = useCallback(async (): Promise<void> => {
    try {
      const current = visibleWorkspace()
      const now = new Date().toISOString()
      const copy = importWorkspaceProject(
        JSON.stringify({
          ...current,
          revision: 0,
          project: {
            ...current.project,
            id: crypto.randomUUID() as ProjectId,
            title: `${current.project.title} copy`,
            createdAt: now,
            updatedAt: now,
          },
        }),
      )
      replaceWorkspace(copy)
      setSavedProjectJson(undefined)
      await projectStore.save(copy)
      setSavedProjectJson(serializeWorkspaceProject(copy))
      window.localStorage.setItem(LAST_PROJECT_KEY, copy.project.id)
      await refreshRecentProjects()
      appendLog(`Saved a new copy as ${copy.project.title}`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save a project copy.')
    }
  }, [appendLog, projectStore, refreshRecentProjects, replaceWorkspace, visibleWorkspace])

  const newProject = useCallback((): void => {
    const previous = currentSnapshot()
    const snapshot = createProject()
    replaceWorkspace(snapshot)
    setSavedProjectJson(undefined)
    window.localStorage.removeItem(LAST_PROJECT_KEY)
    setSource(undefined)
    setOpened(undefined)
    setSelection(undefined)
    setMapping({ mode: 'linear', range: 'auto' })
    setComponent(0)
    setError(undefined)
    setAnalysisDataset(undefined)
    setAnalysisOverlay(undefined)
    setAnalysisState({ busy: false, tableOffset: 0 })
    setBatchRows([])
    setAdvancedPlan(undefined)
    setAdvancedMessage(undefined)
    void reconciler.reconcile(previous, snapshot).catch((releaseError: unknown) => {
      setError(
        `${releaseError instanceof Error ? releaseError.message : 'Runtime cleanup failed.'} The new project remains active.`,
      )
    })
  }, [currentSnapshot, reconciler, replaceWorkspace])

  const performHistory = useCallback(
    (direction: 'undo' | 'redo'): void => {
      const previous = currentSnapshot()
      const next = stepHistory(direction)
      if (next.snapshot === previous) return
      void replayWorkspace(next.snapshot, previous)
    },
    [currentSnapshot, replayWorkspace, stepHistory],
  )

  const importProjectFile = useCallback(
    async (file: File | undefined): Promise<void> => {
      if (file === undefined) return
      try {
        const snapshot = importWorkspaceProject(await file.text())
        await projectStore.save(snapshot)
        await refreshRecentProjects()
        await loadProject(snapshot)
      } catch (importError) {
        setError(
          `${importError instanceof Error ? importError.message : 'Project import failed'} No project was changed or stored.`,
        )
      }
    },
    [loadProject, projectStore, refreshRecentProjects],
  )

  const applyRebind = useCallback(
    (
      sourceId: SemanticSourceId,
      files: readonly File[],
      nextSource: OpenedSourceDescriptor,
      nextDataset: OpenedDatasetDescriptor,
    ): void => {
      const primary = files[0]
      if (primary === undefined) return
      const datasets: readonly WorkspaceDatasetReference[] = nextSource.datasets.map(
        (descriptor) => ({
          id: datasetReferenceId(sourceId, descriptor.id),
          sourceId,
          datasetId: descriptor.id,
          identity: validateSemanticIdentity(descriptor.identity),
          descriptor,
        }),
      )
      applyProjectMutation({
        kind: 'source.rebind',
        sourceId,
        locator: {
          kind: 'local',
          name: primary.name,
          size: primary.size,
          lastModified: primary.lastModified,
          companionNames: files.slice(1).map(({ name }) => name),
        },
        identity: validateSemanticIdentity(nextSource.identity),
        bound: true,
        datasets,
      })
      runtime.bindLocalFiles(sourceId, files)
      runtime.adopt(sourceId, nextSource, nextDataset)
      setSource(nextSource)
      setOpened(nextDataset)
      setSelection(nextDataset.selection)
      setRebindSourceId(undefined)
      setIdentityMismatch(undefined)
      setError(undefined)
      setStatus('ready')
      appendLog(`Rebound ${primary.name} after identity approval`)
    },
    [appendLog, applyProjectMutation, runtime],
  )

  const rebindFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      const sourceReference = workspace.sources.find(({ id }) => id === rebindSourceId)
      const primary = files[0]
      const activeDataset = workspace.datasets.find(
        ({ id }) => id === workspace.active?.datasetReferenceId,
      )
      if (sourceReference === undefined || primary === undefined || activeDataset === undefined)
        return
      setStatus('opening')
      setError(undefined)
      try {
        const nextGeneration = generation.current + 1
        const nextSource = await client.openLocal(files, primary, nextGeneration)
        const descriptor = nextSource.datasets.find(({ id }) => id === activeDataset.datasetId)
        if (descriptor === undefined) {
          throw new Error('The selected files do not contain the saved dataset.')
        }
        const nextDataset = await client.openDataset(
          nextSource.documentId,
          descriptor.id,
          nextGeneration,
        )
        const actual = validateSemanticIdentity(nextSource.identity)
        if (!semanticIdentityEqual(sourceReference.identity, actual)) {
          setIdentityMismatch({
            sourceId: sourceReference.id,
            expected: sourceReference.identity,
            actual,
            files,
            openedSource: nextSource,
            openedDataset: nextDataset,
          })
          setError(
            'The selected source identity differs from the saved project. Nothing was replayed.',
          )
          setStatus('ready')
          return
        }
        generation.current = nextGeneration
        applyRebind(sourceReference.id, files, nextSource, nextDataset)
      } catch (rebindError) {
        setStatus('ready')
        setError(rebindError instanceof Error ? rebindError.message : 'Source rebind failed.')
      }
    },
    [
      applyRebind,
      client,
      rebindSourceId,
      workspace.active?.datasetReferenceId,
      workspace.datasets,
      workspace.sources,
    ],
  )

  useEffect(() => {
    let cancelled = false
    void refreshRecentProjects()
    const lastProjectId = window.localStorage.getItem(LAST_PROJECT_KEY)
    if (lastProjectId !== null) {
      void projectStore
        .load(lastProjectId as ProjectId)
        .then((snapshot) => {
          if (!cancelled && snapshot !== undefined) return loadProject(snapshot)
          return undefined
        })
        .catch((loadError: unknown) => {
          if (!cancelled) {
            setError(
              `${loadError instanceof Error ? loadError.message : 'Unable to restore the last project.'} The workbench opened a new project instead.`,
            )
          }
        })
    }
    return () => {
      cancelled = true
    }
  }, [loadProject, projectStore, refreshRecentProjects])

  const selectDataset = useCallback(
    async (datasetId: string): Promise<void> => {
      if (source === undefined || opened?.dataset.id === datasetId) return
      try {
        const next = await client.openDataset(source.documentId, datasetId, source.generation)
        const sourceReference = workspace.sources.find(
          ({ id }) => id === runtime.current?.semanticSourceId,
        )
        const datasetReference = workspace.datasets.find(
          (candidate) =>
            candidate.sourceId === sourceReference?.id && candidate.datasetId === datasetId,
        )
        if (sourceReference === undefined || datasetReference === undefined) {
          throw new Error('The selected dataset is not present in the semantic project.')
        }
        applyProjectMutation({
          kind: 'dataset.select',
          selection: {
            sourceId: sourceReference.id,
            datasetReferenceId: datasetReference.id,
            plane: next.selection,
            component: 0,
          },
        })
        const previous = opened
        setOpened(next)
        setSelection(next.selection)
        setComponent(0)
        if (previous !== undefined) await client.closeDataset(previous.handleId, source.generation)
      } catch (datasetError) {
        setError(datasetError instanceof Error ? datasetError.message : 'Unable to open dataset')
      }
    },
    [applyProjectMutation, client, opened, runtime, source, workspace.datasets, workspace.sources],
  )

  const changeSelection = useCallback(
    (next: PlaneSelection): void => {
      if (opened === undefined) return
      setConnectedPlanReady(false)
      void client
        .setPlane(opened.handleId, opened.generation, next)
        .then(() => {
          if (workspace.active !== undefined) {
            applyProjectMutation({
              kind: 'dataset.select',
              selection: { ...workspace.active, plane: next },
            })
          }
          autoRangeLocked.current = false
          setMapping({ mode: 'linear', range: 'auto' })
          setSelection(next)
        })
        .catch((selectionError: unknown) =>
          setError(
            selectionError instanceof Error ? selectionError.message : 'Plane selection failed',
          ),
        )
    },
    [applyProjectMutation, client, opened, workspace.active],
  )

  const onTile = useCallback((tile: RenderTile, first: boolean): void => {
    if (first && !autoRangeLocked.current) {
      setHistogram(tile.histogram)
      autoRangeLocked.current = true
      const displayRange = displayRangeFromTile(
        quantitativeRangeFromValues(tile.values),
        tile.histogram,
      )
      setMapping({
        mode: 'linear',
        range: 'auto',
        minimum: displayRange.minimum,
        maximum: displayRange.maximum,
      })
      const elapsed = performance.now() - openedAt.current
      window.__PJI_WORKBENCH_METRICS__.firstTileMilliseconds = elapsed
      const waiters = firstTileWaiters.current
      firstTileWaiters.current = []
      for (const waiter of waiters) waiter()
      setLog((current) => [
        ...current,
        `${new Date().toLocaleTimeString()} · First tile in ${elapsed.toFixed(1)} ms`,
      ])
    }
  }, [])

  const changeComponent = useCallback(
    (next: number): void => {
      if (workspace.active !== undefined) {
        applyProjectMutation({
          kind: 'dataset.select',
          selection: { ...workspace.active, component: next },
        })
      }
      autoRangeLocked.current = false
      setMapping({ mode: 'linear', range: 'auto' })
      setComponent(next)
      setConnectedPlanReady(false)
    },
    [applyProjectMutation, workspace.active],
  )

  const changeMapping = useCallback(
    (next: DisplayMapping): void => {
      const layer = workspace.layers.find(
        ({ datasetReferenceId }) => datasetReferenceId === workspace.active?.datasetReferenceId,
      )
      if (layer !== undefined) {
        applyProjectMutation({ kind: 'display.set-layer', layer: { ...layer, mapping: next } })
      }
      autoRangeLocked.current = next.range === 'manual'
      setMapping(next)
    },
    [applyProjectMutation, workspace.active?.datasetReferenceId, workspace.layers],
  )

  const setViewportApi = useCallback((api: ScientificViewportApi | null): void => {
    viewportApi.current = api
  }, [])

  const exportViewportPng = useCallback(async (): Promise<void> => {
    const api = viewportApi.current
    if (api === null) return
    const blob = await api.exportPng()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'purejsimage-rendered-view.png'
    anchor.click()
    URL.revokeObjectURL(url)
    appendLog(
      `Exported rendered PNG with ${mapping.mode} display mapping; source pixels were unchanged.`,
    )
  }, [appendLog, mapping.mode])

  const commandContext = useMemo<CommandContext>(
    () => ({
      hasDataset,
      canUndo: historyState.undo.length > 0,
      canRedo: historyState.redo.length > 0,
    }),
    [hasDataset, historyState.redo.length, historyState.undo.length],
  )
  const actionHostRef = useRef<WorkbenchActionHost<CommandContext> | undefined>(undefined)
  const actionHost = useMemo(
    () =>
      new WorkbenchActionHost(
        workbenchActionRegistry,
        new Map<string, ActionHandler<CommandContext>>([
          [
            'workspace.openSample@1',
            commandAction(async () => {
              await openSample()
            }),
          ],
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
                if (
                  graph === undefined ||
                  (roiId !== undefined && typeof roiId !== 'string') ||
                  opened === undefined ||
                  selection === undefined
                )
                  throw new Error('Analysis graph action input is invalid.')
                const roi =
                  typeof roiId === 'string'
                    ? workspace.analysis.roiSet.rois.find(({ id }) => id === roiId)
                    : wholePlaneRoi(calibratedOpened ?? opened, selection)
                if (roi === undefined) throw new Error('The recipe ROI is no longer available.')
                await executeAnalysisGraph(
                  graph as unknown as WorkspaceSnapshot['analysis']['graph'],
                  {
                    roi,
                    overlay: 'labels',
                    overlayView: particleSettings.overlayView,
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
                const operation = catalogOperation(analysisCatalog, operationId, operationVersion)
                if (operation === undefined) {
                  throw new Error('Analysis operation is unavailable.')
                }
                await runToolboxOperation(operation, parameters, mode)
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
              analysisAbort.current?.abort(
                new DOMException('Cancelled by semantic action.', 'AbortError'),
              )
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
            fixtureAction(() => workspace.analysis.graph as unknown as JsonValue),
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
          [
            'script.log@1',
            fixtureAction((input) => {
              const message =
                typeof input === 'object' && input !== null && !Array.isArray(input)
                  ? (input as { readonly [key: string]: JsonValue })['message']
                  : undefined
              if (typeof message === 'string')
                setLog((current) => [...current, `Script · ${message}`])
              return null
            }),
          ],
          [
            'script.create_draft@1',
            executeOnlyAction(async (input) => {
              const request = rpcObject(input)
              const id = request?.['id']
              const title = request?.['title']
              if (typeof id !== 'string' || typeof title !== 'string')
                throw new Error('Script draft requires bounded id and title fields.')
              const document = (await normalizeStudioDocument({
                schemaVersion: 1,
                kind: 'analysis-script',
                id,
                title,
                language: 'typescript',
                source: `export async function main() { return {} }\nglobalThis.__scriptMain = main\n`,
                manifest: {
                  scriptApiVersion: 1,
                  requestedCapabilities: [],
                  pureJsImageCompatibility: '^4.0.0',
                  workbenchCompatibility: '^0.0.0',
                  entrypoint: 'main',
                  deterministic: true,
                },
                tests: [],
                integrity: { algorithm: 'sha256', digest: '0'.repeat(64) },
              })) as AnalysisScriptDocumentV1
              const record = {
                schemaVersion: 1 as const,
                id,
                kind: 'analysis-script' as const,
                document,
                savedDocument: document,
                editor: {
                  schemaVersion: 1 as const,
                  selectionAnchor: 0,
                  selectionHead: 0,
                  scrollTop: 0,
                  activePanel: 'problems' as const,
                },
                testResults: [],
              }
              await scriptStore.put(record)
              return { id, digest: document.integrity.digest }
            }),
          ],
          [
            'script.read@1',
            fixtureAction(async (input) => {
              const id = rpcObject(input)?.['id']
              if (typeof id !== 'string') throw new Error('Script read requires an id.')
              const record = await scriptStore.get(id)
              if (record === undefined) throw new Error('Script or recipe was not found.')
              return record as unknown as JsonValue
            }),
          ],
          [
            'script.apply_patch@1',
            executeOnlyAction(async (input) => {
              const request = rpcObject(input)
              const id = request?.['id']
              const expectedDigest = request?.['expectedDigest']
              const source = request?.['source']
              if (
                typeof id !== 'string' ||
                typeof expectedDigest !== 'string' ||
                typeof source !== 'string'
              )
                throw new Error('Script patch requires id, expectedDigest, and source.')
              const record = await scriptStore.get(id)
              if (record?.document.kind !== 'analysis-script')
                throw new Error('Only sandboxed script source can be patched by this action.')
              if (record.document.integrity.digest !== expectedDigest)
                throw new Error('Script changed since the requested patch was prepared.')
              const document = (await normalizeStudioDocument({
                ...record.document,
                source,
              })) as AnalysisScriptDocumentV1
              await scriptStore.put({ ...record, document, testResults: [] })
              return { id, digest: document.integrity.digest, status: 'draft-updated' }
            }),
          ],
          [
            'script.typecheck@1',
            fixtureAction(async (input) => {
              const request = rpcObject(input)
              const id = request?.['id']
              const expectedDigest = request?.['expectedDigest']
              if (typeof id !== 'string' || typeof expectedDigest !== 'string')
                throw new Error('Script typecheck requires id and expectedDigest.')
              const record = await scriptStore.get(id)
              if (record?.document.kind !== 'analysis-script')
                throw new Error('Typecheck requires a sandboxed script.')
              if (record.document.integrity.digest !== expectedDigest)
                throw new Error('Script changed since typecheck was requested.')
              const [{ ScriptLanguageClient }] = await Promise.all([
                import('../features/scripts/language-client.js'),
              ])
              const client = new ScriptLanguageClient()
              try {
                const result = await client.check(
                  record.document.source,
                  record.document.language,
                  generateScriptApi(workbenchActionRegistry.manifest()),
                )
                return {
                  id,
                  digest: record.document.integrity.digest,
                  problems: result.problems,
                } as unknown as JsonValue
              } finally {
                client.dispose()
              }
            }),
          ],
          [
            'script.run_tests@1',
            executeOnlyAction(async (input) => {
              const request = rpcObject(input)
              const id = request?.['id']
              const expectedDigest = request?.['expectedDigest']
              if (typeof id !== 'string' || typeof expectedDigest !== 'string')
                throw new Error('Script tests require id and expectedDigest.')
              const record = await scriptStore.get(id)
              if (record === undefined) throw new Error('Script or recipe was not found.')
              if (record.document.integrity.digest !== expectedDigest)
                throw new Error('Script changed since tests were requested.')
              const host = actionHostRef.current
              if (host === undefined) throw new Error('Script action host is unavailable.')
              const [studio, languageModule, scriptModule] = await Promise.all([
                import('../features/scripts/studio-operations.js'),
                import('../features/scripts/language-client.js'),
                import('@pji-workbench/scripts/examples'),
              ])
              const languageClient = new languageModule.ScriptLanguageClient()
              try {
                const examples = await scriptModule.createBuiltInScriptStudioExamples()
                const example = examples.find((candidate) => candidate.id === id)
                const results = await studio.runDocumentTests({
                  document: record.document,
                  ...(example === undefined ? {} : { recipeTests: example.tests }),
                  language: languageClient,
                  api: generateScriptApi(workbenchActionRegistry.manifest()),
                  invoker: {
                    invoke: (actionId, version, actionInput, mode) =>
                      mode === 'dry-run'
                        ? host.dryRun(
                            actionId,
                            version,
                            actionInput,
                            { hasDataset: true },
                            ACTIVE_ACTION_SIGNAL,
                          )
                        : host.execute(
                            actionId,
                            version,
                            actionInput,
                            { hasDataset: true },
                            ACTIVE_ACTION_SIGNAL,
                          ),
                  },
                })
                await scriptStore.put({ ...record, testResults: results })
                return {
                  id,
                  digest: record.document.integrity.digest,
                  results,
                  status: results.every(({ status }) => status === 'passed') ? 'passed' : 'failed',
                } as unknown as JsonValue
              } finally {
                languageClient.dispose()
              }
            }),
          ],
          [
            'script.diff@1',
            fixtureAction(async (input) => {
              const request = rpcObject(input)
              const id = request?.['id']
              const expectedDigest = request?.['expectedDigest']
              if (typeof id !== 'string' || typeof expectedDigest !== 'string')
                throw new Error('Script diff requires id and expectedDigest.')
              const record = await scriptStore.get(id)
              if (record === undefined) throw new Error('Script or recipe was not found.')
              if (record.document.integrity.digest !== expectedDigest)
                throw new Error('Script changed since diff was requested.')
              const { boundedLineDiff, documentText } = await import(
                '../features/scripts/studio-operations.js'
              )
              return {
                id,
                lines: boundedLineDiff(
                  documentText(record.savedDocument),
                  documentText(record.document),
                ),
              }
            }),
          ],
          [
            'script.request_install@1',
            fixtureAction(async (input) => {
              const request = rpcObject(input)
              const id = request?.['id']
              const expectedDigest = request?.['expectedDigest']
              if (typeof id !== 'string' || typeof expectedDigest !== 'string')
                throw new Error('Installation request requires id and expectedDigest.')
              const record = await scriptStore.get(id)
              if (record === undefined) throw new Error('Script or recipe was not found.')
              if (record.document.integrity.digest !== expectedDigest)
                throw new Error('Script changed since installation was requested.')
              return {
                id,
                digest: record.document.integrity.digest,
                status: 'requires-user-review',
              }
            }),
          ],
          [
            'script.request_execute@1',
            fixtureAction(async (input) => {
              const request = rpcObject(input)
              const id = request?.['id']
              const expectedDigest = request?.['expectedDigest']
              if (typeof id !== 'string' || typeof expectedDigest !== 'string')
                throw new Error('Execution request requires id and expectedDigest.')
              const record = await scriptStore.get(id)
              if (record === undefined) throw new Error('Script or recipe was not found.')
              if (record.document.integrity.digest !== expectedDigest)
                throw new Error('Script changed since execution was requested.')
              return {
                id,
                digest: record.document.integrity.digest,
                status: 'requires-user-review',
              }
            }),
          ],
          ['workspace.new@1', commandAction(newProject)],
          ['workspace.openProject@1', commandAction(openProjectDialog)],
          ['workspace.save@1', commandAction(saveProject)],
          ['workspace.export@1', commandAction(() => downloadProject(visibleWorkspace()))],
          ['workspace.undo@1', commandAction(() => performHistory('undo'))],
          ['workspace.redo@1', commandAction(() => performHistory('redo'))],
          ['viewport.fit@1', commandAction(() => viewportApi.current?.fit())],
          ['viewport.oneToOne@1', commandAction(() => viewportApi.current?.oneToOne())],
          ['panel.agent@1', commandAction(() => setInspectorTab('agent'))],
          ['analysis.threshold.preview@1', commandAction(() => setPreviewEnabled(true))],
          ['analysis.threshold.commit@1', commandAction(applyThreshold)],
          ['analysis.connected-components.plan@1', commandAction(planConnectedComponents)],
          ['analysis.connected-components.execute@1', commandAction(runConnectedComponents)],
          [
            'theme.toggle@1',
            commandAction(() =>
              updatePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' }),
            ),
          ],
          ['palette.open@1', commandAction(() => setPaletteOpen(true))],
        ]),
      ),
    [
      newProject,
      openSample,
      applyThreshold,
      analysisCatalog,
      calibratedOpened,
      executeAnalysisGraph,
      opened,
      openProjectDialog,
      particleSettings.overlayView,
      planConnectedComponents,
      performHistory,
      preferences.theme,
      runToolboxOperation,
      runConnectedComponents,
      saveProject,
      selection,
      scriptStore,
      updatePreferences,
      visibleWorkspace,
      workspace,
    ],
  )
  actionHostRef.current = actionHost

  const scriptInvoker = useMemo<ScriptActionInvoker>(
    () => ({
      invoke: (id, version, input, mode) =>
        mode === 'dry-run'
          ? actionHost.dryRun(id, version, input, { hasDataset: true }, ACTIVE_ACTION_SIGNAL)
          : actionHost.execute(id, version, input, { hasDataset: true }, ACTIVE_ACTION_SIGNAL),
      cancel: () =>
        analysisAbort.current?.abort(
          new DOMException('Cancelled with the active sandbox script.', 'AbortError'),
        ),
    }),
    [actionHost],
  )
  const scriptActionManifest = useMemo(() => workbenchActionRegistry.manifest(), [])

  const executeAction = useCallback(
    (id: WorkbenchActionId): void => {
      void actionHost
        .execute(id, 1, {}, commandContext, ACTIVE_ACTION_SIGNAL)
        .catch((actionError: unknown) =>
          setError(actionError instanceof Error ? actionError.message : 'Action failed.'),
        )
    },
    [actionHost, commandContext],
  )

  const executeCommand = useCallback((id: CommandId): void => executeAction(id), [executeAction])

  const requestToolboxOperation = useCallback(
    (operation: ToolboxOperation, parameters: RpcJsonObject, mode: 'preview' | 'apply'): void => {
      void actionHost
        .execute(
          'analysis.request-execute',
          1,
          {
            operationId: operation.id,
            operationVersion: operation.version,
            parameters,
            mode,
          },
          commandContext,
          ACTIVE_ACTION_SIGNAL,
        )
        .catch((actionError: unknown) =>
          setAnalysisState((current) => ({
            ...current,
            message: actionError instanceof Error ? actionError.message : 'Operation failed.',
          })),
        )
    },
    [actionHost, commandContext],
  )

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      const command = resolveShortcut(event, {
        hasDataset,
        canUndo: historyState.undo.length > 0,
        canRedo: historyState.redo.length > 0,
      })
      if (command === undefined) return
      event.preventDefault()
      executeCommand(command)
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [executeCommand, hasDataset, historyState.redo.length, historyState.undo.length])

  const paletteCommands = useMemo<readonly PaletteCommand[]>(() => {
    const availability = getCommandAvailability({
      hasDataset,
      canUndo: historyState.undo.length > 0,
      canRedo: historyState.redo.length > 0,
    })
    const commands = workbenchCommands.map((command) => ({
      id: command.id,
      label: command.label,
      ...(command.shortcut === undefined ? {} : { shortcut: command.shortcut }),
      disabled: !availability[command.id],
    }))
    const descriptors = analysisCatalog?.capabilities['operationDescriptors']
    const operations: PaletteCommand[] = Array.isArray(descriptors)
      ? descriptors.flatMap((candidate) => {
          if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
            return []
          const id = candidate['id']
          const title = candidate['title']
          if (typeof id !== 'string' || typeof title !== 'string') return []
          return [{ id: `operation:${id}`, label: `Operation: ${title}`, disabled: !hasDataset }]
        })
      : []
    return [...commands, ...operations]
  }, [analysisCatalog, hasDataset, historyState.redo.length, historyState.undo.length])

  const startResize = useCallback(
    (config: ResizeConfig, event: Parameters<typeof startPanelResize>[1]): void =>
      startPanelResize(config, event, preferences, updatePreferences),
    [preferences, updatePreferences],
  )

  const submitRemote = (event: FormEvent): void => {
    event.preventDefault()
    closeUrlDialog()
    void runOpen((nextGeneration, signal) => client.openRemote(remoteUrl, nextGeneration, signal), {
      kind: 'remote',
      url: remoteUrl,
    })
  }

  const themeIcon = preferences.theme === 'dark' ? 'sun' : 'moon'
  const oppositeTheme: ThemeName = preferences.theme === 'dark' ? 'light' : 'dark'
  const datasetName = opened?.dataset.name ?? opened?.dataset.id
  const visibleRois = useMemo(
    () =>
      workspace.analysis.roiSet.rois.filter(
        (roi) => roi.presentation?.style?.['visible'] !== false,
      ),
    [workspace.analysis.roiSet.rois],
  )
  const workbenchReady = workerReady && status === 'ready'
  const analysisSettled = !analysisState.busy
  const roiContent =
    opened === undefined ? null : (
      <RoiInspector
        {...(activeCalibration === undefined ? {} : { calibration: activeCalibration })}
        onCalibration={(calibration) => {
          const datasetReferenceId = workspace.active?.datasetReferenceId
          if (datasetReferenceId === undefined) return
          applyProjectMutation(
            calibration === undefined
              ? { kind: 'calibration.remove', datasetReferenceId }
              : { kind: 'calibration.set', calibration: { ...calibration, datasetReferenceId } },
          )
        }}
        onDelete={deleteRoi}
        onMeasure={measureSelectedRoi}
        onRename={(roi, name) => {
          void updateRoi({ ...roi, name: name.trim() || roi.id })
        }}
        onSelect={selectRoi}
        onTool={setRoiTool}
        onVisibility={(roi, visible) => {
          void updateRoi({
            ...roi,
            presentation: {
              ...roi.presentation,
              style: { ...roi.presentation?.style, visible },
            },
          })
        }}
        opened={calibratedOpened ?? opened}
        rois={workspace.analysis.roiSet.rois}
        {...(workspace.workflow.selectedRoiId === undefined
          ? {}
          : { selectedRoiId: workspace.workflow.selectedRoiId })}
        tool={roiTool}
      />
    )
  const analysisContent = (
    <div className="analysis-surfaces">
      {opened === undefined || particleGraph === undefined ? null : (
        <ParticleAnalysisWorkflow
          busy={analysisState.busy}
          componentCount={opened.dataset.components.length}
          {...(currentParticleDryRun === undefined ? {} : { dryRun: currentParticleDryRun })}
          graphSteps={particleGraph.nodes.map(({ label, operation }) => label ?? operation.id)}
          {...(particleMessage === undefined ? {} : { message: particleMessage })}
          onCancel={() => {
            cancelPreview()
            setParticleMessage('Preview cancelled. The committed project is unchanged.')
          }}
          onCancelRun={() => {
            analysisAbort.current?.abort(
              new DOMException('Particle analysis cancelled', 'AbortError'),
            )
            setParticleMessage('Particle analysis cancelled. The committed project is unchanged.')
            setAnalysisState((current) => ({ ...current, busy: false }))
          }}
          onChange={(settings) => {
            setParticleSettings(settings)
            setParticleMessage(undefined)
            setParticleDryRun(undefined)
            setParticleDryRunIdentity(undefined)
            setAnalysisState((current) => {
              const { dryRun: _dryRun, ...rest } = current
              return rest
            })
          }}
          onOpenScripts={() => void openParticleRecipeInScripts()}
          onPlan={() => void planParticleAnalysis()}
          onPreview={previewParticleThreshold}
          onRun={runParticleAnalysis}
          onSaveRecipe={() => void saveParticleRecipe()}
          rois={workspace.analysis.roiSet.rois}
          settings={particleSettings}
        />
      )}
      {opened === undefined || selection === undefined ? null : (
        <AdvancedMaterialsWorkflows
          axes={opened.dataset.axes}
          batchRows={batchRows}
          busy={analysisState.busy}
          contextIdentity={advancedContextIdentity}
          {...(advancedMessage === undefined ? {} : { message: advancedMessage })}
          onBatchFiles={(files, concurrency) => void runBatchFiles(files, concurrency)}
          onCancelBatchItem={(itemId) => {
            if (batchCancelItem.current?.(itemId) === true)
              setAdvancedMessage(`Cancelled batch item ${itemId}. Other items continue.`)
          }}
          onCancel={() => {
            analysisAbort.current?.abort(new DOMException('Advanced work cancelled', 'AbortError'))
            batchCancel.current?.()
            setAdvancedMessage('Advanced work cancelled. The committed project is unchanged.')
            setAnalysisState((current) => ({ ...current, busy: false }))
          }}
          onPlanFft={(settings) => {
            const workflow = fftGraphFor(settings)
            if (workflow === undefined) {
              setAdvancedMessage('FFT requires a rectangular source ROI.')
              return
            }
            void planAdvanced('fft', advancedPlanIdentity(settings), workflow.graph, workflow.roi)
          }}
          onPlanStack={(settings) => {
            const graph = stackGraphFor(settings)
            if (graph !== undefined)
              void planAdvanced('stack', advancedPlanIdentity(settings), graph)
          }}
          onPlanSurface={(settings) => {
            const workflow = surfaceGraphFor(settings)
            if (workflow !== undefined)
              void planAdvanced(
                'surface',
                advancedPlanIdentity(settings),
                workflow.graph,
                workflow.roi,
              )
          }}
          onRunFft={(settings) => {
            const workflow = fftGraphFor(settings)
            if (workflow !== undefined)
              void executeAnalysisGraph(workflow.graph, {
                roi: workflow.roi,
                commit: true,
                surface: 'advanced',
              })
          }}
          onRunStack={(settings) => {
            const graph = stackGraphFor(settings)
            if (graph !== undefined)
              void executeAnalysisGraph(graph, { commit: true, surface: 'advanced' })
          }}
          onRunSurface={(settings) => {
            const workflow = surfaceGraphFor(settings)
            if (workflow !== undefined)
              void executeAnalysisGraph(workflow.graph, {
                roi: workflow.roi,
                commit: true,
                surface: 'advanced',
              })
          }}
          {...(advancedPlan === undefined ? {} : { plan: advancedPlan })}
          planeHeight={
            opened.dataset.axes.find(({ id }) => id === selection.displayAxes[1])?.length ?? 1
          }
          planeWidth={
            opened.dataset.axes.find(({ id }) => id === selection.displayAxes[0])?.length ?? 1
          }
          rois={workspace.analysis.roiSet.rois}
          selection={selection}
        />
      )}
      <details className="analysis-surfaces__toolbox">
        <summary>Operation browser and legacy threshold controls</summary>
        <AnalysisInspector
          catalog={analysisCatalog}
          {...(paletteOperationId === undefined ? {} : { focusOperationId: paletteOperationId })}
          component={component}
          planeLabel={selection?.displayAxes.join(' × ') ?? 'unavailable'}
          connectedPlanReady={connectedPlanReady}
          connectivity={connectivity}
          mode={thresholdMode}
          onApply={() => executeAction('analysis.threshold.commit')}
          onCancelPreview={cancelPreview}
          onConnectivity={(value) => {
            setConnectivity(value)
            setConnectedPlanReady(false)
          }}
          onMode={(value) => {
            setThresholdMode(value)
            setConnectedPlanReady(false)
          }}
          onPreview={() => executeAction('analysis.threshold.preview')}
          onPlanObjects={() => executeAction('analysis.connected-components.plan')}
          onRunObjects={() => executeAction('analysis.connected-components.execute')}
          onRunOperation={requestToolboxOperation}
          sampleType={opened?.dataset.sampleType}
          onThreshold={(value) => {
            setThreshold(value)
            setConnectedPlanReady(false)
          }}
          state={analysisState}
          threshold={threshold}
        />
      </details>
    </div>
  )
  const analysisResults = (
    <AnalysisResults
      onExport={(scope, format) => void downloadAnalysis(scope, format)}
      onFilter={changeTableFilter}
      onPage={changeTablePage}
      onPin={pinAnalysisResult}
      onSelectLabel={selectAnalysisLabel}
      onSort={changeTableSort}
      state={analysisState}
    />
  )

  return (
    <ThemeRoot className="workbench-theme" theme={preferences.theme}>
      <WorkbenchShell
        analysisSettled={analysisSettled}
        environment={environment.appEnvironment}
        rootRef={workbenchRoot}
        style={preferenceStyle}
        workbenchReady={workbenchReady}
      >
        <header className="app-bar">
          <div className="app-identity">
            <span className="app-mark" aria-hidden="true">
              P
            </span>
            <div>
              <h1>PureJsImage Lab</h1>
              <input
                aria-label="Project title"
                className="project-title"
                defaultValue={workspace.project.title}
                key={`${workspace.project.id}:${workspace.project.title}`}
                maxLength={4_096}
                onBlur={(event) => {
                  const title = event.target.value.trim()
                  if (title !== '' && title !== workspace.project.title) {
                    applyProjectMutation({ kind: 'project.set-title', title })
                  }
                }}
              />
              <span>{savedProjectJson === projectJson ? 'Saved locally' : 'Unsaved changes'}</span>
            </div>
          </div>
          <Toolbar label="Workspace actions">
            <IconButton
              className="app-bar__project-action"
              label="New"
              onClick={() => executeCommand('workspace.new')}
            >
              <Icon name="file-new" />
            </IconButton>
            <Button
              className="app-bar__projects"
              onClick={(event) => {
                projectDialogReturnFocus.current = event.currentTarget
                executeCommand('workspace.openProject')
              }}
            >
              Projects
            </Button>
            <IconButton
              className="app-bar__project-action"
              label="Save"
              onClick={() => executeCommand('workspace.save')}
            >
              <Icon name="save" />
            </IconButton>
            <IconButton
              className="app-bar__project-action"
              label="Save as"
              onClick={() => void saveProjectAs()}
            >
              <Icon name="save-as" />
            </IconButton>
            <IconButton
              className="app-bar__project-action"
              label="Export"
              onClick={() => executeCommand('workspace.export')}
            >
              <Icon name="export" />
            </IconButton>
            <IconButton
              className="app-bar__project-action"
              label="Import"
              onClick={() => projectImportInput.current?.click()}
            >
              <Icon name="import" />
            </IconButton>
            <input
              accept=".json,.pji-lab.json"
              aria-label="Import PureJsImage Lab project"
              className="visually-hidden"
              onChange={(event) => void importProjectFile(event.target.files?.[0])}
              ref={projectImportInput}
              type="file"
            />
            <IconButton
              className="app-bar__project-action"
              disabled={historyState.undo.length === 0}
              label="Undo project change"
              onClick={() => executeCommand('workspace.undo')}
            >
              <Icon name="undo" />
            </IconButton>
            <IconButton
              className="app-bar__project-action"
              disabled={historyState.redo.length === 0}
              label="Redo project change"
              onClick={() => executeCommand('workspace.redo')}
            >
              <Icon name="redo" />
            </IconButton>
            <span aria-hidden="true" className="toolbar-divider" />
            <Button onClick={() => fileInput.current?.click()} variant="primary">
              <Icon name="open" size={15} /> Open files
            </Button>
            <Button
              onClick={(event) => {
                urlDialogReturnFocus.current = event.currentTarget
                openUrlDialog()
              }}
            >
              <Icon name="link" size={15} /> Open URL
            </Button>
            <input
              accept={SUPPORTED_FILE_ACCEPT}
              aria-label="Choose local scientific files"
              className="visually-hidden"
              multiple
              onChange={(event) => openFiles([...(event.target.files ?? [])])}
              ref={fileInput}
              type="file"
            />
          </Toolbar>
          <Toolbar label="Application actions">
            <IconButton label="Open command palette" onClick={() => executeCommand('palette.open')}>
              <Icon name="command" />
            </IconButton>
            <IconButton
              label={`Use ${oppositeTheme} theme`}
              onClick={() => executeCommand('theme.toggle')}
            >
              <Icon name={themeIcon} />
            </IconButton>
            <IconButton label="Show agent readiness" onClick={() => executeCommand('panel.agent')}>
              <Icon name="agent" />
            </IconButton>
          </Toolbar>
        </header>

        {error === undefined ? null : (
          <div className="source-error" role="alert">
            <span>{error}</span>
            {status === 'crashed' ? (
              <Button
                onClick={() =>
                  void client.restart().then(async () => {
                    setWorkerReady(true)
                    runtime.clearRuntime()
                    await replayWorkspace(workspace, undefined)
                  })
                }
              >
                Restart imaging Worker
              </Button>
            ) : rebindSourceId === undefined ? (
              <Button onClick={() => setError(undefined)}>Dismiss</Button>
            ) : (
              <Button onClick={() => rebindInput.current?.click()}>Choose source files</Button>
            )}
          </div>
        )}

        <input
          aria-label="Rebind local source files"
          className="visually-hidden"
          multiple
          onChange={(event) => void rebindFiles([...(event.target.files ?? [])])}
          ref={rebindInput}
          type="file"
        />

        <main className="workbench-main">
          <div className="workbench-primary">
            <nav aria-label="Workbench modes" className="mode-rail">
              <IconButton
                aria-pressed={
                  inspectorTab === 'info' ||
                  inspectorTab === 'display' ||
                  inspectorTab === 'history'
                }
                className="mode-rail__button"
                label="Browse mode"
                onClick={() => setInspectorTab('info')}
              >
                <Icon name="browse" />
              </IconButton>
              <IconButton
                aria-pressed={inspectorTab === 'roi'}
                className="mode-rail__button"
                disabled={!hasDataset}
                label="ROI mode"
                onClick={() => setInspectorTab('roi')}
              >
                <Icon name="roi" />
              </IconButton>
              <IconButton
                aria-pressed={inspectorTab === 'analysis'}
                className="mode-rail__button"
                disabled={!hasDataset}
                label="Analyze mode"
                onClick={() => setInspectorTab('analysis')}
              >
                <Icon name="analyze" />
              </IconButton>
              <IconButton
                aria-pressed={bottomTab === 'results'}
                className="mode-rail__button"
                disabled={!hasDataset}
                label="Results mode"
                onClick={() => setBottomTab('results')}
              >
                <Icon name="results" />
              </IconButton>
              <IconButton
                aria-pressed={scriptStudioOpen}
                className="mode-rail__button"
                label="Script Studio"
                onClick={() => {
                  setScriptArtifactId(undefined)
                  setScriptRecipe(undefined)
                  setScriptStudioOpen(true)
                }}
              >
                <Icon name="code" />
              </IconButton>
              <IconButton
                aria-pressed={exampleGalleryOpen}
                className="mode-rail__button"
                label="Examples mode"
                onClick={(event) => {
                  exampleGalleryReturnFocus.current = event.currentTarget
                  setExampleGalleryOpen(true)
                }}
              >
                <Icon name="examples" />
              </IconButton>
              <IconButton className="mode-rail__button" disabled label="Agent mode unavailable">
                <Icon name="agent" />
              </IconButton>
            </nav>
            <Panel className="navigator-panel" label="Workspace navigator">
              <div className="panel-heading">
                <div>
                  <p>Navigator</p>
                  <h2>Workspace</h2>
                </div>
                <Icon name="layers" />
              </div>
              <nav aria-label="Project contents" className="navigator-tree">
                <p className="tree-group">Sources</p>
                {workspace.sources.length === 0 ? (
                  <TreeRow label="No source open" />
                ) : (
                  workspace.sources.map((reference) => (
                    <TreeRow
                      key={reference.id}
                      label={reference.label}
                      detail={
                        reference.bound
                          ? sourceLocatorDetail(reference.locator.kind)
                          : 'rebind required'
                      }
                      selected={workspace.active?.sourceId === reference.id}
                      onSelect={() => {
                        if (!reference.bound) {
                          setRebindSourceId(reference.id)
                          rebindInput.current?.click()
                        } else {
                          setInspectorTab('info')
                        }
                      }}
                    />
                  ))
                )}
                <p className="tree-group">Datasets</p>
                {workspace.datasets.map((dataset) => (
                  <TreeRow
                    depth={1}
                    key={dataset.id}
                    label={dataset.descriptor.name ?? dataset.datasetId}
                    detail={`${dataset.descriptor.axes.length}D`}
                    selected={workspace.active?.datasetReferenceId === dataset.id}
                    onSelect={() => void selectDataset(dataset.datasetId)}
                  />
                ))}
                <p className="tree-group">Layers</p>
                {workspace.layers.length === 0 ? (
                  <TreeRow depth={1} label="No display layers" />
                ) : (
                  workspace.layers.map((layer) => (
                    <TreeRow
                      depth={1}
                      detail={layer.visible ? `${Math.round(layer.opacity * 100)}%` : 'hidden'}
                      key={layer.id}
                      label={layer.label}
                      selected={workspace.workflow.selectedLayerId === layer.id}
                      onSelect={() => {
                        setInspectorTab('display')
                        applyProjectMutation({
                          kind: 'project.set-workflow',
                          workflow: { ...workspace.workflow, selectedLayerId: layer.id },
                        })
                      }}
                    />
                  ))
                )}
                <p className="tree-group">ROIs</p>
                {workspace.analysis.roiSet.rois.length === 0 ? (
                  <TreeRow depth={1} label="No regions yet" />
                ) : (
                  workspace.analysis.roiSet.rois.map((roi) => (
                    <TreeRow
                      depth={1}
                      detail={roi.geometry.kind}
                      key={roi.id}
                      label={roi.name ?? 'Unnamed ROI'}
                      selected={workspace.workflow.selectedRoiId === roi.id}
                      onSelect={() => {
                        selectRoi(roi.id)
                        setInspectorTab('roi')
                      }}
                    />
                  ))
                )}
                <p className="tree-group">Results</p>
                {workspace.pinnedResults.length === 0 ? (
                  <TreeRow depth={1} label="No pinned results" />
                ) : (
                  workspace.pinnedResults.map((result) => (
                    <TreeRow
                      depth={1}
                      detail={result.kind}
                      key={result.id}
                      label={result.label}
                      selected={workspace.workflow.selectedResultId === result.id}
                      onSelect={() => {
                        setBottomTab('results')
                        applyProjectMutation({
                          kind: 'project.set-workflow',
                          workflow: { ...workspace.workflow, selectedResultId: result.id },
                        })
                      }}
                    />
                  ))
                )}
                {workspace.sources.length === 0 && recentSources.length > 0 ? (
                  <p className="tree-group">Recent names</p>
                ) : null}
                {workspace.sources.length === 0
                  ? recentSources.map((name) => (
                      <TreeRow depth={1} detail="recent" key={name} label={name} />
                    ))
                  : null}
              </nav>
              <div className="navigator-footer">
                <span>Revision {workspace.revision}</span>
                <span>Local only</span>
              </div>
            </Panel>
            <Splitter
              label="Resize navigator"
              minimum={PREFERENCE_BOUNDS.leftPanelWidth.minimum}
              maximum={PREFERENCE_BOUNDS.leftPanelWidth.maximum}
              onChange={(value) => updatePreferences({ leftPanelWidth: value })}
              onPointerDown={(event) =>
                startResize({ key: 'leftPanelWidth', axis: 'x', direction: 1 }, event)
              }
              value={preferences.leftPanelWidth}
            />

            <section
              aria-label="Image viewport"
              className="viewport-panel"
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
              }}
              onDrop={(event) => {
                event.preventDefault()
                openFiles([...event.dataTransfer.files])
              }}
            >
              <div className="viewport-toolbar">
                <div className="dataset-breadcrumb">
                  {hasDataset ? (
                    <>
                      <span>{source?.source.name}</span>
                      <span aria-hidden="true">/</span>
                      <strong>{datasetName}</strong>
                      {analysisDataset === undefined ? null : (
                        <>
                          <span aria-hidden="true">/</span>
                          <strong>{analysisOutputLabel(analysisDataset.output)}</strong>
                        </>
                      )}
                    </>
                  ) : (
                    <span>No dataset</span>
                  )}
                </div>
                <Toolbar label="Viewport tools">
                  <span className="tool-hint">Wheel zoom · Space drag pan · Drop files here</span>
                  <span className="context-chip">
                    {calibrationLabel(calibratedOpened ?? opened)}
                  </span>
                  <IconButton
                    disabled={!hasDataset}
                    label="Fit image"
                    onClick={() => executeCommand('viewport.fit')}
                  >
                    <Icon name="fit" />
                  </IconButton>
                  <IconButton
                    disabled={!hasDataset}
                    label="Actual pixels"
                    onClick={() => executeCommand('viewport.oneToOne')}
                  >
                    <span className="one-to-one">1:1</span>
                  </IconButton>
                  <IconButton
                    disabled={!hasDataset}
                    label="Export rendered PNG"
                    onClick={() => void exportViewportPng()}
                  >
                    <Icon name="download" />
                  </IconButton>
                </Toolbar>
              </div>
              <div className={`viewport-stage${hasDataset ? ' viewport-stage--has-data' : ''}`}>
                {status === 'opening' ? (
                  <div className="source-opening" role="status">
                    <span className="source-opening__bar" />
                    <strong>Opening source in the imaging Worker…</strong>
                    <span>The current workspace stays available until opening succeeds.</span>
                    <Button onClick={() => openAbort.current?.abort()}>Cancel</Button>
                  </div>
                ) : hasDataset && opened !== undefined && selection !== undefined ? (
                  <ScientificViewport
                    analysisDataset={analysisDataset}
                    analysisPoints={frequencyAnnotations}
                    analysisOverlay={analysisOverlay}
                    client={client}
                    component={component}
                    mapping={mapping}
                    onReady={setViewportApi}
                    onRenderSettled={setRenderSettled}
                    onCreateRoi={handleCreateRoi}
                    onDeleteRoi={deleteRoi}
                    onSelectRoi={selectRoi}
                    onSelectLabel={selectAnalysisLabel}
                    onTile={onTile}
                    opened={calibratedOpened ?? opened}
                    roiTool={roiTool}
                    rois={visibleRois}
                    selectedLabel={analysisState.selectedLabel}
                    selectedRoiId={workspace.workflow.selectedRoiId}
                    selection={selection}
                  />
                ) : workspace.sources.length > 0 ? (
                  <section className="empty-start" aria-labelledby="empty-start-title">
                    <Icon name="open" size={30} />
                    <p className="panel-kicker">Project open · source not bound</p>
                    <h2 id="empty-start-title">
                      {(
                        workspace.sources.find((reference) => !reference.bound) ??
                        workspace.sources[0]
                      )?.label ?? 'This source'}{' '}
                      must be rebound
                    </h2>
                    <p>
                      Select the original file. Its identity will be checked before analysis can
                      replay.
                    </p>
                    <div className="empty-start__actions">
                      <Button
                        onClick={() => {
                          const unbound =
                            workspace.sources.find((reference) => !reference.bound) ??
                            workspace.sources[0]
                          if (unbound !== undefined) setRebindSourceId(unbound.id)
                          rebindInput.current?.click()
                        }}
                        variant="primary"
                      >
                        <Icon name="open" size={16} /> Choose source files
                      </Button>
                    </div>
                  </section>
                ) : (
                  <section className="empty-start" aria-labelledby="empty-start-title">
                    <Icon name="open" size={30} />
                    <p className="panel-kicker">Local-first scientific imaging</p>
                    <h2 id="empty-start-title">
                      Start with an original file or a verified example
                    </h2>
                    <p>
                      Inspect calibration, measure regions, and replay analysis without uploading
                      local source pixels.
                    </p>
                    <div className="empty-start__actions">
                      <Button onClick={() => fileInput.current?.click()} variant="primary">
                        <Icon name="open" size={16} /> Open local file
                      </Button>
                      <Button
                        onClick={(event) => {
                          exampleGalleryReturnFocus.current = event.currentTarget
                          setExampleGalleryOpen(true)
                        }}
                      >
                        <Icon name="examples" size={16} /> Browse examples
                      </Button>
                      <Button
                        onClick={(event) => {
                          urlDialogReturnFocus.current = event.currentTarget
                          openUrlDialog()
                        }}
                      >
                        <Icon name="link" size={16} /> Open remote URL
                      </Button>
                      <Button
                        onClick={(event) => {
                          projectDialogReturnFocus.current = event.currentTarget
                          executeCommand('workspace.openProject')
                        }}
                      >
                        <Icon name="folder" size={16} /> Open saved project
                      </Button>
                    </div>
                    <div className="empty-start__sample">
                      <Button
                        onClick={() => executeCommand('workspace.openSample')}
                        variant="ghost"
                      >
                        Try generated calibrated sample
                      </Button>
                      <span>Offline · SEM-like · 0.42 nm/px</span>
                    </div>
                    <p className="empty-start__privacy">
                      Local files stay on this device. Remote sources are fetched only when you
                      explicitly provide an HTTPS URL.
                    </p>
                  </section>
                )}
              </div>
            </section>

            <Splitter
              label="Resize inspector"
              minimum={PREFERENCE_BOUNDS.rightPanelWidth.minimum}
              maximum={PREFERENCE_BOUNDS.rightPanelWidth.maximum}
              onChange={(value) => updatePreferences({ rightPanelWidth: value })}
              onPointerDown={(event) =>
                startResize({ key: 'rightPanelWidth', axis: 'x', direction: -1 }, event)
              }
              value={preferences.rightPanelWidth}
            />
            <Panel className="inspector-panel" label="Inspector">
              <div className="panel-heading">
                <div>
                  <p>Inspector</p>
                  <h2>{datasetName ?? 'Nothing selected'}</h2>
                </div>
              </div>
              <Tabs
                compact
                items={inspectorTabs}
                label="Inspector sections"
                onSelect={(tab) => {
                  measureUxNextPaint('inspector.tab')
                  setInspectorTab(tab)
                }}
                selectedId={inspectorTab === 'history' ? 'info' : inspectorTab}
              />
              <div className="inspector-scroll">
                <InspectorContent
                  analysisContent={analysisContent}
                  component={component}
                  history={historyState.undo}
                  mapping={mapping}
                  onComponent={changeComponent}
                  onMapping={changeMapping}
                  onSelection={changeSelection}
                  opened={opened}
                  roiContent={roiContent}
                  selection={selection}
                  source={source}
                  tab={inspectorTab === 'history' ? 'info' : inspectorTab}
                />
              </div>
            </Panel>
          </div>

          <Splitter
            label="Resize results panel"
            maximum={PREFERENCE_BOUNDS.bottomPanelHeight.maximum}
            minimum={PREFERENCE_BOUNDS.bottomPanelHeight.minimum}
            onChange={(value) => updatePreferences({ bottomPanelHeight: value })}
            onPointerDown={(event) =>
              startResize({ key: 'bottomPanelHeight', axis: 'y', direction: -1 }, event)
            }
            orientation="horizontal"
            value={preferences.bottomPanelHeight}
          />
          <Panel className="bottom-panel" label="Analysis output">
            <Tabs
              items={bottomTabs}
              label="Analysis output sections"
              onSelect={(tab) => {
                setBottomTab(tab)
              }}
              selectedId={bottomTab}
            />
            <div className="bottom-content">
              <BottomContent
                analysisResults={analysisResults}
                analysisState={analysisState}
                histogram={histogram}
                history={historyState.undo}
                log={log}
                opened={calibratedOpened ?? opened}
                onDeleteNode={deletePipelineNode}
                onEditNode={() => setInspectorTab('analysis')}
                tab={bottomTab}
                workspace={workspace}
              />
            </div>
          </Panel>
        </main>

        <div aria-label="Workbench status" className="status-bar" role="status">
          <StatusItem label="Application status">
            <span className="status-dot" aria-hidden="true" />
            {status === 'opening' ? 'Opening' : status === 'crashed' ? 'Worker stopped' : 'Ready'}
          </StatusItem>
          <StatusItem label="Source">
            {source === undefined
              ? 'No source open'
              : `${source.source.name} · ${sourceLocatorDetail(source.source.kind)}`}
          </StatusItem>
          <span className="status-spacer" />
          <StatusItem label="Calibration">
            {activeCalibration === undefined
              ? `${calibrationLabel(opened)} · file metadata`
              : `${activeCalibration.unitsPerPixel[0]} × ${activeCalibration.unitsPerPixel[1]} ${activeCalibration.unit}/px · project ${activeCalibration.source} override`}
          </StatusItem>
          <StatusItem label="Privacy">Files stay on this device</StatusItem>
        </div>
      </WorkbenchShell>

      {urlDialog ? (
        <div className="url-dialog-backdrop">
          <form
            aria-label="Open remote scientific source"
            aria-modal="true"
            className="url-dialog"
            onKeyDown={(event) => handleDialogKeyDown(event, closeUrlDialog)}
            onSubmit={submitRemote}
            role="dialog"
          >
            <h2>Open remote source</h2>
            <p>
              HTTPS is required outside localhost. The server must support CORS and byte ranges.
            </p>
            <label>
              Source URL
              <input
                onChange={(event) => setRemoteUrl(event.target.value)}
                placeholder="https://example.org/volume.mrc"
                ref={urlInput}
                required
                type="url"
                value={remoteUrl}
              />
            </label>
            <div className="url-dialog__actions">
              <Button onClick={closeUrlDialog} type="button">
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Open URL
              </Button>
            </div>
          </form>
        </div>
      ) : null}
      {projectDialog ? (
        <div className="url-dialog-backdrop">
          <section
            aria-label="Recent projects"
            aria-modal="true"
            className="url-dialog"
            onKeyDown={(event) => handleDialogKeyDown(event, closeProjectDialog)}
            ref={projectDialogRoot}
            role="dialog"
          >
            <h2>Recent projects</h2>
            <p>Projects and bounded result artifacts are stored only in this browser profile.</p>
            <div className="recent-projects">
              {recentProjects.length === 0 ? <p>No saved projects yet.</p> : null}
              {recentProjects.map((project) => (
                <button
                  className="recent-project"
                  data-dialog-initial-focus={project === recentProjects[0]}
                  key={project.id}
                  onClick={() => {
                    void projectStore
                      .load(project.id)
                      .then((snapshot) => {
                        if (snapshot !== undefined) return loadProject(snapshot)
                        throw new Error('The selected project no longer exists.')
                      })
                      .catch((openError: unknown) => {
                        closeProjectDialog()
                        setError(
                          openError instanceof Error
                            ? openError.message
                            : 'Unable to open the selected project.',
                        )
                      })
                  }}
                  type="button"
                >
                  <strong>{project.title}</strong>
                  <span>
                    {new Date(project.updatedAt).toLocaleString()} · {fileSize(project.bytes)}
                  </span>
                </button>
              ))}
            </div>
            <div className="url-dialog__actions">
              <Button onClick={closeProjectDialog}>Close</Button>
              <Button
                data-dialog-initial-focus={recentProjects.length === 0}
                onClick={() => projectImportInput.current?.click()}
                variant="primary"
              >
                Import project
              </Button>
            </div>
          </section>
        </div>
      ) : null}
      {identityMismatch === undefined ? null : (
        <div className="url-dialog-backdrop">
          <section aria-label="Source identity mismatch" className="url-dialog" role="alertdialog">
            <h2>Source identity mismatch</h2>
            <p>
              The selected files do not match the identity saved with this project. Analysis has not
              run and the saved project is unchanged.
            </p>
            <div className="identity-warning">
              <strong>{identityMismatch.openedSource.source.name}</strong>
              <span>Use it only if this is an intentional source replacement.</span>
            </div>
            <div className="url-dialog__actions">
              <Button
                onClick={() => {
                  setIdentityMismatch(undefined)
                  rebindInput.current?.click()
                }}
              >
                Choose another file
              </Button>
              <Button
                onClick={() => {
                  generation.current = identityMismatch.openedSource.generation
                  applyRebind(
                    identityMismatch.sourceId,
                    identityMismatch.files,
                    identityMismatch.openedSource,
                    identityMismatch.openedDataset,
                  )
                }}
                variant="primary"
              >
                Use selected source
              </Button>
            </div>
          </section>
        </div>
      )}
      {exampleGalleryOpen ? (
        <ExampleGallery
          onClose={() => setExampleGalleryOpen(false)}
          onInspectWorkflow={(workflow) => {
            setExampleGalleryOpen(false)
            setScriptRecipe(undefined)
            setScriptArtifactId(workflow.artifactId)
            setScriptStudioOpen(true)
          }}
          onOpen={openExample}
          onRunWorkflow={runExampleWorkflow}
          returnFocusTo={exampleGalleryReturnFocus.current}
        />
      ) : null}
      {scriptStudioOpen ? (
        <Suspense
          fallback={
            <div className="script-studio-backdrop" role="status">
              Loading sandbox tools…
            </div>
          }
        >
          <ScriptStudioSurface
            actionManifest={scriptActionManifest}
            initialArtifactId={scriptArtifactId}
            invoker={scriptInvoker}
            onClose={() => setScriptStudioOpen(false)}
            onOpenPanel={setBottomTab}
            recipe={scriptRecipe}
            repository={scriptStore}
          />
        </Suspense>
      ) : null}
      <CommandPalette
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
        onRun={(id) => {
          if (id.startsWith('operation:')) {
            setPaletteOperationId(id.slice('operation:'.length))
            setInspectorTab('analysis')
            return
          }
          executeCommand(id as CommandId)
        }}
        open={paletteOpen}
      />
    </ThemeRoot>
  )
}
