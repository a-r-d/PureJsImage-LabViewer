import type {
  AnalysisDryRunResponse,
  AnalysisExecutionResponse,
  AnalysisTablePage,
  OpenedDatasetDescriptor,
} from '@pji-workbench/contracts'
import { Button } from '@pji-workbench/ui'
import type { WorkspaceSnapshot } from '@pji-workbench/workspace'

import type { RoiTool, ViewportRoi } from './ScientificViewport.js'

export interface MaterialsPanelState {
  readonly busy: boolean
  readonly message?: string
  readonly dryRun?: AnalysisDryRunResponse
  readonly execution?: AnalysisExecutionResponse
  readonly table?: AnalysisTablePage
  readonly tableOffset: number
  readonly selectedLabel?: number | undefined
}

function roiMeasurement(roi: ViewportRoi, opened: OpenedDatasetDescriptor): string {
  const points =
    roi.geometry.kind === 'point'
      ? [roi.geometry.point]
      : roi.geometry.kind === 'line-segment'
        ? [roi.geometry.start, roi.geometry.end]
        : roi.geometry.kind === 'polyline' || roi.geometry.kind === 'polygon'
          ? roi.geometry.points
          : []
  const lineLength = points.slice(1).reduce((total, point, index) => {
    const previous = points[index]
    return previous === undefined
      ? total
      : total + Math.hypot(point.x - previous.x, point.y - previous.y)
  }, 0)
  const pixelArea =
    roi.geometry.kind === 'rectangle'
      ? roi.geometry.width * roi.geometry.height
      : roi.geometry.kind === 'ellipse'
        ? Math.PI * roi.geometry.radiusX * roi.geometry.radiusY
        : roi.geometry.kind === 'polygon'
          ? Math.abs(
              roi.geometry.points.reduce((sum, point, index, polygon) => {
                const next = polygon[(index + 1) % polygon.length]
                return next === undefined ? sum : sum + point.x * next.y - next.x * point.y
              }, 0) / 2,
            )
          : undefined
  const pixel =
    pixelArea === undefined
      ? lineLength > 0
        ? `${lineLength.toFixed(2)} px`
        : points[0] === undefined
          ? 'pixel coordinates'
          : `${points[0].x.toFixed(1)}, ${points[0].y.toFixed(1)} px`
      : `${pixelArea.toFixed(2)} px²`
  const horizontal = opened.dataset.axes.find(({ id }) => id === roi.axisIds[0])
  const vertical = opened.dataset.axes.find(({ id }) => id === roi.axisIds[1])
  if (
    horizontal?.coordinates.type !== 'linear' ||
    vertical?.coordinates.type !== 'linear' ||
    horizontal.unit === undefined ||
    horizontal.unit !== vertical.unit
  ) {
    return `${pixel} · physical calibration unavailable`
  }
  const scaleX = Math.abs(horizontal.coordinates.step)
  const scaleY = Math.abs(vertical.coordinates.step)
  const physical =
    pixelArea === undefined
      ? points.length > 1
        ? `${points
            .slice(1)
            .reduce((total, point, index) => {
              const previous = points[index]
              return previous === undefined
                ? total
                : total +
                    Math.hypot((point.x - previous.x) * scaleX, (point.y - previous.y) * scaleY)
            }, 0)
            .toFixed(2)} ${horizontal.unit}`
        : 'calibrated point'
      : `${(pixelArea * scaleX * scaleY).toFixed(2)} ${horizontal.unit}²`
  return `${pixel} · ${physical}`
}

export function RoiInspector({
  rois,
  selectedRoiId,
  tool,
  onTool,
  onSelect,
  onRename,
  onVisibility,
  onDelete,
  onMeasure,
  opened,
}: {
  readonly rois: readonly ViewportRoi[]
  readonly selectedRoiId?: string | undefined
  readonly tool: RoiTool
  readonly onTool: (tool: RoiTool) => void
  readonly onSelect: (id?: string) => void
  readonly onRename: (roi: ViewportRoi, name: string) => void
  readonly onVisibility: (roi: ViewportRoi, visible: boolean) => void
  readonly onDelete: (id: string) => void
  readonly onMeasure: (kind: 'statistics' | 'histogram' | 'profile') => void
  readonly opened: OpenedDatasetDescriptor
}) {
  const tools: readonly RoiTool[] = [
    'select',
    'point',
    'line',
    'polyline',
    'rectangle',
    'ellipse',
    'polygon',
  ]
  const selected = rois.find(({ id }) => id === selectedRoiId)
  return (
    <div className="inspector-content form-stack" data-testid="roi-inspector">
      <fieldset className="tool-grid">
        <legend>Viewport tool</legend>
        {tools.map((candidate) => (
          <Button
            aria-pressed={tool === candidate}
            key={candidate}
            onClick={() => onTool(candidate)}
            variant={tool === candidate ? 'primary' : 'secondary'}
          >
            {candidate}
          </Button>
        ))}
      </fieldset>
      <p className="panel-note">
        Drag to draw. Handles remain screen-sized while zooming. Escape cancels; Delete removes the
        selected ROI.
      </p>
      <ul className="roi-list" aria-label="Regions of interest">
        {rois.length === 0 ? <li>No ROIs yet.</li> : null}
        {rois.map((roi) => {
          const style = roi.presentation?.style
          const visible = style?.['visible'] !== false
          return (
            <li data-selected={roi.id === selectedRoiId} key={roi.id}>
              <button type="button" onClick={() => onSelect(roi.id)}>
                {roi.name ?? roi.id}
              </button>
              <label>
                <span className="sr-only">Rename {roi.name ?? roi.id}</span>
                <input
                  aria-label={`Rename ${roi.name ?? roi.id}`}
                  onBlur={(event) => onRename(roi, event.target.value)}
                  defaultValue={roi.name ?? roi.id}
                />
              </label>
              <label className="inline-check">
                <input
                  checked={visible}
                  onChange={(event) => onVisibility(roi, event.target.checked)}
                  type="checkbox"
                />
                Visible
              </label>
              <small>{roiMeasurement(roi, opened)}</small>
              <Button onClick={() => onDelete(roi.id)}>Delete</Button>
            </li>
          )
        })}
      </ul>
      <div className="button-row">
        <Button disabled={selected === undefined} onClick={() => onMeasure('statistics')}>
          Statistics
        </Button>
        <Button disabled={selected === undefined} onClick={() => onMeasure('histogram')}>
          Histogram
        </Button>
        <Button
          disabled={
            selected === undefined ||
            (selected.geometry.kind !== 'line-segment' && selected.geometry.kind !== 'polyline')
          }
          onClick={() => onMeasure('profile')}
        >
          Line profile
        </Button>
      </div>
    </div>
  )
}

export function AnalysisInspector({
  threshold,
  mode,
  connectivity,
  component,
  planeLabel,
  operationCount,
  state,
  onThreshold,
  onMode,
  onConnectivity,
  onPreview,
  onCancelPreview,
  onApply,
  onRunObjects,
  onPlanObjects,
  connectedPlanReady,
}: {
  readonly threshold: number
  readonly mode: 'greater-than' | 'greater-than-or-equal' | 'less-than' | 'less-than-or-equal'
  readonly connectivity: 4 | 8
  readonly component: number
  readonly planeLabel: string
  readonly operationCount: number
  readonly state: MaterialsPanelState
  readonly onThreshold: (value: number) => void
  readonly onMode: (value: typeof mode) => void
  readonly onConnectivity: (value: 4 | 8) => void
  readonly onPreview: () => void
  readonly onCancelPreview: () => void
  readonly onApply: () => void
  readonly onRunObjects: () => void
  readonly onPlanObjects: () => void
  readonly connectedPlanReady: boolean
}) {
  const estimate = state.dryRun?.plan?.['totalEstimate']
  const estimateRecord: Readonly<Record<string, unknown>> | null =
    typeof estimate === 'object' && estimate !== null && !Array.isArray(estimate)
      ? (estimate as Readonly<Record<string, unknown>>)
      : null
  return (
    <div className="inspector-content form-stack" data-testid="analysis-inspector">
      <p className="panel-kicker">PureJsImage operation catalog · {operationCount} operations</p>
      <label>
        Comparison
        <select value={mode} onChange={(event) => onMode(event.target.value as typeof mode)}>
          <option value="greater-than">Greater than</option>
          <option value="greater-than-or-equal">Greater than or equal</option>
          <option value="less-than">Less than</option>
          <option value="less-than-or-equal">Less than or equal</option>
        </select>
      </label>
      <label>
        Threshold · component {component}
        <input
          aria-label="Threshold value"
          onChange={(event) => onThreshold(Number(event.target.value))}
          step="any"
          type="number"
          value={threshold}
        />
      </label>
      <div className="button-row">
        <Button disabled={state.busy} onClick={onPreview}>
          Preview
        </Button>
        <Button onClick={onCancelPreview}>Cancel preview</Button>
        <Button disabled={state.busy} onClick={onApply} variant="primary">
          Apply threshold
        </Button>
      </div>
      <p className="panel-note">
        Preview is temporary and cancellable. Apply creates one normalized project revision; display
        range is never used as an analysis input.
      </p>
      <hr />
      <p className="panel-note">
        Plane {planeLabel} · component {component}
      </p>
      <label>
        Connectivity
        <select
          value={connectivity}
          onChange={(event) => onConnectivity(Number(event.target.value) as 4 | 8)}
        >
          <option value={4}>4-connected</option>
          <option value={8}>8-connected</option>
        </select>
      </label>
      {estimateRecord === null ? (
        <p className="panel-note">Preview the plan to see resource estimates before execution.</p>
      ) : (
        <dl className="estimate-grid" aria-label="Analysis resource estimate">
          <div>
            <dt>Peak memory</dt>
            <dd>{String(estimateRecord['peakWorkingBytes'] ?? 'unresolved')} bytes</dd>
          </div>
          <div>
            <dt>Compute</dt>
            <dd>{String(estimateRecord['computeMilliseconds'] ?? 'unresolved')} ms</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>{String(estimateRecord['outputBytes'] ?? 'unresolved')} bytes</dd>
          </div>
        </dl>
      )}
      <div className="button-row">
        <Button disabled={state.busy} onClick={onPlanObjects}>
          Plan connected components
        </Button>
        <Button
          disabled={state.busy || !connectedPlanReady}
          onClick={onRunObjects}
          variant="primary"
        >
          Run connected components
        </Button>
      </div>
      <p className="panel-note">Outputs: label overlay and bounded, paged object measurements.</p>
      {state.message === undefined ? null : (
        <p aria-live="polite" className="analysis-message">
          {state.message}
        </p>
      )}
      {state.dryRun?.issues.map((issue) => (
        <p className="error-banner" key={JSON.stringify(issue)}>
          {String(issue['message'] ?? 'Analysis validation failed')}
        </p>
      ))}
    </div>
  )
}

export function analysisPageRows(
  page: AnalysisTablePage,
): readonly Readonly<Record<string, unknown>>[] {
  return Array.from({ length: page.rowCount }, (_value, row) =>
    Object.fromEntries(page.columns.map((column) => [column.name, column.values[row] ?? null])),
  )
}

function numericPreview(value: unknown): readonly number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number')
    : []
}

function keyedValues(values: readonly number[]) {
  const counts = new Map<number, number>()
  return values.map((value) => {
    const ordinal = counts.get(value) ?? 0
    counts.set(value, ordinal + 1)
    return { id: `${value}:${ordinal}`, value }
  })
}

function ResultPreviewPlot({ execution }: { readonly execution: AnalysisExecutionResponse }) {
  const result = execution.outputs.find((output) => output.kind === 'result')
  if (result?.kind !== 'result') return null
  const preview = result.summary['preview']
  if (typeof preview !== 'object' || preview === null || Array.isArray(preview)) return null
  const previewRecord = preview as Readonly<Record<string, unknown>>
  const values =
    numericPreview(previewRecord['counts']).length > 0
      ? numericPreview(previewRecord['counts'])
      : numericPreview(previewRecord['value'])
  if (values.length === 0) return null
  const maximum = Math.max(1, ...values)
  return (
    <div className="result-plot" aria-label={`Bounded ${result.name} preview`} role="img">
      {keyedValues(values).map(({ id, value }) => (
        <span key={id} style={{ height: `${Math.max(2, (value / maximum) * 54)}px` }} />
      ))}
    </div>
  )
}

function ObjectDistributions({ page }: { readonly page: AnalysisTablePage }) {
  const definitions = [
    ['pixelArea', 'Area'],
    ['equivalentCircularDiameter', 'ECD'],
    ['aspectRatio', 'Aspect ratio'],
    ['orientationRadians', 'Orientation'],
  ] as const
  const available = definitions.flatMap(([name, label]) => {
    const column = page.columns.find((candidate) => candidate.name === name)
    if (column === undefined) return []
    const values = column.values.filter((value): value is number => typeof value === 'number')
    return values.length === 0 ? [] : [{ name, label, values }]
  })
  if (available.length === 0) return null
  return (
    <section className="distribution-grid" aria-label="Bounded object distributions">
      {available.map(({ name, label, values }) => {
        const maximum = Math.max(...values)
        const minimum = Math.min(...values)
        const span = Math.max(Number.EPSILON, maximum - minimum)
        return (
          <figure key={name}>
            <figcaption>{label} · current page</figcaption>
            <div>
              {keyedValues(values.slice(0, 50)).map(({ id, value }) => (
                <span key={id} style={{ height: `${4 + ((value - minimum) / span) * 34}px` }} />
              ))}
            </div>
          </figure>
        )
      })}
    </section>
  )
}

export function AnalysisResults({
  state,
  onPage,
  onSort,
  onFilter,
  onSelectLabel,
  onExport,
  onPin,
}: {
  readonly state: MaterialsPanelState
  readonly onPage: (offset: number) => void
  readonly onSort: (column: string) => void
  readonly onFilter: (column: string, minimum?: number) => void
  readonly onSelectLabel: (label?: number) => void
  readonly onExport: (scope: 'selected' | 'all', format: 'csv' | 'json') => void
  readonly onPin: () => void
}) {
  const execution = state.execution
  if (execution === undefined) {
    return <p className="bottom-placeholder">Run an ROI measurement or object workflow.</p>
  }
  const table = state.table
  return (
    <div className="analysis-results" data-testid="analysis-results">
      <div className="result-summary-row">
        <strong>{execution.outputs.length} bounded outputs</strong>
        <span>{execution.elapsedMilliseconds.toFixed(1)} ms</span>
        <Button onClick={onPin}>Pin result</Button>
        <Button onClick={() => onExport('selected', 'csv')}>Export selected CSV</Button>
        <Button onClick={() => onExport('all', 'csv')}>Export all CSV</Button>
        <Button onClick={() => onExport('all', 'json')}>Export JSON</Button>
      </div>
      <ResultPreviewPlot execution={execution} />
      {table === undefined ? (
        <pre className="result-json">
          {JSON.stringify(
            execution.outputs.map(({ kind, name, ...rest }) => ({ kind, name, ...rest })),
            null,
            2,
          )}
        </pre>
      ) : (
        <>
          <div className="result-summary-row">
            <strong>{table.totalRows.toLocaleString()} objects</strong>
            <label>
              Minimum area
              <input
                aria-label="Minimum area filter"
                min={0}
                onChange={(event) =>
                  onFilter(
                    'pixelArea',
                    event.target.value === '' ? undefined : Number(event.target.value),
                  )
                }
                type="number"
              />
            </label>
          </div>
          <ObjectDistributions page={table} />
          <section className="virtual-table" aria-label="Paged object measurements">
            <table>
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th key={column.name}>
                      <button type="button" onClick={() => onSort(column.name)}>
                        {column.name}
                        {column.unit === undefined ? '' : ` (${column.unit})`}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysisPageRows(table).map((row) => {
                  const labelValue = row['label'] ?? row['id']
                  const label = typeof labelValue === 'number' ? labelValue : undefined
                  return (
                    <tr
                      data-selected={label !== undefined && label === state.selectedLabel}
                      key={String(labelValue ?? JSON.stringify(row))}
                      onClick={() => onSelectLabel(label)}
                    >
                      {table.columns.map((column) => {
                        const value = row[column.name]
                        return (
                          <td key={column.name}>
                            {column.name === 'label' && label !== undefined ? (
                              <button
                                aria-label={`Select label ${label}`}
                                aria-pressed={label === state.selectedLabel}
                                className="table-label-button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onSelectLabel(label)
                                }}
                                type="button"
                              >
                                {String(value ?? '—')}
                              </button>
                            ) : (
                              String(value ?? '—')
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
          <div className="button-row">
            <Button
              disabled={table.offset === 0}
              onClick={() => onPage(Math.max(0, table.offset - 50))}
            >
              Previous
            </Button>
            <span>
              {table.offset + 1}–{table.offset + table.rowCount} of {table.totalRows}
            </span>
            <Button
              disabled={table.offset + table.rowCount >= table.totalRows}
              onClick={() => onPage(table.offset + 50)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export function readablePipeline(graph: WorkspaceSnapshot['analysis']['graph']): readonly Readonly<{
  id: string
  label: string
  version: number
  parameters: unknown
}>[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    label: node.label ?? node.operation.id,
    version: node.operation.version,
    parameters: node.parameters,
  }))
}
