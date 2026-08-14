import { RPC_SCHEMA_VERSION } from '@pji-workbench/contracts'

export interface EmptyWorkspace {
  readonly schemaVersion: typeof RPC_SCHEMA_VERSION
  readonly revision: 0
  readonly title: string
}

export function createEmptyWorkspace(title = 'Untitled project'): EmptyWorkspace {
  return { schemaVersion: RPC_SCHEMA_VERSION, revision: 0, title }
}
