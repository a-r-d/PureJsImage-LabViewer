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
import { MockViewport, type MockViewportApi } from './MockViewport.js'
import {
  LocalWorkbenchPreferenceStore,
  PREFERENCE_BOUNDS,
  type WorkbenchPreferences,
} from './preferences.js'

type InspectorTab = 'info' | 'display' | 'roi' | 'analysis' | 'history' | 'agent'
type BottomTab = 'histogram' | 'profile' | 'results' | 'log'
type WorkspaceMode = 'empty' | 'opened'

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

const histogramBars = Array.from({ length: 38 }, (_, index) => ({
  id: `intensity-bin-${index + 1}`,
  height: 8 + ((index * 37) % 64),
}))

function preferenceStyle(preferences: WorkbenchPreferences): CSSProperties {
  return {
    '--left-panel-width': `${preferences.leftPanelWidth}px`,
    '--right-panel-width': `${preferences.rightPanelWidth}px`,
    '--bottom-panel-height': `${preferences.bottomPanelHeight}px`,
  } as CSSProperties
}

function InspectorContent({
  tab,
  mode,
}: {
  readonly tab: InspectorTab
  readonly mode: WorkspaceMode
}) {
  if (tab === 'agent') {
    return (
      <div className="inspector-content agent-panel" data-testid="agent-panel">
        <p className="panel-kicker">User-approved tool client</p>
        <div className="agent-message agent-message--user">
          Count bright precipitates larger than 20 nm².
        </div>
        <div className="agent-message">
          I can propose a threshold and connected-components workflow after a dataset is open. No
          operation will run without approval.
        </div>
        <Button disabled={mode === 'empty'} variant="primary">
          Review proposed plan
        </Button>
        <p className="panel-note">Mock conversation · no network request</p>
      </div>
    )
  }
  if (mode === 'empty') {
    return <p className="panel-placeholder">Open a dataset to inspect {tab} settings.</p>
  }
  if (tab === 'display') {
    return (
      <div className="inspector-content form-stack">
        <label>
          Display range
          <input defaultValue="18 – 232" readOnly />
        </label>
        <label>
          Mapping
          <select defaultValue="linear">
            <option value="linear">Linear</option>
            <option value="log">Logarithmic</option>
          </select>
        </label>
        <p className="panel-note">Display mapping does not alter quantitative pixels.</p>
      </div>
    )
  }
  if (tab === 'roi') {
    return (
      <dl className="inspector-facts">
        <div>
          <dt>Name</dt>
          <dd>Precipitate field</dd>
        </div>
        <div>
          <dt>Geometry</dt>
          <dd>Rectangle</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>256.2 × 231.0 nm</dd>
        </div>
        <div>
          <dt>Area</dt>
          <dd>59,182 nm²</dd>
        </div>
      </dl>
    )
  }
  if (tab === 'analysis') {
    return (
      <div className="inspector-content analysis-plan">
        <p className="panel-kicker">Preview plan</p>
        <ol>
          <li>Gaussian blur · σ 1.2 px</li>
          <li>Threshold · 172</li>
          <li>Connected components</li>
        </ol>
        <p>Estimated working set: 18 MB</p>
        <Button variant="primary">Review before run</Button>
      </div>
    )
  }
  if (tab === 'history') {
    return (
      <ol className="history-list">
        <li>Opened sample-sem.mrc</li>
        <li>Created Precipitate field ROI</li>
      </ol>
    )
  }
  return (
    <dl className="inspector-facts">
      <div>
        <dt>Dataset</dt>
        <dd>Electron intensity</dd>
      </div>
      <div>
        <dt>Dimensions</dt>
        <dd>2048 × 1536 px</dd>
      </div>
      <div>
        <dt>Calibration</dt>
        <dd>0.42 nm / px</dd>
      </div>
      <div>
        <dt>Source</dt>
        <dd>MRC / CCP4</dd>
      </div>
      <div>
        <dt>Data type</dt>
        <dd>uint16</dd>
      </div>
      <div>
        <dt>File size</dt>
        <dd>6.0 MB · mock</dd>
      </div>
    </dl>
  )
}

function BottomContent({ tab, mode }: { readonly tab: BottomTab; readonly mode: WorkspaceMode }) {
  if (mode === 'empty')
    return <p className="bottom-placeholder">Results and profiles appear here.</p>
  if (tab === 'results') {
    return (
      <div className="result-table-wrap">
        <table>
          <caption className="visually-hidden">Mock connected component measurements</caption>
          <thead>
            <tr>
              <th>Label</th>
              <th>Area</th>
              <th>ECD</th>
              <th>Centroid</th>
              <th>Aspect</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>17</td>
              <td>28.6 nm²</td>
              <td>6.04 nm</td>
              <td>812, 603 px</td>
              <td>1.18</td>
            </tr>
            <tr>
              <td>18</td>
              <td>43.1 nm²</td>
              <td>7.41 nm</td>
              <td>946, 712 px</td>
              <td>1.37</td>
            </tr>
            <tr>
              <td>19</td>
              <td>21.8 nm²</td>
              <td>5.27 nm</td>
              <td>1093, 824 px</td>
              <td>1.09</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }
  if (tab === 'log') {
    return (
      <ol className="log-list">
        <li>20:14:03 · Mock source opened locally</li>
        <li>20:14:04 · First useful tile rendered</li>
        <li>20:14:09 · ROI selected</li>
      </ol>
    )
  }
  if (tab === 'profile') {
    return (
      <div className="mock-profile" aria-label="Mock line profile" role="img">
        <span>0</span>
        <svg aria-hidden="true" viewBox="0 0 600 75" preserveAspectRatio="none">
          <path d="M0 61 L48 55 L96 58 L145 26 L194 48 L242 43 L290 14 L338 37 L386 29 L435 50 L483 38 L531 54 L600 45" />
        </svg>
        <span>256 nm</span>
      </div>
    )
  }
  return (
    <div className="mock-histogram" aria-label="Mock intensity histogram" role="img">
      {histogramBars.map((bar) => (
        <span key={bar.id} style={{ height: `${bar.height}px` }} />
      ))}
    </div>
  )
}

interface ResizeConfig {
  readonly key: 'leftPanelWidth' | 'rightPanelWidth' | 'bottomPanelHeight'
  readonly axis: 'x' | 'y'
  readonly direction: 1 | -1
}

export function App({ environment }: { readonly environment: PublicEnvironment }) {
  if (window.__PJI_WORKBENCH_METRICS__ === undefined) {
    window.__PJI_WORKBENCH_METRICS__ = { reactRenders: 0, viewportFrames: 0 }
  }
  window.__PJI_WORKBENCH_METRICS__.reactRenders += 1
  const preferenceStore = useMemo(() => new LocalWorkbenchPreferenceStore(window.localStorage), [])
  const [preferences, setPreferences] = useState(() => preferenceStore.load())
  const [mode, setMode] = useState<WorkspaceMode>('empty')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('info')
  const [bottomTab, setBottomTab] = useState<BottomTab>('histogram')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const viewportApi = useRef<MockViewportApi | null>(null)
  const workspace = useMemo(() => createEmptyWorkspace('Untitled microscopy project'), [])
  const hasDataset = mode === 'opened'

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
      if (id === 'workspace.openSample') {
        setMode('opened')
        setInspectorTab('info')
      } else if (id === 'viewport.fit') {
        viewportApi.current?.fit()
      } else if (id === 'viewport.oneToOne') {
        viewportApi.current?.oneToOne()
      } else if (id === 'panel.agent') {
        setInspectorTab('agent')
      } else if (id === 'theme.toggle') {
        updatePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' })
      } else {
        setPaletteOpen(true)
      }
    },
    [preferences.theme, updatePreferences],
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

  const setViewportApi = useCallback((api: MockViewportApi | null): void => {
    viewportApi.current = api
  }, [])

  const themeIcon = preferences.theme === 'dark' ? 'sun' : 'moon'
  const oppositeTheme: ThemeName = preferences.theme === 'dark' ? 'light' : 'dark'

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
            <Button onClick={() => executeCommand('workspace.openSample')} variant="primary">
              <Icon name="open" size={15} /> Open sample
            </Button>
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
                {hasDataset ? (
                  <TreeRow
                    label="sample-sem.mrc"
                    detail="6 MB"
                    selected
                    onSelect={() => setInspectorTab('info')}
                  />
                ) : (
                  <TreeRow label="No source open" />
                )}
                <p className="tree-group">Datasets</p>
                {hasDataset ? (
                  <TreeRow
                    depth={1}
                    label="Electron intensity"
                    detail="2D"
                    onSelect={() => setInspectorTab('display')}
                  />
                ) : null}
                <p className="tree-group">Overlays</p>
                {hasDataset ? (
                  <TreeRow
                    depth={1}
                    label="Precipitate field"
                    detail="ROI"
                    selected={inspectorTab === 'roi'}
                    onSelect={() => setInspectorTab('roi')}
                  />
                ) : null}
                <p className="tree-group">Analyses</p>
                {hasDataset ? (
                  <TreeRow
                    depth={1}
                    label="Particle segmentation"
                    detail="draft"
                    onSelect={() => setInspectorTab('analysis')}
                  />
                ) : null}
                <p className="tree-group">Results</p>
                {hasDataset ? (
                  <TreeRow
                    depth={1}
                    label="Object measurements"
                    detail="3 rows"
                    onSelect={() => setBottomTab('results')}
                  />
                ) : null}
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

            <section aria-label="Image viewport" className="viewport-panel">
              <div className="viewport-toolbar">
                <div className="dataset-breadcrumb">
                  {hasDataset ? (
                    <>
                      <span>sample-sem.mrc</span>
                      <span aria-hidden="true">/</span>
                      <strong>Electron intensity</strong>
                    </>
                  ) : (
                    <span>No dataset</span>
                  )}
                </div>
                <Toolbar label="Viewport tools">
                  <IconButton label="Region tool" disabled={!hasDataset}>
                    <Icon name="roi" />
                  </IconButton>
                  <span className="tool-hint">Wheel zoom · Space drag pan</span>
                </Toolbar>
              </div>
              <div className="viewport-stage">
                {hasDataset ? (
                  <MockViewport onReady={setViewportApi} roiSelected={inspectorTab === 'roi'} />
                ) : (
                  <EmptyState
                    title="Open an original image"
                    description="Inspect calibration, metadata, and pixels locally in your browser. The sample is deterministic and makes no network request."
                    action={
                      <Button
                        onClick={() => executeCommand('workspace.openSample')}
                        variant="primary"
                      >
                        Try sample SEM image
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
                  <h2>{hasDataset ? 'Electron intensity' : 'Nothing selected'}</h2>
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
                <InspectorContent mode={mode} tab={inspectorTab} />
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
              <BottomContent mode={mode} tab={bottomTab} />
            </div>
          </Panel>
        </main>

        <div aria-label="Workbench status" className="status-bar" role="status">
          <StatusItem label="Application status">
            <span className="status-dot" aria-hidden="true" />
            Ready
          </StatusItem>
          <StatusItem label="Source">
            {hasDataset ? 'sample-sem.mrc · local' : 'No source open'}
          </StatusItem>
          <span className="status-spacer" />
          <StatusItem label="Calibration">{hasDataset ? '0.42 nm/px' : 'Uncalibrated'}</StatusItem>
          <StatusItem label="Privacy">Files stay on this device</StatusItem>
        </div>
      </div>
      <CommandPalette
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
        onRun={(id) => executeCommand(id as CommandId)}
        open={paletteOpen}
      />
    </ThemeRoot>
  )
}
