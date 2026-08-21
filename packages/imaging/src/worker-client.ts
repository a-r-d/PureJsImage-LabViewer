import {
  type AnalysisCatalog,
  type AnalysisDatasetTileRequest,
  type AnalysisDryRunResponse,
  type AnalysisExecutionResponse,
  type AnalysisGraphRequest,
  type AnalysisNormalizeRequest,
  type AnalysisOverlayTile,
  type AnalysisOverlayTileRequest,
  type AnalysisParameterNormalization,
  type AnalysisReleaseRequest,
  type AnalysisRoiNormalization,
  type AnalysisSeriesExport,
  type AnalysisSeriesExportRequest,
  type AnalysisTablePage,
  type AnalysisTablePageRequest,
  type DatasetHandleId,
  type DerivedDisplayTile,
  type DerivedDisplayTileRequest,
  type DerivedRasterDryRunReport,
  type DerivedRasterDryRunRequest,
  type DerivedRasterLineProfileRequest,
  type DerivedRasterLineProfileResponse,
  type DerivedRasterReleaseRequest,
  type DerivedRasterStatisticsRequest,
  type DerivedRasterStatisticsResponse,
  type DisplayStatistics,
  type DisplayStatisticsRequest,
  type DisplayTile,
  type DisplayTileRequest,
  type DocumentId,
  type OpenedDatasetDescriptor,
  type OpenedSourceDescriptor,
  type PlaneSelection,
  type RasterPointSample,
  type RasterPointSampleRequest,
  type RenderTile,
  type RenderTileRequest,
  RPC_SCHEMA_VERSION,
  type SourceId,
  type StructuredRpcError,
  type WorkerDiagnostics,
  type WorkerRequest,
  type WorkerResponse,
} from '@pji-workbench/contracts'

export class ImagingRpcError extends Error {
  readonly detail: StructuredRpcError

  constructor(detail: StructuredRpcError) {
    super(detail.message)
    this.name = 'ImagingRpcError'
    this.detail = detail
  }
}

export function isStaleIdError(error: unknown): boolean {
  return error instanceof ImagingRpcError && error.detail.code === 'STALE_ID'
}

type CrashListener = (error: Error) => void
type SuccessfulResponse = Extract<WorkerResponse, { ok: true }>
type ResponseKind = SuccessfulResponse['kind']
type ResponsePayload<Kind extends ResponseKind> =
  Extract<SuccessfulResponse, { kind: Kind }> extends { payload: infer Payload } ? Payload : never

export interface ImagingWorkerClientOptions {
  readonly workerFactory?: () => Worker
  /** Science keeps one live source. Atlas retains independent sources. */
  readonly sourcePolicy?: 'replace-one' | 'retain'
}

export class ImagingWorkerClient {
  #worker: Worker
  readonly #workerFactory: () => Worker
  readonly #sourcePolicy: 'replace-one' | 'retain'
  #retained:
    | {
        readonly sourceId: SourceId
        readonly generation: number
      }
    | undefined
  #pending = new Map<
    string,
    {
      readonly resolve: (response: WorkerResponse) => void
      readonly reject: (error: Error) => void
    }
  >()
  #nextRequest = 1
  #crashListeners = new Set<CrashListener>()

  constructor(workerFactoryOrOptions: (() => Worker) | ImagingWorkerClientOptions = {}) {
    const options =
      typeof workerFactoryOrOptions === 'function'
        ? { workerFactory: workerFactoryOrOptions }
        : workerFactoryOrOptions
    this.#workerFactory = options.workerFactory ?? ImagingWorkerClient.createWorker
    this.#sourcePolicy = options.sourcePolicy ?? 'retain'
    this.#worker = this.#workerFactory()
    this.#bindWorker()
  }

  static createWorker(): Worker {
    return new Worker(new URL('./worker-entry.ts', import.meta.url), {
      type: 'module',
      name: 'purejsimage-imaging',
    })
  }

  onCrash(listener: CrashListener): () => void {
    this.#crashListeners.add(listener)
    return () => this.#crashListeners.delete(listener)
  }

  async initialize(
    payload: Extract<WorkerRequest, { kind: 'worker.initialize' }>['payload'] = null,
  ): Promise<Extract<WorkerResponse, { kind: 'worker.initialize' }>['payload']> {
    return this.#payload(await this.#call('worker.initialize', payload), 'worker.initialize')
  }

  async openSample(
    generation: number,
    signal?: AbortSignal,
    sampleId = 'generated.calibrated-particles',
  ): Promise<OpenedSourceDescriptor> {
    return this.#opened(
      this.#payload(
        await this.#call('source.open-sample', { generation, sampleId }, signal),
        'source.opened',
      ),
    )
  }

  async openLocal(
    files: readonly File[],
    primary: File,
    generation: number,
    signal?: AbortSignal,
  ): Promise<OpenedSourceDescriptor> {
    const attachments = files.map((file, index) => ({
      id: `file-${index}`,
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      blob: file as Blob,
    }))
    const index = files.indexOf(primary)
    if (index < 0) throw new Error('The primary file must be present in the file list')
    return this.#opened(
      this.#payload(
        await this.#call(
          'source.open-local',
          { generation, primaryId: `file-${index}`, files: attachments },
          signal,
        ),
        'source.opened',
      ),
    )
  }

  async openBundled(
    locator: Readonly<{
      path: string
      name: string
      size: number
      sha256: string
      mediaType: string
    }>,
    generation: number,
    signal?: AbortSignal,
  ): Promise<Readonly<{ source: OpenedSourceDescriptor; dataset: OpenedDatasetDescriptor }>> {
    const opened = this.#payload(
      await this.#call('source.open-bundled', { generation, ...locator }, signal),
      'source-bundled.opened',
    )
    await this.#replacePreviousSource(opened.source)
    return opened
  }

  async openRemote(
    url: string,
    generation: number,
    signal?: AbortSignal,
  ): Promise<OpenedSourceDescriptor> {
    return this.#opened(
      this.#payload(
        await this.#call('source.open-remote', { generation, url }, signal),
        'source.opened',
      ),
    )
  }

  async openOmeZarrRemote(
    url: string,
    generation: number,
    signal?: AbortSignal,
  ): Promise<OpenedSourceDescriptor> {
    return this.#opened(
      this.#payload(
        await this.#call('source.open-ome-zarr-remote', { generation, url }, signal),
        'source.opened',
      ),
    )
  }

  async openOmeZarrDirectory(
    files: readonly File[],
    storeRoot: string,
    generation: number,
    signal?: AbortSignal,
  ): Promise<OpenedSourceDescriptor> {
    const attachments = files.map((file, index) => ({
      id: `file-${index}`,
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      relativePath:
        typeof file.webkitRelativePath === 'string' && file.webkitRelativePath.length > 0
          ? file.webkitRelativePath
          : file.name,
      blob: file as Blob,
    }))
    return this.#opened(
      this.#payload(
        await this.#call(
          'source.open-ome-zarr-directory',
          { generation, primaryId: 'file-0', storeRoot, files: attachments },
          signal,
        ),
        'source.opened',
      ),
    )
  }

  async openOmeZarrZip(
    file: File,
    generation: number,
    signal?: AbortSignal,
  ): Promise<OpenedSourceDescriptor> {
    return this.#opened(
      this.#payload(
        await this.#call(
          'source.open-ome-zarr-zip',
          {
            generation,
            primaryId: 'file-0',
            files: [
              {
                id: 'file-0',
                name: file.name,
                size: file.size,
                type: file.type,
                lastModified: file.lastModified,
                blob: file as Blob,
              },
            ],
          },
          signal,
        ),
        'source.opened',
      ),
    )
  }

  async closeSource(sourceId: SourceId, generation: number): Promise<void> {
    await this.#call('source.close', { sourceId, generation })
    if (this.#retained?.sourceId === sourceId && this.#retained.generation === generation) {
      this.#retained = undefined
    }
  }

  async openDataset(
    documentId: DocumentId,
    datasetId: string,
    generation: number,
    signal?: AbortSignal,
    sourceId?: SourceId,
  ): Promise<OpenedDatasetDescriptor> {
    return this.#payload(
      await this.#call(
        'dataset.open',
        {
          documentId,
          datasetId,
          generation,
          ...(sourceId === undefined ? {} : { sourceId }),
        },
        signal,
      ),
      'dataset.opened',
    )
  }

  async closeDataset(handleId: DatasetHandleId, generation: number): Promise<void> {
    await this.#call('dataset.close', { handleId, generation })
  }

  async setPlane(
    handleId: DatasetHandleId,
    generation: number,
    selection: PlaneSelection,
  ): Promise<void> {
    await this.#call('plane.set', { handleId, generation, selection })
  }

  requestTile(request: RenderTileRequest, signal?: AbortSignal): Promise<RenderTile> {
    return this.#call('tile.request', request, signal).then((response) =>
      this.#payload(response, 'tile.ready'),
    )
  }

  requestDisplayTile(request: DisplayTileRequest, signal?: AbortSignal): Promise<DisplayTile> {
    return this.#call('display.tile.request', request, signal).then((response) =>
      this.#payload(response, 'display.tile.ready'),
    )
  }

  requestDisplayStatistics(
    request: DisplayStatisticsRequest,
    signal?: AbortSignal,
  ): Promise<DisplayStatistics> {
    return this.#call('display.statistics.request', request, signal).then((response) =>
      this.#payload(response, 'display.statistics.ready'),
    )
  }

  async invalidateDisplayStatistics(
    input: Readonly<{
      sourceIdentity?: string
      datasetHandleId?: DatasetHandleId
    }> = {},
  ): Promise<number> {
    const response = await this.#call('display.statistics.invalidate', input)
    return this.#payload(response, 'display.statistics.invalidated').removed
  }

  sampleRasterPoint(
    request: RasterPointSampleRequest,
    signal?: AbortSignal,
  ): Promise<RasterPointSample> {
    return this.#call('raster.sample_point', request, signal).then((response) =>
      this.#payload(response, 'raster.point_sampled'),
    )
  }

  dryRunDerivedRaster(
    request: DerivedRasterDryRunRequest,
    signal?: AbortSignal,
  ): Promise<DerivedRasterDryRunReport> {
    return this.#call('geo.analysis.dry_run', request, signal).then((response) =>
      this.#payload(response, 'geo.analysis.dry_run'),
    )
  }

  requestDerivedDisplayTile(
    request: DerivedDisplayTileRequest,
    signal?: AbortSignal,
  ): Promise<DerivedDisplayTile> {
    return this.#call('geo.analysis.tile', request, signal).then((response) =>
      this.#payload(response, 'geo.analysis.tile'),
    )
  }

  requestDerivedStatistics(
    request: DerivedRasterStatisticsRequest,
    signal?: AbortSignal,
  ): Promise<DerivedRasterStatisticsResponse> {
    return this.#call('geo.analysis.region_statistics', request, signal).then((response) =>
      this.#payload(response, 'geo.analysis.region_statistics'),
    )
  }

  requestDerivedLineProfile(
    request: DerivedRasterLineProfileRequest,
    signal?: AbortSignal,
  ): Promise<DerivedRasterLineProfileResponse> {
    return this.#call('geo.analysis.line_profile', request, signal).then((response) =>
      this.#payload(response, 'geo.analysis.line_profile'),
    )
  }

  async releaseDerivedRaster(request: DerivedRasterReleaseRequest): Promise<void> {
    await this.#call('geo.analysis.release', request)
  }

  analysisCatalog(
    dataset: Pick<AnalysisGraphRequest, 'datasetHandleId' | 'generation'>,
    signal?: AbortSignal,
  ): Promise<AnalysisCatalog> {
    return this.#call('analysis.catalog', dataset, signal).then((response) =>
      this.#payload(response, 'analysis.catalog'),
    )
  }

  normalizeAnalysisParameters(
    request: AnalysisNormalizeRequest,
    signal?: AbortSignal,
  ): Promise<AnalysisParameterNormalization> {
    return this.#call('analysis.normalize-parameters', request, signal).then((response) =>
      this.#payload(response, 'analysis.parameters-normalized'),
    )
  }

  normalizeRoi(
    request: Extract<WorkerRequest, { kind: 'analysis.normalize-roi' }>['payload'],
    signal?: AbortSignal,
  ): Promise<AnalysisRoiNormalization> {
    return this.#call('analysis.normalize-roi', request, signal).then((response) =>
      this.#payload(response, 'analysis.roi-normalized'),
    )
  }

  dryRunAnalysis(
    request: AnalysisGraphRequest,
    signal?: AbortSignal,
  ): Promise<AnalysisDryRunResponse> {
    return this.#call('analysis.dry-run', request, signal).then((response) =>
      this.#payload(response, 'analysis.dry-run'),
    )
  }

  executeAnalysis(
    request: AnalysisGraphRequest,
    signal?: AbortSignal,
  ): Promise<AnalysisExecutionResponse> {
    return this.#call('analysis.execute', request, signal).then((response) =>
      this.#payload(response, 'analysis.executed'),
    )
  }

  requestAnalysisOverlay(
    request: AnalysisOverlayTileRequest,
    signal?: AbortSignal,
  ): Promise<AnalysisOverlayTile> {
    return this.#call('analysis.overlay-tile', request, signal).then((response) =>
      this.#payload(response, 'analysis.overlay-tile'),
    )
  }

  requestAnalysisDatasetTile(
    request: AnalysisDatasetTileRequest,
    signal?: AbortSignal,
  ): Promise<RenderTile> {
    return this.#call('analysis.dataset-tile', request, signal).then((response) =>
      this.#payload(response, 'analysis.dataset-tile'),
    )
  }

  requestAnalysisTablePage(
    request: AnalysisTablePageRequest,
    signal?: AbortSignal,
  ): Promise<AnalysisTablePage> {
    return this.#call('analysis.table-page', request, signal).then((response) =>
      this.#payload(response, 'analysis.table-page'),
    )
  }

  requestAnalysisSeriesExport(
    request: AnalysisSeriesExportRequest,
    signal?: AbortSignal,
  ): Promise<AnalysisSeriesExport> {
    return this.#call('analysis.series-export', request, signal).then((response) =>
      this.#payload(response, 'analysis.series-export'),
    )
  }

  async releaseAnalysis(request: AnalysisReleaseRequest): Promise<void> {
    await this.#call('analysis.release', request)
  }

  async diagnostics(sourceId?: SourceId): Promise<WorkerDiagnostics> {
    return this.#payload(
      await this.#call('diagnostics.get', sourceId === undefined ? null : { sourceId }),
      'diagnostics',
    )
  }

  async crashForTest(): Promise<void> {
    await this.#call('worker.test-crash', null)
  }

  async restart(): Promise<void> {
    const error = new Error(
      'Imaging Worker restarted; reopen the source to restore runtime handles.',
    )
    this.#retained = undefined
    this.#worker.terminate()
    this.#rejectPending(error)
    this.#worker = this.#workerFactory()
    this.#bindWorker()
    await this.initialize()
  }

  dispose(): void {
    this.#worker.terminate()
    this.#rejectPending(new Error('Imaging Worker client disposed'))
  }

  async #call<Kind extends WorkerRequest['kind']>(
    kind: Kind,
    payload: Extract<WorkerRequest, { readonly kind: Kind }>['payload'],
    signal?: AbortSignal,
  ): Promise<WorkerResponse> {
    signal?.throwIfAborted()
    const requestId = `rpc-${this.#nextRequest}`
    this.#nextRequest += 1
    const response = new Promise<WorkerResponse>((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject })
    })
    this.#worker.postMessage({
      schemaVersion: RPC_SCHEMA_VERSION,
      requestId,
      kind,
      payload,
    } as WorkerRequest)
    const cancel = (): void => {
      this.#worker.postMessage({
        schemaVersion: RPC_SCHEMA_VERSION,
        requestId: `cancel-${requestId}`,
        kind: 'request.cancel',
        payload: { targetRequestId: requestId },
      } satisfies WorkerRequest)
    }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      return await response
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  }

  async #opened(source: OpenedSourceDescriptor): Promise<OpenedSourceDescriptor> {
    await this.#replacePreviousSource(source)
    return source
  }

  async #replacePreviousSource(source: OpenedSourceDescriptor): Promise<void> {
    if (this.#sourcePolicy !== 'replace-one') return
    const previous = this.#retained
    this.#retained = { sourceId: source.sourceId, generation: source.generation }
    if (previous === undefined) return
    await this.#call('source.close', {
      sourceId: previous.sourceId,
      generation: previous.generation,
    })
  }

  #payload<Kind extends ResponseKind>(response: WorkerResponse, kind: Kind): ResponsePayload<Kind> {
    if (!response.ok) throw new ImagingRpcError(response.error)
    if (response.kind !== kind) throw new Error(`Expected ${kind}, received ${response.kind}`)
    return response.payload as unknown as ResponsePayload<Kind>
  }

  #bindWorker(): void {
    this.#worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const pending = this.#pending.get(event.data.requestId)
      if (pending === undefined) return
      this.#pending.delete(event.data.requestId)
      if (event.data.ok) pending.resolve(event.data)
      else pending.reject(new ImagingRpcError(event.data.error))
    })
    this.#worker.addEventListener('error', (event) => {
      event.preventDefault()
      const error = new Error(event.message || 'The imaging Worker crashed.')
      this.#rejectPending(error)
      for (const listener of this.#crashListeners) listener(error)
    })
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }
}

export function createImagingWorkerClient(
  options: ImagingWorkerClientOptions = {},
): ImagingWorkerClient {
  return new ImagingWorkerClient(options)
}
