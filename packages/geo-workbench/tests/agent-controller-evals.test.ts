import { AgentRuntime, DeterministicAgentTransport } from '@pji-workbench/agent'
import type {
  DatasetHandleId,
  DerivedRasterRecipeV1,
  DocumentId,
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  SourceId,
} from '@pji-workbench/contracts'
import { type CatalogService, CRS_EPSG_4326, crsKey } from '@pji-workbench/domain-geo'
import { describe, expect, it } from 'vitest'

import {
  createGeoAgentGateway,
  type GeoImagingRuntime,
  GeoWorkbenchController,
} from '../src/index.js'

class LocalFixtureRuntime implements GeoImagingRuntime {
  opens = 0
  disposed = false

  async openLocal(_files: readonly File[], primary: File, generation: number) {
    return this.source(primary.name, generation)
  }

  async openRemote(url: string, generation: number) {
    return this.source(url, generation)
  }

  async openDataset(
    _documentId: DocumentId,
    datasetId: string,
    generation: number,
    _signal?: AbortSignal,
    sourceId?: SourceId,
  ): Promise<OpenedDatasetDescriptor> {
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
          crs: CRS_EPSG_4326,
          pixelInterpretation: 'pixel-is-area',
          pixelToModel: [1, 0, 0, 0, -1, 8],
        },
      },
    }
  }

  async closeSource() {}
  async closeDataset() {}
  async diagnostics() {
    return {
      epoch: 1,
      sources: [],
      aggregate: {
        openSources: 1,
        openDatasets: 1,
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
      execution: {
        schemaVersion: 1 as const,
        engine: 'purejsimage/geo' as const,
        packageVersion: '0.16.0',
        cacheSchemaVersion: 2 as const,
        inputs: request.inputs.map((input) => ({
          layerId: input.layerId,
          relationship: 'exact-grid' as const,
          pixelAligned: true,
          pyramidCompatible: true,
          sourceGridIdentity: `source:${input.layerId}`,
          targetGridIdentity: 'target',
        })),
      },
    }
  }
  async requestDerivedStatistics() {
    return {
      cacheKey: 'derived:statistics',
      count: 4,
      invalidCount: 0,
      excludedByMask: 0,
      visitedTiles: 1,
      minimum: 1,
      maximum: 20,
      mean: 12,
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
      components: [{ index: 0, name: 'Gray', unit: 'reflectance', value: 12, nodata: false }],
    }
  }
  async releaseDerivedRaster() {}
  dispose() {
    this.disposed = true
  }

  private source(label: string, generation: number): OpenedSourceDescriptor {
    this.opens += 1
    const sourceId = `source-${this.opens}` as SourceId
    return {
      sourceId,
      documentId: `document-${this.opens}` as DocumentId,
      generation,
      identity: { url: label },
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
    return {
      items: [
        {
          id: 'local-cog',
          collection: 'fixture',
          assets: {
            visual: {
              href: 'https://fixtures.local/local.tif',
              type: 'image/tiff; application=geotiff; profile=cloud-optimized',
            },
          },
        },
      ],
    }
  },
  async follow() {
    return { items: [] }
  },
  async resolveDeepLink() {
    return undefined
  },
  async invalidate() {},
}

describe('Atlas controller-backed agent evaluations', () => {
  it('opens a local fixture raster and grades zonal statistics on the live controller', async () => {
    const imaging = new LocalFixtureRuntime()
    const controller = new GeoWorkbenchController({
      runtime: imaging,
      catalogService,
    })
    await controller.executeAction('geo.source.open_remote', {
      url: 'https://fixtures.local/local.tif',
    })
    const layerId = controller.getSnapshot().selectedLayerId
    const created = (await controller.executeAction('geo.roi.create', {
      name: 'Fixture ROI',
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
        ],
      },
      crs: CRS_EPSG_4326,
    })) as { readonly id: string }
    if (layerId === undefined) throw new Error('Fixture source was not opened.')
    const roiId = created.id
    const initialRevision = controller.getSnapshot().revision
    const gateway = createGeoAgentGateway(controller)
    const runtime = new AgentRuntime({
      transport: new DeterministicAgentTransport([
        {
          provider: 'fake',
          model: 'fake/atlas',
          content: '',
          toolCalls: [
            {
              callId: 'stats-1',
              actionId: 'geo.analysis.zonal_statistics',
              actionVersion: 1,
              projectRevision: initialRevision,
              input: { layerId, roiId, valuePolicy: 'raw' },
            },
          ],
          plan: {
            goalSummary: 'Summarize ROI statistics on the local fixture raster',
            actions: [],
            approvalsRequired: [],
            stoppingCondition: 'Bounded zonal statistics exist.',
          },
        },
        {
          provider: 'fake',
          model: 'fake/atlas',
          content: 'The ROI contains four valid samples on the local fixture raster.',
          toolCalls: [],
        },
      ]),
      gateway,
      policy: {
        decide(capability) {
          return {
            decision: 'allow',
            reason: 'Controller-backed eval action.',
            permissions: capability.permissions,
          }
        },
      },
    })
    const audit = await runtime.start(
      'Select the ROI and summarize raster statistics inside it.',
      'fake/atlas',
    )
    expect(audit.kind).toBe('run')
    expect(audit.trace.map(({ actionId }) => actionId)).toEqual(['geo.analysis.zonal_statistics'])
    expect(controller.getSnapshot().revision).toBeGreaterThanOrEqual(initialRevision)
    expect(JSON.stringify(audit.trace[0]?.result)).toContain('count')
    expect(runtime.getSnapshot().finalText).toContain('four valid samples')
  })

  it('searches a local deterministic catalog through the live controller', async () => {
    const controller = new GeoWorkbenchController({
      runtime: new LocalFixtureRuntime(),
      catalogService,
    })
    const runtime = new AgentRuntime({
      transport: new DeterministicAgentTransport([
        {
          provider: 'fake',
          model: 'fake/atlas',
          content: '',
          toolCalls: [
            {
              callId: 'search-1',
              actionId: 'geo.catalog.search',
              actionVersion: 1,
              projectRevision: controller.getSnapshot().revision,
              input: { catalogId: 'ky-from-above', request: { query: 'Kentucky' } },
            },
          ],
          plan: {
            goalSummary: 'Search the local fixture catalog',
            actions: [],
            approvalsRequired: [],
            stoppingCondition: 'Bounded catalog candidates exist.',
          },
        },
        {
          provider: 'fake',
          model: 'fake/atlas',
          content: 'The local catalog returned one decoder-ready COG candidate.',
          toolCalls: [],
        },
      ]),
      gateway: createGeoAgentGateway(controller),
      policy: {
        decide(capability) {
          return {
            decision: 'allow',
            reason: 'Controller-backed eval action.',
            permissions: capability.permissions,
          }
        },
      },
    })
    const audit = await runtime.start(
      'Search Kentucky without calling a government service.',
      'fake/atlas',
    )
    expect(audit.trace.map(({ actionId }) => actionId)).toEqual(['geo.catalog.search'])
    expect(JSON.stringify(audit.trace[0]?.result)).toContain('local-cog')
    expect(runtime.getSnapshot().finalText).toContain('decoder-ready')
  })

  it('creates a hillshade derived layer and advances the project revision', async () => {
    const controller = new GeoWorkbenchController({
      runtime: new LocalFixtureRuntime(),
      catalogService,
    })
    await controller.executeAction('geo.source.open_remote', {
      url: 'https://fixtures.local/dem.tif',
    })
    const initialRevision = controller.getSnapshot().revision
    const recipe = hillshadeRecipe(controller)
    const runtime = new AgentRuntime({
      transport: new DeterministicAgentTransport([
        {
          provider: 'fake',
          model: 'fake/atlas',
          content: '',
          toolCalls: [
            {
              callId: 'hillshade-1',
              actionId: 'geo.analysis.hillshade',
              actionVersion: 1,
              projectRevision: initialRevision,
              input: { recipe, label: 'Hillshade' },
            },
          ],
          plan: {
            goalSummary: 'Create local hillshade',
            actions: [],
            approvalsRequired: [],
            stoppingCondition: 'A derived hillshade layer exists.',
          },
        },
        {
          provider: 'fake',
          model: 'fake/atlas',
          content: 'Hillshade was added from the local DEM fixture.',
          toolCalls: [],
        },
      ]),
      gateway: createGeoAgentGateway(controller),
      policy: {
        decide(capability) {
          return {
            decision: 'allow',
            reason: 'Controller-backed eval action.',
            permissions: capability.permissions,
          }
        },
      },
    })
    const audit = await runtime.start('Create hillshade from the open local DEM.', 'fake/atlas')
    expect(audit.trace.map(({ actionId }) => actionId)).toEqual(['geo.analysis.hillshade'])
    expect(controller.getSnapshot().revision).toBeGreaterThan(initialRevision)
    expect(JSON.stringify(audit.trace[0]?.result)).toContain('layerId')
    expect(controller.getSnapshot().project.layers.some((layer) => layer.kind === 'derived')).toBe(
      true,
    )
  })
})

describe('Atlas opt-in live local catalog evaluations', () => {
  it.skipIf(process.env['ATLAS_LIVE_EVAL'] !== '1')(
    'uses only local deterministic catalogs and rasters when enabled',
    async () => {
      const controller = new GeoWorkbenchController({
        runtime: new LocalFixtureRuntime(),
        catalogService,
      })
      const page = await controller.executeAction('geo.catalog.search', {
        catalogId: 'ky-from-above',
        request: { query: 'local fixture' },
      })
      expect(JSON.stringify(page)).toContain('fixtures.local')
      expect(JSON.stringify(page)).not.toMatch(/usgs\.gov|noaa\.gov|ky\.gov/u)
    },
  )
})

function hillshadeRecipe(controller: GeoWorkbenchController): DerivedRasterRecipeV1 {
  const snapshot = controller.getSnapshot()
  const layer = snapshot.project.layers.find((entry) => entry.id === snapshot.selectedLayerId)
  const source = snapshot.project.sources.find((entry) => entry.id === layer?.sourceId)
  if (layer === undefined || source === undefined || layer.kind !== 'raster')
    throw new Error('Fixture raster is missing.')
  const affine = source.spatialReference.pixelToModel
  const crs = crsKey(source.spatialReference.crs)
  if (affine === undefined || crs === undefined) throw new Error('Fixture grid is missing.')
  const corners = [
    [0, 0],
    [source.width, 0],
    [source.width, source.height],
    [0, source.height],
  ].map(([x = 0, y = 0]) => ({
    x: affine[0] * x + affine[1] * y + affine[2],
    y: affine[3] * x + affine[4] * y + affine[5],
  }))
  return {
    schemaVersion: 1,
    operationVersion: 1,
    operation: {
      kind: 'terrain',
      operation: 'hillshade',
      input: 'elevation',
      xSpacing: Math.hypot(affine[0], affine[3]),
      ySpacing: Math.hypot(affine[1], affine[4]),
      xUnit: { kind: 'metre' },
      yUnit: { kind: 'metre' },
      verticalUnit: { kind: 'metre' },
      rowDirection: affine[4] < 0 ? 'north' : 'south',
      edge: 'nodata',
      slopeUnit: 'degrees',
      azimuthDegrees: 315,
      altitudeDegrees: 45,
    },
    inputs: [
      {
        name: 'elevation',
        layerId: layer.id,
        component: 0,
        valueMode: 'raw',
        scale: 1,
        offset: 0,
        noData: { kind: 'none' },
      },
    ],
    targetGrid: {
      schemaVersion: 1,
      crs,
      width: source.width,
      height: source.height,
      affine,
      pixelInterpretation: 'area',
      extent: [
        Math.min(...corners.map(({ x }) => x)),
        Math.min(...corners.map(({ y }) => y)),
        Math.max(...corners.map(({ x }) => x)),
        Math.max(...corners.map(({ y }) => y)),
      ],
      sampleType: 'uint16',
      noData: { kind: 'none' },
      resampling: 'nearest',
    },
    alignment: 'exact',
    outputNoData: { kind: 'nan' },
    minimumValidWeight: 0.5,
    limits: {
      maxTilePixels: 65_536,
      maxOutputBytes: 1_024 * 1_024,
      maxWorkingBytes: 2_048 * 1_024,
    },
  }
}
