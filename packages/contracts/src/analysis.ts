import type { DatasetHandleId, PlaneSelection, Region } from './index.js'

export type RpcJsonPrimitive = null | boolean | number | string
export type RpcJsonValue =
  | RpcJsonPrimitive
  | readonly RpcJsonValue[]
  | Readonly<{ readonly [key: string]: RpcJsonValue }>
export type RpcJsonObject = Readonly<{ readonly [key: string]: RpcJsonValue }>

export type AnalysisResultHandleId = string & {
  readonly __analysisResultHandleId: unique symbol
}

export interface AnalysisDatasetRequest {
  readonly datasetHandleId: DatasetHandleId
  readonly generation: number
}

export interface AnalysisOperationReference {
  readonly id: string
  readonly version: number
}

export interface AnalysisNormalizeRequest extends AnalysisDatasetRequest {
  readonly operation: AnalysisOperationReference
  readonly parameters: RpcJsonValue
}

export interface AnalysisNormalizeRoiRequest extends AnalysisDatasetRequest {
  readonly roi: RpcJsonObject
}

export interface AnalysisGraphRequest extends AnalysisDatasetRequest {
  readonly graph: RpcJsonObject
  readonly roi?: RpcJsonObject
}

export interface AnalysisCatalog {
  readonly capabilities: RpcJsonObject
}

export interface AnalysisParameterNormalization {
  readonly valid: boolean
  readonly issues: readonly RpcJsonObject[]
  readonly parameters?: RpcJsonValue
}

export interface AnalysisRoiNormalization {
  readonly valid: boolean
  readonly issues: readonly RpcJsonObject[]
  readonly roi?: RpcJsonObject
}

export interface AnalysisDryRunResponse {
  readonly valid: boolean
  readonly issues: readonly RpcJsonObject[]
  readonly warnings: readonly RpcJsonObject[]
  readonly plan: RpcJsonObject | null
}

export type AnalysisOutputSummary =
  | Readonly<{
      kind: 'result'
      name: string
      summary: RpcJsonObject
    }>
  | Readonly<{
      kind: 'dataset'
      name: string
      descriptor: RpcJsonObject
    }>

export interface AnalysisExecutionResponse {
  readonly resultHandleId: AnalysisResultHandleId
  readonly outputs: readonly AnalysisOutputSummary[]
  readonly provenance: RpcJsonObject
  readonly elapsedMilliseconds: number
}

export interface AnalysisOverlayTileRequest extends AnalysisDatasetRequest {
  readonly resultHandleId: AnalysisResultHandleId
  readonly output: string
  readonly tileId: string
  readonly selection: PlaneSelection
  readonly component: number
  readonly region: Region
}

export interface AnalysisOverlayTile {
  readonly tileId: string
  readonly resultHandleId: AnalysisResultHandleId
  readonly output: string
  readonly region: Region
  readonly width: number
  readonly height: number
  readonly rgba: Uint8ClampedArray
  readonly labels: Uint32Array
}

export interface AnalysisTableFilter {
  readonly column: string
  readonly minimum?: number
  readonly maximum?: number
}

export interface AnalysisTableSort {
  readonly column: string
  readonly direction: 'ascending' | 'descending'
}

export interface AnalysisTablePageRequest extends AnalysisDatasetRequest {
  readonly resultHandleId: AnalysisResultHandleId
  readonly output: string
  readonly offset: number
  readonly limit: number
  readonly columns?: readonly string[]
  readonly filter?: AnalysisTableFilter
  readonly sort?: AnalysisTableSort
}

export interface AnalysisTableColumnPage {
  readonly name: string
  readonly kind: 'numeric' | 'boolean' | 'string' | 'category'
  readonly unit?: string
  readonly values: readonly (number | boolean | string | null)[]
}

export interface AnalysisTablePage {
  readonly offset: number
  readonly rowCount: number
  readonly totalRows: number
  readonly columns: readonly AnalysisTableColumnPage[]
}

export interface AnalysisReleaseRequest extends AnalysisDatasetRequest {
  readonly resultHandleId: AnalysisResultHandleId
}
