import type { AgentDecision, AgentPermission } from './types.js'

export function defaultAgentDecision(permission: AgentPermission): AgentDecision {
  switch (permission) {
    case 'workspace.read':
    case 'source.read-metadata':
      return 'allow'
    case 'workspace.propose':
    case 'analysis.execute':
    case 'compute.expensive':
    case 'network.read':
    case 'network.explicit-hosts':
    case 'network.open-source':
    case 'network.relay':
    case 'source.read-pixels':
    case 'viewport.read':
    case 'viewport.propose':
    case 'model.preview':
    case 'file.export':
    case 'plugin.install':
      return 'require-approval'
  }
}
