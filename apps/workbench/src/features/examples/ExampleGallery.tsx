import {
  type ExampleScenarioV1,
  type ExampleWorkflowV1,
  enabledExampleScenarios,
  researchExampleScenarios,
} from '@pji-workbench/test-corpus'
import { Button, Icon } from '@pji-workbench/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { handleDialogKeyDown } from '../../app/dialog-keyboard.js'

export const RECENT_EXAMPLES_KEY = 'pji-workbench.recent-examples.v1'

interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ExampleFilters {
  readonly query: string
  readonly modality: string
  readonly format: string
  readonly vendor: string
  readonly task: string
  readonly size: string
}

const EMPTY_FILTERS: ExampleFilters = {
  query: '',
  modality: '',
  format: '',
  vendor: '',
  task: '',
  size: '',
}

export function readRecentExampleIds(storage: KeyValueStorage): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RECENT_EXAMPLES_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 6)
      : []
  } catch {
    return []
  }
}

export function rememberRecentExample(
  storage: KeyValueStorage,
  current: readonly string[],
  id: string,
): readonly string[] {
  const next = [id, ...current.filter((candidate) => candidate !== id)].slice(0, 6)
  storage.setItem(RECENT_EXAMPLES_KEY, JSON.stringify(next))
  return next
}

export function filterExampleScenarios(
  scenarios: readonly ExampleScenarioV1[],
  filters: ExampleFilters,
): readonly ExampleScenarioV1[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return scenarios.filter((scenario) => {
    const searchable = [
      scenario.title,
      scenario.summary,
      scenario.modality,
      scenario.vendor ?? '',
      scenario.format,
      ...scenario.tags,
      ...scenario.learningGoals,
      ...scenario.workflows.flatMap(({ title, summary }) => [title, summary]),
    ]
      .join(' ')
      .toLocaleLowerCase()
    return (
      (query === '' || searchable.includes(query)) &&
      (filters.modality === '' || scenario.modality === filters.modality) &&
      (filters.format === '' || scenario.format === filters.format) &&
      (filters.vendor === '' || (scenario.vendor ?? '') === filters.vendor) &&
      (filters.task === '' || scenario.tags.includes(filters.task)) &&
      (filters.size === '' || scenario.sizeClass === filters.size)
    )
  })
}

function options(
  scenarios: readonly ExampleScenarioV1[],
  value: (scenario: ExampleScenarioV1) => string,
) {
  return [...new Set(scenarios.map(value).filter((item) => item !== ''))].sort((left, right) =>
    left.localeCompare(right),
  )
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return 'size pending verification'
  if (bytes === 0) return 'generated on demand'
  const units = ['B', 'kB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1_000 && unit < units.length - 1) {
    value /= 1_000
    unit += 1
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

function scenarioSize(scenario: ExampleScenarioV1): string {
  const total = scenario.source.files.reduce<number | undefined>((sum, file) => {
    if (sum === undefined || file.sizeBytes === undefined) return undefined
    return sum + file.sizeBytes
  }, 0)
  return formatBytes(total)
}

interface Activity {
  readonly scenarioId: string
  readonly label: string
  readonly controller: AbortController
}

export function ExampleGallery({
  onClose,
  onInspectWorkflow,
  onOpen,
  onRunWorkflow,
  returnFocusTo,
}: {
  readonly onClose: () => void
  readonly onInspectWorkflow: (workflow: ExampleWorkflowV1) => void
  readonly onOpen: (scenario: ExampleScenarioV1, signal: AbortSignal) => Promise<void>
  readonly onRunWorkflow: (
    scenario: ExampleScenarioV1,
    workflow: ExampleWorkflowV1,
    signal: AbortSignal,
  ) => Promise<void>
  readonly returnFocusTo: HTMLElement | null
}) {
  const enabled = useMemo(() => enabledExampleScenarios(), [])
  const research = useMemo(() => researchExampleScenarios(), [])
  const [view, setView] = useState<'examples' | 'research'>('examples')
  const [filters, setFilters] = useState<ExampleFilters>(EMPTY_FILTERS)
  const [recent, setRecent] = useState(() => readRecentExampleIds(window.localStorage))
  const [activity, setActivity] = useState<Activity>()
  const [error, setError] = useState<string>()
  const alive = useRef(true)
  const returnFocus = useRef(
    returnFocusTo ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  )
  const searchInput = useRef<HTMLInputElement>(null)
  const viewTabs = useRef<HTMLDivElement>(null)
  const visibleSource = view === 'examples' ? enabled : research
  const filtered = filterExampleScenarios(visibleSource, filters)
  const ordered = [...filtered].sort((left, right) => {
    const leftRecent = recent.indexOf(left.id)
    const rightRecent = recent.indexOf(right.id)
    if (leftRecent >= 0 || rightRecent >= 0)
      return (
        (leftRecent < 0 ? Number.MAX_SAFE_INTEGER : leftRecent) -
        (rightRecent < 0 ? Number.MAX_SAFE_INTEGER : rightRecent)
      )
    return left.title.localeCompare(right.title)
  })
  const taskOptions = [...new Set(visibleSource.flatMap(({ tags }) => tags))].sort((left, right) =>
    left.localeCompare(right),
  )

  const selectView = (next: 'examples' | 'research', focus = false): void => {
    if (next !== view) setFilters(EMPTY_FILTERS)
    setView(next)
    if (focus)
      queueMicrotask(() =>
        viewTabs.current
          ?.querySelector<HTMLButtonElement>(`[data-example-view="${next}"]`)
          ?.focus(),
      )
  }

  useEffect(() => {
    searchInput.current?.focus()
    return () => {
      const target = returnFocus.current
      const galleryInput = searchInput.current
      queueMicrotask(() => {
        if (!galleryInput?.isConnected) target?.focus()
      })
    }
  }, [])

  const close = (): void => {
    alive.current = false
    activity?.controller.abort()
    onClose()
  }

  const run = async (
    scenario: ExampleScenarioV1,
    label: string,
    action: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> => {
    const controller = new AbortController()
    setError(undefined)
    setActivity({ scenarioId: scenario.id, label, controller })
    try {
      await action(controller.signal)
      if (!alive.current) return
      const nextRecent = rememberRecentExample(window.localStorage, recent, scenario.id)
      setRecent(nextRecent)
      alive.current = false
      onClose()
    } catch (actionError) {
      if (!alive.current) return
      setError(
        controller.signal.aborted
          ? 'Example action cancelled. The previous workspace was retained.'
          : actionError instanceof Error
            ? actionError.message
            : 'Example action failed.',
      )
    } finally {
      if (alive.current) setActivity(undefined)
    }
  }

  return (
    <div className="url-dialog-backdrop">
      <section
        aria-label="Example library"
        aria-modal="true"
        className="url-dialog example-gallery"
        onKeyDown={(event) =>
          handleDialogKeyDown(event, activity === undefined ? close : undefined)
        }
        role="dialog"
      >
        <header className="example-gallery__heading">
          <Icon name="examples" size={18} />
          <div>
            <p>Local-first scientific corpus</p>
            <h2>Example library</h2>
          </div>
          <span className="example-gallery__count">
            {enabled.length} ready · {research.length} planned
          </span>
        </header>

        <div
          aria-label="Example catalog views"
          className="example-gallery__views"
          ref={viewTabs}
          role="tablist"
        >
          <Button
            aria-controls="example-gallery-results"
            aria-selected={view === 'examples'}
            data-example-view="examples"
            onClick={() => selectView('examples')}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              selectView(
                event.key === 'End' || event.key === 'ArrowRight' ? 'research' : 'examples',
                true,
              )
            }}
            role="tab"
            tabIndex={view === 'examples' ? 0 : -1}
            variant={view === 'examples' ? 'primary' : 'secondary'}
          >
            Ready examples
          </Button>
          <Button
            aria-controls="example-gallery-results"
            aria-selected={view === 'research'}
            data-example-view="research"
            onClick={() => selectView('research')}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              selectView(
                event.key === 'Home' || event.key === 'ArrowLeft' ? 'examples' : 'research',
                true,
              )
            }}
            role="tab"
            tabIndex={view === 'research' ? 0 : -1}
            variant={view === 'research' ? 'primary' : 'secondary'}
          >
            Planned datasets
          </Button>
        </div>

        <div className="example-gallery__controls">
          {view === 'research' ? (
            <aside className="example-gallery__notice">
              <div>
                <strong>Planned datasets are not available to open yet.</strong>
                <p>
                  These candidates are awaiting license, file-integrity, delivery, and scientific
                  oracle checks. They are shown for roadmap transparency only.
                </p>
              </div>
              <Button onClick={() => selectView('examples', true)} variant="primary">
                Browse ready examples
              </Button>
            </aside>
          ) : null}

          <div className="example-gallery__filters">
            <label>
              Search
              <input
                onChange={(event) => setFilters({ ...filters, query: event.currentTarget.value })}
                placeholder="particles, FFT, AFM…"
                ref={searchInput}
                type="search"
                value={filters.query}
              />
            </label>
            {[
              ['Modality', 'modality', options(visibleSource, ({ modality }) => modality)],
              ['Format', 'format', options(visibleSource, ({ format }) => format)],
              ['Vendor', 'vendor', options(visibleSource, ({ vendor }) => vendor ?? '')],
              ['Task', 'task', taskOptions],
              ['Size', 'size', options(visibleSource, ({ sizeClass }) => sizeClass)],
            ].map(([label, key, values]) => (
              <label key={String(key)}>
                {String(label)}
                <select
                  onChange={(event) =>
                    setFilters({ ...filters, [String(key)]: event.currentTarget.value })
                  }
                  value={filters[String(key) as keyof ExampleFilters]}
                >
                  <option value="">All</option>
                  {(values as readonly string[]).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <Button
              disabled={Object.values(filters).every((value) => value === '')}
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              Clear filters
            </Button>
          </div>

          {error === undefined ? null : (
            <div className="example-gallery__error" role="alert">
              {error}
            </div>
          )}
          <p aria-live="polite" className="visually-hidden">
            {ordered.length} {view === 'examples' ? 'ready examples' : 'planned datasets'} shown.
          </p>
        </div>

        <div
          aria-label={view === 'examples' ? 'Ready examples' : 'Planned datasets'}
          className="example-gallery__results"
          id="example-gallery-results"
          role="tabpanel"
        >
          {ordered.length === 0 ? (
            <p className="example-gallery__empty">No examples match these filters.</p>
          ) : (
            ordered.map((scenario) => {
              const busy = activity?.scenarioId === scenario.id
              const workflow = scenario.workflows[0]
              const local =
                scenario.source.kind === 'generated' || scenario.source.kind === 'bundled'
              const analyzed = scenario.initialAnalysis !== undefined
              return (
                <article className="example-card" key={scenario.id}>
                  {scenario.preview.kind === 'bundled-image' ? (
                    <img
                      alt={scenario.preview.alt}
                      className="example-card__preview"
                      decoding="async"
                      loading="lazy"
                      src={scenario.preview.value}
                    />
                  ) : (
                    <div
                      aria-label={scenario.preview.alt}
                      className="example-card__preview"
                      data-pattern={scenario.preview.value}
                      role="img"
                    />
                  )}
                  <div className="example-card__body">
                    <div className="example-card__title">
                      <div>
                        <span
                          className={`example-card__status example-card__status--${scenario.status}`}
                        >
                          {scenario.status}
                        </span>
                        {scenario.source.kind === 'bundled' ? (
                          <span className="example-card__status example-card__status--real">
                            real data
                          </span>
                        ) : null}
                        {analyzed ? (
                          <span className="example-card__status example-card__status--analyzed">
                            analysis included
                          </span>
                        ) : null}
                        <h3>{scenario.title}</h3>
                      </div>
                      {recent.includes(scenario.id) ? <span>Recent</span> : null}
                    </div>
                    <p>{scenario.summary}</p>
                    {scenario.status === 'enabled' && workflow !== undefined ? (
                      <div className="example-card__actions">
                        <Button
                          disabled={activity !== undefined}
                          onClick={() =>
                            void run(scenario, 'Opening', (signal) => onOpen(scenario, signal))
                          }
                          variant="primary"
                        >
                          {analyzed ? 'Open analyzed example' : 'Open example'}
                        </Button>
                        <Button
                          disabled={activity !== undefined}
                          onClick={() =>
                            void run(scenario, 'Preparing workflow', (signal) =>
                              onRunWorkflow(scenario, workflow, signal),
                            )
                          }
                        >
                          Run workflow
                        </Button>
                        <Button
                          disabled={activity !== undefined}
                          onClick={() => onInspectWorkflow(workflow)}
                        >
                          Inspect {workflow.artifactKind}
                        </Button>
                        {busy ? (
                          <Button onClick={() => activity?.controller.abort()}>Cancel</Button>
                        ) : null}
                      </div>
                    ) : (
                      <p className="example-card__unavailable">
                        <strong>Not available:</strong> {scenario.statusReason}
                      </p>
                    )}
                    {scenario.initialAnalysis === undefined ? null : (
                      <p className="example-card__analysis">
                        <strong>Opens analyzed:</strong> {scenario.initialAnalysis.title}.{' '}
                        {scenario.initialAnalysis.description}
                      </p>
                    )}
                    <dl className="example-card__facts">
                      <div>
                        <dt>Modality</dt>
                        <dd>{scenario.modality}</dd>
                      </div>
                      <div>
                        <dt>Format</dt>
                        <dd>{scenario.format}</dd>
                      </div>
                      <div>
                        <dt>Delivery</dt>
                        <dd>
                          {local ? 'Local' : 'Remote'} · {scenarioSize(scenario)}
                        </dd>
                      </div>
                      <div>
                        <dt>Calibration</dt>
                        <dd>{scenario.calibration}</dd>
                      </div>
                    </dl>
                    <div className="example-card__tags">
                      {scenario.tags.slice(0, 5).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                    <p className="example-card__goal">
                      <strong>Learn:</strong> {scenario.learningGoals.join(' · ')}
                    </p>
                    <p className="example-card__license">
                      <a href={scenario.license.url} rel="noreferrer" target="_blank">
                        {scenario.license.id}
                      </a>{' '}
                      · {scenario.license.attribution}
                      {scenario.source.kind === 'generated' ? null : (
                        <>
                          {' · '}
                          <a href={scenario.source.landingPage} rel="noreferrer" target="_blank">
                            Source
                          </a>
                        </>
                      )}
                    </p>
                    {busy ? (
                      <div className="example-card__progress" role="status">
                        <span />
                        {activity?.label}…
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })
          )}
        </div>

        <div className="url-dialog__actions">
          <span>External assets are never fetched until an enabled action requests them.</span>
          <Button onClick={close} variant="primary">
            Close
          </Button>
        </div>
      </section>
    </div>
  )
}
