import type {
  AnalysisResultHandleId,
  DatasetHandleId,
  DocumentId,
  PlaneSelection,
  SourceId,
} from '@pji-workbench/contracts'
import type {
  AnalysisController,
  AnalysisExecutionResult,
  PreparedAnalysisPlan,
} from 'purejsimage/analysis'
import type {
  createTileDatasetIdentityForScientificDataset,
  TileRuntime,
  TileSource,
} from 'purejsimage/analysis/runtime'
import type {
  ScientificDataset,
  ScientificDatasetSummary,
  ScientificDocument,
} from 'purejsimage/scientific'
import type { HttpRangeSource } from 'purejsimage/sources/http-range'

export interface SourceRecord {
  readonly id: SourceId
  readonly documentId: DocumentId
  readonly generation: number
  readonly kind: 'local' | 'remote' | 'sample'
  readonly name: string
  readonly size: number
  readonly url?: string
  readonly document: ScientificDocument
  readonly rangeSources: readonly HttpRangeSource[]
  readonly datasets: Map<DatasetHandleId, DatasetRecord>
  closed: boolean
}

export interface DatasetRecord {
  readonly handleId: DatasetHandleId
  readonly summary: ScientificDatasetSummary
  readonly dataset: ScientificDataset
  readonly runtime: TileRuntime
  readonly tileSource: TileSource
  readonly tileIdentity: ReturnType<typeof createTileDatasetIdentityForScientificDataset>
  readonly analysis: AnalysisController
  readonly results: Map<AnalysisResultHandleId, AnalysisExecutionRecord>
  selection: PlaneSelection
  closed: boolean
}

export interface AnalysisExecutionRecord {
  readonly id: AnalysisResultHandleId
  readonly plan: PreparedAnalysisPlan
  readonly execution: AnalysisExecutionResult
  closed: boolean
}

export interface PendingRequest {
  readonly controller: AbortController
  readonly datasetHandleId?: DatasetHandleId
}
