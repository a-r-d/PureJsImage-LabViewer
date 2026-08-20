import type { JsonValue, WorkbenchActionHost } from '@pji-workbench/actions'
import {
  type AgentActionGateway,
  type AgentPolicy,
  createAgentCapabilityManifest,
} from '@pji-workbench/agent'
import type { WorkspaceSnapshot } from '@pji-workbench/workspace'

import type { CommandContext } from './actions.js'
import { workbenchActionRegistry } from './actions.js'

export interface ScienceAgentGatewayPorts {
  readonly currentHost: () => WorkbenchActionHost<CommandContext>
  readonly currentContext: () => CommandContext
  readonly currentWorkspace: () => WorkspaceSnapshot
  readonly modelContext: () => JsonValue
}

export class ScienceParticlePlanGate {
  #reviewed: Readonly<{ id: string; identity: string; valid: boolean }> | undefined

  review(identity: string, valid: boolean): string {
    const id = `particle-plan-${identityHash(identity)}`
    this.#reviewed = { id, identity, valid }
    return id
  }

  assertCurrent(planId: string, identity: string): void {
    const reviewed = this.#reviewed
    if (
      reviewed === undefined ||
      reviewed.id !== planId ||
      reviewed.identity !== identity ||
      !reviewed.valid
    )
      throw new Error('Particle execution requires the current valid dry-run plan.')
  }

  consume(): void {
    this.#reviewed = undefined
  }
}

export function createScienceAgentGateway(ports: ScienceAgentGatewayPorts): AgentActionGateway {
  return {
    revision: () => ports.currentWorkspace().revision,
    capabilities: () => {
      const context = ports.currentContext()
      return createAgentCapabilityManifest(
        ports.currentWorkspace().revision,
        workbenchActionRegistry.list().map((descriptor) => ({
          descriptor,
          availability: workbenchActionRegistry.availability(
            descriptor.id,
            descriptor.version,
            context,
          ),
        })),
      )
    },
    context: ports.modelContext,
    auditContext: ports.modelContext,
    plan: (call) =>
      ports
        .currentHost()
        .plan(call.actionId, call.actionVersion, call.input, ports.currentContext()),
    execute: (call, signal) =>
      ports
        .currentHost()
        .execute(call.actionId, call.actionVersion, call.input, ports.currentContext(), signal),
  }
}

export interface ScienceAgentPolicySettings {
  readonly allowProposalsWithoutApproval: boolean
}

export function createScienceAgentPolicy(
  settings: ScienceAgentPolicySettings = { allowProposalsWithoutApproval: false },
): AgentPolicy {
  return {
    decide(capability, input) {
      const permissions = [...capability.permissions]
      if (!capability.availability.available)
        return {
          decision: 'deny',
          reason: capability.availability.reason ?? 'The scientific action is unavailable.',
          permissions,
        }
      if (capability.actionId === 'viewport.preview.create')
        return {
          decision: 'require-approval',
          reason:
            previewScope(input) === 'screen'
              ? 'The first browser screen preview in this session requires approval and the browser display-share picker; later screen previews reuse that approval.'
              : 'The first model-visible specimen preview in this session requires approval; later viewport previews reuse that approval.',
          permissions,
          approvalScope: `science:model-preview:${previewScope(input) === 'screen' ? 'screen' : 'viewport'}`,
        }
      if (capability.actionId.startsWith('source.open-'))
        return {
          decision: 'require-approval',
          reason:
            capability.actionId === 'source.open-remote'
              ? 'Opening a network source requires explicit network approval.'
              : 'Selecting or opening a scientific source requires user approval.',
          permissions,
        }
      if (
        capability.actionId.includes('export') ||
        permissions.includes('file.export') ||
        permissions.includes('plugin.install')
      )
        return {
          decision: 'require-approval',
          reason: 'Exporting or installing reviewed content requires explicit approval.',
          permissions,
        }
      if (capability.cost === 'expensive')
        return {
          decision: 'require-approval',
          reason: 'Expensive scientific analysis requires approval after bounded planning.',
          permissions,
        }
      if (capability.mutability === 'mutation')
        return {
          decision: 'require-approval',
          reason: 'This action changes the scientific project or visible analysis state.',
          permissions,
        }
      if (capability.mutability === 'proposal' && !settings.allowProposalsWithoutApproval)
        return {
          decision: 'require-approval',
          reason: 'The workbench is configured to review model proposals.',
          permissions,
        }
      return {
        decision: 'allow',
        reason: 'Bounded read-only scientific metadata and result summaries are automatic.',
        permissions,
      }
    },
  }
}

function previewScope(input: JsonValue): JsonValue | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  return (input as Readonly<Record<string, JsonValue>>)['scope']
}

function identityHash(value: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
