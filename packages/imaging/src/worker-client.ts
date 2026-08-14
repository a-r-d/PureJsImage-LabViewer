import {
  type DatasetHandleId,
  type DocumentId,
  type OpenedDatasetDescriptor,
  type OpenedSourceDescriptor,
  type PlaneSelection,
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

type CrashListener = (error: Error) => void
type SuccessfulResponse = Extract<WorkerResponse, { ok: true }>
type ResponseKind = SuccessfulResponse['kind']
type ResponsePayload<Kind extends ResponseKind> =
  Extract<SuccessfulResponse, { kind: Kind }> extends { payload: infer Payload } ? Payload : never

export class ImagingWorkerClient {
  #worker: Worker
  readonly #workerFactory: () => Worker
  #pending = new Map<
    string,
    {
      readonly resolve: (response: WorkerResponse) => void
      readonly reject: (error: Error) => void
    }
  >()
  #nextRequest = 1
  #crashListeners = new Set<CrashListener>()

  constructor(workerFactory: () => Worker = ImagingWorkerClient.createWorker) {
    this.#workerFactory = workerFactory
    this.#worker = workerFactory()
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

  async initialize(): Promise<Extract<WorkerResponse, { kind: 'worker.initialize' }>['payload']> {
    return this.#payload(await this.#call('worker.initialize', null), 'worker.initialize')
  }

  async openSample(generation: number, signal?: AbortSignal): Promise<OpenedSourceDescriptor> {
    return this.#payload(
      await this.#call('source.open-sample', { generation }, signal),
      'source.opened',
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
    return this.#payload(
      await this.#call(
        'source.open-local',
        { generation, primaryId: `file-${index}`, files: attachments },
        signal,
      ),
      'source.opened',
    )
  }

  async openRemote(
    url: string,
    generation: number,
    signal?: AbortSignal,
  ): Promise<OpenedSourceDescriptor> {
    return this.#payload(
      await this.#call('source.open-remote', { generation, url }, signal),
      'source.opened',
    )
  }

  async closeSource(sourceId: SourceId, generation: number): Promise<void> {
    await this.#call('source.close', { sourceId, generation })
  }

  async openDataset(
    documentId: DocumentId,
    datasetId: string,
    generation: number,
    signal?: AbortSignal,
  ): Promise<OpenedDatasetDescriptor> {
    return this.#payload(
      await this.#call('dataset.open', { documentId, datasetId, generation }, signal),
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

  async diagnostics(): Promise<WorkerDiagnostics> {
    return this.#payload(await this.#call('diagnostics.get', null), 'diagnostics')
  }

  async crashForTest(): Promise<void> {
    await this.#call('worker.test-crash', null)
  }

  async restart(): Promise<void> {
    const error = new Error(
      'Imaging Worker restarted; reopen the source to restore runtime handles.',
    )
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

export function createImagingWorkerClient(): ImagingWorkerClient {
  return new ImagingWorkerClient()
}
