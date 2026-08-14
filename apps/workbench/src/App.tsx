import type {
  AnalysisCatalog,
  AnalysisExecutionResponse,
  AnalysisResultHandleId,
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
import { createImagingWorkerClient, ImagingRpcError } from '@pji-workbench/imaging'
import {
  Button,
  CommandPalette,
  EmptyState,
  Icon,
  IconButton,
  type PaletteCommand,
  Panel,
  Splitter,
  StatusItem,
  type TabItem,
  Tabs,
  type ThemeName,
  ThemeRoot,
  Toolbar,
  TreeRow,
} from '@pji-workbench/ui'
import {
  createEmptyWorkspace,
  type DisplayLayerState,
  datasetReferenceId,
  IndexedDbProjectStore,
  importWorkspaceProject,
  type LayerId,
  type ProjectId,
  type ProjectSummary,
  type SemanticSourceId,
  semanticIdentityEqual,
  serializeWorkspaceProject,
  validateSemanticIdentity,
  type WorkspaceDatasetReference,
  WorkspaceHistory,
  type WorkspaceHistoryEntry,
  type WorkspaceHistoryState,
  type WorkspaceMutation,
  WorkspaceRuntimeReconciler,
  type WorkspaceSnapshot,
  type WorkspaceSourceReference,
  workspaceCommand,
} from '@pji-workbench/workspace'
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ANALYSIS_OPERATIONS,
  connectedComponentsGraph,
  histogramGraph,
  lineProfileGraph,
  statisticsGraph,
  thresholdGraph,
} from './analysis-workflows.js'
import {
  type CommandId,
  getCommandAvailability,
  resolveShortcut,
  workbenchCommands,
} from './commands.js'
import type { PublicEnvironment } from './environment.js'
import {
  AnalysisInspector,
  AnalysisResults,
  type MaterialsPanelState,
  RoiInspector,
  readablePipeline,
} from './MaterialsPanels.js'
import {
  LocalWorkbenchPreferenceStore,
  PREFERENCE_BOUNDS,
  type WorkbenchPreferences,
} from './preferences.js'
import { WorkbenchWorkspaceRuntime } from './project-runtime.js'
import {
  type AnalysisOverlaySelection,
  type RoiTool,
  ScientificViewport,
  type ScientificViewportApi,
  type ViewportRoi,
} from './ScientificViewport.js'

type InspectorTab = 'info' | 'display' | 'roi' | 'analysis' | 'history' | 'agent'
type BottomTab = 'pipeline' | 'history' | 'histogram' | 'profile' | 'results' | 'log'
type OpenStatus = 'ready' | 'opening' | 'crashed'

const inspectorTabs: readonly TabItem<InspectorTab>[] = [
  { id: 'info', label: 'Info' },
  { id: 'display', label: 'Display' },
  { id: 'roi', label: 'ROI' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'history', label: 'History' },
  { id: 'agent', label: 'Agent' },
]

const bottomTabs: readonly TabItem<BottomTab>[] = [
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'history', label: 'History' },
  { id: 'histogram', label: 'Histogram' },
  { id: 'profile', label: 'Line Profile' },
  { id: 'results', label: 'Results' },
  { id: 'log', label: 'Log' },
]

const RECENT_SOURCE_KEY = 'pji-workbench.recent-source-names.v1'
const LAST_PROJECT_KEY = 'pji-workbench.last-project-id.v1'
const HISTOGRAM_BIN_IDS = Array.from({ length: 32 }, (_value, index) => `histogram-${index}`)

function preferenceStyle(preferences: WorkbenchPreferences): CSSProperties {
  return {
    '--left-panel-width': `${preferences.leftPanelWidth}px`,
    '--right-panel-width': `${preferences.rightPanelWidth}px`,
    '--bottom-panel-height': `${preferences.bottomPanelHeight}px`,
  } as CSSProperties
}

function fileSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`
}

function readRecentSources(storage: Storage): readonly string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(RECENT_SOURCE_KEY) ?? '[]')
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : []
  } catch {
    return []
  }
}

function createProject(title = 'Untitled microscopy project'): WorkspaceSnapshot {
  const now = new Date().toISOString()
  return createEmptyWorkspace(title, {
    projectId: crypto.randomUUID() as ProjectId,
    now,
    appVersion: '0.0.0',
    pureJsImageVersion: '0.10.0',
  })
}

function projectSourceMutation(
  nextSource: OpenedSourceDescriptor,
  locator: WorkspaceSourceReference['locator'],
): Extract<WorkspaceMutation, { readonly kind: 'source.add' }> {
  const sourceId = `source-${crypto.randomUUID()}` as SemanticSourceId
  const source: WorkspaceSourceReference = {
    id: sourceId,
    label: nextSource.source.name,
    locator,
    identity: validateSemanticIdentity(nextSource.identity),
    reader: nextSource.reader,
    bound: true,
  }
  const datasets: readonly WorkspaceDatasetReference[] = nextSource.datasets.map((descriptor) => ({
    id: datasetReferenceId(sourceId, descriptor.id),
    sourceId,
    datasetId: descriptor.id,
    identity: validateSemanticIdentity(descriptor.identity),
    descriptor,
  }))
  const first = datasets[0]
  return {
    kind: 'source.add',
    source,
    datasets,
    ...(first === undefined
      ? {}
      : {
          layers: [
            {
              id: `layer-${crypto.randomUUID()}` as LayerId,
              datasetReferenceId: first.id,
              label: first.descriptor.name ?? first.datasetId,
              visible: true,
              opacity: 1,
              mapping: { mode: 'linear', range: 'auto' },
              palette: 'gray',
            } satisfies DisplayLayerState,
          ],
        }),
  }
}

function downloadProject(snapshot: WorkspaceSnapshot): void {
  const blob = new Blob([serializeWorkspaceProject(snapshot)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${snapshot.project.title.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase() || 'project'}.pji-lab.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function axisPairOptions(opened: OpenedDatasetDescriptor): readonly (readonly [string, string])[] {
  const planeReads = opened.dataset.capabilities.planeReads
  if (planeReads.kind === 'ordered-axis-pairs') return planeReads.pairs
  const axes = opened.dataset.axes
  const pairs: (readonly [string, string])[] = []
  for (let horizontal = 0; horizontal < axes.length; horizontal += 1) {
    for (let vertical = horizontal + 1; vertical < axes.length; vertical += 1) {
      const left = axes[horizontal]
      const right = axes[vertical]
      if (left !== undefined && right !== undefined) pairs.push([left.id, right.id])
    }
  }
  return pairs
}

function calibrationLabel(opened: OpenedDatasetDescriptor | undefined): string {
  if (opened === undefined) return 'Uncalibrated'
  const axis = opened.dataset.axes.find(
    ({ id, coordinates, unit }) =>
      id === opened.selection.displayAxes[0] && coordinates.type === 'linear' && unit !== undefined,
  )
  if (axis?.coordinates.type !== 'linear' || axis.unit === undefined) return 'Uncalibrated'
  return `${axis.coordinates.step} ${axis.unit}/px`
}

interface InspectorContentProps {
  readonly tab: InspectorTab
  readonly source: OpenedSourceDescriptor | undefined
  readonly opened: OpenedDatasetDescriptor | undefined
  readonly selection: PlaneSelection | undefined
  readonly component: number
  readonly mapping: DisplayMapping
  readonly onComponent: (component: number) => void
  readonly onMapping: (mapping: DisplayMapping) => void
  readonly onSelection: (selection: PlaneSelection) => void
  readonly history: readonly WorkspaceHistoryEntry[]
  readonly roiContent: ReactNode
  readonly analysisContent: ReactNode
}

function InspectorContent({
  tab,
  source,
  opened,
  selection,
  component,
  mapping,
  onComponent,
  onMapping,
  onSelection,
  history,
  roiContent,
  analysisContent,
}: InspectorContentProps) {
  if (tab === 'agent') {
    return (
      <div className="inspector-content agent-panel" data-testid="agent-panel">
        <p className="panel-kicker">User-approved tool client</p>
        <div className="agent-message">
          The imaging Worker is ready. Analysis tools arrive in the next workflow prompts.
        </div>
        <Button disabled={opened === undefined} variant="primary">
          Review proposed plan
        </Button>
        <p className="panel-note">No model or network request has been made.</p>
      </div>
    )
  }
  if (source === undefined || opened === undefined || selection === undefined) {
    return <p className="panel-placeholder">Open a dataset to inspect {tab} settings.</p>
  }
  if (tab === 'display') {
    const pairs = axisPairOptions(opened)
    return (
      <div className="inspector-content form-stack">
        <label>
          Component
          <select value={component} onChange={(event) => onComponent(Number(event.target.value))}>
            {opened.dataset.components.map((candidate, index) => (
              <option key={candidate.id} value={index}>
                {candidate.name ?? candidate.id}
              </option>
            ))}
          </select>
        </label>
        {pairs.length > 1 ? (
          <label>
            Plane axes
            <select
              value={selection.displayAxes.join('/')}
              onChange={(event) => {
                const pair = pairs.find((candidate) => candidate.join('/') === event.target.value)
                if (pair === undefined) return
                onSelection({
                  ...selection,
                  displayAxes: pair,
                  fixedIndices: opened.dataset.axes
                    .filter(({ id }) => id !== pair[0] && id !== pair[1])
                    .map(({ id }) => ({ axisId: id, index: 0 })),
                })
              }}
            >
              {pairs.map((pair) => (
                <option key={pair.join('/')} value={pair.join('/')}>
                  {pair.join(' / ')}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {opened.dataset.capabilities.resolutionLevels && opened.dataset.levels.length > 1 ? (
          <label>
            Resolution level
            <select
              value={selection.resolutionLevel}
              onChange={(event) =>
                onSelection({ ...selection, resolutionLevel: Number(event.target.value) })
              }
            >
              {opened.dataset.levels.map(({ level }) => (
                <option key={level} value={level}>
                  Level {level}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selection.fixedIndices.map((fixed) => {
          const axis = opened.dataset.axes.find(({ id }) => id === fixed.axisId)
          if (axis === undefined) return null
          return (
            <label key={axis.id}>
              {axis.name ?? axis.id} index
              <input
                max={axis.length - 1}
                min={0}
                type="number"
                value={fixed.index}
                onChange={(event) =>
                  onSelection({
                    ...selection,
                    fixedIndices: selection.fixedIndices.map((candidate) =>
                      candidate.axisId === fixed.axisId
                        ? {
                            ...candidate,
                            index: Math.max(
                              0,
                              Math.min(axis.length - 1, Number(event.target.value)),
                            ),
                          }
                        : candidate,
                    ),
                  })
                }
              />
            </label>
          )
        })}
        <label>
          Display range
          <select
            value={mapping.range}
            onChange={(event) =>
              onMapping(
                event.target.value === 'auto'
                  ? { mode: 'linear', range: 'auto' }
                  : { mode: 'linear', range: 'manual', minimum: 0, maximum: 255 },
              )
            }
          >
            <option value="auto">Histogram auto</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        {mapping.range === 'manual' ? (
          <div className="display-range-inputs">
            <label>
              Minimum
              <input
                type="number"
                value={mapping.minimum ?? 0}
                onChange={(event) => onMapping({ ...mapping, minimum: Number(event.target.value) })}
              />
            </label>
            <label>
              Maximum
              <input
                type="number"
                value={mapping.maximum ?? 255}
                onChange={(event) => onMapping({ ...mapping, maximum: Number(event.target.value) })}
              />
            </label>
          </div>
        ) : null}
        <p className="panel-note">Display mapping never changes quantitative source pixels.</p>
      </div>
    )
  }
  if (tab === 'roi') return roiContent
  if (tab === 'analysis') return analysisContent
  if (tab === 'history') {
    return (
      <ol className="history-list">
        {history.length === 0 ? <li>No project changes yet.</li> : null}
        {history.toReversed().map((entry) => (
          <li key={entry.id}>{entry.description}</li>
        ))}
      </ol>
    )
  }
  return (
    <dl className="inspector-facts">
      <div>
        <dt>Dataset</dt>
        <dd>{opened.dataset.name ?? opened.dataset.id}</dd>
      </div>
      <div>
        <dt>Axes</dt>
        <dd>{opened.dataset.axes.map(({ id, length }) => `${id} ${length}`).join(' × ')}</dd>
      </div>
      <div>
        <dt>Calibration</dt>
        <dd>{calibrationLabel(opened)}</dd>
      </div>
      <div>
        <dt>Source</dt>
        <dd>{source.reader.format}</dd>
      </div>
      <div>
        <dt>Data type</dt>
        <dd>{opened.dataset.sampleType}</dd>
      </div>
      <div>
        <dt>File size</dt>
        <dd>{fileSize(source.source.size)}</dd>
      </div>
    </dl>
  )
}

function BottomContent({
  tab,
  opened,
  histogram,
  log,
  history,
  workspace,
  analysisResults,
  analysisState,
  onEditNode,
  onDeleteNode,
}: {
  readonly tab: BottomTab
  readonly opened: OpenedDatasetDescriptor | undefined
  readonly histogram: readonly number[]
  readonly log: readonly string[]
  readonly history: readonly WorkspaceHistoryEntry[]
  readonly workspace: WorkspaceSnapshot
  readonly analysisResults: ReactNode
  readonly analysisState: MaterialsPanelState
  readonly onEditNode: (nodeId: string) => void
  readonly onDeleteNode: (nodeId: string) => void
}) {
  if (tab === 'pipeline') {
    return workspace.analysis.graph.nodes.length === 0 ? (
      <p className="bottom-placeholder">
        No analysis steps. The pipeline is saved with this project.
      </p>
    ) : (
      <ol className="history-list">
        {readablePipeline(workspace.analysis.graph).map((node) => {
          const hasConsumer = workspace.analysis.graph.nodes.some((candidate) =>
            candidate.inputs.some(
              ({ source }) => source.kind === 'node' && source.nodeId === node.id,
            ),
          )
          const provenanceNodes = analysisState.execution?.provenance['nodes']
          const provenance = Array.isArray(provenanceNodes)
            ? provenanceNodes.find(
                (candidate) =>
                  typeof candidate === 'object' &&
                  candidate !== null &&
                  !Array.isArray(candidate) &&
                  candidate['nodeId'] === node.id,
              )
            : undefined
          return (
            <li key={node.id}>
              <strong>{node.label}</strong> · v{node.version}
              <span>
                <label>
                  <input checked readOnly type="checkbox" /> Enabled
                </label>{' '}
                · {provenance === undefined ? 'committed' : 'complete · reference provider'}
              </span>
              <code>{JSON.stringify(node.parameters)}</code>
              <div className="button-row">
                <Button onClick={() => onEditNode(node.id)}>Select / edit</Button>
                <Button disabled={hasConsumer} onClick={() => onDeleteNode(node.id)}>
                  Delete
                </Button>
              </div>
            </li>
          )
        })}
      </ol>
    )
  }
  if (tab === 'results' || tab === 'profile') return analysisResults
  if (tab === 'history') {
    return (
      <ol className="history-list" aria-label="Project history">
        {history.length === 0 ? <li>No project changes yet.</li> : null}
        {history.toReversed().map((entry) => (
          <li key={entry.id}>{entry.description}</li>
        ))}
      </ol>
    )
  }
  if (opened === undefined)
    return <p className="bottom-placeholder">Results and profiles appear here.</p>
  if (tab === 'log') {
    return (
      <ol className="log-list">
        {log.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ol>
    )
  }
  if (tab === 'histogram') {
    const maximum = Math.max(1, ...histogram)
    return (
      <div className="mock-histogram" aria-label="Histogram of the latest numeric tile" role="img">
        {HISTOGRAM_BIN_IDS.map((id, index) => (
          <span key={id} style={{ height: `${((histogram[index] ?? 0) / maximum) * 72}px` }} />
        ))}
      </div>
    )
  }
  return (
    <p className="bottom-placeholder">
      {tab === 'profile' ? 'Draw a line ROI to create a profile.' : 'Analysis results appear here.'}
    </p>
  )
}

interface ResizeConfig {
  readonly key: 'leftPanelWidth' | 'rightPanelWidth' | 'bottomPanelHeight'
  readonly axis: 'x' | 'y'
  readonly direction: 1 | -1
}

export function App({ environment }: { readonly environment: PublicEnvironment }) {
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
    }
  }
  window.__PJI_WORKBENCH_METRICS__.reactRenders += 1
  const preferenceStore = useMemo(() => new LocalWorkbenchPreferenceStore(window.localStorage), [])
  const client = useMemo(() => createImagingWorkerClient(), [])
  const projectStore = useMemo(() => new IndexedDbProjectStore(window.indexedDB), [])
  const initialWorkspace = useMemo(() => createProject(), [])
  const historyController = useRef(new WorkspaceHistory(initialWorkspace))
  const [historyState, setHistoryState] = useState<WorkspaceHistoryState>(
    historyController.current.state,
  )
  const workspace = historyState.snapshot
  const projectJson = useMemo(() => serializeWorkspaceProject(workspace), [workspace])
  const runtime = useMemo(() => new WorkbenchWorkspaceRuntime(client), [client])
  const reconciler = useMemo(() => new WorkspaceRuntimeReconciler(runtime), [runtime])
  const [savedProjectJson, setSavedProjectJson] = useState<string>()
  const [recentProjects, setRecentProjects] = useState<readonly ProjectSummary[]>([])
  const [projectDialog, setProjectDialog] = useState(false)
  const [rebindSourceId, setRebindSourceId] = useState<SemanticSourceId>()
  const [identityMismatch, setIdentityMismatch] = useState<{
    readonly sourceId: SemanticSourceId
    readonly expected: WorkspaceSourceReference['identity']
    readonly actual: WorkspaceSourceReference['identity']
    readonly files: readonly File[]
    readonly openedSource: OpenedSourceDescriptor
    readonly openedDataset: OpenedDatasetDescriptor
  }>()
  const [preferences, setPreferences] = useState(() => preferenceStore.load())
  const [source, setSource] = useState<OpenedSourceDescriptor>()
  const [opened, setOpened] = useState<OpenedDatasetDescriptor>()
  const [selection, setSelection] = useState<PlaneSelection>()
  const [component, setComponent] = useState(0)
  const [mapping, setMapping] = useState<DisplayMapping>({ mode: 'linear', range: 'auto' })
  const [histogram, setHistogram] = useState<readonly number[]>([])
  const [status, setStatus] = useState<OpenStatus>('ready')
  const [error, setError] = useState<string>()
  const [urlDialog, setUrlDialog] = useState(false)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('info')
  const [bottomTab, setBottomTab] = useState<BottomTab>('histogram')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [recentSources, setRecentSources] = useState(() => readRecentSources(window.localStorage))
  const [log, setLog] = useState<readonly string[]>([])
  const [roiTool, setRoiTool] = useState<RoiTool>('select')
  const [threshold, setThreshold] = useState(128)
  const [thresholdMode, setThresholdMode] = useState<
    'greater-than' | 'greater-than-or-equal' | 'less-than' | 'less-than-or-equal'
  >('greater-than')
  const [connectivity, setConnectivity] = useState<4 | 8>(8)
  const [connectedPlanReady, setConnectedPlanReady] = useState(false)
  const [analysisCatalog, setAnalysisCatalog] = useState<AnalysisCatalog>()
  const [analysisState, setAnalysisState] = useState<MaterialsPanelState>({
    busy: false,
    tableOffset: 0,
  })
  const [analysisOverlay, setAnalysisOverlay] = useState<AnalysisOverlaySelection>()
  const [previewEnabled, setPreviewEnabled] = useState(false)
  const [tableFilter, setTableFilter] = useState<AnalysisTableFilter>()
  const [tableSort, setTableSort] = useState<AnalysisTableSort>()
  const analysisAbort = useRef<AbortController | undefined>(undefined)
  const previewResult = useRef<AnalysisResultHandleId | undefined>(undefined)
  const activeResult = useRef<AnalysisResultHandleId | undefined>(undefined)
  const viewportApi = useRef<ScientificViewportApi | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const projectImportInput = useRef<HTMLInputElement>(null)
  const rebindInput = useRef<HTMLInputElement>(null)
  const openAbort = useRef<AbortController | undefined>(undefined)
  const generation = useRef(0)
  const openedAt = useRef(0)
  const autoRangeLocked = useRef(false)
  const hasDataset = opened !== undefined && selection !== undefined

  const applyProjectMutation = useCallback((mutation: WorkspaceMutation): WorkspaceHistoryState => {
    const current = historyController.current.state.snapshot
    const next = historyController.current.dispatch(
      workspaceCommand(current, crypto.randomUUID(), new Date().toISOString(), mutation),
    )
    setHistoryState(next)
    return next
  }, [])

  const refreshRecentProjects = useCallback(async (): Promise<void> => {
    setRecentProjects(await projectStore.list())
  }, [projectStore])

  const appendLog = useCallback((message: string): void => {
    setLog((current) => [...current.slice(-20), `${new Date().toLocaleTimeString()} · ${message}`])
  }, [])

  const releaseAnalysisHandle = useCallback(
    async (handle: AnalysisResultHandleId | undefined): Promise<void> => {
      if (handle === undefined || opened === undefined) return
      try {
        await client.releaseAnalysis({
          datasetHandleId: opened.handleId,
          generation: opened.generation,
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
    void releaseAnalysisHandle(handle)
    setAnalysisState((current) => ({
      ...current,
      busy: false,
      message: 'Preview cancelled. The committed project is unchanged.',
    }))
  }, [releaseAnalysisHandle])

  const previewThreshold = useCallback(async (): Promise<void> => {
    if (opened === undefined) return
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
    }
  }, [client, component, opened, releaseAnalysisHandle, threshold, thresholdMode])

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
    return () => {
      analysisAbort.current?.abort(new DOMException('Dataset changed', 'AbortError'))
      const preview = previewResult.current
      const active = activeResult.current
      previewResult.current = undefined
      activeResult.current = undefined
      if (opened !== undefined) {
        for (const handle of [preview, active]) {
          if (handle !== undefined) {
            void client
              .releaseAnalysis({
                datasetHandleId: opened.handleId,
                generation: opened.generation,
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
    ): Promise<AnalysisTablePage | undefined> => {
      if (
        opened === undefined ||
        !execution.outputs.some(({ name, kind }) => name === 'objects' && kind === 'result')
      ) {
        return undefined
      }
      return client.requestAnalysisTablePage({
        datasetHandleId: opened.handleId,
        generation: opened.generation,
        resultHandleId: execution.resultHandleId,
        output: 'objects',
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
        readonly commit?: boolean
      } = {},
    ): Promise<void> => {
      if (opened === undefined) return
      cancelPreview()
      const controller = new AbortController()
      analysisAbort.current = controller
      setAnalysisState((current) => ({ ...current, busy: true, message: 'Planning analysis…' }))
      try {
        const request = {
          datasetHandleId: opened.handleId,
          generation: opened.generation,
          graph: graph as unknown as RpcJsonObject,
          ...(options.roi === undefined ? {} : { roi: options.roi as unknown as RpcJsonObject }),
        }
        const dryRun = await client.dryRunAnalysis(request, controller.signal)
        setAnalysisState((current) => ({ ...current, dryRun }))
        if (!dryRun.valid) {
          setAnalysisState((current) => ({
            ...current,
            busy: false,
            message: 'Analysis validation failed. The committed project is unchanged.',
          }))
          return
        }
        const execution = await client.executeAnalysis(request, controller.signal)
        const previous = activeResult.current
        activeResult.current = execution.resultHandleId
        if (previous !== undefined) await releaseAnalysisHandle(previous)
        if (options.commit === true) applyProjectMutation({ kind: 'analysis.set-graph', graph })
        const table = await loadTablePage(execution, 0, undefined, undefined)
        setAnalysisState({
          busy: false,
          execution,
          dryRun,
          tableOffset: 0,
          ...(table === undefined ? {} : { table }),
          message: `Analysis completed in ${execution.elapsedMilliseconds.toFixed(1)} ms.`,
        })
        setAnalysisOverlay(
          options.overlay === undefined
            ? undefined
            : { resultHandleId: execution.resultHandleId, output: options.overlay },
        )
        setBottomTab(
          table === undefined
            ? options.roi?.geometry.kind === 'line-segment'
              ? 'profile'
              : 'results'
            : 'results',
        )
        appendLog(
          `Executed ${graph.nodes.map(({ label, operation }) => label ?? operation.id).join(' → ')}`,
        )
      } catch (executionError) {
        if (!controller.signal.aborted) {
          setAnalysisState((current) => ({
            ...current,
            busy: false,
            message: `${executionError instanceof Error ? executionError.message : 'Analysis failed.'} The previous committed project remains intact.`,
          }))
        }
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
    ],
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
      void createRoi(geometry)
    },
    [createRoi],
  )

  const applyThreshold = useCallback(async (): Promise<void> => {
    if (opened === undefined) return
    const graph = thresholdGraph({ component, threshold, mode: thresholdMode })
    const dryRun = await client.dryRunAnalysis({
      datasetHandleId: opened.handleId,
      generation: opened.generation,
      graph: graph as unknown as RpcJsonObject,
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
  }, [applyProjectMutation, cancelPreview, client, component, opened, threshold, thresholdMode])

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
  }, [client, component, connectivity, opened, selection, threshold, thresholdMode])

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
      void executeAnalysisGraph(graph, { roi, commit: false })
    },
    [
      component,
      executeAnalysisGraph,
      selection,
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

  const downloadAnalysis = useCallback(
    async (scope: 'selected' | 'all', format: 'csv' | 'json'): Promise<void> => {
      const execution = analysisState.execution
      if (execution === undefined) return
      const parts: string[] = []
      if (analysisState.table === undefined || opened === undefined) {
        parts.push(JSON.stringify(execution.outputs, null, 2))
      } else {
        const headers = analysisState.table.columns.map(({ name }) => name)
        const collect = (page: AnalysisTablePage): void => {
          const pageRows = analysisPageRows(page)
          if (format === 'csv') {
            if (parts.length === 0) parts.push(`${headers.join(',')}\n`)
            parts.push(
              `${pageRows
                .map((row) => headers.map((header) => JSON.stringify(row[header] ?? '')).join(','))
                .join('\n')}\n`,
            )
          } else {
            parts.push(...pageRows.map((row) => JSON.stringify(row)))
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
              output: 'objects',
              offset,
              limit: 200,
              ...(tableFilter === undefined ? {} : { filter: tableFilter }),
              ...(tableSort === undefined ? {} : { sort: tableSort }),
            })
            collect(page)
            offset += page.rowCount
            if (page.rowCount === 0) break
          }
        }
        if (format === 'json') parts.splice(0, parts.length, `[${parts.join(',')}]`)
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
    void client.initialize().catch((initializationError: unknown) => {
      setError(
        initializationError instanceof Error
          ? initializationError.message
          : 'Worker failed to start',
      )
      setStatus('crashed')
    })
    return client.onCrash((crash) => {
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
    ): Promise<void> => {
      const summary = nextSource.datasets[0]
      if (summary === undefined) throw new Error('The document contains no scientific datasets.')
      const nextDataset = await client.openDataset(
        nextSource.documentId,
        summary.id,
        nextSource.generation,
        signal,
      )
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
      applyProjectMutation(mutation)
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
      rememberSource(nextSource.source.name)
      appendLog(`Opened ${nextSource.source.name} with ${nextSource.reader.id}`)
    },
    [appendLog, applyProjectMutation, client, rememberSource, runtime],
  )

  const runOpen = useCallback(
    async (
      opener: (nextGeneration: number, signal: AbortSignal) => Promise<OpenedSourceDescriptor>,
      locator: WorkspaceSourceReference['locator'],
    ): Promise<void> => {
      openAbort.current?.abort()
      const controller = new AbortController()
      openAbort.current = controller
      const nextGeneration = generation.current + 1
      setStatus('opening')
      setError(undefined)
      try {
        const nextSource = await opener(nextGeneration, controller.signal)
        await finishOpen(nextSource, locator, controller.signal)
        generation.current = nextGeneration
        setStatus('ready')
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
      }
    },
    [appendLog, finishOpen],
  )

  const openSample = useCallback((): void => {
    void runOpen((nextGeneration, signal) => client.openSample(nextGeneration, signal), {
      kind: 'sample',
      sampleId: 'generated-calibrated-sem',
    })
  }, [client, runOpen])

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
    [appendLog, reconciler, runtime],
  )

  const loadProject = useCallback(
    async (snapshot: WorkspaceSnapshot): Promise<void> => {
      const previous = historyController.current.state.snapshot
      const next = historyController.current.replace(snapshot)
      setHistoryState(next)
      setSavedProjectJson(serializeWorkspaceProject(snapshot))
      window.localStorage.setItem(LAST_PROJECT_KEY, snapshot.project.id)
      setInspectorTab(snapshot.workflow.inspector)
      setBottomTab(snapshot.workflow.bottom)
      setProjectDialog(false)
      await replayWorkspace(snapshot, previous)
    },
    [replayWorkspace],
  )

  const saveProject = useCallback(async (): Promise<void> => {
    try {
      const saved = historyController.current.state.snapshot
      await projectStore.save(saved)
      setSavedProjectJson(serializeWorkspaceProject(saved))
      window.localStorage.setItem(LAST_PROJECT_KEY, saved.project.id)
      await refreshRecentProjects()
      appendLog(`Saved ${saved.project.title}`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the project.')
    }
  }, [appendLog, projectStore, refreshRecentProjects])

  const saveProjectAs = useCallback(async (): Promise<void> => {
    try {
      const current = historyController.current.state.snapshot
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
      setHistoryState(historyController.current.replace(copy))
      setSavedProjectJson(undefined)
      await projectStore.save(copy)
      setSavedProjectJson(serializeWorkspaceProject(copy))
      window.localStorage.setItem(LAST_PROJECT_KEY, copy.project.id)
      await refreshRecentProjects()
      appendLog(`Saved a new copy as ${copy.project.title}`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save a project copy.')
    }
  }, [appendLog, projectStore, refreshRecentProjects])

  const newProject = useCallback((): void => {
    const previous = historyController.current.state.snapshot
    const snapshot = createProject()
    setHistoryState(historyController.current.replace(snapshot))
    setSavedProjectJson(undefined)
    window.localStorage.removeItem(LAST_PROJECT_KEY)
    setSource(undefined)
    setOpened(undefined)
    setSelection(undefined)
    setMapping({ mode: 'linear', range: 'auto' })
    setComponent(0)
    setError(undefined)
    void reconciler.reconcile(previous, snapshot).catch((releaseError: unknown) => {
      setError(
        `${releaseError instanceof Error ? releaseError.message : 'Runtime cleanup failed.'} The new project remains active.`,
      )
    })
  }, [reconciler])

  const performHistory = useCallback(
    (direction: 'undo' | 'redo'): void => {
      const previous = historyController.current.state.snapshot
      const next =
        direction === 'undo' ? historyController.current.undo() : historyController.current.redo()
      if (next.snapshot === previous) return
      setHistoryState(next)
      void replayWorkspace(next.snapshot, previous)
    },
    [replayWorkspace],
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
      setMapping({
        mode: 'linear',
        range: 'auto',
        minimum: tile.range.minimum,
        maximum: tile.range.maximum,
      })
      const elapsed = performance.now() - openedAt.current
      window.__PJI_WORKBENCH_METRICS__.firstTileMilliseconds = elapsed
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

  const updatePreferences = useCallback(
    (update: Partial<WorkbenchPreferences>, persist = true): void => {
      setPreferences((current) => {
        const next = { ...current, ...update }
        if (persist) preferenceStore.save(next)
        return next
      })
    },
    [preferenceStore],
  )

  const executeCommand = useCallback(
    (id: CommandId): void => {
      if (id === 'workspace.openSample') openSample()
      else if (id === 'workspace.new') newProject()
      else if (id === 'workspace.openProject') setProjectDialog(true)
      else if (id === 'workspace.save') void saveProject()
      else if (id === 'workspace.export') downloadProject(workspace)
      else if (id === 'workspace.undo') performHistory('undo')
      else if (id === 'workspace.redo') performHistory('redo')
      else if (id === 'viewport.fit') viewportApi.current?.fit()
      else if (id === 'viewport.oneToOne') viewportApi.current?.oneToOne()
      else if (id === 'panel.agent') setInspectorTab('agent')
      else if (id === 'theme.toggle')
        updatePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' })
      else setPaletteOpen(true)
    },
    [
      newProject,
      openSample,
      performHistory,
      preferences.theme,
      saveProject,
      updatePreferences,
      workspace,
    ],
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
    return workbenchCommands.map((command) => ({
      id: command.id,
      label: command.label,
      ...(command.shortcut === undefined ? {} : { shortcut: command.shortcut }),
      disabled: !availability[command.id],
    }))
  }, [hasDataset, historyState.redo.length, historyState.undo.length])

  const startResize = useCallback(
    (config: ResizeConfig, event: ReactPointerEvent<HTMLHRElement>): void => {
      event.preventDefault()
      const startPosition = config.axis === 'x' ? event.clientX : event.clientY
      const startValue = preferences[config.key]
      const bounds = PREFERENCE_BOUNDS[config.key]
      let lastValue = startValue
      const move = (moveEvent: PointerEvent): void => {
        const position = config.axis === 'x' ? moveEvent.clientX : moveEvent.clientY
        lastValue = Math.min(
          bounds.maximum,
          Math.max(bounds.minimum, startValue + (position - startPosition) * config.direction),
        )
        updatePreferences({ [config.key]: lastValue }, false)
      }
      const stop = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
        updatePreferences({ [config.key]: lastValue })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop, { once: true })
    },
    [preferences, updatePreferences],
  )

  const submitRemote = (event: FormEvent): void => {
    event.preventDefault()
    setUrlDialog(false)
    void runOpen((nextGeneration, signal) => client.openRemote(remoteUrl, nextGeneration, signal), {
      kind: 'remote',
      url: remoteUrl,
    })
  }

  const themeIcon = preferences.theme === 'dark' ? 'sun' : 'moon'
  const oppositeTheme: ThemeName = preferences.theme === 'dark' ? 'light' : 'dark'
  const datasetName = opened?.dataset.name ?? opened?.dataset.id
  const operationDescriptors = analysisCatalog?.capabilities['operationDescriptors']
  const operationCount = Array.isArray(operationDescriptors) ? operationDescriptors.length : 0
  const visibleRois = useMemo(
    () =>
      workspace.analysis.roiSet.rois.filter(
        (roi) => roi.presentation?.style?.['visible'] !== false,
      ),
    [workspace.analysis.roiSet.rois],
  )
  const roiContent =
    opened === undefined ? null : (
      <RoiInspector
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
        opened={opened}
        rois={workspace.analysis.roiSet.rois}
        {...(workspace.workflow.selectedRoiId === undefined
          ? {}
          : { selectedRoiId: workspace.workflow.selectedRoiId })}
        tool={roiTool}
      />
    )
  const analysisContent = (
    <AnalysisInspector
      component={component}
      planeLabel={selection?.displayAxes.join(' × ') ?? 'unavailable'}
      connectedPlanReady={connectedPlanReady}
      connectivity={connectivity}
      mode={thresholdMode}
      onApply={() => void applyThreshold()}
      onCancelPreview={cancelPreview}
      onConnectivity={(value) => {
        setConnectivity(value)
        setConnectedPlanReady(false)
      }}
      onMode={(value) => {
        setThresholdMode(value)
        setConnectedPlanReady(false)
      }}
      onPreview={() => setPreviewEnabled(true)}
      onPlanObjects={() => void planConnectedComponents()}
      onRunObjects={runConnectedComponents}
      onThreshold={(value) => {
        setThreshold(value)
        setConnectedPlanReady(false)
      }}
      operationCount={operationCount}
      state={analysisState}
      threshold={threshold}
    />
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
      <div
        className="workbench"
        data-environment={environment.appEnvironment}
        style={preferenceStyle(preferences)}
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
            <Button onClick={newProject}>New</Button>
            <Button onClick={() => setProjectDialog(true)}>Projects</Button>
            <Button onClick={() => void saveProject()}>Save</Button>
            <Button onClick={() => void saveProjectAs()}>Save as</Button>
            <Button onClick={() => downloadProject(workspace)}>Export</Button>
            <Button onClick={() => projectImportInput.current?.click()}>Import</Button>
            <input
              accept=".json,.pji-lab.json"
              aria-label="Import PureJsImage Lab project"
              className="visually-hidden"
              onChange={(event) => void importProjectFile(event.target.files?.[0])}
              ref={projectImportInput}
              type="file"
            />
            <IconButton
              disabled={historyState.undo.length === 0}
              label="Undo project change"
              onClick={() => performHistory('undo')}
            >
              <span aria-hidden="true">↶</span>
            </IconButton>
            <IconButton
              disabled={historyState.redo.length === 0}
              label="Redo project change"
              onClick={() => performHistory('redo')}
            >
              <span aria-hidden="true">↷</span>
            </IconButton>
            <Button onClick={() => fileInput.current?.click()} variant="primary">
              <Icon name="open" size={15} /> Open files
            </Button>
            <Button onClick={() => setUrlDialog(true)}>Open URL</Button>
            <input
              accept=".gsf,.hdr,.envi,.fits,.fit,.fts,.mrc,.map,.ccp4,.cbf,.imgcif,.tif,.tiff,.svs"
              aria-label="Choose local scientific files"
              className="visually-hidden"
              multiple
              onChange={(event) => openFiles([...(event.target.files ?? [])])}
              ref={fileInput}
              type="file"
            />
            <IconButton
              label="Fit image"
              disabled={!hasDataset}
              onClick={() => executeCommand('viewport.fit')}
            >
              <Icon name="fit" />
            </IconButton>
            <IconButton
              label="Actual pixels"
              disabled={!hasDataset}
              onClick={() => executeCommand('viewport.oneToOne')}
            >
              <span className="one-to-one">1:1</span>
            </IconButton>
          </Toolbar>
          <Toolbar label="Application actions">
            <IconButton label="Open command palette" onClick={() => setPaletteOpen(true)}>
              <Icon name="command" />
            </IconButton>
            <IconButton
              label={`Use ${oppositeTheme} theme`}
              onClick={() => executeCommand('theme.toggle')}
            >
              <Icon name={themeIcon} />
            </IconButton>
            <IconButton label="Show agent panel" onClick={() => executeCommand('panel.agent')}>
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
                      detail={reference.bound ? reference.locator.kind : 'rebind required'}
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
                {workspace.sources.length === 0 && recentSources.length > 0 ? (
                  <p className="tree-group">Recent names</p>
                ) : null}
                {workspace.sources.length === 0
                  ? recentSources.map((name) => (
                      <TreeRow depth={1} detail="rebind required" key={name} label={name} />
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
                    </>
                  ) : (
                    <span>No dataset</span>
                  )}
                </div>
                <Toolbar label="Viewport tools">
                  <span className="tool-hint">Wheel zoom · Space drag pan · Drop files here</span>
                </Toolbar>
              </div>
              <div className="viewport-stage">
                {status === 'opening' ? (
                  <div className="source-opening" role="status">
                    <span className="source-opening__bar" />
                    <strong>Opening source in the imaging Worker…</strong>
                    <span>The current workspace stays available until opening succeeds.</span>
                    <Button onClick={() => openAbort.current?.abort()}>Cancel</Button>
                  </div>
                ) : hasDataset && opened !== undefined && selection !== undefined ? (
                  <ScientificViewport
                    analysisOverlay={analysisOverlay}
                    client={client}
                    component={component}
                    mapping={mapping}
                    onReady={setViewportApi}
                    onCreateRoi={handleCreateRoi}
                    onDeleteRoi={deleteRoi}
                    onSelectRoi={selectRoi}
                    onSelectLabel={selectAnalysisLabel}
                    onTile={onTile}
                    opened={opened}
                    roiTool={roiTool}
                    rois={visibleRois}
                    selectedLabel={analysisState.selectedLabel}
                    selectedRoiId={workspace.workflow.selectedRoiId}
                    selection={selection}
                  />
                ) : (
                  <EmptyState
                    title="Open an original scientific image"
                    description="Files remain local. Remote sources use bounded HTTPS Range reads when the server permits them."
                    action={
                      <Button onClick={openSample} variant="primary">
                        Try generated calibrated sample
                      </Button>
                    }
                  />
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
                  setInspectorTab(tab)
                  applyProjectMutation({
                    kind: 'project.set-workflow',
                    workflow: { ...workspace.workflow, inspector: tab },
                  })
                }}
                selectedId={inspectorTab}
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
                  tab={inspectorTab}
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
                applyProjectMutation({
                  kind: 'project.set-workflow',
                  workflow: { ...workspace.workflow, bottom: tab },
                })
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
                opened={opened}
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
              : `${source.source.name} · ${source.source.kind}`}
          </StatusItem>
          <span className="status-spacer" />
          <StatusItem label="Calibration">{calibrationLabel(opened)}</StatusItem>
          <StatusItem label="Privacy">Files stay on this device</StatusItem>
        </div>
      </div>

      {urlDialog ? (
        <div className="url-dialog-backdrop">
          <form
            aria-label="Open remote scientific source"
            className="url-dialog"
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
                required
                type="url"
                value={remoteUrl}
              />
            </label>
            <div className="url-dialog__actions">
              <Button onClick={() => setUrlDialog(false)} type="button">
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
          <section aria-label="Recent projects" className="url-dialog" role="dialog">
            <h2>Recent projects</h2>
            <p>Projects and bounded result artifacts are stored only in this browser profile.</p>
            <div className="recent-projects">
              {recentProjects.length === 0 ? <p>No saved projects yet.</p> : null}
              {recentProjects.map((project) => (
                <button
                  className="recent-project"
                  key={project.id}
                  onClick={() => {
                    void projectStore
                      .load(project.id)
                      .then((snapshot) => {
                        if (snapshot !== undefined) return loadProject(snapshot)
                        throw new Error('The selected project no longer exists.')
                      })
                      .catch((openError: unknown) => {
                        setProjectDialog(false)
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
              <Button onClick={() => setProjectDialog(false)}>Close</Button>
              <Button onClick={() => projectImportInput.current?.click()} variant="primary">
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
      <CommandPalette
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
        onRun={(id) => executeCommand(id as CommandId)}
        open={paletteOpen}
      />
    </ThemeRoot>
  )
}
