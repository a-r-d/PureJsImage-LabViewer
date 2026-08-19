import {
  type ActionHandler,
  WorkbenchActionHost,
  type WorkbenchActionRegistry,
} from '@pji-workbench/actions'
import {
  type CommandContext,
  createScienceActionHandlers,
  type ScienceActionPorts,
} from '@pji-workbench/workbench-core'

import {
  createScriptActionHandlers,
  type ScriptActionPorts,
} from '../features/scripts/script-action-handlers.js'

export function createWorkbenchActionHost(
  registry: WorkbenchActionRegistry<CommandContext>,
  sciencePorts: ScienceActionPorts,
  scriptPorts: ScriptActionPorts,
): WorkbenchActionHost<CommandContext> {
  return new WorkbenchActionHost(
    registry,
    new Map<string, ActionHandler<CommandContext>>([
      ...createScienceActionHandlers(sciencePorts),
      ...createScriptActionHandlers(scriptPorts),
    ]),
  )
}
