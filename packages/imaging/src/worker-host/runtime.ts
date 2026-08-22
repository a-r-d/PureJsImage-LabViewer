import type {
  AnalysisResultHandleId,
  CogInspectionReport,
  DatasetHandleId,
  DocumentId,
  OmeZarrNetworkDiagnostics,
  OmeZarrRootIdentityEvidence,
  PlaneSelection,
  SourceId,
  SourceKind,
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
import type { GeoRasterDataset, GeoRasterDescriptor, GeoRasterDocument } from 'purejsimage/geo'
import type { GeoTiffStructuralReport } from 'purejsimage/geo/readers/geotiff'
import type { GeoZarrStructuralReport } from 'purejsimage/geo/readers/geozarr'
import type {
  ScientificDataset,
  ScientificDatasetSummary,
  ScientificDocument,
} from 'purejsimage/scientific'
import type { OmeZarrHttpStore } from 'purejsimage/scientific/browser'
import type { HttpRangeSource } from 'purejsimage/sources/http-range'

export interface SourceRecord {
  readonly id: SourceId
  readonly documentId: DocumentId
  readonly generation: number
  readonly kind: SourceKind
  readonly name: string
  readonly size: number
  readonly url?: string
  readonly document:
    | Readonly<{ kind: 'scientific'; value: ScientificDocument }>
    | Readonly<{
        kind: 'geo'
        value: GeoRasterDocument
        identity: Readonly<Record<string, unknown>>
      }>
  readonly rangeSources: readonly HttpRangeSource[]
  readonly lifetime: AbortController
  readonly cogInspection?: CogInspectionReport
  readonly geoTiffStructure?: GeoTiffStructuralReport
  readonly geoZarrStructure?: GeoZarrStructuralReport
  readonly geoZarrDiagnostics?: () => GeoZarrStructuralReport
  readonly omeZarrHttpStore?: OmeZarrHttpStore
  readonly omeZarrIdentity?: OmeZarrRootIdentityEvidence
  readonly omeZarrNetwork?: () => OmeZarrNetworkDiagnostics
  readonly directoryDisposer?: () => void
  readonly datasets: Map<DatasetHandleId, DatasetRecord>
  lastUsedAt: number
  closed: boolean
}

export interface DatasetRecord {
  readonly handleId: DatasetHandleId
  readonly sourceId: SourceId
  readonly summary: ScientificDatasetSummary | import('purejsimage/geo').GeoRasterDatasetSummary
  readonly dataset: ScientificDataset
  readonly geo?: Readonly<{
    dataset: GeoRasterDataset
    descriptor: GeoRasterDescriptor
  }>
  readonly analysisDataset: ScientificDataset
  readonly readerId: string
  readonly runtime: TileRuntime
  readonly tileSource: TileSource
  readonly tileIdentity: ReturnType<typeof createTileDatasetIdentityForScientificDataset>
  readonly analysis: AnalysisController
  readonly disposeExtensions: () => Promise<void>
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
  readonly datasetHandleIds?: readonly DatasetHandleId[]
  readonly sourceId?: SourceId
  readonly derivedLayerId?: string
}
