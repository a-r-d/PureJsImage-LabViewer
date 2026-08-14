import type {
  DisplayMapping,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  PlaneSelection,
  RenderTile,
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
import { createEmptyWorkspace } from '@pji-workbench/workspace'
import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  type CommandId,
  getCommandAvailability,
  resolveShortcut,
  workbenchCommands,
} from './commands.js'
import type { PublicEnvironment } from './environment.js'
import {
  LocalWorkbenchPreferenceStore,
  PREFERENCE_BOUNDS,
  type WorkbenchPreferences,
} from './preferences.js'
import { ScientificViewport, type ScientificViewportApi } from './ScientificViewport.js'

type InspectorTab = 'info' | 'display' | 'roi' | 'analysis' | 'history' | 'agent'
type BottomTab = 'histogram' | 'profile' | 'results' | 'log'
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
  { id: 'histogram', label: 'Histogram' },
  { id: 'profile', label: 'Line Profile' },
  { id: 'results', label: 'Results' },
  { id: 'log', label: 'Log' },
]

const RECENT_SOURCE_KEY = 'pji-workbench.recent-source-names.v1'
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
  if (tab === 'roi' || tab === 'analysis') {
    return (
      <div className="inspector-content">
        <p className="panel-kicker">Runtime ready</p>
        <p className="panel-note">
          ROI and analysis composition build on this numeric dataset in the next prompts.
        </p>
      </div>
    )
  }
  if (tab === 'history') {
    return (
      <ol className="history-list">
        <li>Opened {source.source.name}</li>
        <li>Selected {opened.dataset.name ?? opened.dataset.id}</li>
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
}: {
  readonly tab: BottomTab
  readonly opened: OpenedDatasetDescriptor | undefined
  readonly histogram: readonly number[]
  readonly log: readonly string[]
}) {
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
  const workspace = useMemo(() => createEmptyWorkspace('Untitled microscopy project'), [])
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
  const viewportApi = useRef<ScientificViewportApi | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const openAbort = useRef<AbortController | undefined>(undefined)
  const generation = useRef(0)
  const openedAt = useRef(0)
  const autoRangeLocked = useRef(false)
  const hasDataset = opened !== undefined && selection !== undefined

  const appendLog = useCallback((message: string): void => {
    setLog((current) => [...current.slice(-20), `${new Date().toLocaleTimeString()} · ${message}`])
  }, [])

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
    async (nextSource: OpenedSourceDescriptor, signal: AbortSignal): Promise<void> => {
      const summary = nextSource.datasets[0]
      if (summary === undefined) throw new Error('The document contains no scientific datasets.')
      const nextDataset = await client.openDataset(
        nextSource.documentId,
        summary.id,
        nextSource.generation,
        signal,
      )
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
    [appendLog, client, rememberSource],
  )

  const runOpen = useCallback(
    async (
      opener: (nextGeneration: number, signal: AbortSignal) => Promise<OpenedSourceDescriptor>,
    ): Promise<void> => {
      openAbort.current?.abort()
      const controller = new AbortController()
      openAbort.current = controller
      const nextGeneration = generation.current + 1
      setStatus('opening')
      setError(undefined)
      try {
        const nextSource = await opener(nextGeneration, controller.signal)
        await finishOpen(nextSource, controller.signal)
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
    void runOpen((nextGeneration, signal) => client.openSample(nextGeneration, signal))
  }, [client, runOpen])

  const openFiles = useCallback(
    (files: readonly File[]): void => {
      const primary = files[0]
      if (primary === undefined) return
      void runOpen((nextGeneration, signal) =>
        client.openLocal(files, primary, nextGeneration, signal),
      )
    },
    [client, runOpen],
  )

  const selectDataset = useCallback(
    async (datasetId: string): Promise<void> => {
      if (source === undefined || opened?.dataset.id === datasetId) return
      try {
        const next = await client.openDataset(source.documentId, datasetId, source.generation)
        const previous = opened
        setOpened(next)
        setSelection(next.selection)
        setComponent(0)
        if (previous !== undefined) await client.closeDataset(previous.handleId, source.generation)
      } catch (datasetError) {
        setError(datasetError instanceof Error ? datasetError.message : 'Unable to open dataset')
      }
    },
    [client, opened, source],
  )

  const changeSelection = useCallback(
    (next: PlaneSelection): void => {
      if (opened === undefined) return
      void client
        .setPlane(opened.handleId, opened.generation, next)
        .then(() => {
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
    [client, opened],
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

  const changeComponent = useCallback((next: number): void => {
    autoRangeLocked.current = false
    setMapping({ mode: 'linear', range: 'auto' })
    setComponent(next)
  }, [])

  const changeMapping = useCallback((next: DisplayMapping): void => {
    autoRangeLocked.current = next.range === 'manual'
    setMapping(next)
  }, [])

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
      else if (id === 'viewport.fit') viewportApi.current?.fit()
      else if (id === 'viewport.oneToOne') viewportApi.current?.oneToOne()
      else if (id === 'panel.agent') setInspectorTab('agent')
      else if (id === 'theme.toggle')
        updatePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' })
      else setPaletteOpen(true)
    },
    [openSample, preferences.theme, updatePreferences],
  )

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      const command = resolveShortcut(event, { hasDataset })
      if (command === undefined) return
      event.preventDefault()
      executeCommand(command)
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [executeCommand, hasDataset])

  const paletteCommands = useMemo<readonly PaletteCommand[]>(() => {
    const availability = getCommandAvailability({ hasDataset })
    return workbenchCommands.map((command) => ({
      id: command.id,
      label: command.label,
      ...(command.shortcut === undefined ? {} : { shortcut: command.shortcut }),
      disabled: !availability[command.id],
    }))
  }, [hasDataset])

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
    void runOpen((nextGeneration, signal) => client.openRemote(remoteUrl, nextGeneration, signal))
  }

  const themeIcon = preferences.theme === 'dark' ? 'sun' : 'moon'
  const oppositeTheme: ThemeName = preferences.theme === 'dark' ? 'light' : 'dark'
  const datasetName = opened?.dataset.name ?? opened?.dataset.id

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
              <span>{workspace.title}</span>
            </div>
          </div>
          <Toolbar label="Workspace actions">
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
                  void client.restart().then(() => {
                    setStatus('ready')
                    setError(undefined)
                  })
                }
              >
                Restart imaging Worker
              </Button>
            ) : (
              <Button onClick={() => setError(undefined)}>Dismiss</Button>
            )}
          </div>
        )}

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
                {source === undefined ? (
                  <TreeRow label="No source open" />
                ) : (
                  <TreeRow
                    label={source.source.name}
                    detail={fileSize(source.source.size)}
                    selected
                    onSelect={() => setInspectorTab('info')}
                  />
                )}
                <p className="tree-group">Datasets</p>
                {source?.datasets.map((dataset) => (
                  <TreeRow
                    depth={1}
                    key={dataset.id}
                    label={dataset.name ?? dataset.id}
                    detail={`${dataset.axes.length}D`}
                    selected={opened?.dataset.id === dataset.id}
                    onSelect={() => void selectDataset(dataset.id)}
                  />
                ))}
                {source === undefined && recentSources.length > 0 ? (
                  <p className="tree-group">Recent names</p>
                ) : null}
                {source === undefined
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
                    client={client}
                    component={component}
                    mapping={mapping}
                    onReady={setViewportApi}
                    onTile={onTile}
                    opened={opened}
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
                onSelect={setInspectorTab}
                selectedId={inspectorTab}
              />
              <div className="inspector-scroll">
                <InspectorContent
                  component={component}
                  mapping={mapping}
                  onComponent={changeComponent}
                  onMapping={changeMapping}
                  onSelection={changeSelection}
                  opened={opened}
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
              onSelect={setBottomTab}
              selectedId={bottomTab}
            />
            <div className="bottom-content">
              <BottomContent histogram={histogram} log={log} opened={opened} tab={bottomTab} />
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
      <CommandPalette
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
        onRun={(id) => executeCommand(id as CommandId)}
        open={paletteOpen}
      />
    </ThemeRoot>
  )
}
