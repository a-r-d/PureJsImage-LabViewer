import type { DatasetDescriptor, DisplayMapping, PlaneSelection } from '@pji-workbench/contracts'
import type { AnalysisGraph, AnalysisSemanticIdentity } from 'purejsimage/analysis'
import type { PersistedInputBinding, PersistedSourceReference } from 'purejsimage/analysis/project'
import type { RoiSet } from 'purejsimage/analysis/roi'

export const WORKSPACE_SCHEMA_VERSION = 1 as const

const MiB = 1_024 * 1_024

export const WORKSPACE_LIMITS = Object.freeze({
  maxProjectBytes: 2 * MiB,
  maxCommandBytes: 256 * 1_024,
  maxCommandsPerBatch: 64,
  maxHistoryEntries: 100,
  maxHistoryBytes: 8 * MiB,
  maxStringLength: 4_096,
  maxNotesLength: 64 * 1_024,
  maxSources: 32,
  maxDatasets: 128,
  maxLayers: 128,
  maxRois: 256,
  maxRoiPoints: 4_096,
  maxGraphNodes: 256,
  maxGraphEdges: 512,
  maxBindings: 256,
  maxOutputs: 128,
  maxPinnedResults: 128,
  maxPinnedSummaryBytes: 64 * 1_024,
  maxArtifactBytes: 32 * MiB,
  maxArtifactTotalBytes: 256 * MiB,
})

export type ProjectId = string & { readonly __projectId: unique symbol }
export type SemanticSourceId = string & { readonly __semanticSourceId: unique symbol }
export type DatasetReferenceId = string & { readonly __datasetReferenceId: unique symbol }
export type LayerId = string & { readonly __layerId: unique symbol }
export type ResultReferenceId = string & { readonly __resultReferenceId: unique symbol }
export type ArtifactReferenceId = string & { readonly __artifactReferenceId: unique symbol }

export type JsonPrimitive = null | boolean | number | string
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | Readonly<{ readonly [key: string]: JsonValue }>

export type SourceLocator =
  | Readonly<{ kind: 'sample'; sampleId: string }>
  | Readonly<{
      kind: 'bundled'
      path: string
      name: string
      size: number
      sha256: string
      mediaType: string
    }>
  | Readonly<{
      kind: 'local'
      name: string
      size: number
      lastModified: number
      companionNames: readonly string[]
    }>
  | Readonly<{ kind: 'remote'; url: string }>

export interface WorkspaceProjectMetadata {
  readonly id: ProjectId
  readonly title: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly createdWith: Readonly<{
    appVersion: string
    pureJsImageVersion: string
  }>
}

export interface WorkspaceSourceReference {
  readonly id: SemanticSourceId
  readonly label: string
  readonly locator: SourceLocator
  readonly identity: AnalysisSemanticIdentity
  readonly reader: Readonly<{ id: string; version: string; format: string }>
  readonly bound: boolean
}

export interface WorkspaceDatasetReference {
  readonly id: DatasetReferenceId
  readonly sourceId: SemanticSourceId
  readonly datasetId: string
  readonly identity: AnalysisSemanticIdentity
  readonly descriptor: DatasetDescriptor
}

export interface WorkspaceSelection {
  readonly sourceId: SemanticSourceId
  readonly datasetReferenceId: DatasetReferenceId
  readonly plane: PlaneSelection
  readonly component: number
}

export interface DisplayLayerState {
  readonly id: LayerId
  readonly datasetReferenceId: DatasetReferenceId
  readonly label: string
  readonly visible: boolean
  readonly opacity: number
  readonly mapping: DisplayMapping
  readonly palette: string
}

export interface CalibrationOverride {
  readonly datasetReferenceId: DatasetReferenceId
  readonly axisIds: readonly [string, string]
  readonly unitsPerPixel: readonly [number, number]
  readonly unit: string
  readonly source: 'known-line' | 'manual'
  readonly knownDistance?: number
  readonly measuredPixels?: number
}

export interface WorkspaceAnalysisState {
  readonly graph: AnalysisGraph
  readonly roiSet: RoiSet
  readonly bindings: readonly PersistedInputBinding[]
  readonly sourceReferences: readonly PersistedSourceReference[]
}

export interface PinnedResultReference {
  readonly id: ResultReferenceId
  readonly graphOutput: string
  readonly label: string
  readonly kind: string
  readonly artifactId?: ArtifactReferenceId
  readonly summary: Readonly<Record<string, JsonValue>>
  readonly createdAt: string
}

export interface ProjectWorkflowSelection {
  readonly inspector: 'info' | 'display' | 'roi' | 'analysis' | 'history' | 'agent'
  readonly bottom: 'pipeline' | 'history' | 'histogram' | 'profile' | 'results' | 'log'
  readonly selectedRoiId?: string | undefined
  readonly selectedLayerId?: LayerId | undefined
  readonly selectedResultId?: ResultReferenceId | undefined
}

export interface WorkspaceSnapshot {
  readonly schemaVersion: typeof WORKSPACE_SCHEMA_VERSION
  readonly revision: number
  readonly project: WorkspaceProjectMetadata
  readonly sources: readonly WorkspaceSourceReference[]
  readonly datasets: readonly WorkspaceDatasetReference[]
  readonly active?: WorkspaceSelection | undefined
  readonly layers: readonly DisplayLayerState[]
  readonly calibrations: readonly CalibrationOverride[]
  readonly analysis: WorkspaceAnalysisState
  readonly pinnedResults: readonly PinnedResultReference[]
  readonly notes: string
  readonly workflow: ProjectWorkflowSelection
}

export interface CreateWorkspaceOptions {
  readonly projectId?: ProjectId
  readonly now?: string
  readonly appVersion?: string
  readonly pureJsImageVersion?: string
}

const EMPTY_GRAPH: AnalysisGraph = {
  schemaVersion: 1,
  inputs: [],
  nodes: [],
  outputs: [],
}

const EMPTY_ROI_SET: RoiSet = { schemaVersion: 1, rois: [] }

export function createEmptyWorkspace(
  title = 'Untitled project',
  options: Readonly<CreateWorkspaceOptions> = {},
): WorkspaceSnapshot {
  const now = options.now ?? '1970-01-01T00:00:00.000Z'
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    revision: 0,
    project: {
      id: options.projectId ?? ('untitled-project' as ProjectId),
      title,
      createdAt: now,
      updatedAt: now,
      createdWith: {
        appVersion: options.appVersion ?? '0.0.0',
        pureJsImageVersion: options.pureJsImageVersion ?? '0.11.0',
      },
    },
    sources: [],
    datasets: [],
    layers: [],
    calibrations: [],
    analysis: {
      graph: EMPTY_GRAPH,
      roiSet: EMPTY_ROI_SET,
      bindings: [],
      sourceReferences: [],
    },
    pinnedResults: [],
    notes: '',
    workflow: { inspector: 'info', bottom: 'histogram' },
  }
}
