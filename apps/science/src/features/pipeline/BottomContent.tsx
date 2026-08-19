import type { OpenedDatasetDescriptor } from '@pji-workbench/contracts'
import { type MaterialsPanelState, readablePipeline } from '@pji-workbench/domain-science'
import { Button, type TabItem } from '@pji-workbench/ui'
import type { WorkspaceHistoryEntry, WorkspaceSnapshot } from '@pji-workbench/workspace'
import type { ReactNode } from 'react'

export type BottomTab = 'pipeline' | 'history' | 'histogram' | 'profile' | 'results' | 'log'

export const bottomTabs: readonly TabItem<BottomTab>[] = [
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'history', label: 'History' },
  { id: 'histogram', label: 'Histogram' },
  { id: 'profile', label: 'Line Profile' },
  { id: 'results', label: 'Results' },
  { id: 'log', label: 'Log' },
]

const HISTOGRAM_BIN_IDS = Array.from({ length: 32 }, (_value, index) => `histogram-${index}`)

export interface BottomContentProps {
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
}

export function BottomContent({
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
}: BottomContentProps) {
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
