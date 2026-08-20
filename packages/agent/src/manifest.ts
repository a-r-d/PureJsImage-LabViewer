import type {
  ActionAvailability,
  JsonSchema,
  WorkbenchActionDescriptorV1,
} from '@pji-workbench/actions'

import type { AgentActionCapability, AgentCapabilityManifest } from './types.js'

const MAX_DESCRIPTION = 512

export function agentToolName(actionId: string, version: number): string {
  const encoded = actionId.replace(/[^A-Za-z0-9_-]/gu, '__')
  return `${encoded}__v${version}`.slice(0, 128)
}

export function createAgentCapabilityManifest(
  projectRevision: number,
  actions: readonly Readonly<{
    descriptor: WorkbenchActionDescriptorV1
    availability: ActionAvailability
  }>[],
): AgentCapabilityManifest {
  return {
    schemaVersion: 1,
    projectRevision,
    actions: actions
      .map(({ descriptor, availability }) => capability(descriptor, availability))
      .sort(
        (left, right) =>
          left.actionId.localeCompare(right.actionId) || left.actionVersion - right.actionVersion,
      ),
  }
}

export function modelToolInputSchema(capability: AgentActionCapability): JsonSchema {
  return {
    type: 'object',
    properties: {
      input: capability.inputSchema,
    },
    required: ['input'],
    additionalProperties: false,
  }
}

function capability(
  descriptor: WorkbenchActionDescriptorV1,
  availability: ActionAvailability,
): AgentActionCapability {
  const suffix = availability.available
    ? 'Currently available.'
    : `Currently unavailable: ${availability.reason ?? 'no reason supplied'}`
  return {
    toolName: agentToolName(descriptor.id, descriptor.version),
    actionId: descriptor.id,
    actionVersion: descriptor.version,
    title: descriptor.title,
    description: `${descriptor.description} ${suffix}`.slice(0, MAX_DESCRIPTION),
    inputSchema: descriptor.inputSchema,
    outputSchema: descriptor.outputSchema,
    permissions: [...descriptor.permissions],
    cost: descriptor.cost,
    mutability: descriptor.mutability,
    cancellable: descriptor.cancellable,
    availability,
  }
}
