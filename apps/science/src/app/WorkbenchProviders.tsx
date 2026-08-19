import { type ImagingWorkerClient } from '@pji-workbench/imaging'
import {
  IndexedDbProjectStore,
  type WorkspaceRuntimeReconciler,
  WorkspaceRuntimeReconciler as WorkspaceRuntimeReconcilerController,
} from '@pji-workbench/workspace'
import type { ReactNode } from 'react'

import { IndexedDbScriptStudioRepository } from '../features/scripts/script-store.js'
import { createScienceImagingWorkerClient } from '../imaging-client.js'
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

let browserServices: WorkbenchServices | undefined

function getBrowserServices(): WorkbenchServices {
  if (browserServices !== undefined) return browserServices
  const client = createScienceImagingWorkerClient()
  const runtime = new WorkbenchWorkspaceRuntime(client)
  browserServices = {
    client,
    preferenceStore: new LocalWorkbenchPreferenceStore(window.localStorage),
    projectStore: new IndexedDbProjectStore(window.indexedDB),
    scriptStore: new IndexedDbScriptStudioRepository(window.indexedDB),
    runtime,
    reconciler: new WorkspaceRuntimeReconcilerController(runtime),
  }
  return browserServices
}

export function WorkbenchProviders({
  children,
}: {
  readonly children: (services: WorkbenchServices) => ReactNode
}) {
  return children(getBrowserServices())
}
