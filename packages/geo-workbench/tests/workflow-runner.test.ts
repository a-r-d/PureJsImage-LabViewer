import type { JsonValue } from '@pji-workbench/actions'
import type {
  CatalogSearchPage,
  CatalogSourceCandidate,
  GeoActionId,
} from '@pji-workbench/domain-geo'
import { describe, expect, it, vi } from 'vitest'

import type { GeoRuntimeBinding, GeoWorkbenchController } from '../src/controller.js'
import { GeoWorkflowRunner } from '../src/workflow-runner.js'

class RecordedController {
  readonly calls: Array<Readonly<{ id: GeoActionId; input: unknown }>> = []
  readonly pages: Readonly<Record<string, CatalogSearchPage>>
  project: {
    sources: Array<Record<string, unknown>>
    layers: Array<Record<string, unknown>>
    comparison: Record<string, unknown> & { mode: string }
  } = { sources: [], layers: [], comparison: { mode: 'single' } }
  #next = 1

  constructor(pages: Readonly<Record<string, CatalogSearchPage>>) {
    this.pages = pages
  }

  getSnapshot() {
    return {
      project: {
        ...this.project,
        sources: [...this.project.sources],
        layers: [...this.project.layers],
      },
      revision: 0,
      task: { kind: 'idle' as const },
    }
  }

  actionAvailability() {
    return { available: true }
  }

  bindingForSource(sourceId: string) {
    return this.project.sources.some(({ id }) => id === sourceId)
      ? ({ dataset: { dataset: { sampleType: 'float32' } } } as unknown as GeoRuntimeBinding)
      : undefined
  }

  async executeAction(id: GeoActionId, input: unknown, signal?: AbortSignal): Promise<JsonValue> {
    this.calls.push({ id, input })
    signal?.throwIfAborted()
    const record = input as Readonly<Record<string, unknown>>
    if (id === 'geo.catalog.search')
      return (this.pages[String(record['catalogId'])] ?? { items: [] }) as never
    if (id === 'geo.catalog.inspect_asset') {
      const identity = record['identity'] as Readonly<{
        catalogId: string
        collectionId: string
        itemId: string
        assetKey: string
      }>
      return (Object.values(this.pages)
        .flatMap(({ items }) => items)
        .flatMap(({ candidates }) => candidates)
        .find(
          (candidate) =>
            candidate.catalogId === identity.catalogId &&
            candidate.collectionId === identity.collectionId &&
            candidate.itemId === identity.itemId &&
            candidate.assetKey === identity.assetKey,
        ) ?? null) as never
    }
    if (id === 'geo.source.open_catalog_asset') {
      const candidate = record['candidate'] as CatalogSourceCandidate
      if (candidate.label === 'Slow') {
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }
      const sourceId = `source-${this.#next}`
      const layerId = `layer-${this.#next}`
      this.#next += 1
      this.project.sources.push({
        id: sourceId,
        label: candidate.label,
        width: 16,
        height: 8,
        componentCount: Math.max(1, candidate.bands.length),
        bands:
          candidate.bands.length === 0
            ? [{ index: 0, name: 'Elevation', unit: 'm' }]
            : candidate.bands,
        spatialReference: {
          crs: { kind: 'authority', authority: 'EPSG', code: candidate.projEpsg ?? 4326 },
          pixelInterpretation: 'pixel-is-area',
          pixelToModel: [1, 0, 0, 0, -1, 8],
        },
      })
      this.project.layers.push({
        id: layerId,
        kind: 'raster',
        sourceId,
        visible: true,
        opacity: 1,
        style: { mapping: { gray: 0 } },
      })
      return { sourceId }
    }
    if (id === 'geo.source.close') {
      this.project.sources = this.project.sources.filter(
        ({ id: sourceId }) => sourceId !== record['sourceId'],
      )
      this.project.layers = this.project.layers.filter(
        ({ sourceId }) => sourceId !== record['sourceId'],
      )
      return { closed: true }
    }
    if (id === 'geo.derived_layer.remove') {
      this.project.layers = this.project.layers.filter(
        ({ id: layerId }) => layerId !== record['layerId'],
      )
      return { removed: true }
    }
    if (
      id.startsWith('geo.analysis.') &&
      !id.endsWith('line_profile') &&
      !id.endsWith('region_statistics')
    ) {
      const layerId = `derived-${this.#next++}`
      this.project.layers.push({ id: layerId, kind: 'derived' })
      return { layerId }
    }
    if (id === 'geo.analysis.line_profile')
      return { distances: [0, 1], values: [10, 11], valid: [true, true] }
    if (id === 'geo.analysis.region_statistics') return { count: 128, minimum: 10, maximum: 20 }
    if (id === 'geo.comparison.set_swipe') this.project.comparison = { mode: 'swipe', ...record }
    if (id === 'geo.comparison.set_blink') this.project.comparison = { mode: 'blink', ...record }
    return { updated: true }
  }
}

class AbortIgnoringSearchController extends RecordedController {
  readonly started: Promise<void>
  #markStarted!: () => void
  #release!: () => void
  #delayNextSearch = true

  constructor(pages: Readonly<Record<string, CatalogSearchPage>>) {
    super(pages)
    this.started = new Promise<void>((resolve) => {
      this.#markStarted = resolve
    })
  }

  release(): void {
    this.#release()
  }

  override async executeAction(
    id: GeoActionId,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    if (id !== 'geo.catalog.search' || !this.#delayNextSearch)
      return super.executeAction(id, input, signal)
    this.#delayNextSearch = false
    this.calls.push({ id, input })
    this.#markStarted()
    await new Promise<void>((resolve) => {
      this.#release = resolve
    })
    const catalogId = String((input as Readonly<Record<string, unknown>>)['catalogId'])
    return (this.pages[catalogId] ?? { items: [] }) as never
  }
}

describe('GeoWorkflowRunner recorded workflows', () => {
  it('does not append an abort-ignoring stale action to a newer run', async () => {
    const candidate = raster('rgb', 'RGB', [
      { index: 0, commonName: 'red' },
      { index: 1, commonName: 'green' },
      { index: 2, commonName: 'blue' },
    ])
    const controller = new AbortIgnoringSearchController({ 'ky-from-above': page(candidate) })
    const runner = new GeoWorkflowRunner(controller as unknown as GeoWorkbenchController)
    const stale = runner.start('cog-anatomy')
    await controller.started
    await runner.start('natural-color-cir')
    controller.release()
    await expect(stale).rejects.toBeDefined()
    expect(runner.getSnapshot().run).toMatchObject({
      workflowId: 'natural-color-cir',
      status: 'awaiting-decision',
      actions: [{ actionId: 'geo.catalog.search' }],
    })
  })

  it('applies natural color from explicit metadata and never invents CIR', async () => {
    const candidate = raster('rgb', 'RGB', [
      { index: 0, commonName: 'red' },
      { index: 1, commonName: 'green' },
      { index: 2, commonName: 'blue' },
      { index: 3, commonName: 'gray' },
    ])
    const controller = recorded({ 'ky-from-above': page(candidate) })
    const runner = new GeoWorkflowRunner(controller)
    await runner.start('natural-color-cir')
    expect(runner.getSnapshot().decisionOptions[0]?.supportedParameters?.['displayPreset']).toEqual(
      ['natural-color'],
    )
    await runner.choose([optionId(runner)])
    const run = runner.getSnapshot().run
    expect(run?.status).toBe('completed')
    expect(action(run, 'geo.layer.set_style')?.input).toMatchObject({
      style: { mapping: { red: 0, green: 1, blue: 2 }, rangeMode: 'stable' },
    })
  })

  it('opens two dated Kentucky assets and configures swipe with both identities', async () => {
    const first = { ...raster('2019', '2019'), datetime: '2019-04-01T00:00:00Z' }
    const second = { ...raster('2022', '2022'), datetime: '2022-04-01T00:00:00Z' }
    const controller = recorded({ 'ky-from-above': page(first, second) })
    const runner = new GeoWorkflowRunner(controller)
    await runner.start('kentucky-through-time')
    const choices = runner.getSnapshot().decisionOptions.map(({ id }) => id)
    await runner.choose(choices)
    expect(controller.getSnapshot().project.comparison.mode).toBe('swipe')
    expect(runner.getSnapshot().run).toMatchObject({
      status: 'completed',
      selectedAssets: [{ itemId: '2019' }, { itemId: '2022' }],
      sourceIds: ['source-1', 'source-2'],
    })
  })

  it('refuses incompatible CRS and removes every temporary source', async () => {
    const first = { ...raster('left', 'Left'), datetime: '2019-01-01T00:00:00Z', projEpsg: 4326 }
    const second = { ...raster('right', 'Right'), datetime: '2022-01-01T00:00:00Z', projEpsg: 3857 }
    const controller = recorded({ 'ky-from-above': page(first, second) })
    const runner = new GeoWorkflowRunner(controller)
    await runner.start('kentucky-through-time')
    await expect(
      runner.choose(runner.getSnapshot().decisionOptions.map(({ id }) => id)),
    ).rejects.toThrow('same identified CRS')
    expect(controller.getSnapshot().project.sources).toEqual([])
    expect(runner.getSnapshot().run).toMatchObject({
      status: 'failed',
      availability: { status: 'blocked-incompatible-crs' },
    })
  })

  it('composes separate Landsat band assets with scaled RGB, CIR, and NDVI recipes', async () => {
    const bands = [
      landsat('red', 'red'),
      landsat('green', 'green'),
      landsat('blue', 'blue'),
      landsat('nir08', 'nir'),
    ]
    const controller = recorded({ 'usgs-landsat': scenePage(bands) })
    const runner = new GeoWorkflowRunner(controller)
    await runner.start('usgs-landsat-cincinnati', { valueMode: 'scaled', includeNdvi: true })
    await runner.choose([optionId(runner)])
    const run = runner.getSnapshot().run
    expect(run?.status).toBe('completed')
    expect(run?.selectedAssets.map(({ assetKey }) => assetKey)).toEqual([
      'red',
      'green',
      'blue',
      'nir08',
    ])
    expect(run?.outputLayerIds).toHaveLength(3)
    expect(run?.outputLayerIds.every((id) => String(id).startsWith('derived-'))).toBe(true)
    const stackActions =
      run?.actions.filter(({ actionId }) => actionId === 'geo.analysis.virtual_band_stack') ?? []
    expect(stackActions).toHaveLength(2)
    expect(stackActions[0]?.input).toMatchObject({
      recipe: {
        operation: { kind: 'virtual-band-stack', bands: ['red', 'green', 'blue'] },
      },
    })
    const naturalStack = stackActions[0]
    if (naturalStack === undefined) throw new Error('Expected natural-color stack action')
    const naturalInputs = (
      naturalStack.input as unknown as {
        readonly recipe: { readonly inputs: readonly unknown[] }
      }
    ).recipe.inputs
    expect(naturalInputs).toHaveLength(3)
    expect(naturalInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ valueMode: 'scaled', scale: 0.0000275, offset: -0.2 }),
      ]),
    )
    expect(action(run, 'geo.analysis.normalized_difference')?.input).toMatchObject({
      recipe: { operation: { kind: 'normalized-difference', left: 'nir', right: 'red' } },
    })
  })

  it('omits optional NDVI provenance when NDVI is disabled', async () => {
    const controller = recorded({
      'usgs-landsat': scenePage([
        landsat('red', 'red'),
        landsat('green', 'green'),
        landsat('blue', 'blue'),
        landsat('nir08', 'nir'),
      ]),
    })
    const runner = new GeoWorkflowRunner(controller)
    await runner.start('usgs-landsat-cincinnati', { valueMode: 'raw', includeNdvi: false })
    await runner.choose([optionId(runner)])
    const run = runner.getSnapshot().run
    expect(action(run, 'geo.analysis.normalized_difference')).toBeUndefined()
    expect(run?.completedOutputs.map(({ id }) => id)).toEqual(['natural-color', 'cir'])
    expect(run?.outputLayerIds).toHaveLength(2)
  })

  it('refuses to substitute one multiband asset for separate Landsat assets', async () => {
    const combined = {
      ...landsat('combined', 'red'),
      bands: [
        { index: 0, commonName: 'red' },
        { index: 1, commonName: 'green' },
        { index: 2, commonName: 'blue' },
        { index: 3, commonName: 'nir' },
      ],
    }
    const controller = recorded({ 'usgs-landsat': scenePage([combined]) })
    const runner = new GeoWorkflowRunner(controller)
    await runner.start('usgs-landsat-cincinnati')
    await expect(runner.choose([optionId(runner)])).rejects.toThrow('separate asset')
    expect(controller.getSnapshot().project.sources).toEqual([])
  })

  it('runs terrain analysis against the elevation recipe for hillshade, slope, profile, and summary', async () => {
    const dem = {
      ...raster('dem', 'Bare-earth DEM', []),
      catalogId: 'usgs-3dep',
      collectionId: 'National Elevation Dataset (NED) 1/3 arc-second',
    }
    const controller = recorded({ 'usgs-3dep': page(dem) })
    const runner = new GeoWorkflowRunner(controller)
    await runner.start('terrain-lab')
    await runner.choose([optionId(runner)])
    const run = runner.getSnapshot().run
    expect(run?.actions.map(({ actionId }) => actionId)).toEqual(
      expect.arrayContaining([
        'geo.analysis.hillshade',
        'geo.analysis.slope',
        'geo.analysis.line_profile',
        'geo.analysis.region_statistics',
      ]),
    )
    expect(action(run, 'geo.analysis.line_profile')?.input).toMatchObject({
      recipe: { operation: { kind: 'virtual-band-stack', bands: ['elevation'] } },
    })
  })

  it('cancels an in-flight open, rolls back, and replays identities without search', async () => {
    const first = { ...raster('first', 'First'), datetime: '2019-01-01T00:00:00Z' }
    const slow = { ...raster('slow', 'Slow'), datetime: '2022-01-01T00:00:00Z' }
    const controller = recorded({ 'ky-from-above': page(first, slow) })
    const runner = new GeoWorkflowRunner(controller)
    await runner.start('kentucky-through-time')
    const choosing = runner.choose(runner.getSnapshot().decisionOptions.map(({ id }) => id))
    await vi.waitFor(() => expect(controller.getSnapshot().project.sources).toHaveLength(1))
    runner.cancel()
    await expect(choosing).rejects.toBeDefined()
    expect(controller.getSnapshot().project.sources).toEqual([])
    expect(runner.getSnapshot().run?.status).toBe('cancelled')

    const replayController = recorded({
      'ky-from-above': page(first, { ...slow, label: 'Second' }),
    })
    const replayRunner = new GeoWorkflowRunner(replayController)
    const cancelledRun = runner.getSnapshot().run
    if (cancelledRun === undefined) throw new Error('Expected cancelled workflow record')
    const record = {
      ...cancelledRun,
      status: 'completed' as const,
      selectedAssets: [first, slow].map(({ catalogId, collectionId, itemId, assetKey }) => ({
        catalogId,
        collectionId,
        itemId,
        assetKey,
      })),
    }
    await replayRunner.replay(record)
    expect(replayController.calls.some(({ id }) => id === 'geo.catalog.search')).toBe(false)
    expect(
      replayController.calls.filter(({ id }) => id === 'geo.catalog.inspect_asset'),
    ).toHaveLength(2)
  })
})

function recorded(pages: Readonly<Record<string, CatalogSearchPage>>): GeoWorkbenchController {
  return new RecordedController(pages) as unknown as GeoWorkbenchController
}

function raster(
  itemId: string,
  label: string,
  bands: CatalogSourceCandidate['bands'] = [{ index: 0, name: 'gray' }],
): CatalogSourceCandidate {
  return {
    catalogId: 'ky-from-above',
    catalogTitle: 'Kentucky From Above',
    collectionId: 'orthos-phase2',
    itemId,
    assetKey: 'data',
    href: `https://fixtures.invalid/${itemId}.tif`,
    label,
    datetime: '2020-01-01T00:00:00Z',
    bbox: [-85, 38, -84, 39],
    roles: ['data'],
    bands,
    provider: 'Recorded provider',
    license: 'CC-BY-4.0',
    attribution: 'Recorded fixture attribution',
  }
}

function landsat(assetKey: string, commonName: string): CatalogSourceCandidate {
  return {
    ...raster('LC09_SCENE', assetKey, [
      { index: 0, commonName, scale: 0.0000275, offset: -0.2, nodata: 0 },
    ]),
    catalogId: 'usgs-landsat',
    catalogTitle: 'USGS Landsat',
    collectionId: 'landsat-c2l2-sr',
    assetKey,
  }
}

function page(...candidates: readonly CatalogSourceCandidate[]): CatalogSearchPage {
  return {
    items: candidates.map((candidate) => ({
      id: candidate.itemId,
      collectionId: candidate.collectionId,
      datetime: candidate.datetime,
      bbox: candidate.bbox,
      candidates: [candidate],
    })),
  }
}

function scenePage(candidates: readonly CatalogSourceCandidate[]): CatalogSearchPage {
  const first = candidates[0]
  if (first === undefined) return { items: [] }
  return {
    items: [
      {
        id: first.itemId,
        collectionId: first.collectionId,
        datetime: first.datetime,
        bbox: first.bbox,
        candidates,
      },
    ],
  }
}

function optionId(runner: GeoWorkflowRunner): string {
  const id = runner.getSnapshot().decisionOptions[0]?.id
  if (id === undefined) throw new Error('Expected workflow decision option')
  return id
}

function action(run: ReturnType<GeoWorkflowRunner['getSnapshot']>['run'], id: GeoActionId) {
  return run?.actions.find(({ actionId }) => actionId === id)
}
