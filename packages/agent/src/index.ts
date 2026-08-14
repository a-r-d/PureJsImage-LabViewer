export type AgentPermission =
  | 'workspace.read'
  | 'workspace.propose'
  | 'analysis.execute'
  | 'compute.expensive'
  | 'network.read'
  | 'file.export'
  | 'plugin.install'

export type AgentDecision = 'allow' | 'deny' | 'require-approval'

export function defaultAgentDecision(permission: AgentPermission): AgentDecision {
  switch (permission) {
    case 'workspace.read':
      return 'allow'
    case 'workspace.propose':
    case 'analysis.execute':
    case 'compute.expensive':
    case 'network.read':
    case 'file.export':
    case 'plugin.install':
      return 'require-approval'
  }
}
