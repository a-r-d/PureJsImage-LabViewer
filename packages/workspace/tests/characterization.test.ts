import { describe, expect, it } from 'vitest'

import {
  applyWorkspaceCommand,
  createEmptyWorkspace,
  type DisplayLayerState,
  datasetReferenceId,
  importWorkspaceProject,
  MemoryProjectStore,
  type ProjectId,
  type SemanticSourceId,
  serializeWorkspaceProject,
  type WorkspaceDatasetReference,
  type WorkspaceMutation,
  type WorkspaceSelection,
  type WorkspaceSourceReference,
  workspaceCommand,
} from '../src/index.js'

const NOW = '2026-08-18T00:00:00.000Z'
const PROJECT_ID = 'characterization-project' as ProjectId
const SOURCE_ID = 'source-sem' as SemanticSourceId
const DATASET_ID = datasetReferenceId(SOURCE_ID, 'surface')
const identity = {
  kind: 'application-defined' as const,
  namespace: 'test.purejsimage.lab',
  value: 'characterization-source-v1',
}

const source: WorkspaceSourceReference = {
  id: SOURCE_ID,
  label: 'sample.gsf',
  locator: { kind: 'sample', sampleId: 'generated.calibrated-particles' },
  identity,
  reader: { id: 'gsf', version: '1', format: 'Gwyddion Simple Field' },
  bound: true,
}

const descriptor = {
  id: 'surface',
  identity,
  name: 'Surface',
  sampleType: 'float32',
  axes: [
    {
      id: 'x',
      kind: 'spatial',
      length: 16,
      unit: 'nm',
      coordinates: { type: 'linear' as const, origin: 0, step: 0.5 },
    },
    {
      id: 'y',
      kind: 'spatial',
      length: 12,
      unit: 'nm',
      coordinates: { type: 'linear' as const, origin: 0, step: 0.5 },
    },
  ],
  components: [{ id: 'value', kind: 'scalar' }],
  levels: [
    {
      level: 0,
      axisLengths: [
        { axisId: 'x', length: 16 },
        { axisId: 'y', length: 12 },
      ],
    },
  ],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'any-axis-pair' as const },
  },
} as const

const dataset: WorkspaceDatasetReference = {
  id: DATASET_ID,
  sourceId: SOURCE_ID,
  datasetId: 'surface',
  identity,
  descriptor,
}

const selection: WorkspaceSelection = {
  sourceId: SOURCE_ID,
  datasetReferenceId: DATASET_ID,
  plane: { displayAxes: ['x', 'y'], fixedIndices: [], resolutionLevel: 0 },
  component: 0,
}

const layer: DisplayLayerState = {
  id: 'source-layer' as DisplayLayerState['id'],
  datasetReferenceId: DATASET_ID,
  label: 'Source image',
  visible: true,
  opacity: 1,
  mapping: { mode: 'linear', range: 'auto' },
  palette: 'gray',
}

const sourceAdd: WorkspaceMutation = {
  kind: 'source.add',
  source,
  datasets: [dataset],
  layers: [layer],
  activate: selection,
}

describe('science project persistence characterization', () => {
  it('saves and loads a semantic project without live runtime handles', async () => {
    const empty = createEmptyWorkspace('Characterization project', {
      projectId: PROJECT_ID,
      now: NOW,
    })
    const snapshot = applyWorkspaceCommand(
      empty,
      workspaceCommand(empty, 'source-add', NOW, sourceAdd),
    ).snapshot
    const withGraph = applyWorkspaceCommand(
      snapshot,
      workspaceCommand(snapshot, 'analysis-graph', NOW, {
        kind: 'analysis.set-graph',
        graph: {
          schemaVersion: 1,
          inputs: [],
          nodes: [
            {
              id: 'threshold',
              operation: { id: 'purejsimage.analysis.threshold', version: 1 },
              inputs: [],
              parameters: { minimum: 120 },
              label: 'Threshold',
            },
          ],
          outputs: [],
        },
      }),
    ).snapshot

    const store = new MemoryProjectStore()
    await store.save(withGraph)
    const loaded = await store.load(withGraph.project.id)
    expect(loaded).toEqual(withGraph)
    expect(serializeWorkspaceProject(loaded ?? empty)).toBe(serializeWorkspaceProject(withGraph))
    expect(
      importWorkspaceProject(serializeWorkspaceProject(withGraph)).sources[0]?.locator,
    ).toEqual(source.locator)
    expect(serializeWorkspaceProject(withGraph)).not.toMatch(/apiKey|documentId|handleId|tileId/iu)
    const summaries = await store.list()
    expect(summaries).toEqual([
      expect.objectContaining({
        id: PROJECT_ID,
        title: 'Characterization project',
      }),
    ])
  })
})
