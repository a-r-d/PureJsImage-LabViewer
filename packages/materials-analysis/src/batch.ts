export type BatchItemStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface BatchRecipeItem<Input> {
  readonly id: string
  readonly sourceIdentity: string
  readonly sourceName: string
  readonly input: Input
}

export interface DatasetPlaneBatchTarget<Dataset> {
  readonly datasetIdentity: string
  readonly datasetName: string
  readonly dataset: Dataset
  readonly planeIds: readonly string[]
}

export interface DatasetPlaneBatchInput<Dataset> {
  readonly dataset: Dataset
  readonly planeId: string
}

export function datasetPlaneBatchItems<Dataset>(
  targets: readonly DatasetPlaneBatchTarget<Dataset>[],
): readonly BatchRecipeItem<DatasetPlaneBatchInput<Dataset>>[] {
  return targets.flatMap((target) =>
    target.planeIds.map((planeId) => ({
      id: `dataset-plane:${target.datasetIdentity}:${planeId}`,
      sourceIdentity: `${target.datasetIdentity}#plane=${planeId}`,
      sourceName: `${target.datasetName}-${planeId}`,
      input: { dataset: target.dataset, planeId },
    })),
  )
}

export interface CorpusScenarioBatchTarget<Input> {
  readonly id: string
  readonly title: string
  readonly enabled: boolean
  readonly integrity: string
  readonly input: Input
}

export function enabledCorpusScenarioBatchItems<Input>(
  scenarios: readonly CorpusScenarioBatchTarget<Input>[],
): readonly BatchRecipeItem<Input>[] {
  return scenarios.flatMap((scenario) =>
    scenario.enabled
      ? [
          {
            id: `corpus-scenario:${scenario.id}`,
            sourceIdentity: `corpus:${scenario.id}:${scenario.integrity}`,
            sourceName: scenario.title,
            input: scenario.input,
          },
        ]
      : [],
  )
}

export interface BatchRecipeRow<Output> {
  readonly itemId: string
  readonly sourceIdentity: string
  readonly sourceName: string
  readonly outputName: string
  readonly recipeHash: string
  readonly status: BatchItemStatus
  readonly output?: Output
  readonly error?: string
}

export interface BatchRunMetadata<Output> {
  readonly schemaVersion: 1
  readonly runId: string
  readonly recipeHash: string
  readonly concurrency: number
  readonly rows: readonly BatchRecipeRow<Output>[]
}

export interface BatchRunController<Output> {
  readonly result: Promise<BatchRunMetadata<Output>>
  cancelItem(itemId: string): boolean
  cancelAll(): void
  snapshot(): BatchRunMetadata<Output>
}

function deterministicStem(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, '')
  const normalized = withoutExtension
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return normalized === '' ? 'analysis-item' : normalized.slice(0, 96)
}

export function deterministicBatchOutputName(
  sourceName: string,
  recipeHash: string,
  index: number,
): string {
  const hashBody = recipeHash.includes(':') ? (recipeHash.split(':').at(-1) ?? '') : recipeHash
  const digest =
    hashBody
      .replace(/[^a-fA-F0-9]/g, '')
      .slice(0, 12)
      .toLowerCase() || 'unhashed'
  return `${String(index + 1).padStart(4, '0')}-${deterministicStem(sourceName)}-${digest}`
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Cancelled'
  return error instanceof Error ? error.message : 'Batch item failed.'
}

export function runBatchRecipe<Input, Output>(
  items: readonly BatchRecipeItem<Input>[],
  options: Readonly<{
    runId: string
    recipeHash: string
    concurrency: number
    execute(item: BatchRecipeItem<Input>, signal: AbortSignal): Promise<Output>
    outputSourceIdentity?: (output: Output) => string
    resume?: BatchRunMetadata<Output>
    signal?: AbortSignal
    onRow?: (row: BatchRecipeRow<Output>) => void
  }>,
): BatchRunController<Output> {
  if (
    !Number.isSafeInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > 8
  )
    throw new Error('Batch concurrency must be between 1 and 8.')
  if (items.length > 10_000) throw new Error('Batch item count exceeds the 10000 item limit.')
  const seen = new Set<string>()
  for (const item of items) {
    if (item.id.length < 1 || item.id.length > 4_096 || seen.has(item.id))
      throw new Error('Batch item IDs must be unique, non-empty, and bounded.')
    seen.add(item.id)
  }
  const resumed = new Map(
    options.resume?.recipeHash === options.recipeHash
      ? options.resume.rows
          .filter(({ status }) => status === 'succeeded')
          .map((row) => [row.itemId, row] as const)
      : [],
  )
  const rows = items.map<BatchRecipeRow<Output>>((item, index) => {
    const previous = resumed.get(item.id)
    return previous === undefined
      ? {
          itemId: item.id,
          sourceIdentity: item.sourceIdentity,
          sourceName: item.sourceName,
          outputName: deterministicBatchOutputName(item.sourceName, options.recipeHash, index),
          recipeHash: options.recipeHash,
          status: 'queued',
        }
      : previous
  })
  const controllers = new Map<string, AbortController>()
  let cursor = 0
  let cancelledAll = false

  const snapshot = (): BatchRunMetadata<Output> => ({
    schemaVersion: 1,
    runId: options.runId,
    recipeHash: options.recipeHash,
    concurrency: options.concurrency,
    rows: rows.map((row) => ({ ...row })),
  })
  const replaceRow = (index: number, row: BatchRecipeRow<Output>): void => {
    rows[index] = row
    options.onRow?.(row)
  }
  const nextIndex = (): number | undefined => {
    while (cursor < rows.length) {
      const index = cursor
      cursor += 1
      if (rows[index]?.status === 'queued') return index
    }
    return undefined
  }
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex()
      if (index === undefined) return
      const item = items[index]
      const row = rows[index]
      if (item === undefined || row === undefined) return
      if (cancelledAll || options.signal?.aborted) {
        replaceRow(index, { ...row, status: 'cancelled', error: 'Cancelled' })
        continue
      }
      const controller = new AbortController()
      const relayAbort = (): void => controller.abort(options.signal?.reason)
      options.signal?.addEventListener('abort', relayAbort, { once: true })
      controllers.set(item.id, controller)
      replaceRow(index, { ...row, status: 'running' })
      try {
        const output = await options.execute(item, controller.signal)
        controller.signal.throwIfAborted()
        const resolvedIdentity = options.outputSourceIdentity?.(output)
        replaceRow(index, {
          ...row,
          ...(resolvedIdentity === undefined ? {} : { sourceIdentity: resolvedIdentity }),
          status: 'succeeded',
          output,
        })
      } catch (error) {
        const cancelled = controller.signal.aborted || options.signal?.aborted === true
        replaceRow(index, {
          ...row,
          status: cancelled ? 'cancelled' : 'failed',
          error: errorMessage(error),
        })
      } finally {
        controllers.delete(item.id)
        options.signal?.removeEventListener('abort', relayAbort)
      }
    }
  }
  const result = Promise.all(
    Array.from({ length: Math.min(options.concurrency, Math.max(1, items.length)) }, () =>
      worker(),
    ),
  ).then(() => snapshot())
  return {
    result,
    snapshot,
    cancelItem(itemId) {
      const controller = controllers.get(itemId)
      if (controller !== undefined) {
        controller.abort(new DOMException('Batch item cancelled', 'AbortError'))
        return true
      }
      const index = rows.findIndex((row) => row.itemId === itemId && row.status === 'queued')
      const row = rows[index]
      if (row === undefined) return false
      replaceRow(index, { ...row, status: 'cancelled', error: 'Cancelled' })
      return true
    },
    cancelAll() {
      cancelledAll = true
      for (const controller of controllers.values())
        controller.abort(new DOMException('Batch run cancelled', 'AbortError'))
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        if (row?.status === 'queued')
          replaceRow(index, { ...row, status: 'cancelled', error: 'Cancelled' })
      }
    },
  }
}
