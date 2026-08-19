import { createEmptyWorkspace, type SemanticSourceId } from '@pji-workbench/workspace'
import { describe, expect, it } from 'vitest'

import {
  createProject,
  duplicateProjectSnapshot,
  mutationsToReplaceOpenSource,
  setProjectTitleMutation,
  snapshotWithVisibleWorkflow,
} from '../src/index.js'

describe('project lifecycle', () => {
  it('creates a science project with the current application versions', () => {
    const project = createProject('Untitled microscopy project', {
      now: '2020-01-01T00:00:00.000Z',
      projectId: 'project-fixed' as ReturnType<typeof createProject>['project']['id'],
    })
    expect(project.project.title).toBe('Untitled microscopy project')
    expect(project.project.createdWith.appVersion).toBe('0.0.0')
    expect(project.revision).toBe(0)
  })

  it('clears leftover analysis and sources when opening a new file', () => {
    const empty = createEmptyWorkspace('Test project')
    const sourceId = 'source-previous' as SemanticSourceId
    const snapshot = {
      ...empty,
      sources: [
        {
          id: sourceId,
          label: 'previous.gsf',
          locator: { kind: 'sample' as const, sampleId: 'generated.calibrated-particles' },
          identity: { kind: 'application-defined', namespace: 'test', value: 'previous' },
          reader: { id: 'gsf', version: '1', format: 'Gwyddion Simple Field' },
          bound: true,
        },
      ],
      analysis: {
        ...empty.analysis,
        graph: {
          schemaVersion: 1 as const,
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
    expect(mutationsToReplaceOpenSource(snapshot)).toEqual([
      {
        kind: 'analysis.set-graph',
        graph: { schemaVersion: 1, inputs: [], nodes: [], outputs: [] },
      },
      { kind: 'source.remove', sourceId },
    ])
  })

  it('duplicates a project identity for Save As without copying IndexedDB state', () => {
    const current = createProject('Original', {
      now: '2020-01-01T00:00:00.000Z',
      projectId: 'project-original' as ReturnType<typeof createProject>['project']['id'],
    })
    const copy = duplicateProjectSnapshot(current, {
      now: '2020-02-01T00:00:00.000Z',
      projectId: 'project-copy' as ReturnType<typeof createProject>['project']['id'],
    })
    expect(copy.project.id).toBe('project-copy')
    expect(copy.project.title).toBe('Original copy')
    expect(copy.revision).toBe(0)
    expect(setProjectTitleMutation('Renamed')).toEqual({
      kind: 'project.set-title',
      title: 'Renamed',
    })
    const next = snapshotWithVisibleWorkflow(current, { inspector: 'analysis', bottom: 'pipeline' })
    expect(next.workflow).toEqual({ inspector: 'analysis', bottom: 'pipeline' })
  })
})
