import { createImagingWorkerClient, type ImagingWorkerClient } from '@pji-workbench/imaging'
import {
  IndexedDbProjectStore,
  type WorkspaceRuntimeReconciler,
  WorkspaceRuntimeReconciler as WorkspaceRuntimeReconcilerController,
} from '@pji-workbench/workspace'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { IndexedDbScriptStudioRepository } from '../features/scripts/script-store.js'
import { LocalWorkbenchPreferenceStore, type WorkbenchPreferences } from '../preferences.js'
import { WorkbenchWorkspaceRuntime } from '../project-runtime.js'

export interface WorkbenchServices {
  readonly client: ImagingWorkerClient
  readonly preferenceStore: {
    load(): WorkbenchPreferences
    save(preferences: WorkbenchPreferences): void
  }
  readonly projectStore: IndexedDbProjectStore
  readonly scriptStore: IndexedDbScriptStudioRepository
  readonly runtime: WorkbenchWorkspaceRuntime
  readonly reconciler: WorkspaceRuntimeReconciler
}

export function WorkbenchProviders({
  children,
}: {
  readonly children: (services: WorkbenchServices) => ReactNode
}) {
  const preferenceStore = useMemo(() => new LocalWorkbenchPreferenceStore(window.localStorage), [])
  const client = useMemo(() => createImagingWorkerClient(), [])
  const projectStore = useMemo(() => new IndexedDbProjectStore(window.indexedDB), [])
  const scriptStore = useMemo(() => new IndexedDbScriptStudioRepository(window.indexedDB), [])
  const runtime = useMemo(() => new WorkbenchWorkspaceRuntime(client), [client])
  const reconciler = useMemo(() => new WorkspaceRuntimeReconcilerController(runtime), [runtime])
  const services = useMemo(
    () => ({ client, preferenceStore, projectStore, scriptStore, runtime, reconciler }),
    [client, preferenceStore, projectStore, reconciler, runtime, scriptStore],
  )
  return children(services)
}
