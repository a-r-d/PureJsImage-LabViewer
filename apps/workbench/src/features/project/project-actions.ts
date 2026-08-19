import type { WorkspaceSnapshot } from '@pji-workbench/workspace'
import { serializeWorkspaceProject } from '@pji-workbench/workspace'

export {
  createProject,
  LAST_PROJECT_KEY,
  mutationsToReplaceOpenSource,
  projectSourceMutation,
  snapshotWithVisibleWorkflow,
} from '@pji-workbench/workbench-core'

export function downloadProject(snapshot: WorkspaceSnapshot): void {
  const blob = new Blob([serializeWorkspaceProject(snapshot)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${snapshot.project.title.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase() || 'project'}.pji-lab.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
