import {
  createEmptyWorkspace,
  type SemanticSourceId,
  type WorkspaceSnapshot,
} from '@pji-workbench/workspace'
import { describe, expect, it } from 'vitest'
import {
  mutationsToReplaceOpenSource,
  snapshotWithVisibleWorkflow,
} from '../src/features/project/project-actions.js'

const SOURCE_ID = 'source-previous' as SemanticSourceId

function snapshotWithSource(): WorkspaceSnapshot {
  const empty = createEmptyWorkspace('Test project')
  return {
    ...empty,
    sources: [
      {
        id: SOURCE_ID,
        label: 'previous.gsf',
        locator: { kind: 'sample', sampleId: 'generated.calibrated-particles' },
        identity: {
          kind: 'application-defined',
          namespace: 'test',
          value: 'previous',
        },
        reader: { id: 'gsf', version: '1', format: 'Gwyddion Simple Field' },
        bound: true,
      },
    ],
    analysis: {
      ...empty.analysis,
      graph: {
        schemaVersion: 1,
        inputs: [],
        nodes: [
          {
            id: 'threshold-1',
            operation: { id: 'threshold', version: 1 },
            inputs: [],
            parameters: {},
          },
        ],
        outputs: [],
      },
    },
  }
}

describe('project open replacements', () => {
  it('clears leftover analysis and sources when opening a new file', () => {
    const mutations = mutationsToReplaceOpenSource(snapshotWithSource())
    expect(mutations).toEqual([
      {
        kind: 'analysis.set-graph',
        graph: { schemaVersion: 1, inputs: [], nodes: [], outputs: [] },
      },
      { kind: 'source.remove', sourceId: SOURCE_ID },
    ])
  })

  it('writes inspector and bottom tabs onto a snapshot without inventing a revision', () => {
    const snapshot = createEmptyWorkspace('Test project')
    const next = snapshotWithVisibleWorkflow(snapshot, {
      inspector: 'analysis',
      bottom: 'pipeline',
    })
    expect(next.revision).toBe(snapshot.revision)
    expect(next.workflow).toEqual({ inspector: 'analysis', bottom: 'pipeline' })
    expect(snapshotWithVisibleWorkflow(next, { inspector: 'analysis', bottom: 'pipeline' })).toBe(
      next,
    )
  })
})
