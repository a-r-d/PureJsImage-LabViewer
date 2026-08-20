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
  lastStatisticsRequest: Parameters<GeoImagingRuntime['requestDerivedStatistics']>[0] | undefined
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
        components: [
          { id: 'gray', name: 'Gray', kind: 'intensity', unit: 'reflectance' },
          { id: 'nir', name: 'NIR', kind: 'intensity', unit: 'reflectance' },
        ],
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

  async dryRunDerivedRaster(request: Parameters<GeoImagingRuntime['dryRunDerivedRaster']>[0]) {
    return {
      valid: true,
      cacheKey: `derived:${request.layerId}`,
      sources: request.inputs.map((input) => ({
        layerId: input.layerId,
        sourceIdentity: input.sourceIdentity,
        sourceRevision: input.sourceRevision,
        grid: input.grid,
      })),
      targetGrid: request.recipe.targetGrid,
      estimatedTiles: 1,
      estimatedTransferredBytes: 1_024,
      estimatedManagedMemory: 2_048,
      transformRequirements: [],
      resampling: request.recipe.targetGrid.resampling,
      nodataPolicy: request.recipe.outputNoData,
      expectedOutput: { sampleType: 'float32' as const, componentCount: 1 },
      warnings: [],
    }
  }

  async requestDerivedStatistics(
    request: Parameters<GeoImagingRuntime['requestDerivedStatistics']>[0],
  ) {
    this.lastStatisticsRequest = request
    return {
      cacheKey: 'derived:statistics',
      count: 1,
      invalidCount: 0,
      excludedByMask: 2,
      visitedTiles: 1,
      minimum: 0.5,
      maximum: 0.5,
      mean: 0.5,
      variance: 0,
    }
  }

  async requestDerivedLineProfile() {
    return {
      cacheKey: 'derived:line',
      distances: Float64Array.of(0, 1),
      values: Float64Array.of(0.25, 0.5),
      valid: Uint8Array.of(1, 1),
    }
  }

  async sampleRasterPoint(request: Parameters<GeoImagingRuntime['sampleRasterPoint']>[0]) {
    return {
      sourceIdentity: request.sourceIdentity,
      datasetHandleId: request.datasetHandleId,
      layerId: request.layerId,
      pixel: request.pixel,
      sourceMapCoordinate: request.projectMapCoordinate,
      projectMapCoordinate: request.projectMapCoordinate,
      nodata: false,
      components: [
        { index: 0, name: 'Gray', unit: 'reflectance', value: 12, nodata: false },
        { index: 1, name: 'NIR', unit: 'reflectance', value: 24, nodata: false },
      ],
    }
  }

  async releaseDerivedRaster() {}

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
  it('persists bounded workflow action and asset provenance in the project', async () => {
    const { controller: workbench } = controller()
    const sourceId = await workbench.openRemote({ url: 'https://example.com/workflow.tif' })
    const layerId = workbench.getSnapshot().project.layers[0]?.id
    if (layerId === undefined) throw new Error('Expected workflow source layer')
    await workbench.executeAction('geo.workflow.record', {
      record: {
        schemaVersion: 1,
        id: 'workflow-run-1',
        workflowId: 'cog-anatomy',
        workflowVersion: 1,
        parameters: {},
        decisions: { choose: ['fixture'] },
        selectedAssets: [
          {
            catalogId: 'fixture',
            collectionId: 'collection',
            itemId: 'item',
            assetKey: 'data',
          },
        ],
        actions: [
          {
            sequence: 1,
            stepId: 'open',
            actionId: 'geo.source.open_catalog_asset',
            input: { candidate: 'bounded fixture' },
            result: { sourceId },
          },
        ],
        sourceIds: [sourceId],
        outputLayerIds: [layerId],
        completedOutputs: [{ id: 'cog-report', title: 'COG X-ray and telemetry', kind: 'report' }],
        attribution: ['Fixture attribution'],
        startedAt: '2026-08-20T00:00:00.000Z',
        completedAt: '2026-08-20T00:00:01.000Z',
      },
    })
    expect(workbench.getSnapshot().project.workflowRuns).toMatchObject([
      {
        workflowId: 'cog-anatomy',
        sourceIds: [sourceId],
        outputLayerIds: [layerId],
        actions: [{ actionId: 'geo.source.open_catalog_asset' }],
      },
    ])
  })

  it('dry-runs and persists a replayable normalized-difference derived layer', async () => {
    const { controller: workbench } = controller()
    await workbench.executeAction('geo.source.open_remote', { url: 'https://example.com/a.tif' })
    await workbench.executeAction('geo.source.open_remote', { url: 'https://example.com/b.tif' })
    const [left, right] = workbench.getSnapshot().project.layers
    if (left === undefined || right === undefined) throw new Error('Expected two source layers')
    const recipe = {
      schemaVersion: 1,
      operationVersion: 1,
      operation: { kind: 'normalized-difference', left: 'nir', right: 'red' },
      inputs: [
        {
          name: 'nir',
          layerId: left.id,
          component: 0,
          valueMode: 'scaled',
          scale: 0.0000275,
          offset: -0.2,
          noData: { kind: 'value', value: 0 },
        },
        {
          name: 'red',
          layerId: right.id,
          component: 0,
          valueMode: 'scaled',
          scale: 0.0000275,
          offset: -0.2,
          noData: { kind: 'value', value: 0 },
        },
      ],
      targetGrid: {
        schemaVersion: 1,
        crs: 'EPSG:4326',
        width: 16,
        height: 8,
        affine: [1, 0, 0, 0, -1, 8],
        pixelInterpretation: 'area',
        extent: [0, 0, 16, 8],
        sampleType: 'float32',
        noData: { kind: 'nan' },
        resampling: 'nearest',
      },
      alignment: 'exact',
      outputNoData: { kind: 'nan' },
      minimumValidWeight: 0.5,
      limits: {
        maxTilePixels: 65_536,
        maxOutputBytes: 4_194_304,
        maxWorkingBytes: 16_777_216,
      },
    } as const

    const planned = await workbench.executeAction('geo.analysis.dry_run', { recipe })
    expect(planned).toMatchObject({ valid: true, estimatedTiles: 1 })
    const created = (await workbench.executeAction('geo.analysis.normalized_difference', {
      label: 'Landsat NDVI',
      recipe,
    })) as { readonly layerId: string }
    const layer = workbench.getSnapshot().project.layers.find(({ id }) => id === created.layerId)
    expect(layer).toMatchObject({
      kind: 'derived',
      label: 'Landsat NDVI',
      inputLayerIds: [left.id, right.id],
      recipe,
    })
    expect(workbench.getSnapshot().project.provenance).toHaveLength(1)

    await workbench.executeAction('geo.derived_layer.remove', { layerId: created.layerId })
    expect(workbench.getSnapshot().project.layers).toHaveLength(2)
    expect(workbench.getSnapshot().project.provenance).toHaveLength(0)
  })

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
      reason: 'Open a source first.',
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

  it('draws, measures, samples, analyzes, and exports a polygon through semantic actions', async () => {
    const { runtime, controller: workbench } = controller()
    await workbench.executeAction('geo.source.open_remote', { url: 'https://example.com/a.tif' })
    const layerId = workbench.getSnapshot().selectedLayerId
    const created = (await workbench.executeAction('geo.roi.create', {
      name: 'Analysis polygon',
      tool: 'polygon',
      geometry: {
        kind: 'polygon',
        rings: [
          [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
            { x: 8, y: 8 },
            { x: 0, y: 8 },
            { x: 0, y: 0 },
          ],
          [
            { x: 2, y: 2 },
            { x: 4, y: 2 },
            { x: 4, y: 4 },
            { x: 2, y: 4 },
            { x: 2, y: 2 },
          ],
        ],
      },
      crs: CRS_EPSG_4326,
      properties: { class: 'test' },
    })) as { readonly id: string }
    expect(workbench.getSnapshot()).toMatchObject({ selectedRoiId: created.id })

    const measurement = await workbench.executeAction('geo.measure.area', { roiId: created.id })
    expect(measurement).toMatchObject({
      mode: 'geodesic',
      method: 'wgs84-authalic-sphere-area',
      ellipsoid: 'WGS84',
    })

    const samples = await workbench.executeAction('geo.raster.sample_points', {
      layerId,
      points: [{ x: 1, y: 7 }],
      crs: CRS_EPSG_4326,
      valuePolicy: 'raw',
    })
    expect(samples).toMatchObject({
      validSampleCount: 1,
      nodataCount: 0,
      samples: [
        {
          components: [
            { index: 0, value: 12 },
            { index: 1, value: 24 },
          ],
        },
      ],
    })

    const plan = await workbench.executeAction('geo.analysis.zonal_statistics', {
      layerId,
      roiId: created.id,
      dryRun: true,
      valuePolicy: 'raw',
    })
    expect(plan).toMatchObject({
      valid: true,
      estimatedTiles: 2,
      gridTiles: 1,
      bandCount: 2,
      valuePolicy: 'raw',
    })
    const statistics = await workbench.executeAction('geo.analysis.zonal_statistics', {
      layerId,
      roiId: created.id,
      valuePolicy: 'raw',
    })
    expect(statistics).toMatchObject({
      roiId: created.id,
      bands: [
        { component: 0, count: 1 },
        { component: 1, count: 1 },
      ],
      validSampleCount: 2,
      nodataCount: 0,
      provenance: { originalGeometryPreserved: true, transform: { id: 'identity' } },
    })
    expect(runtime.lastStatisticsRequest?.mask?.polygons[0]).toHaveLength(2)

    const exported = await workbench.executeAction('geo.roi.export_geojson', {
      roiIds: [created.id],
    })
    expect(exported).toMatchObject({ format: 'RFC7946-GeoJSON', compliant: true })
    expect(String((exported as { text: string }).text)).toContain('atlas:provenance')
  })

  it('requires explicit legacy CRS confirmation and refuses unsupported raster transforms', async () => {
    const { controller: workbench } = controller()
    const legacy = JSON.stringify({
      type: 'Feature',
      crs: { type: 'name', properties: { name: 'EPSG:3857' } },
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {},
    })
    const warning = await workbench.executeAction('geo.roi.import_geojson', { document: legacy })
    expect(warning).toMatchObject({ requiresConfirmation: true, rois: [] })
    const imported = await workbench.executeAction('geo.roi.import_geojson', {
      document: legacy,
      legacyCrsConfirmed: true,
      legacyCrs: CRS_EPSG_4326,
    })
    expect(imported).toMatchObject({
      requiresConfirmation: false,
      rois: [{ provenance: { interpretationConfirmed: true } }],
    })

    await workbench.executeAction('geo.source.open_remote', { url: 'https://example.com/a.tif' })
    const roi = (await workbench.executeAction('geo.roi.create', {
      geometry: { kind: 'point', x: 1, y: 1 },
      crs: { kind: 'projected', authority: 'EPSG', code: 9999 },
    })) as { id: string }
    await expect(
      workbench.executeAction('geo.raster.sample_points', {
        roiId: roi.id,
        points: [{ x: 1, y: 1 }],
        crs: { kind: 'projected', authority: 'EPSG', code: 9999 },
      }),
    ).rejects.toThrow(/No transform is available/u)
  })

  it('honors cancellation before zonal work starts', async () => {
    const { controller: workbench } = controller()
    await workbench.executeAction('geo.source.open_remote', { url: 'https://example.com/a.tif' })
    const roi = (await workbench.executeAction('geo.roi.create', {
      geometry: {
        kind: 'rectangle',
        minX: 0,
        minY: 0,
        maxX: 8,
        maxY: 8,
      },
      crs: CRS_EPSG_4326,
    })) as { id: string }
    const abort = new AbortController()
    abort.abort()
    await expect(
      workbench.executeAction('geo.analysis.zonal_statistics', { roiId: roi.id }, abort.signal),
    ).rejects.toMatchObject({ code: 'ABORTED' })
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
