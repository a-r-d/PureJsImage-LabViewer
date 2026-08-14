import {
  applyWorkspaceCommand,
  applyWorkspaceCommandBatch,
  type WorkspaceCommand,
  type WorkspaceCommandApplication,
  type WorkspaceCommandBatch,
} from './commands.js'
import { WORKSPACE_LIMITS, type WorkspaceSnapshot } from './model.js'
import { jsonBytes } from './serialization.js'

export interface WorkspaceHistoryEntry {
  readonly id: string
  readonly description: string
  readonly before: WorkspaceSnapshot
  readonly after: WorkspaceSnapshot
  readonly bytes: number
}

export interface WorkspaceHistoryState {
  readonly snapshot: WorkspaceSnapshot
  readonly undo: readonly WorkspaceHistoryEntry[]
  readonly redo: readonly WorkspaceHistoryEntry[]
}

function entry(
  id: string,
  before: WorkspaceSnapshot,
  application: WorkspaceCommandApplication,
): WorkspaceHistoryEntry {
  return {
    id,
    description: application.description,
    before,
    after: application.snapshot,
    bytes: jsonBytes(before) + jsonBytes(application.snapshot) + application.description.length,
  }
}

function bounded(entries: readonly WorkspaceHistoryEntry[]): readonly WorkspaceHistoryEntry[] {
  const result = [...entries].slice(-WORKSPACE_LIMITS.maxHistoryEntries)
  let bytes = result.reduce((total, item) => total + item.bytes, 0)
  while (result.length > 0 && bytes > WORKSPACE_LIMITS.maxHistoryBytes) {
    const removed = result.shift()
    if (removed !== undefined) bytes -= removed.bytes
  }
  return result
}

export class WorkspaceHistory {
  #state: WorkspaceHistoryState

  constructor(snapshot: WorkspaceSnapshot) {
    this.#state = { snapshot, undo: [], redo: [] }
  }

  get state(): WorkspaceHistoryState {
    return this.#state
  }

  replace(snapshot: WorkspaceSnapshot): WorkspaceHistoryState {
    this.#state = { snapshot, undo: [], redo: [] }
    return this.#state
  }

  dispatch(command: WorkspaceCommand): WorkspaceHistoryState {
    const before = this.#state.snapshot
    const application = applyWorkspaceCommand(before, command)
    this.#state = {
      snapshot: application.snapshot,
      undo: bounded([...this.#state.undo, entry(command.id, before, application)]),
      redo: [],
    }
    return this.#state
  }

  dispatchBatch(batch: WorkspaceCommandBatch): WorkspaceHistoryState {
    const before = this.#state.snapshot
    const application = applyWorkspaceCommandBatch(before, batch)
    this.#state = {
      snapshot: application.snapshot,
      undo: bounded([...this.#state.undo, entry(batch.id, before, application)]),
      redo: [],
    }
    return this.#state
  }

  undo(): WorkspaceHistoryState {
    const item = this.#state.undo.at(-1)
    if (item === undefined) return this.#state
    this.#state = {
      snapshot: item.before,
      undo: this.#state.undo.slice(0, -1),
      redo: bounded([...this.#state.redo, item]),
    }
    return this.#state
  }

  redo(): WorkspaceHistoryState {
    const item = this.#state.redo.at(-1)
    if (item === undefined) return this.#state
    this.#state = {
      snapshot: item.after,
      undo: bounded([...this.#state.undo, item]),
      redo: this.#state.redo.slice(0, -1),
    }
    return this.#state
  }
}
