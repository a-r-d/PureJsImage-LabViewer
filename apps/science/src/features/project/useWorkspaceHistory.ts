import type {
  WorkspaceHistoryState,
  WorkspaceMutation,
  WorkspaceSnapshot,
} from '@pji-workbench/workspace'
import { WorkspaceHistory, workspaceCommand } from '@pji-workbench/workspace'
import { useCallback, useRef, useState } from 'react'

export function useWorkspaceHistory(initial: WorkspaceSnapshot) {
  const controller = useRef(new WorkspaceHistory(initial))
  const [historyState, setHistoryState] = useState<WorkspaceHistoryState>(controller.current.state)

  const currentSnapshot = useCallback(
    (): WorkspaceSnapshot => controller.current.state.snapshot,
    [],
  )
  const applyProjectMutation = useCallback((mutation: WorkspaceMutation): WorkspaceHistoryState => {
    const current = controller.current.state.snapshot
    const next = controller.current.dispatch(
      workspaceCommand(current, crypto.randomUUID(), new Date().toISOString(), mutation),
    )
    setHistoryState(next)
    return next
  }, [])
  const replaceWorkspace = useCallback((snapshot: WorkspaceSnapshot): WorkspaceHistoryState => {
    const next = controller.current.replace(snapshot)
    setHistoryState(next)
    return next
  }, [])
  const stepHistory = useCallback((direction: 'undo' | 'redo'): WorkspaceHistoryState => {
    const next = direction === 'undo' ? controller.current.undo() : controller.current.redo()
    setHistoryState(next)
    return next
  }, [])

  return {
    applyProjectMutation,
    currentSnapshot,
    historyState,
    replaceWorkspace,
    stepHistory,
  } as const
}
