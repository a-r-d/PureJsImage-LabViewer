import {
  type DisplayMapping,
  type OpenedDatasetDescriptor,
  type OpenedSourceDescriptor,
  type PlaneSelection,
  type SourceRangeDiagnostics,
  spatialReferenceFacts,
} from '@pji-workbench/contracts'
import type { TabItem } from '@pji-workbench/ui'
import type { WorkspaceHistoryEntry } from '@pji-workbench/workspace'
import type { ReactNode } from 'react'

import { axisPairOptions, calibrationLabel, fileSize } from '../source/source-model.js'

export type InspectorTab = 'info' | 'display' | 'roi' | 'analysis' | 'history' | 'agent'

export const inspectorTabs: readonly TabItem<InspectorTab>[] = [
  { id: 'info', label: 'Info' },
  { id: 'display', label: 'Display' },
  { id: 'roi', label: 'ROI' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'agent', label: 'Agent' },
]

export interface InspectorContentProps {
  readonly tab: InspectorTab
  readonly source: OpenedSourceDescriptor | undefined
  readonly diagnostics?: SourceRangeDiagnostics
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
  readonly agentContent: ReactNode
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
  agentContent,
  diagnostics,
}: InspectorContentProps) {
  if (tab === 'agent') return agentContent
  if (source === undefined || opened === undefined || selection === undefined) {
    const emptyCopy: Readonly<Record<InspectorTab, string>> = {
      info: 'Open a dataset to inspect calibration, axes, and file metadata.',
      display: 'Open a dataset to adjust display mapping without changing source pixels.',
      roi: 'Open a dataset to draw regions and measure them.',
      analysis: 'Open a dataset to run a guided analysis recipe.',
      history: 'Open a dataset to inspect project history.',
      agent: 'Open a dataset before reviewing an agent plan.',
    }
    return <p className="panel-placeholder">{emptyCopy[tab]}</p>
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
                max={Math.max(0, axis.length - 1)}
                min={0}
                type="number"
                value={fixed.index}
                onChange={(event) =>
                  onSelection({
                    ...selection,
                    fixedIndices: selection.fixedIndices.map((candidate) =>
                      candidate.axisId === axis.id
                        ? { axisId: axis.id, index: Number(event.target.value) }
                        : candidate,
                    ),
                  })
                }
              />
            </label>
          )
        })}
        {mapping.omeZarrChannels === undefined ? null : (
          <fieldset className="form-stack">
            <legend>OME-Zarr channels</legend>
            <label>
              Color model
              <select
                value={mapping.colorModel ?? 'color'}
                onChange={(event) =>
                  onMapping({
                    ...mapping,
                    colorModel: event.target.value === 'greyscale' ? 'greyscale' : 'color',
                  })
                }
              >
                <option value="color">Color</option>
                <option value="greyscale">Greyscale</option>
              </select>
            </label>
            {mapping.omeZarrChannels.map((channel, index) => {
              const channels = mapping.omeZarrChannels
              if (channels === undefined) return null
              return (
                <fieldset className="form-stack" key={channel.index}>
                  <legend>{channel.label ?? `Channel ${channel.index}`}</legend>
                  <label>
                    <input
                      checked={channel.active}
                      onChange={(event) =>
                        onMapping({
                          ...mapping,
                          omeZarrChannels: channels.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, active: event.target.checked }
                              : candidate,
                          ),
                        })
                      }
                      type="checkbox"
                    />
                    Active
                  </label>
                  <label>
                    Color
                    <input
                      onChange={(event) => {
                        const hex = event.target.value.replace('#', '')
                        const color = Number.parseInt(hex, 16)
                        if (!Number.isFinite(color)) return
                        onMapping({
                          ...mapping,
                          omeZarrChannels: channels.map((candidate, candidateIndex) =>
                            candidateIndex === index ? { ...candidate, color } : candidate,
                          ),
                        })
                      }}
                      type="color"
                      value={`#${(channel.color ?? 0xffffff).toString(16).padStart(6, '0')}`}
                    />
                  </label>
                  <label>
                    Coefficient
                    <input
                      onChange={(event) =>
                        onMapping({
                          ...mapping,
                          omeZarrChannels: channels.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, coefficient: Number(event.target.value) }
                              : candidate,
                          ),
                        })
                      }
                      step="0.1"
                      type="number"
                      value={channel.coefficient ?? 1}
                    />
                  </label>
                  <label>
                    <input
                      checked={channel.inverted === true}
                      onChange={(event) =>
                        onMapping({
                          ...mapping,
                          omeZarrChannels: channels.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, inverted: event.target.checked }
                              : candidate,
                          ),
                        })
                      }
                      type="checkbox"
                    />
                    Invert
                  </label>
                  {channel.window === undefined ? null : (
                    <p className="panel-note">
                      Authored window {channel.window.start}–{channel.window.end}
                    </p>
                  )}
                </fieldset>
              )
            })}
            <p className="panel-note">
              Channel overrides stay in the display mapping. Source OMERO metadata is not mutated.
            </p>
          </fieldset>
        )}
        <label>
          Display range
          <select
            value={mapping.range}
            onChange={(event) =>
              onMapping(
                event.target.value === 'auto'
                  ? { ...mapping, mode: 'linear', range: 'auto' }
                  : {
                      ...mapping,
                      mode: 'linear',
                      range: 'manual',
                      minimum: mapping.minimum ?? 0,
                      maximum: mapping.maximum ?? 255,
                    },
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
        <dd>
          {opened.dataset.axes
            .map(({ id, length, unit }) => `${id} ${length}${unit === undefined ? '' : ` ${unit}`}`)
            .join(' × ')}
        </dd>
      </div>
      <div>
        <dt>Calibration</dt>
        <dd>{calibrationLabel(opened)}</dd>
      </div>
      {opened.dataset.spatialReference === undefined
        ? null
        : spatialReferenceFacts(opened.dataset.spatialReference).map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
      <div>
        <dt>Source</dt>
        <dd>{source.reader.format}</dd>
      </div>
      {typeof source.metadata['omeNgffVersion'] === 'string' ? (
        <div>
          <dt>NGFF version</dt>
          <dd>{source.metadata['omeNgffVersion']}</dd>
        </div>
      ) : null}
      {typeof source.metadata['zarrFormat'] === 'number' ? (
        <div>
          <dt>Zarr version</dt>
          <dd>{String(source.metadata['zarrFormat'])}</dd>
        </div>
      ) : null}
      {typeof opened.dataset.metadata?.['kind'] === 'string' ? (
        <div>
          <dt>Dataset kind</dt>
          <dd>{opened.dataset.metadata['kind']}</dd>
        </div>
      ) : null}
      {source.source.kind.startsWith('ome-zarr') ? (
        <div>
          <dt>Selected level</dt>
          <dd>{String(selection.resolutionLevel)}</dd>
        </div>
      ) : null}
      {Array.isArray(opened.dataset.metadata?.['omeZarrLevels'])
        ? (opened.dataset.metadata['omeZarrLevels'] as readonly Readonly<Record<string, unknown>>[])
            .filter((level) => level['level'] === selection.resolutionLevel)
            .flatMap((level) => [
              <div key="logical-chunks">
                <dt>Logical chunks</dt>
                <dd>{JSON.stringify(level['logicalChunkShape'] ?? [])}</dd>
              </div>,
              <div key="outer-shards">
                <dt>Outer shards</dt>
                <dd>{JSON.stringify(level['storageChunkShape'] ?? [])}</dd>
              </div>,
              <div key="scale">
                <dt>Scale</dt>
                <dd>{JSON.stringify(level['scale'] ?? [])}</dd>
              </div>,
              <div key="translation">
                <dt>Translation</dt>
                <dd>{JSON.stringify(level['translation'] ?? [])}</dd>
              </div>,
              <div key="codecs">
                <dt>Codecs</dt>
                <dd>{Array.isArray(level['codecs']) ? level['codecs'].join(', ') : 'none'}</dd>
              </div>,
              <div key="shard-index">
                <dt>Shard index</dt>
                <dd>
                  {typeof level['shardIndexLocation'] === 'string'
                    ? level['shardIndexLocation']
                    : 'n/a'}
                </dd>
              </div>,
            ])
        : null}
      {(() => {
        const display = opened.dataset.metadata?.['omeZarrDisplay']
        const channels =
          typeof display === 'object' &&
          display !== null &&
          !Array.isArray(display) &&
          Array.isArray((display as { channels?: unknown }).channels)
            ? (display as { channels: readonly unknown[] }).channels
            : undefined
        if (channels === undefined) return null
        return channels.map((channel) => {
          const record =
            typeof channel === 'object' && channel !== null
              ? (channel as Readonly<Record<string, unknown>>)
              : {}
          const key =
            typeof record['label'] === 'string'
              ? record['label']
              : `channel-${String(record['index'] ?? record['color'] ?? 'omero')}`
          return (
            <div key={key}>
              <dt>OMERO channel {key}</dt>
              <dd>
                {typeof record['label'] === 'string' ? record['label'] : key}
                {typeof record['color'] === 'number'
                  ? ` #${record['color'].toString(16).padStart(6, '0')}`
                  : ''}
              </dd>
            </div>
          )
        })
      })()}
      {diagnostics?.omeZarrNetwork === undefined ? null : (
        <>
          <div>
            <dt>Object requests</dt>
            <dd>{String(diagnostics.omeZarrNetwork.objectRequests)}</dd>
          </div>
          <div>
            <dt>Range requests</dt>
            <dd>{String(diagnostics.omeZarrNetwork.rangeRequests)}</dd>
          </div>
          <div>
            <dt>Metadata bytes</dt>
            <dd>{fileSize(diagnostics.omeZarrNetwork.metadataBytesFetched)}</dd>
          </div>
          <div>
            <dt>Array bytes</dt>
            <dd>{fileSize(diagnostics.omeZarrNetwork.arrayBytesFetched)}</dd>
          </div>
          <div>
            <dt>Unique bytes</dt>
            <dd>{fileSize(diagnostics.uniqueBytes ?? diagnostics.omeZarrNetwork.uniqueBytes)}</dd>
          </div>
          <div>
            <dt>Cache bytes</dt>
            <dd>{fileSize(diagnostics.rangeCacheBytes)}</dd>
          </div>
          <div>
            <dt>Cache hits</dt>
            <dd>{String(diagnostics.rangeCacheHits)}</dd>
          </div>
          <div>
            <dt>Cancelled requests</dt>
            <dd>{String(diagnostics.omeZarrNetwork.abortedConsumers)}</dd>
          </div>
        </>
      )}
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
