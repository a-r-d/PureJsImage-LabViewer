import type {
  DisplayMapping,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  PlaneSelection,
} from '@pji-workbench/contracts'
import { Button, type TabItem } from '@pji-workbench/ui'
import type { WorkspaceHistoryEntry } from '@pji-workbench/workspace'
import type { ReactNode } from 'react'

import { axisPairOptions, calibrationLabel, fileSize } from '../source/source-model.js'

export type InspectorTab = 'info' | 'display' | 'roi' | 'analysis' | 'history' | 'agent'

export const inspectorTabs: readonly TabItem<InspectorTab>[] = [
  { id: 'info', label: 'Info' },
  { id: 'display', label: 'Display' },
  { id: 'roi', label: 'ROI' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'history', label: 'History' },
  { id: 'agent', label: 'Agent' },
]

export interface InspectorContentProps {
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

export function InspectorContent({
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
          The semantic action host is ready. Model access remains disabled until Prompt 14.
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
