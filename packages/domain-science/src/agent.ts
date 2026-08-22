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
    sourceIdentities: () => {
      const workspace = ports.currentWorkspace()
      return workspace.sources.slice(0, 32).map((reference) => ({
        id: reference.id,
        bound: reference.bound,
        locator: reference.locator,
      }))
    },
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

export function createScienceAgentPolicy(): AgentPolicy {
  return {
    decide(capability, input) {
      const permissions = [...capability.permissions]
      if (!capability.availability.available)
        return {
          decision: 'deny',
          reason: capability.availability.reason ?? 'The scientific action is unavailable.',
          permissions,
        }
      if (capability.actionId === 'viewport.preview.create' && previewScope(input) === 'screen')
        return {
          decision: 'deny',
          reason: 'Use the automatic specimen viewport preview instead of browser screen sharing.',
          permissions,
        }
      if (
        permissions.some((permission) => permission.startsWith('network.')) ||
        permissions.includes('file.export') ||
        permissions.includes('plugin.install')
      )
        return {
          decision: 'deny',
          reason:
            'The automatic local-analysis path does not expose network, export, or trusted-plugin capabilities.',
          permissions,
        }
      return {
        decision: 'allow',
        reason:
          'The requested action runs automatically on the open local workbench through the bounded semantic action host.',
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
