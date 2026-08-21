import type { ActionHandler, JsonSchema, JsonValue } from '@pji-workbench/actions'
import { WorkbenchActionHost, WorkbenchActionRegistry } from '@pji-workbench/actions'
import {
  type AgentActionGateway,
  type AgentModelResponse,
  AgentRuntime,
  createAgentCapabilityManifest,
  DeterministicAgentTransport,
} from '@pji-workbench/agent'
import { type GeoActionContext, geoActionDefinitions } from '@pji-workbench/domain-geo'
import { describe, expect, it } from 'vitest'

import {
  ATLAS_AGENT_EVAL_CASES,
  ATLAS_AGENT_FAILURE_EVAL_CASES,
  createGeoAgentPolicy,
} from '../src/index.js'

const FIXTURE_CONTEXT: GeoActionContext = {
  hasSource: true,
  hasSelection: true,
  sourceCount: 2,
  sourceLimit: 32,
  hasLocalResources: true,
  comparisonEnabled: true,
  viewportAvailable: true,
  hasRoi: true,
}

describe('Atlas scripted action-contract evaluations', () => {
  it.each(ATLAS_AGENT_EVAL_CASES)(
    '$id uses only current geo semantic actions',
    async (testCase) => {
      const registry = new WorkbenchActionRegistry(geoActionDefinitions)
      let revision = 7
      const handlers = new Map<string, ActionHandler<GeoActionContext>>()
      for (const descriptor of registry.list()) {
        handlers.set(`${descriptor.id}@${descriptor.version}`, {
          execute: () => fixtureOutput(descriptor.outputSchema),
        })
      }
      const host = new WorkbenchActionHost(registry, handlers)
      const executed: string[] = []
      const gateway: AgentActionGateway = {
        revision: () => revision,
        capabilities: () =>
          createAgentCapabilityManifest(
            revision,
            registry.list().map((descriptor) => ({
              descriptor,
              availability: registry.availability(
                descriptor.id,
                descriptor.version,
                FIXTURE_CONTEXT,
              ),
            })),
          ),
        context: () => ({ fixtureId: testCase.fixtureId, projectRevision: revision }),
        plan: (call) => host.plan(call.actionId, call.actionVersion, call.input, FIXTURE_CONTEXT),
        execute: async (call, signal) => {
          const descriptor = registry.get(call.actionId, call.actionVersion)
          const result = await host.execute(
            call.actionId,
            call.actionVersion,
            call.input,
            FIXTURE_CONTEXT,
            signal,
          )
          executed.push(call.actionId)
          if (descriptor?.mutability === 'mutation') revision += 1
          return result
        },
      }
      const modelSteps = testCase.steps.map(
        (step, index) =>
          (
            request: Parameters<DeterministicAgentTransport['complete']>[0],
          ): AgentModelResponse => ({
            provider: 'fake',
            model: 'fake/atlas',
            content: index === 0 ? JSON.stringify({ plan: testCase }) : '',
            toolCalls: [
              {
                callId: `${testCase.id}-${index + 1}`,
                actionId: step.actionId,
                actionVersion: 1,
                projectRevision: request.manifest.projectRevision,
                input: step.input,
              },
            ],
            ...(index === 0
              ? {
                  plan: {
                    goalSummary: testCase.title,
                    actions: testCase.steps.map((entry) => ({
                      actionId: entry.actionId,
                      actionVersion: 1,
                      input: entry.input,
                      expectedOutput: entry.expectedOutput,
                    })),
                    approvalsRequired: [],
                    stoppingCondition: testCase.stoppingCondition,
                  },
                }
              : {}),
          }),
      )
      const transport = new DeterministicAgentTransport([
        ...modelSteps,
        {
          provider: 'fake',
          model: 'fake/atlas',
          content:
            testCase.expectedBehavior === 'refuse'
              ? `Refused safely: ${testCase.stoppingCondition}`
              : `Completed: ${testCase.stoppingCondition}`,
          toolCalls: [],
        },
      ])
      const runtime = new AgentRuntime({
        transport,
        gateway,
        policy: createGeoAgentPolicy(),
      })
      runtime.subscribe((snapshot) => {
        const approval = snapshot.approval
        if (approval !== undefined) queueMicrotask(() => runtime.approve(approval.id))
      })

      const audit = await runtime.start(testCase.userRequest, 'fake/atlas')

      expect(executed).toEqual(testCase.steps.map(({ actionId }) => actionId))
      expect(audit.trace.map(({ actionId }) => actionId)).toEqual(executed)
      expect(audit.plan?.stoppingCondition).toBe(testCase.stoppingCondition)
    },
  )

  it('registers every required deterministic failure evaluation', () => {
    expect(ATLAS_AGENT_FAILURE_EVAL_CASES.map(({ id }) => id)).toEqual([
      'malformed-tool-input',
      'unavailable-action',
      'repeated-provider-failure',
      'maximum-steps',
      'timeout',
      'cancellation',
      'stale-project-revision',
      'approval-denial',
      'unsupported-decoder',
      'unavailable-relay',
      'tool-output-too-large',
    ])
  })

  it('applies Atlas-specific permission policy to live action capabilities', () => {
    const registry = new WorkbenchActionRegistry(geoActionDefinitions)
    const manifest = createAgentCapabilityManifest(
      1,
      registry.list().map((descriptor) => ({
        descriptor,
        availability: registry.availability(descriptor.id, descriptor.version, FIXTURE_CONTEXT),
      })),
    )
    const policy = createGeoAgentPolicy()
    const decision = (id: string) => {
      const capability = manifest.actions.find(({ actionId }) => actionId === id)
      if (capability === undefined) throw new Error(`Missing capability ${id}`)
      return policy.decide(capability, {}, { projectRevision: 1 }).decision
    }

    expect(decision('geo.catalog.search')).toBe('allow')
    expect(decision('geo.source.open_catalog_asset')).toBe('require-approval')
    expect(decision('geo.analysis.zonal_statistics')).toBe('require-approval')
    expect(decision('geo.preview.create')).toBe('require-approval')
    expect(decision('geo.project.export')).toBe('require-approval')

    const preview = manifest.actions.find(({ actionId }) => actionId === 'geo.preview.create')
    if (preview === undefined) throw new Error('Missing geo.preview.create')
    expect(
      policy.decide(
        preview,
        { scope: 'viewport', width: 512, height: 512 },
        { projectRevision: 1 },
      ),
    ).toMatchObject({ approvalScope: 'geo:model-preview:viewport' })
  })
})

function fixtureOutput(schema: JsonSchema): JsonValue {
  switch (schema.type) {
    case 'array':
      return []
    case 'boolean':
      return false
    case 'integer':
    case 'number':
      return 0
    case 'null':
      return null
    case 'string':
      return schema.enum?.find((value): value is string => typeof value === 'string') ?? 'fixture'
    case 'object':
    case undefined:
      return {}
  }
}
