import { WorkbenchActionHost } from '@pji-workbench/actions'
import {
  type AgentActionCall,
  type AgentModelRequest,
  type AgentModelResponse,
  type AgentPlan,
  AgentRuntime,
  DeterministicAgentTransport,
} from '@pji-workbench/agent'
import { createEmptyWorkspace, type WorkspaceSnapshot } from '@pji-workbench/workspace'
import { describe, expect, it, vi } from 'vitest'

import {
  createScienceActionHandlers,
  createScienceAgentGateway,
  createScienceAgentPolicy,
  type ScienceActionPorts,
  ScienceParticlePlanGate,
  workbenchActionRegistry,
} from '../src/index.js'

const PLAN: AgentPlan = {
  goalSummary: 'Tune particle detection from bounded evidence',
  actions: [],
  approvalsRequired: ['particle execution', 'model preview'],
  stoppingCondition: 'A bounded result and labels preview have been inspected.',
}

function call(
  callId: string,
  actionId: string,
  projectRevision: number,
  input: AgentActionCall['input'],
): AgentActionCall {
  return { callId, actionId, actionVersion: 1, projectRevision, input }
}

function response(toolCalls: readonly AgentActionCall[], content = ''): AgentModelResponse {
  return {
    provider: 'fake',
    model: 'fake/science-vision',
    content,
    toolCalls,
    plan: PLAN,
  }
}

function pngArtifact(projectRevision: number) {
  const payload =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
  return {
    scope: 'viewport',
    agentArtifact: {
      kind: 'image',
      mimeType: 'image/png',
      width: 64,
      height: 64,
      bytes: 68,
      dataUrl: `data:image/png;base64,${payload}`,
      attribution: ['deterministic fixture'],
      projectRevision,
    },
  }
}

describe('science agent runtime', () => {
  it('exposes the implemented particle no-data policies to model tool validation', () => {
    expect(
      workbenchActionRegistry.validate('analysis.particle.plan', 1, {
        settings: { noDataPolicy: 'propagate' },
      }),
    ).toEqual([])
    expect(
      workbenchActionRegistry.validate('analysis.particle.plan', 1, {
        settings: { noDataPolicy: 'error' },
      }),
    ).toEqual([expect.objectContaining({ path: '/settings/noDataPolicy' })])
  })

  it('propagates graph execution failures and leaves particle overlays to particle actions', async () => {
    const workspace = createEmptyWorkspace('Graph action fixture')
    const signal = { aborted: false, throwIfAborted: vi.fn() }
    const executeAnalysisGraph = vi.fn(async () => {
      throw new Error('worker execution failed')
    })
    const ports = {
      openedDataset: () => ({}),
      currentSelection: () => ({}),
      calibratedDataset: () => undefined,
      currentWorkspace: () => workspace,
      wholePlaneRoi: () => ({}),
      executeAnalysisGraph,
    } as unknown as ScienceActionPorts
    const handler = createScienceActionHandlers(ports).get('analysis.graph.request-execute@1')
    if (handler === undefined) throw new Error('Missing graph execution action handler.')

    await expect(
      handler.execute({ graph: { nodes: [], outputs: [] } }, { hasDataset: true }, signal),
    ).rejects.toThrow('worker execution failed')
    expect(executeAnalysisGraph).toHaveBeenCalledWith(
      { nodes: [], outputs: [] },
      {
        roi: {},
        commit: true,
        signal,
        throwOnError: true,
      },
    )
    expect(executeAnalysisGraph.mock.calls[0]?.[1]).not.toHaveProperty('overlay')
    expect(executeAnalysisGraph.mock.calls[0]?.[1]).not.toHaveProperty('overlayTableOutput')
  })

  it('binds particle execution to the exact current valid dry-run identity', () => {
    const gate = new ScienceParticlePlanGate()
    const planId = gate.review('dataset:1|revision:2|settings:a', true)
    expect(() => gate.assertCurrent(planId, 'dataset:1|revision:2|settings:a')).not.toThrow()
    expect(() => gate.assertCurrent(planId, 'dataset:1|revision:3|settings:a')).toThrow(
      /current valid dry-run plan/,
    )
    expect(() => gate.assertCurrent(gate.review('settings:b', false), 'settings:b')).toThrow(
      /current valid dry-run plan/,
    )
    const consumed = gate.review('settings:c', true)
    gate.consume()
    expect(() => gate.assertCurrent(consumed, 'settings:c')).toThrow(/current valid dry-run plan/)
  })

  it('iterates through analysis and reuses the first viewport-preview approval', async () => {
    let workspace: WorkspaceSnapshot = createEmptyWorkspace('Agent fixture')
    const executed: string[] = []
    const host = new WorkbenchActionHost(
      workbenchActionRegistry,
      createScienceActionHandlers({
        openSample: vi.fn(),
        requestLocalFiles: vi.fn(),
        requestRemoteUrl: vi.fn(),
        newProject: vi.fn(),
        openProjectBrowser: vi.fn(),
        saveProject: vi.fn(),
        exportProject: vi.fn(),
        undo: vi.fn(),
        redo: vi.fn(),
        fitViewport: vi.fn(),
        oneToOneViewport: vi.fn(),
        openAgentPanel: vi.fn(),
        previewThreshold: vi.fn(),
        commitThreshold: vi.fn(),
        planConnectedComponents: vi.fn(),
        runConnectedComponents: vi.fn(),
        toggleTheme: vi.fn(),
        openPalette: vi.fn(),
        cancelAnalysis: vi.fn(),
        currentWorkspace: () => workspace,
        openedDataset: () => undefined,
        currentSelection: () => undefined,
        calibratedDataset: () => undefined,
        analysisCatalog: () => undefined,
        resolveCatalogOperation: () => undefined,
        executeAnalysisGraph: async () => undefined,
        wholePlaneRoi: () => {
          throw new Error('not used')
        },
        runToolboxOperation: async () => undefined,
        workspaceSummary: () => ({ revision: workspace.revision }),
        sourceList: () => [],
        datasetList: () => [],
        datasetDescription: () => ({}),
        roiList: () => [],
        analysisCatalogSummary: () => ({ operations: [] }),
        analysisDescription: () => ({}),
        resultSummary: () => ({ available: true, particleCount: 17 }),
        resultPage: async () => ({ offset: 0, totalRows: 17, columns: [] }),
        viewportState: () => ({ mounted: true }),
        particleSettings: () => ({
          settings: { thresholdMethod: 'otsu', minimumObjectPixels: 64, watershed: false },
        }),
        planParticleAnalysis: async () => ({
          planId: 'particle-plan-fixture',
          valid: true,
          settings: { minimumObjectPixels: 24, watershed: true },
          estimatedPeakBytes: 1_048_576,
        }),
        executeParticleAnalysis: async () => {
          executed.push('particle')
          workspace = { ...workspace, revision: workspace.revision + 1 }
          return { status: 'completed', particleCount: 17 }
        },
        createModelPreview: async () => {
          executed.push('preview')
          return pngArtifact(workspace.revision)
        },
        normalizeAnalysis: async () => ({ valid: true }),
        dryRunAnalysis: async () => ({ valid: true }),
        selectRoi: () => ({ selected: true }),
        removeRoi: () => ({ removed: true }),
        removePipelineNode: () => ({ removed: true }),
        selectPanel: () => ({ selected: true }),
        createRoi: async () => ({ created: true }),
        updateRoi: async () => ({ updated: true }),
      }),
    )
    const gateway = createScienceAgentGateway({
      currentHost: () => host,
      currentContext: () => ({ hasDataset: true, hasResult: workspace.revision > 0 }),
      currentWorkspace: () => workspace,
      modelContext: () => ({ revision: workspace.revision, rawPixelsVisibleToModel: false }),
    })
    const transport = new DeterministicAgentTransport(
      [
        response([call('settings', 'analysis.particle.settings.read', 0, {})]),
        response([
          call('plan', 'analysis.particle.plan', 0, {
            settings: { minimumObjectPixels: 24, watershed: true },
          }),
        ]),
        response([
          call('execute', 'analysis.particle.execute', 0, {
            planId: 'particle-plan-fixture',
            settings: { minimumObjectPixels: 24, watershed: true },
          }),
        ]),
        response([call('result', 'result.summary.read', 1, {})]),
        response([
          call('preview', 'viewport.preview.create', 1, {
            scope: 'viewport',
            width: 64,
            height: 64,
          }),
        ]),
        (request: AgentModelRequest) => {
          expect(request.messages.at(-1)).toMatchObject({ role: 'user' })
          expect(JSON.stringify(request.messages.at(-1))).toContain('data:image/png;base64')
          return response([
            call('preview-2', 'viewport.preview.create', 1, {
              scope: 'viewport',
              width: 96,
              height: 64,
            }),
          ])
        },
        (request: AgentModelRequest) => {
          expect(request.messages.at(-1)).toMatchObject({ role: 'user' })
          expect(JSON.stringify(request.messages.at(-1))).toContain('data:image/png;base64')
          return response(
            [],
            'The tuned run counted 17 particles and two labels previews were inspected.',
          )
        },
        (request: AgentModelRequest) => {
          expect(JSON.stringify(request.messages)).toContain(
            'The tuned run counted 17 particles and two labels previews were inspected.',
          )
          expect(JSON.stringify(request.messages)).not.toContain('data:image/png;base64')
          return response([], 'The prior tuning used watershed and a 24-pixel minimum.')
        },
      ],
      [
        {
          id: 'fake/science-vision',
          name: 'Deterministic science vision model',
          supportedParameters: ['tools'],
          inputModalities: ['text', 'image'],
        },
      ],
    )
    const runtime = new AgentRuntime({
      transport,
      gateway,
      policy: createScienceAgentPolicy(),
      productName: 'Science fixture',
    })

    const firstTurn = runtime.start(
      'Count the particles and tune missed detections.',
      'fake/science-vision',
    )
    await vi.waitFor(() =>
      expect(runtime.getSnapshot().approval?.call.actionId).toBe('analysis.particle.execute'),
    )
    runtime.approve(runtime.getSnapshot().approval?.id ?? '')
    await vi.waitFor(() =>
      expect(runtime.getSnapshot().approval?.call.actionId).toBe('viewport.preview.create'),
    )
    runtime.approve(runtime.getSnapshot().approval?.id ?? '')
    const audit = await firstTurn

    expect(executed).toEqual(['particle', 'preview', 'preview'])
    expect(audit.trace.map(({ actionId }) => actionId)).toEqual([
      'analysis.particle.settings.read',
      'analysis.particle.plan',
      'analysis.particle.execute',
      'result.summary.read',
      'viewport.preview.create',
      'viewport.preview.create',
    ])
    expect(audit.trace.slice(-2).map(({ approval }) => approval)).toEqual([
      'approved',
      'remembered',
    ])
    expect(audit.approvals.filter(({ callId }) => callId.startsWith('preview'))).toHaveLength(1)
    expect(runtime.getSnapshot().artifacts).toHaveLength(2)

    await runtime.start('Which settings changed?', 'fake/science-vision')
    expect(runtime.getSnapshot()).toMatchObject({
      conversationTurnCount: 2,
      finalText: 'The prior tuning used watershed and a 24-pixel minimum.',
    })
  })

  it('requires preview and expensive-analysis approval while allowing bounded reads', () => {
    const policy = createScienceAgentPolicy()
    const manifest = createScienceAgentGateway({
      currentHost: () => {
        throw new Error('not used')
      },
      currentContext: () => ({ hasDataset: true }),
      currentWorkspace: () => createEmptyWorkspace(),
      modelContext: () => ({}),
    }).capabilities()
    const capability = (id: string) => {
      const value = manifest.actions.find(({ actionId }) => actionId === id)
      if (value === undefined) throw new Error(`Missing ${id}`)
      return value
    }
    expect(
      policy.decide(capability('result.summary.read'), {}, { projectRevision: 0 }).decision,
    ).toBe('allow')
    expect(
      policy.decide(
        capability('analysis.particle.execute'),
        { planId: 'particle-plan-fixture', settings: {} },
        { projectRevision: 0 },
      ).decision,
    ).toBe('require-approval')
    expect(
      policy.decide(
        capability('viewport.preview.create'),
        { scope: 'screen', width: 512, height: 512 },
        { projectRevision: 0 },
      ),
    ).toMatchObject({
      decision: 'require-approval',
      approvalScope: 'science:model-preview:screen',
    })
    expect(
      policy.decide(
        capability('viewport.preview.create'),
        { scope: 'viewport', width: 512, height: 512 },
        { projectRevision: 0 },
      ),
    ).toMatchObject({
      decision: 'require-approval',
      approvalScope: 'science:model-preview:viewport',
    })
  })
})
