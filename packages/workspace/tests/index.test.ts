import { describe, expect, it, vi } from 'vitest'

import {
  type ArtifactReferenceId,
  applyWorkspaceCommand,
  applyWorkspaceCommandBatch,
  createEmptyWorkspace,
  type DisplayLayerState,
  datasetReferenceId,
  describeWorkspaceCommand,
  deterministicJson,
  importWorkspaceProject,
  invertWorkspaceMutation,
  MemoryArtifactStore,
  MemoryProjectStore,
  type ProjectId,
  type SemanticSourceId,
  semanticIdentityEqual,
  serializeWorkspaceProject,
  WORKSPACE_LIMITS,
  type WorkspaceCommand,
  type WorkspaceCommandBatch,
  WorkspaceCommandError,
  WorkspaceHistory,
  type WorkspaceMutation,
  type WorkspaceRuntimePort,
  WorkspaceRuntimeReconciler,
  type WorkspaceSelection,
  type WorkspaceSnapshot,
  type WorkspaceSourceReference,
  WorkspaceValidationError,
  workspaceCommand,
} from '../src/index.js'

const NOW = '2026-08-14T00:00:00.000Z'
const SOURCE_ID = 'source-sem' as SemanticSourceId
const DATASET_ID = datasetReferenceId(SOURCE_ID, 'surface')
const identity = {
  kind: 'application-defined' as const,
  namespace: 'test.purejsimage.lab',
  value: 'source-v1',
}
const source: WorkspaceSourceReference = {
  id: SOURCE_ID,
  label: 'sample.gsf',
  locator: { kind: 'sample', sampleId: 'generated-sem' },
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
      coordinates: { type: 'linear', origin: 0, step: 0.5 },
    },
    {
      id: 'y',
      kind: 'spatial',
      length: 12,
      unit: 'nm',
      coordinates: { type: 'linear', origin: 0, step: 0.5 },
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
    planeReads: { kind: 'any-axis-pair' },
  },
} as const
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
  datasets: [{ id: DATASET_ID, sourceId: SOURCE_ID, datasetId: 'surface', identity, descriptor }],
  layers: [layer],
  activate: selection,
}
const roi = {
  schemaVersion: 1 as const,
  id: 'roi-1',
  name: 'Precipitates',
  axisIds: ['x', 'y'] as const,
  fixedIndices: [],
  coordinateSpace: 'pixel' as const,
  geometry: { kind: 'rectangle' as const, x: 1, y: 2, width: 5, height: 4 },
}
const node = {
  id: 'threshold',
  operation: { id: 'purejsimage.threshold', version: 1 },
  inputs: [],
  parameters: { minimum: 120 },
  label: 'Threshold',
} as const
const secondNode = {
  id: 'components',
  operation: { id: 'purejsimage.connected-components', version: 1 },
  inputs: [],
  parameters: { connectivity: 8 },
} as const
const input = {
  name: 'image',
  valueType: { id: 'purejsimage.numeric-dataset', version: 1 },
  label: 'Active image',
} as const
const binding = {
  input: 'image',
  valueType: input.valueType,
  identity,
  value: { kind: 'source' as const, sourceReference: SOURCE_ID },
}
const output = {
  name: 'labels',
  source: { kind: 'node' as const, nodeId: 'threshold', output: 'mask' },
  label: 'Threshold mask',
}
const result = {
  id: 'result-1' as const,
  graphOutput: 'labels',
  label: 'Particle summary',
  kind: 'table-summary',
  summary: { rowCount: 42 },
  createdAt: NOW,
}

function empty(): WorkspaceSnapshot {
  return createEmptyWorkspace('Microscopy project', {
    projectId: 'project-1' as ProjectId,
    now: NOW,
  })
}

let commandSequence = 0
function apply(snapshot: WorkspaceSnapshot, mutation: WorkspaceMutation): WorkspaceSnapshot {
  commandSequence += 1
  return applyWorkspaceCommand(
    snapshot,
    workspaceCommand(snapshot, `command-${commandSequence}`, NOW, mutation),
  ).snapshot
}

function applyBatch(
  snapshot: WorkspaceSnapshot,
  mutations: readonly Exclude<WorkspaceMutation, { readonly kind: 'agent.apply-proposal' }>[],
): WorkspaceSnapshot {
  commandSequence += 1
  return applyWorkspaceCommandBatch(snapshot, {
    schemaVersion: 1,
    id: `batch-${commandSequence}`,
    expectedRevision: snapshot.revision,
    issuedAt: NOW,
    commands: mutations,
  }).snapshot
}

function populated(): WorkspaceSnapshot {
  return apply(empty(), sourceAdd)
}

function semantic(snapshot: WorkspaceSnapshot): unknown {
  return {
    ...snapshot,
    revision: 0,
    project: { ...snapshot.project, updatedAt: NOW },
  }
}

function expectRoundTrip(base: WorkspaceSnapshot, mutation: WorkspaceMutation): void {
  const inverse = invertWorkspaceMutation(base, mutation)
  const changed = apply(base, mutation)
  const restored = applyBatch(
    changed,
    inverse as readonly Exclude<WorkspaceMutation, { readonly kind: 'agent.apply-proposal' }>[],
  )
  expect(semantic(restored)).toEqual(semantic(base))
}

describe('workspace model and commands', () => {
  it('stores anisotropic known-line calibration as an invertible semantic command', () => {
    const base = populated()
    const mutation: WorkspaceMutation = {
      kind: 'calibration.set',
      calibration: {
        datasetReferenceId: DATASET_ID,
        axisIds: ['x', 'y'],
        unitsPerPixel: [0.25, 0.5],
        unit: 'nm',
        source: 'known-line',
        knownDistance: 10,
        measuredPixels: 40,
      },
    }
    const calibrated = apply(base, mutation)
    expect(calibrated.calibrations[0]).toMatchObject({
      unitsPerPixel: [0.25, 0.5],
      source: 'known-line',
    })
    expect(calibrated.datasets[0]?.descriptor).toEqual(descriptor)
    expectRoundTrip(base, mutation)
    expect(importWorkspaceProject(serializeWorkspaceProject(calibrated)).calibrations).toEqual(
      calibrated.calibrations,
    )
    expect(() =>
      apply(base, {
        kind: 'calibration.set',
        calibration: {
          datasetReferenceId: DATASET_ID,
          axisIds: ['x', 'x'],
          unitsPerPixel: [0.25, 0.5],
          unit: 'nm',
          source: 'manual',
        },
      }),
    ).toThrow(WorkspaceCommandError)
  })

  it('starts normalized without credentials, runtime IDs, or bytes', () => {
    const snapshot = empty()
    expect(snapshot).toMatchObject({ schemaVersion: 1, revision: 0, sources: [], datasets: [] })
    expect(serializeWorkspaceProject(snapshot)).not.toMatch(/apiKey|documentId|handleId|tileId/iu)
  })

  it('round-trips every initial command through its inverse', () => {
    const withSource = populated()
    const withRoi = apply(withSource, { kind: 'roi.add', roi })
    const withLayer = apply(withSource, {
      kind: 'display.set-layer',
      layer: { ...layer, opacity: 0.5 },
    })
    const withNode = apply(withSource, { kind: 'analysis.add-node', node })
    const withNodes = apply(withNode, { kind: 'analysis.add-node', node: secondNode })
    const withEdge = apply(withNodes, {
      kind: 'analysis.set-edge',
      nodeId: secondNode.id,
      port: 'mask',
      source: { kind: 'node', nodeId: node.id, output: 'mask' },
    })
    const withBinding = apply(withSource, { kind: 'analysis.set-binding', input, binding })
    const withOutput = apply(withNode, { kind: 'analysis.set-output', output })
    const withResult = apply(withSource, { kind: 'result.pin', result })
    const cases: readonly [WorkspaceSnapshot, WorkspaceMutation][] = [
      [empty(), sourceAdd],
      [withSource, { kind: 'source.remove', sourceId: SOURCE_ID }],
      [
        withSource,
        {
          kind: 'source.rebind',
          sourceId: SOURCE_ID,
          locator: { kind: 'remote', url: 'https://example.test/sample.gsf' },
          identity: { ...identity, value: 'source-v2' },
          bound: true,
        },
      ],
      [withSource, { kind: 'dataset.select', selection: { ...selection, component: 0 } }],
      [withSource, { kind: 'dataset.clear-selection' }],
      [withSource, { kind: 'roi.add', roi }],
      [withRoi, { kind: 'roi.update', roiId: roi.id, roi: { ...roi, name: 'Updated ROI' } }],
      [withRoi, { kind: 'roi.remove', roiId: roi.id }],
      [withRoi, { kind: 'roi.select', roiId: roi.id }],
      [
        withSource,
        {
          kind: 'display.set-layer',
          layer: { ...layer, id: 'overlay' as DisplayLayerState['id'] },
        },
      ],
      [withLayer, { kind: 'display.remove-layer', layerId: layer.id }],
      [withSource, { kind: 'analysis.add-node', node }],
      [
        withNode,
        {
          kind: 'analysis.update-node',
          nodeId: node.id,
          node: { ...node, label: 'Adjusted threshold' },
        },
      ],
      [withNode, { kind: 'analysis.remove-node', nodeId: node.id }],
      [
        withNodes,
        {
          kind: 'analysis.set-edge',
          nodeId: secondNode.id,
          port: 'mask',
          source: { kind: 'node', nodeId: node.id, output: 'mask' },
        },
      ],
      [withEdge, { kind: 'analysis.remove-edge', nodeId: secondNode.id, port: 'mask' }],
      [withSource, { kind: 'analysis.set-binding', input, binding }],
      [withBinding, { kind: 'analysis.remove-binding', input: input.name }],
      [withNode, { kind: 'analysis.set-output', output }],
      [withOutput, { kind: 'analysis.remove-output', name: output.name }],
      [withSource, { kind: 'result.pin', result }],
      [withResult, { kind: 'result.unpin', resultId: result.id }],
      [withSource, { kind: 'project.set-title', title: 'Renamed experiment' }],
      [withSource, { kind: 'project.set-notes', notes: 'Calibrated at 0.5 nm/px.' }],
      [
        withSource,
        { kind: 'project.set-workflow', workflow: { inspector: 'analysis', bottom: 'pipeline' } },
      ],
      [
        withSource,
        {
          kind: 'agent.apply-proposal',
          proposalId: 'proposal-1',
          commands: [
            { kind: 'project.set-title', title: 'Agent proposal' },
            { kind: 'project.set-notes', notes: 'Approved assumptions.' },
          ],
        },
      ],
    ]
    for (const [base, mutation] of cases) expectRoundTrip(base, mutation)
  })

  it('rejects stale revisions and rolls an invalid batch back atomically', () => {
    const snapshot = populated()
    const stale: WorkspaceCommand = {
      ...workspaceCommand(snapshot, 'stale', NOW, { kind: 'project.set-title', title: 'Stale' }),
      expectedRevision: snapshot.revision - 1,
    }
    expect(() => applyWorkspaceCommand(snapshot, stale)).toThrowError(
      expect.objectContaining({ code: 'STALE_REVISION' }),
    )
    const batch: WorkspaceCommandBatch = {
      schemaVersion: 1,
      id: 'atomic',
      expectedRevision: snapshot.revision,
      issuedAt: NOW,
      commands: [
        { kind: 'project.set-title', title: 'Should roll back' },
        { kind: 'roi.remove', roiId: 'missing' },
      ],
    }
    expect(() => applyWorkspaceCommandBatch(snapshot, batch)).toThrow(WorkspaceCommandError)
    expect(snapshot.project.title).toBe('Microscopy project')
  })

  it('describes history in readable scientific terms', () => {
    expect(describeWorkspaceCommand({ kind: 'roi.add', roi })).toBe('Added ROI Precipitates')
    expect(describeWorkspaceCommand({ kind: 'analysis.add-node', node })).toBe(
      'Added analysis step Threshold',
    )
  })
})

describe('history, serialization, migration, and storage', () => {
  it('undoes, redoes, and clears redo after a new command', () => {
    const history = new WorkspaceHistory(empty())
    history.dispatch(
      workspaceCommand(history.state.snapshot, 'one', NOW, {
        kind: 'project.set-title',
        title: 'One',
      }),
    )
    history.dispatch(
      workspaceCommand(history.state.snapshot, 'two', NOW, {
        kind: 'project.set-notes',
        notes: 'Two',
      }),
    )
    expect(history.undo().snapshot.notes).toBe('')
    expect(history.redo().snapshot.notes).toBe('Two')
    history.undo()
    history.dispatch(
      workspaceCommand(history.state.snapshot, 'three', NOW, {
        kind: 'project.set-title',
        title: 'Three',
      }),
    )
    expect(history.state.redo).toHaveLength(0)
  })

  it('commits a complete analysis graph as one revision and replays it after serialization', () => {
    const history = new WorkspaceHistory(empty())
    const graph = {
      schemaVersion: 1 as const,
      inputs: [],
      nodes: [node],
      outputs: [output],
    }
    history.dispatch(
      workspaceCommand(history.state.snapshot, 'analysis-graph', NOW, {
        kind: 'analysis.set-graph',
        graph,
      }),
    )
    expect(history.state.snapshot.revision).toBe(1)
    expect(history.state.undo).toHaveLength(1)
    const replayed = importWorkspaceProject(serializeWorkspaceProject(history.state.snapshot))
    expect(replayed.analysis.graph).toEqual(graph)
    expect(history.undo().snapshot.analysis.graph.nodes).toEqual([])
    expect(history.redo().snapshot.analysis.graph).toEqual(graph)
  })

  it('serializes deterministically and enforces hostile import bounds', () => {
    const snapshot = populated()
    expect(serializeWorkspaceProject(snapshot)).toBe(serializeWorkspaceProject(snapshot))
    expect(deterministicJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}')
    expect(() => importWorkspaceProject('{bad')).toThrow(WorkspaceValidationError)
    expect(() =>
      importWorkspaceProject(JSON.stringify({ ...snapshot, documentId: 'live' })),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN_DATA' }))
    expect(() =>
      importWorkspaceProject('x'.repeat(WORKSPACE_LIMITS.maxProjectBytes + 1)),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
  })

  it('migrates the version-zero fixture through the explicit entry point', () => {
    const migrated = importWorkspaceProject(
      JSON.stringify({ schemaVersion: 0, revision: 4, title: 'Legacy project', notes: 'kept' }),
    )
    expect(migrated).toMatchObject({
      schemaVersion: 1,
      revision: 4,
      project: { title: 'Legacy project' },
      notes: 'kept',
    })
  })

  it('saves projects while keeping large results in the artifact store', async () => {
    const projects = new MemoryProjectStore()
    const artifacts = new MemoryArtifactStore()
    const snapshot = apply(populated(), {
      kind: 'result.pin',
      result: { ...result, artifactId: 'artifact-1' as ArtifactReferenceId },
    })
    const data = new Blob([new Uint8Array(512 * 1_024)])
    await artifacts.put({
      id: 'artifact-1' as ArtifactReferenceId,
      projectId: snapshot.project.id,
      kind: 'result-table',
      mediaType: 'application/octet-stream',
      bytes: data.size,
      metadata: { rows: 100_000 },
      data,
    })
    await projects.save(snapshot)
    expect(await projects.load(snapshot.project.id)).toEqual(snapshot)
    expect(serializeWorkspaceProject(snapshot)).not.toContain('Uint8Array')
    expect((await artifacts.get('artifact-1' as ArtifactReferenceId))?.bytes).toBe(data.size)
  })
})

describe('source identity and runtime reconciliation', () => {
  it('distinguishes identity matches and mismatches', () => {
    expect(semanticIdentityEqual(identity, { ...identity })).toBe(true)
    expect(semanticIdentityEqual(identity, { ...identity, value: 'other' })).toBe(false)
  })

  it('recreates runtime state and cancels obsolete graph work on undo', async () => {
    const port: WorkspaceRuntimePort = {
      materialize: vi.fn(async () => identity),
      releaseSource: vi.fn(async () => undefined),
      cancelObsoleteAnalysis: vi.fn(async () => undefined),
    }
    const reconciler = new WorkspaceRuntimeReconciler(port)
    const snapshot = populated()
    expect((await reconciler.reconcile(undefined, snapshot)).status).toBe('ready')
    expect(port.materialize).toHaveBeenCalledOnce()
    const changed = apply(snapshot, { kind: 'analysis.add-node', node })
    await reconciler.reconcile(snapshot, changed)
    await reconciler.reconcile(changed, snapshot)
    expect(port.cancelObsoleteAnalysis).toHaveBeenCalledTimes(2)
  })

  it('requires local rebind and never materializes a mismatched source silently', async () => {
    const localSource = {
      ...source,
      locator: {
        kind: 'local' as const,
        name: 'sample.gsf',
        size: 10,
        lastModified: 5,
        companionNames: [],
      },
      bound: false,
    }
    const snapshot = apply(empty(), { ...sourceAdd, source: localSource })
    const port: WorkspaceRuntimePort = {
      materialize: vi.fn(async () => ({ ...identity, value: 'wrong' })),
      releaseSource: vi.fn(async () => undefined),
      cancelObsoleteAnalysis: vi.fn(async () => undefined),
    }
    const reconciler = new WorkspaceRuntimeReconciler(port)
    expect((await reconciler.reconcile(undefined, snapshot)).status).toBe('needs-rebind')
    expect(port.materialize).not.toHaveBeenCalled()
    const rebound = apply(snapshot, {
      kind: 'source.rebind',
      sourceId: SOURCE_ID,
      locator: localSource.locator,
      identity,
      bound: true,
    })
    expect((await reconciler.reconcile(snapshot, rebound)).status).toBe('identity-mismatch')
  })
})
