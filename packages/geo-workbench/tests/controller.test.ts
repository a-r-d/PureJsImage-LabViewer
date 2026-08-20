import type {
  DatasetHandleId,
  DocumentId,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  SourceId,
} from '@pji-workbench/contracts'
import {
  type CatalogService,
  CRS_EPSG_4326,
  createGeoProject,
  createGeoRasterSource,
} from '@pji-workbench/domain-geo'
import { describe, expect, it } from 'vitest'

import { GeoControllerError, type GeoImagingRuntime, GeoWorkbenchController } from '../src/index.js'

class FakeRuntime implements GeoImagingRuntime {
  opens = 0
  readonly closedSources: string[] = []
  readonly closedDatasets: string[] = []
  failNext = false
  disposed = false

  async openLocal(_files: readonly File[], primary: File, generation: number) {
    return this.source(primary.name, generation)
  }

  async openRemote(url: string, generation: number) {
    if (this.failNext) {
      this.failNext = false
      throw new Error('synthetic open failure')
    }
    return this.source(url, generation)
  }

  async openDataset(
    _documentId: DocumentId,
    datasetId: string,
    generation: number,
    _signal?: AbortSignal,
    sourceId?: SourceId,
  ): Promise<OpenedDatasetDescriptor> {
    const unknown = String(sourceId).includes('unknown')
    const mixed = String(sourceId).includes('mixed')
    return {
      handleId: `handle-${sourceId}` as DatasetHandleId,
      sourceId: sourceId ?? ('source' as SourceId),
      generation,
      dataset: {
        id: datasetId,
        identity: {},
        sampleType: 'uint16',
        axes: [
          { id: 'x', kind: 'space', length: 16, coordinates: { type: 'index' } },
          { id: 'y', kind: 'space', length: 8, coordinates: { type: 'index' } },
        ],
        components: [{ id: 'gray', name: 'Gray', kind: 'intensity', unit: 'reflectance' }],
        levels: [],
        capabilities: {
          regionReads: true,
          resolutionLevels: false,
          planeReads: { kind: 'none' },
        },
        spatialReference: {
          crs: unknown
            ? { kind: 'unknown' }
            : mixed
              ? { kind: 'projected', authority: 'EPSG', code: 3857 }
              : CRS_EPSG_4326,
          pixelInterpretation: 'pixel-is-area',
          pixelToModel: [1, 0, 0, 0, -1, 8],
        },
      },
      selection: { displayAxes: ['x', 'y'], fixedIndices: [], resolutionLevel: 0 },
    }
  }

  async closeDataset(handleId: DatasetHandleId) {
    this.closedDatasets.push(handleId)
  }

  async closeSource(sourceId: SourceId) {
    this.closedSources.push(sourceId)
  }

  async diagnostics() {
    return {
      epoch: 1,
      sources: [],
      aggregate: {
        openSources: this.opens - this.closedSources.length,
        openDatasets: this.opens - this.closedDatasets.length,
        pendingRequests: 0,
        rangeCacheBytes: 0,
        tileRuntimeBytes: 0,
      },
      pendingRequests: 0,
      tileRuntime: null,
      releases: { documents: 0, datasets: 0, tiles: 0, runtimes: 0 },
      limits: {
        maxOpenSources: 32,
        maxDatasetsPerSource: 8,
        maxRangeCacheBytes: 1,
        maxTileRuntimeBytes: 1,
        maxInFlightRequests: 1,
      },
    }
  }

  dispose() {
    this.disposed = true
  }

  private source(label: string, generation: number): OpenedSourceDescriptor {
    this.opens += 1
    const flavor = label.includes('unknown')
      ? 'unknown'
      : label.includes('mixed')
        ? 'mixed'
        : 'known'
    const sourceId = `runtime-${flavor}-${this.opens}` as SourceId
    return {
      sourceId,
      documentId: `document-${this.opens}` as DocumentId,
      generation,
      identity: {},
      source: { kind: 'remote', name: label, size: 1024, url: label },
      reader: { id: 'purejsimage/tiff', version: '1', format: 'TIFF' },
      metadata: {},
      datasets: [
        {
          id: `dataset-${this.opens}`,
          identity: {},
          sampleType: 'uint16',
          axes: [],
          components: [],
          levels: [],
          capabilities: {
            regionReads: true,
            resolutionLevels: false,
            planeReads: { kind: 'none' },
          },
        },
      ],
    }
  }
}

const catalogService: CatalogService = {
  async listCollections() {
    return []
  },
  async search() {
    return { items: [] }
  },
  async follow() {
    return { items: [] }
  },
  async resolveDeepLink() {
    return undefined
  },
  async invalidate() {},
}

function controller(runtime = new FakeRuntime()) {
  return { runtime, controller: new GeoWorkbenchController({ runtime, catalogService }) }
}

describe('GeoWorkbenchController', () => {
  it('replays semantic actions and duplicates the selected layer, not the final layer', async () => {
    const { controller: workbench } = controller()
    await workbench.executeAction('geo.source.open_remote', { url: 'https://example.com/a.tif' })
    await workbench.executeAction('geo.source.open_remote', { url: 'https://example.com/b.tif' })
    const first = workbench.getSnapshot().project.layers[0]
    expect(first).toBeDefined()
    await workbench.executeAction('geo.layer.select', { layerId: first?.id })
    const output = await workbench.executeAction('geo.layer.duplicate', { layerId: first?.id })
    const copiedId = (output as { readonly layerId: string }).layerId
    const copy = workbench.getSnapshot().project.layers.find(({ id }) => id === copiedId)
    expect(copy?.sourceId).toBe(first?.sourceId)
  })

  it('keeps project state unchanged when an open fails and releases partial resources', async () => {
    const { runtime, controller: workbench } = controller()
    await workbench.openRemote({ url: 'https://example.com/a.tif' })
    const before = workbench.getSnapshot().project
    runtime.failNext = true
    await expect(
      workbench.openRemote({ url: 'https://example.com/fail.tif' }),
    ).rejects.toMatchObject({
      code: 'RUNTIME_OPEN_FAILED',
    })
    expect(workbench.getSnapshot().project).toEqual(before)
  })

  it('retries a runtime binding without changing its semantic source or layer ids', async () => {
    const { runtime, controller: workbench } = controller()
    const sourceId = await workbench.openRemote({ url: 'https://example.com/a.tif' })
    const layerId = workbench.getSnapshot().project.layers[0]?.id
    workbench.setActiveOverview(sourceId, 3)

    const output = await workbench.executeAction('geo.source.retry', { sourceId })

    expect(output).toEqual({ sourceId })
    expect(workbench.getSnapshot().project.sources.map(({ id }) => id)).toEqual([sourceId])
    expect(workbench.getSnapshot().project.layers.map(({ id }) => id)).toEqual([layerId])
    expect(workbench.bindingForSource(sourceId)?.activeOverview).toBe(3)
    expect(runtime.closedSources).toHaveLength(1)
    expect(runtime.closedDatasets).toHaveLength(1)
  })

  it('rebinds only the local file matching the persisted fingerprint', async () => {
    const { controller: workbench } = controller()
    const file = new File([new Uint8Array([1, 2, 3])], 'local.tif', {
      type: 'image/tiff',
      lastModified: 123,
    })
    const resourceId = workbench.registerLocalResource([file], file)
    const sourceId = await workbench.openLocalResource(resourceId)
    const wrongFile = new File([new Uint8Array([4])], 'local.tif', {
      type: 'image/tiff',
      lastModified: 123,
    })
    const wrongResourceId = workbench.registerLocalResource([wrongFile], wrongFile)

    await expect(
      workbench.executeAction('geo.source.rebind_local', {
        sourceId,
        resourceId: wrongResourceId,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ACTION_INPUT' })
    await expect(
      workbench.executeAction('geo.source.rebind_local', { sourceId, resourceId }),
    ).resolves.toEqual({ sourceId })
    expect(workbench.getSnapshot().project.sources[0]?.id).toBe(sourceId)
  })

  it('closes one source while leaving the other runtime binding readable', async () => {
    const { controller: workbench } = controller()
    const first = await workbench.openRemote({ url: 'https://example.com/a.tif' })
    const second = await workbench.openRemote({ url: 'https://example.com/b.tif' })
    await workbench.closeSource(first, 'remove')
    expect(workbench.bindingForSource(first)).toBeUndefined()
    expect(workbench.bindingForSource(second)?.dataset.dataset.id).toBeTruthy()
    expect(workbench.getSnapshot().project.sources).toHaveLength(1)
  })

  it('persists swipe and blink comparison through the semantic action host', async () => {
    const { controller: workbench } = controller()
    await workbench.openRemote({ url: 'https://example.com/a.tif' })
    await workbench.openRemote({ url: 'https://example.com/b.tif' })
    const [first, second] = workbench.getSnapshot().project.layers
    if (first === undefined || second === undefined) throw new Error('Expected two layers')
    expect(workbench.actionAvailability('geo.comparison.set_swipe')).toEqual({ available: true })
    await workbench.executeAction('geo.comparison.set_swipe', {
      leftLayerId: first.id,
      rightLayerId: second.id,
      swipePosition: 0.4,
    })
    expect(workbench.getSnapshot().project.comparison).toMatchObject({
      mode: 'swipe',
      swipePosition: 0.4,
    })
    await workbench.executeAction('geo.comparison.set_blink', {
      firstLayerId: first.id,
      secondLayerId: second.id,
      intervalMilliseconds: 600,
    })
    expect(workbench.getSnapshot().project.comparison).toMatchObject({
      mode: 'blink',
      intervalMilliseconds: 600,
    })
  })

  it('refuses mixed and unidentified CRS composition with typed proposals', async () => {
    const { controller: workbench } = controller()
    await workbench.openRemote({ url: 'https://example.com/known.tif' })
    await expect(
      workbench.openRemote({ url: 'https://example.com/mixed.tif' }),
    ).rejects.toMatchObject({
      code: 'CRS_INCOMPATIBLE',
    })

    const unknown = controller().controller
    await unknown.openRemote({ url: 'https://example.com/unknown-a.tif' })
    await expect(
      unknown.openRemote({ url: 'https://example.com/unknown-b.tif' }),
    ).rejects.toBeInstanceOf(GeoControllerError)
  })

  it('uses session-local resource ids without persisting them', async () => {
    const { controller: workbench } = controller()
    const file = new File([new Uint8Array([1, 2, 3])], 'local.tif', {
      type: 'image/tiff',
      lastModified: 123,
    })
    const resourceId = workbench.registerLocalResource([file], file)
    await workbench.executeAction('geo.source.open_local_resource', { resourceId })
    const serialized = JSON.stringify(workbench.getSnapshot().project)
    expect(serialized).not.toContain(resourceId)
    expect(serialized).toContain('local.tif')
  })

  it('keeps catalog provenance and display presets scoped to each selected source', async () => {
    const { controller: workbench } = controller()
    const first = await workbench.openRemote({
      url: 'https://example.com/first.tif',
      candidate: candidate('first'),
      presets: [{ id: 'first-preset', label: 'First preset', style: { mapping: { gray: 0 } } }],
    })
    const second = await workbench.openRemote({
      url: 'https://example.com/second.tif',
      candidate: candidate('second'),
      presets: [{ id: 'second-preset', label: 'Second preset', style: { mapping: { gray: 0 } } }],
    })
    expect(workbench.bindingForSource(first)?.presets[0]?.id).toBe('first-preset')
    expect(workbench.bindingForSource(second)?.presets[0]?.id).toBe('second-preset')
    expect(
      workbench.getSnapshot().project.sources.find(({ id }) => id === first)?.catalog?.itemId,
    ).toBe('first')
    expect(
      workbench.getSnapshot().project.sources.find(({ id }) => id === second)?.catalog?.itemId,
    ).toBe('second')
  })

  it('reports source and selection availability and disposes every runtime binding', async () => {
    const { runtime, controller: workbench } = controller()
    expect(workbench.actionAvailability('geo.layer.duplicate')).toEqual({
      available: false,
      reason: 'Select a layer first.',
    })
    expect(workbench.actionAvailability('geo.raster.sample_point')).toEqual({
      available: false,
      reason: 'Point sampling requires the mounted viewport tile cache.',
    })
    expect(workbench.actionAvailability('geo.raster.describe_statistics')).toEqual({
      available: false,
      reason: 'Statistics are not implemented for Atlas yet.',
    })
    await workbench.openRemote({ url: 'https://example.com/a.tif' })
    await workbench.openRemote({ url: 'https://example.com/b.tif' })
    await workbench.dispose()
    expect(runtime.closedSources).toHaveLength(2)
    expect(runtime.closedDatasets).toHaveLength(2)
    expect(runtime.disposed).toBe(true)
  })

  it('recovers from the source limit after a source is closed', async () => {
    const runtime = new FakeRuntime()
    const sources = Array.from({ length: 32 }, (_, index) =>
      createGeoRasterSource({
        id: `source-${index}`,
        label: `Source ${index}`,
        width: 1,
        height: 1,
        componentCount: 1,
        spatialReference: {
          crs: CRS_EPSG_4326,
          pixelInterpretation: 'pixel-is-area',
          pixelToModel: [1, 0, 0, 0, -1, 1],
        },
        locator: { kind: 'bundled-example', scenarioId: `test.source-${index}` },
      }),
    )
    const workbench = new GeoWorkbenchController({
      runtime,
      catalogService,
      initialProject: createGeoProject({ title: 'Full', crs: CRS_EPSG_4326, sources }),
    })
    expect(workbench.actionAvailability('geo.source.open_remote').available).toBe(false)
    await workbench.closeSource('source-0')
    expect(workbench.actionAvailability('geo.source.open_remote').available).toBe(true)
    await workbench.openRemote({ url: 'https://example.com/recovered.tif' })
    expect(workbench.getSnapshot().project.sources).toHaveLength(32)
  })
})

function candidate(itemId: string) {
  return {
    catalogId: 'test-catalog',
    catalogTitle: 'Test catalog',
    collectionId: 'test-collection',
    itemId,
    assetKey: 'data',
    href: `https://example.com/${itemId}.tif`,
    protocol: 'stac-api' as const,
    label: itemId,
    roles: ['data'],
    bands: [{ index: 0, name: 'Gray', dataType: 'uint16', unit: 'reflectance' }],
    mediaType: 'image/tiff',
    provider: 'Test provider',
    license: 'CC0-1.0',
    attribution: 'Test attribution',
  }
}
