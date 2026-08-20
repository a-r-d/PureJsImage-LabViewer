import type {
  DatasetDescriptor,
  DerivedDisplayTile,
  DerivedRasterRuntimeInputV1,
  DisplayMapping,
  DisplayStatistics,
  DisplayTile,
  OpenedDatasetDescriptor,
  RasterPointSample,
  SpatialReference,
  StructuredRpcError,
} from '@pji-workbench/contracts'
import {
  CRS_EPSG_4326,
  canTransformCrs,
  type DerivedGeoRasterLayer,
  displayMappingFromStyle,
  crsKey as domainCrsKey,
  type GeoComparisonState,
  type GeoLayer,
  type GeoMapGeometry,
  type GeoMapRoi,
  type GeoProjectViewport,
  type GeoRasterLayer,
  type GeoRasterSource,
  sameCrs as sameCrsReference,
  scalarNodata,
  transformGeoMapGeometry,
  transformMapPoint,
} from '@pji-workbench/domain-geo'
import { ImagingRpcError, type ImagingWorkerClient } from '@pji-workbench/imaging'
import {
  type Bounds,
  type Camera,
  type CoordinateSpaceAdapter,
  cameraLimitsForWorldLayer,
  createWorldSpaceAffineAdapter,
  fitCameraToBounds,
  fitCameraToLayer,
  type Point,
  panCameraInSpace,
  pixelToWorldForOverview,
  planMultiLayerTiles,
  resizeCamera,
  type Size,
  selectOverviewLevel,
  type TileLayerPlanInput,
  visibleWorldBounds,
  zoomCameraAtScreenPointInSpace,
} from '@pji-workbench/viewport'
import { useEffect, useRef, useState } from 'react'

import { DisplayTileCache, type DisplayTileCacheDiagnostics } from './display-tile-cache.js'

const TILE_SIZE = 256
const PREFETCH_TILES = 1
const DISPLAY_CACHE_BYTES = 64 * 1_024 * 1_024
const DISPLAY_CACHE_TILES = 256
const SAMPLE_DELAY_MS = 100
const RETRY_DELAYS_MS = [250, 1_000, 4_000] as const

export interface GeoViewportPointer {
  readonly sourceId: string
  readonly datasetHandleId: string
  readonly layerId: string
  readonly pixel: Point
  readonly sourceMapCoordinate: Point
  readonly projectMapCoordinate: Point
  readonly nodata: boolean
  readonly bands: readonly Readonly<{
    name: string
    unit?: string
    value: number | undefined
    nodata: boolean
  }>[]
}

export interface GeoViewportStatus {
  readonly message: string
  readonly pending: number
  readonly transientFailures: number
  readonly permanentFailures: number
  readonly retryableFailures: number
  readonly errors: readonly string[]
  readonly cache: DisplayTileCacheDiagnostics
}

export interface GeoViewportProps {
  readonly client: ImagingWorkerClient
  readonly rasters: readonly OpenedDatasetDescriptor[]
  readonly sources: readonly GeoRasterSource[]
  readonly layers: readonly GeoLayer[]
  readonly comparison: GeoComparisonState
  readonly selectedLayerId?: string
  readonly onComparisonChange: (comparison: GeoComparisonState) => void
  readonly onPointer: (sample: GeoViewportPointer | undefined) => void
  readonly onOverview: (sourceId: string, level: number) => void
  readonly onSettled: (settled: boolean) => void
  readonly onStatus?: (status: GeoViewportStatus) => void
  readonly onViewBbox?: (bbox: readonly [number, number, number, number] | undefined) => void
  readonly rois?: readonly GeoMapRoi[]
  readonly selectedRoiId?: string
  readonly drawingTool?: 'pan' | 'point' | 'line' | 'rectangle' | 'polygon'
  readonly onDrawGeometry?: (geometry: GeoMapGeometry) => void
  readonly onExportFrame?: (render: ((includeRoiOverlay: boolean) => void) | undefined) => void
  readonly projectViewport?: GeoProjectViewport
  readonly onProjectViewport?: (viewport: GeoProjectViewport) => void
  readonly onViewportProposal?: (handler: GeoViewportProposalHandler | undefined) => void
}

export type GeoViewportProposalResult = Readonly<Record<string, boolean | number>>

export type GeoViewportProposalHandler = (input: unknown) => GeoViewportProposalResult

interface CachedTile {
  readonly canvas: HTMLCanvasElement
  readonly layerId: string
  readonly region: Readonly<{ x: number; y: number; width: number; height: number }>
  readonly width: number
  readonly height: number
  readonly adapter: CoordinateSpaceAdapter
}

interface LayerContext {
  readonly layer: GeoLayer
  readonly source?: GeoRasterSource
  readonly raster?: OpenedDatasetDescriptor
  readonly derivedInputs?: readonly DerivedRasterRuntimeInputV1[]
  readonly overview: number
  readonly adapter: CoordinateSpaceAdapter
  readonly mapping: DisplayMapping
  readonly sourceRevision: string
  readonly styleRevision: string
  readonly statisticsRevision: string
}

interface FailedTile {
  readonly tileId: string
  readonly layerId: string
  readonly region: Readonly<{ x: number; y: number; width: number; height: number }>
  readonly adapter: CoordinateSpaceAdapter
  readonly transient: boolean
  readonly message: string
}

type TileState =
  | Readonly<{ kind: 'pending' }>
  | Readonly<{ kind: 'ready' }>
  | Readonly<{ kind: 'failed-transient'; failure: FailedTile }>
  | Readonly<{ kind: 'failed-permanent'; failure: FailedTile }>
  | Readonly<{ kind: 'superseded' }>

class CanvasGeoRenderer {
  readonly #canvas: HTMLCanvasElement
  #context: CanvasRenderingContext2D
  readonly #cache = new DisplayTileCache<CachedTile>(DISPLAY_CACHE_BYTES, DISPLAY_CACHE_TILES)
  #viewport: Size = { width: 1, height: 1 }
  #ratio = 1

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: false })
    if (context === null) throw new Error('A 2D canvas context is required for the geo viewport')
    this.#canvas = canvas
    this.#context = context
  }

  configure(viewport: Size): void {
    this.#viewport = viewport
    this.#ratio = Math.min(2, window.devicePixelRatio || 1)
    this.#canvas.width = Math.max(1, Math.round(viewport.width * this.#ratio))
    this.#canvas.height = Math.max(1, Math.round(viewport.height * this.#ratio))
    this.#canvas.style.width = `${viewport.width}px`
    this.#canvas.style.height = `${viewport.height}px`
    this.#context = this.#canvas.getContext('2d', { alpha: false }) ?? this.#context
  }

  has(tileId: string): boolean {
    return this.#cache.has(tileId)
  }

  touch(tileId: string): void {
    this.#cache.get(tileId)
  }

  upload(
    layerId: string,
    tile: DisplayTile | DerivedDisplayTile,
    adapter: CoordinateSpaceAdapter,
    protectedKeys: ReadonlySet<string>,
  ): void {
    const canvas = document.createElement('canvas')
    canvas.width = tile.width
    canvas.height = tile.height
    const context = canvas.getContext('2d')
    if (context === null) return
    const pixels = new Uint8ClampedArray(tile.rgba.length)
    pixels.set(tile.rgba)
    context.putImageData(new ImageData(pixels, tile.width, tile.height), 0, 0)
    const cached: CachedTile = {
      canvas,
      layerId,
      region: tile.region,
      width: tile.width,
      height: tile.height,
      adapter,
    }
    this.#cache.set(
      tile.tileId,
      {
        value: cached,
        bytes: tile.width * tile.height * 4,
        dispose: ({ canvas: disposable }) => {
          disposable.width = 0
          disposable.height = 0
        },
      },
      protectedKeys,
    )
  }

  render(
    camera: Camera,
    projectAdapter: CoordinateSpaceAdapter,
    layers: readonly GeoLayer[],
    sources: readonly GeoRasterSource[],
    comparison: GeoComparisonState,
    blinkPhase: 0 | 1,
    required: ReadonlySet<string>,
    failures: readonly FailedTile[],
    rois: readonly GeoMapRoi[],
    selectedRoiId: string | undefined,
  ): void {
    const context = this.#context
    context.setTransform(this.#ratio, 0, 0, this.#ratio, 0, 0)
    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-over'
    context.fillStyle = '#050709'
    context.fillRect(0, 0, this.#viewport.width, this.#viewport.height)
    const ordered = orderedDisplayLayers(layers)
    if (comparison.mode === 'swipe') {
      this.#drawLayers(
        camera,
        projectAdapter,
        ordered.filter(({ id }) => id === comparison.leftLayerId),
        required,
        { x: 0, width: this.#viewport.width * comparison.swipePosition },
      )
      this.#drawLayers(
        camera,
        projectAdapter,
        ordered.filter(({ id }) => id === comparison.rightLayerId),
        required,
        {
          x: this.#viewport.width * comparison.swipePosition,
          width: this.#viewport.width * (1 - comparison.swipePosition),
        },
      )
      this.#drawSwipeAdornment(comparison, layers, sources)
    } else if (comparison.mode === 'blink') {
      const active = blinkPhase === 0 ? comparison.firstLayerId : comparison.secondLayerId
      this.#drawLayers(
        camera,
        projectAdapter,
        ordered.filter(({ id }) => id === active),
        required,
      )
      this.#drawLabel(labelForLayer(active, layers, sources), 12, 12, 'left')
    } else {
      const visibleLayers =
        comparison.mode === 'overlay'
          ? ordered.filter(({ id }) => comparison.overlayLayerIds.includes(id))
          : ordered
      this.#drawLayers(camera, projectAdapter, visibleLayers, required)
    }
    this.#drawFailures(camera, projectAdapter, failures)
    this.#drawRois(camera, projectAdapter, rois, selectedRoiId, sources)
  }

  diagnostics(): DisplayTileCacheDiagnostics {
    return this.#cache.diagnostics()
  }

  dispose(): void {
    this.#cache.clear()
  }

  #drawLayers(
    camera: Camera,
    projectAdapter: CoordinateSpaceAdapter,
    layers: readonly GeoLayer[],
    required: ReadonlySet<string>,
    clip?: Readonly<{ x: number; width: number }>,
  ): void {
    this.#context.save()
    if (clip !== undefined) {
      this.#context.beginPath()
      this.#context.rect(clip.x, 0, clip.width, this.#viewport.height)
      this.#context.clip()
    }
    for (const layer of layers) {
      for (const tileId of required) {
        const cached = this.#cache.peek(tileId)
        if (cached?.layerId !== layer.id) continue
        this.#drawTile(cached, projectAdapter, camera, layer)
      }
    }
    this.#context.restore()
  }

  #drawTile(
    cached: CachedTile,
    adapter: CoordinateSpaceAdapter,
    camera: Camera,
    layer: GeoLayer,
  ): void {
    const { region } = cached
    const origin = adapter.worldToScreen(
      cached.adapter.pixelToWorld({ x: region.x, y: region.y }),
      camera,
      this.#viewport,
    )
    const xAxis = adapter.worldToScreen(
      cached.adapter.pixelToWorld({ x: region.x + cached.width, y: region.y }),
      camera,
      this.#viewport,
    )
    const yAxis = adapter.worldToScreen(
      cached.adapter.pixelToWorld({ x: region.x, y: region.y + cached.height }),
      camera,
      this.#viewport,
    )
    const ratio = this.#ratio
    this.#context.save()
    this.#context.globalAlpha = layer.opacity
    this.#context.globalCompositeOperation = canvasCompositeOperation(layer.blendMode)
    this.#context.imageSmoothingEnabled = canvasSmoothingEnabled(layer.style.resample)
    this.#context.setTransform(
      (ratio * (xAxis.x - origin.x)) / cached.canvas.width,
      (ratio * (xAxis.y - origin.y)) / cached.canvas.width,
      (ratio * (yAxis.x - origin.x)) / cached.canvas.height,
      (ratio * (yAxis.y - origin.y)) / cached.canvas.height,
      ratio * origin.x,
      ratio * origin.y,
    )
    this.#context.drawImage(cached.canvas, 0, 0)
    this.#context.restore()
  }

  #drawFailures(
    camera: Camera,
    adapter: CoordinateSpaceAdapter,
    failures: readonly FailedTile[],
  ): void {
    for (const failure of failures) {
      const origin = adapter.worldToScreen(
        failure.adapter.pixelToWorld({ x: failure.region.x, y: failure.region.y }),
        camera,
        this.#viewport,
      )
      const opposite = adapter.worldToScreen(
        failure.adapter.pixelToWorld({
          x: failure.region.x + failure.region.width,
          y: failure.region.y + failure.region.height,
        }),
        camera,
        this.#viewport,
      )
      this.#context.save()
      this.#context.setTransform(this.#ratio, 0, 0, this.#ratio, 0, 0)
      this.#context.fillStyle = failure.transient ? '#ffb02033' : '#ff4d5e44'
      this.#context.strokeStyle = failure.transient ? '#ffb020' : '#ff4d5e'
      this.#context.lineWidth = 2
      const x = Math.min(origin.x, opposite.x)
      const y = Math.min(origin.y, opposite.y)
      const width = Math.abs(opposite.x - origin.x)
      const height = Math.abs(opposite.y - origin.y)
      this.#context.fillRect(x, y, width, height)
      this.#context.strokeRect(x, y, width, height)
      this.#context.restore()
    }
  }

  #drawRois(
    camera: Camera,
    adapter: CoordinateSpaceAdapter,
    rois: readonly GeoMapRoi[],
    selectedRoiId: string | undefined,
    sources: readonly GeoRasterSource[],
  ): void {
    const projectCrs = sources[0]?.spatialReference.crs
    if (projectCrs === undefined) return
    for (const roi of rois) {
      let geometry = roi.geometry
      try {
        geometry = sameCrsReference(roi.crs, projectCrs)
          ? geometry
          : transformGeoMapGeometry(geometry, roi.crs, projectCrs)
      } catch {
        continue
      }
      const selected = roi.id === selectedRoiId
      this.#context.save()
      this.#context.setTransform(this.#ratio, 0, 0, this.#ratio, 0, 0)
      this.#context.strokeStyle = selected ? '#ffd166' : '#39d0ff'
      this.#context.fillStyle = selected ? '#ffd16633' : '#39d0ff22'
      this.#context.lineWidth = selected ? 3 : 2
      this.#context.beginPath()
      traceGeometry(this.#context, geometry, (point) =>
        adapter.worldToScreen(point, camera, this.#viewport),
      )
      this.#context.fill('evenodd')
      this.#context.stroke()
      this.#context.restore()
    }
  }

  #drawSwipeAdornment(
    comparison: Extract<GeoComparisonState, { mode: 'swipe' }>,
    layers: readonly GeoLayer[],
    sources: readonly GeoRasterSource[],
  ): void {
    const x = this.#viewport.width * comparison.swipePosition
    this.#context.save()
    this.#context.setTransform(this.#ratio, 0, 0, this.#ratio, 0, 0)
    this.#context.strokeStyle = '#f7fbff'
    this.#context.lineWidth = 2
    this.#context.beginPath()
    this.#context.moveTo(x, 0)
    this.#context.lineTo(x, this.#viewport.height)
    this.#context.stroke()
    this.#context.restore()
    this.#drawLabel(labelForLayer(comparison.leftLayerId, layers, sources), 12, 12, 'left')
    this.#drawLabel(
      labelForLayer(comparison.rightLayerId, layers, sources),
      this.#viewport.width - 12,
      12,
      'right',
    )
  }

  #drawLabel(label: string, x: number, y: number, align: CanvasTextAlign): void {
    this.#context.save()
    this.#context.setTransform(this.#ratio, 0, 0, this.#ratio, 0, 0)
    this.#context.font = '12px system-ui, sans-serif'
    this.#context.textAlign = align
    this.#context.textBaseline = 'top'
    const width = this.#context.measureText(label).width + 12
    const left = align === 'right' ? x - width : x
    this.#context.fillStyle = '#071018cc'
    this.#context.fillRect(left, y, width, 24)
    this.#context.fillStyle = '#f7fbff'
    this.#context.fillText(label, align === 'right' ? x - 6 : x + 6, y + 5)
    this.#context.restore()
  }
}

export function GeoViewport({
  client,
  rasters,
  sources,
  layers,
  comparison,
  selectedLayerId,
  onComparisonChange,
  onPointer,
  onOverview,
  onSettled,
  onStatus,
  onViewBbox,
  rois = [],
  selectedRoiId,
  drawingTool = 'pan',
  onDrawGeometry,
  onExportFrame,
  projectViewport,
  onProjectViewport,
  onViewportProposal,
}: GeoViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layersRef = useRef(layers)
  const rastersRef = useRef(rasters)
  const sourcesRef = useRef(sources)
  const comparisonRef = useRef(comparison)
  const selectedLayerRef = useRef(selectedLayerId)
  const onViewBboxRef = useRef(onViewBbox)
  const onStatusRef = useRef(onStatus)
  const onComparisonChangeRef = useRef(onComparisonChange)
  const roisRef = useRef(rois)
  const selectedRoiRef = useRef(selectedRoiId)
  const drawingToolRef = useRef(drawingTool)
  const onDrawGeometryRef = useRef(onDrawGeometry)
  const onExportFrameRef = useRef(onExportFrame)
  const projectViewportRef = useRef(projectViewport)
  const onProjectViewportRef = useRef(onProjectViewport)
  const onViewportProposalRef = useRef(onViewportProposal)
  layersRef.current = layers
  rastersRef.current = rasters
  sourcesRef.current = sources
  comparisonRef.current = comparison
  selectedLayerRef.current = selectedLayerId
  onViewBboxRef.current = onViewBbox
  onStatusRef.current = onStatus
  onComparisonChangeRef.current = onComparisonChange
  roisRef.current = rois
  selectedRoiRef.current = selectedRoiId
  drawingToolRef.current = drawingTool
  onDrawGeometryRef.current = onDrawGeometry
  onExportFrameRef.current = onExportFrame
  projectViewportRef.current = projectViewport
  onProjectViewportRef.current = onProjectViewport
  onViewportProposalRef.current = onViewportProposal
  const scheduleRef = useRef<() => void>(() => undefined)
  const retryFailedRef = useRef<() => void>(() => undefined)
  const [status, setStatus] = useState<GeoViewportStatus | undefined>()
  const rastersIdentity = rasters
    .map((raster) => `${raster.handleId}:${raster.generation}`)
    .join('|')
  const sceneKey = JSON.stringify({
    rastersIdentity,
    sources: sources.map(({ id, locator }) => [id, locator]),
    layers,
    comparison,
    selectedLayerId,
    rois,
    selectedRoiId,
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies: sceneKey is the revision signal; refs hold the latest scene.
  useEffect(() => scheduleRef.current(), [sceneKey])

  // biome-ignore lint/correctness/useExhaustiveDependencies: raster handle identity remounts the runtime while scene revisions flow through refs.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const primary = rasters[0]
    if (primary === undefined) return
    const spatial = primary.dataset.spatialReference
    if (spatial?.pixelToModel === undefined) return
    const affine = spatial.pixelToModel
    const full = rasterSize(primary.dataset)
    const fullAdapter = createWorldSpaceAffineAdapter({
      pixelToWorld: affine,
      ...(spatial.modelToPixel === undefined ? {} : { worldToPixel: spatial.modelToPixel }),
      width: full.width,
      height: full.height,
      pixelInterpretation: spatial.pixelInterpretation,
    })
    const sharedWorld = unionWorldBounds(
      rasters.flatMap((raster) => {
        const rasterAdapter = worldAdapterForDataset(raster)
        return rasterAdapter === undefined || !sameCrs(spatial, raster.dataset.spatialReference)
          ? []
          : [rasterAdapter.worldBounds()]
      }),
    )
    const cameraAdapter = withWorldBounds(fullAdapter, sharedWorld)
    const renderer = new CanvasGeoRenderer(canvas)
    let viewport: Size = { width: 1, height: 1 }
    let limits = cameraLimitsForWorldLayer(
      cameraAdapter.worldBounds(),
      cameraAdapter.pixelBounds(),
      viewport,
    )
    let camera: Camera = fitCameraToLayer(cameraAdapter, viewport, 24, limits)
    if (projectViewportRef.current?.kind === 'map') {
      camera = {
        center: {
          x: projectViewportRef.current.centerX,
          y: projectViewportRef.current.centerY,
        },
        zoom: projectViewportRef.current.zoom,
      }
    }
    let fitted = false
    let frameRequest = 0
    let required = new Set<string>()
    let comparisonState = comparisonRef.current
    let blinkPhase: 0 | 1 = 0
    let blinkTimer: number | undefined
    let blinkTimerKey: string | undefined
    let samplingTimer: number | undefined
    let samplingController: AbortController | undefined
    let dragPoint: Point | undefined
    let swipeDragging = false
    let drawingPoints: Point[] = []
    const pending = new Map<string, AbortController>()
    const tileStates = new Map<string, TileState>()
    const retryCounts = new Map<string, number>()
    const statistics = new Map<string, DisplayStatistics>()
    const statisticsPending = new Map<string, AbortController>()
    const statisticsErrors = new Map<string, string>()
    const overviewBySource = new Map<string, number>()

    const failures = (): FailedTile[] =>
      [...required].flatMap((tileId) => {
        const state = tileStates.get(tileId)
        return state?.kind === 'failed-transient' || state?.kind === 'failed-permanent'
          ? [state.failure]
          : []
      })

    const draw = (): void => {
      cancelAnimationFrame(frameRequest)
      frameRequest = requestAnimationFrame(() => {
        renderer.render(
          camera,
          cameraAdapter,
          layersRef.current,
          sourcesRef.current,
          comparisonState,
          blinkPhase,
          required,
          failures(),
          roisRef.current,
          selectedRoiRef.current,
        )
      })
    }

    const renderExportFrame = (includeRoiOverlay: boolean): void => {
      cancelAnimationFrame(frameRequest)
      renderer.render(
        camera,
        cameraAdapter,
        layersRef.current,
        sourcesRef.current,
        comparisonState,
        blinkPhase,
        required,
        failures(),
        includeRoiOverlay ? roisRef.current : [],
        includeRoiOverlay ? selectedRoiRef.current : undefined,
      )
    }
    onExportFrameRef.current?.(renderExportFrame)

    const handleViewportProposal: GeoViewportProposalHandler = (value) => {
      const record = unknownRecord(value)
      const input = unknownRecord(record['input'])
      const kind = record['kind']
      if (kind === 'geo.viewport.fit_source' || kind === 'geo.viewport.fit_layer') {
        const sourceId =
          kind === 'geo.viewport.fit_source'
            ? input['sourceId']
            : layersRef.current.find(({ id }) => id === input['layerId'])?.sourceId
        const raster = rastersRef.current.find(
          ({ sourceId: candidate }) => String(candidate) === String(sourceId),
        )
        const adapter = raster === undefined ? undefined : worldAdapterForDataset(raster)
        if (adapter === undefined)
          throw new Error('The requested raster is not bound to the viewport.')
        camera = fitCameraToLayer(adapter, viewport, 24, limits)
      } else if (kind === 'geo.viewport.fit_bounds') {
        const bounds = unknownRecord(input['bounds'] ?? input)
        const minX = finiteUnknown(bounds['minX'], 'minimum x')
        const minY = finiteUnknown(bounds['minY'], 'minimum y')
        const maxX = finiteUnknown(bounds['maxX'], 'maximum x')
        const maxY = finiteUnknown(bounds['maxY'], 'maximum y')
        if (maxX <= minX || maxY <= minY) throw new Error('Viewport bounds are invalid.')
        camera = fitCameraToBounds(
          { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
          viewport,
          24,
          limits,
        )
      } else if (kind !== 'geo.viewport.propose') {
        throw new Error('This viewport proposal is unsupported.')
      }
      scheduleRef.current()
      return {
        updated: true,
        centerX: camera.center.x,
        centerY: camera.center.y,
        zoom: camera.zoom,
      }
    }
    onViewportProposalRef.current?.(handleViewportProposal)

    const reportStatus = (): void => {
      const states = [...required].map((tileId) => tileStates.get(tileId))
      const pendingCount = states.filter(
        (state) => state?.kind === 'pending' || state === undefined,
      ).length
      const transientFailures = states.filter((state) => state?.kind === 'failed-transient').length
      const permanentFailures = states.filter((state) => state?.kind === 'failed-permanent').length
      const statsFailures = statisticsErrors.size
      const settled = pendingCount === 0 && statisticsPending.size === 0
      const problemCount = transientFailures + permanentFailures + statsFailures
      const loadingCount = pendingCount + statisticsPending.size
      const next: GeoViewportStatus = {
        message:
          problemCount > 0
            ? `${problemCount} display problem${problemCount === 1 ? '' : 's'}`
            : loadingCount > 0
              ? `Loading ${loadingCount} display item${loadingCount === 1 ? '' : 's'}`
              : 'Viewport ready',
        pending: loadingCount,
        transientFailures,
        permanentFailures: permanentFailures + statsFailures,
        retryableFailures: transientFailures + statsFailures,
        errors: [
          ...new Set([...failures().map(({ message }) => message), ...statisticsErrors.values()]),
        ],
        cache: renderer.diagnostics(),
      }
      setStatus(next)
      onStatusRef.current?.(next)
      onSettled(settled)
    }

    const ensureStatistics = (
      context: Omit<LayerContext, 'mapping' | 'statisticsRevision'>,
    ): void => {
      if (context.layer.kind !== 'raster') return
      const source = requiredValue(context.source, 'statistics source')
      const raster = requiredValue(context.raster, 'statistics raster')
      const indices = mappedComponents(context.layer)
      const key = statisticsKey(context.layer, source, raster, indices)
      if (statistics.has(key) || statisticsPending.has(key) || statisticsErrors.has(key)) return
      const controller = new AbortController()
      statisticsPending.set(key, controller)
      reportStatus()
      const nodata = scalarNodata(raster.dataset.spatialReference)
      void client
        .requestDisplayStatistics(
          {
            datasetHandleId: raster.handleId,
            generation: raster.generation,
            sourceIdentity: source.id,
            sourceRevision: context.sourceRevision,
            componentIndices: indices,
            displayAxes: raster.selection.displayAxes,
            fixedIndices: raster.selection.fixedIndices,
            resolutionPolicy: { kind: 'reduced-overview' },
            nodataPolicy: { kind: 'exclude', ...(nodata === undefined ? {} : { value: nodata }) },
            sampleBudget: { maxSamples: 65_536, maxBytes: 1_048_576, maxTiles: 16 },
            percentilePolicy: {
              low: context.layer.style.percentileLow ?? 2,
              high: context.layer.style.percentileHigh ?? 98,
            },
            scaleOffsetPolicy: {
              kind: context.layer.style.valueMode ?? 'raw',
              components: indices.map((index) => bandTransform(source, index)),
            },
          },
          controller.signal,
        )
        .then((value) => {
          if (controller.signal.aborted) return
          statistics.set(key, value)
          statisticsErrors.delete(key)
        })
        .catch((error: unknown) => {
          if (!isAbort(error, controller)) statisticsErrors.set(key, errorMessage(error))
        })
        .finally(() => {
          statisticsPending.delete(key)
          scheduleRef.current()
          reportStatus()
        })
    }

    const contextsForScene = (): Map<string, LayerContext> => {
      const contexts = new Map<string, LayerContext>()
      for (const layer of layersRef.current) {
        if (!layer.visible) continue
        if (layer.kind === 'derived') {
          const target = layer.recipe.targetGrid
          if (domainCrsKey(spatial.crs) !== target.crs) continue
          const derivedInputs = runtimeInputsForDerived(
            layer,
            layersRef.current,
            sourcesRef.current,
            rastersRef.current,
          )
          if (derivedInputs === undefined) continue
          const adapter = createWorldSpaceAffineAdapter({
            pixelToWorld: target.affine,
            width: target.width,
            height: target.height,
            pixelInterpretation:
              target.pixelInterpretation === 'point' ? 'pixel-is-point' : 'pixel-is-area',
          })
          const styleRevision = displayStyleRevision(layer)
          const mapped = mappingForDerivedLayer(layer)
          contexts.set(layer.id, {
            layer,
            derivedInputs,
            overview: 0,
            adapter,
            mapping: mapped.mapping,
            sourceRevision: stableHash(
              JSON.stringify({ recipe: layer.recipe, inputs: derivedInputs }),
            ),
            styleRevision,
            statisticsRevision: mapped.statisticsRevision,
          })
          continue
        }
        const raster = rastersRef.current.find(
          (candidate) => String(candidate.sourceId) === String(layer.sourceId),
        )
        const source = sourcesRef.current.find(({ id }) => id === layer.sourceId)
        if (raster === undefined || source === undefined) continue
        const rasterSpatial = raster.dataset.spatialReference
        const rasterAffine = rasterSpatial?.pixelToModel
        if (
          rasterSpatial === undefined ||
          rasterAffine === undefined ||
          !sameCrs(spatial, rasterSpatial)
        )
          continue
        const rasterFull = rasterSize(raster.dataset)
        const rasterWorld = worldAdapterForDataset(raster)
        if (rasterWorld === undefined) continue
        const overview = selectOverviewLevel(
          overviewSizes(raster.dataset, rasterFull),
          camera,
          viewport,
          rasterWorld.worldBounds(),
        )
        if (overviewBySource.get(source.id) !== overview) {
          overviewBySource.set(source.id, overview)
          onOverview(source.id, overview)
        }
        const layerAdapter = adapterForOverview(
          rasterSpatial,
          rasterAffine,
          rasterFull,
          raster.dataset,
          overview,
        )
        const sourceRevision = revisionForSource(source)
        const styleRevision = displayStyleRevision(layer)
        const base = {
          layer,
          source,
          raster,
          overview,
          adapter: layerAdapter,
          sourceRevision,
          styleRevision,
        }
        const indices = mappedComponents(layer)
        const stats = statistics.get(statisticsKey(layer, source, raster, indices))
        const manual = layer.style.minimum !== undefined && layer.style.maximum !== undefined
        if ((layer.style.rangeMode ?? 'stable') === 'stable' && !manual && stats === undefined) {
          ensureStatistics(base)
          continue
        }
        const { mapping, statisticsRevision } = mappingForLayer(layer, source, raster, stats)
        contexts.set(layer.id, { ...base, mapping, statisticsRevision })
      }
      return contexts
    }

    const requestTile = (
      context: LayerContext,
      candidate: Readonly<{
        x: number
        y: number
        width: number
        height: number
        priority: 'visible' | 'near-visible' | 'background'
      }>,
      tileId: string,
    ): void => {
      const controller = new AbortController()
      pending.set(tileId, controller)
      tileStates.set(tileId, { kind: 'pending' })
      reportStatus()
      const tileRequest =
        context.layer.kind === 'derived'
          ? client.requestDerivedDisplayTile(
              {
                tileId,
                layerId: context.layer.id,
                recipe: context.layer.recipe,
                inputs: context.derivedInputs ?? [],
                styleRevision: context.styleRevision,
                statisticsRevision: context.statisticsRevision,
                mapping: context.mapping,
                region: {
                  x: candidate.x,
                  y: candidate.y,
                  width: candidate.width,
                  height: candidate.height,
                },
                priority: candidate.priority,
              },
              controller.signal,
            )
          : client.requestDisplayTile(
              {
                tileId,
                datasetHandleId: requiredValue(context.raster, 'source raster').handleId,
                generation: requiredValue(context.raster, 'source raster').generation,
                sourceIdentity: requiredValue(context.source, 'source').id,
                sourceRevision: context.sourceRevision,
                layerId: context.layer.id,
                styleRevision: context.styleRevision,
                statisticsRevision: context.statisticsRevision,
                displayAxes: requiredValue(context.raster, 'source raster').selection.displayAxes,
                fixedIndices: requiredValue(context.raster, 'source raster').selection.fixedIndices,
                resolutionLevel: context.overview,
                component: context.mapping.bands?.gray ?? context.mapping.bands?.red ?? 0,
                mapping: context.mapping,
                region: {
                  x: candidate.x,
                  y: candidate.y,
                  width: candidate.width,
                  height: candidate.height,
                },
                priority: candidate.priority,
              },
              controller.signal,
            )
      void tileRequest
        .then((tile) => {
          if (controller.signal.aborted || !required.has(tileId) || tile.tileId !== tileId) return
          renderer.upload(context.layer.id, tile, context.adapter, required)
          tileStates.set(tileId, { kind: 'ready' })
          retryCounts.delete(tileId)
          draw()
        })
        .catch((error: unknown) => {
          if (isAbort(error, controller) || !required.has(tileId)) return
          const transient = isTransient(error)
          const failure: FailedTile = {
            tileId,
            layerId: context.layer.id,
            region: {
              x: candidate.x,
              y: candidate.y,
              width: candidate.width,
              height: candidate.height,
            },
            adapter: context.adapter,
            transient,
            message: errorMessage(error),
          }
          tileStates.set(tileId, {
            kind: transient ? 'failed-transient' : 'failed-permanent',
            failure,
          })
          draw()
          const attempt = retryCounts.get(tileId) ?? 0
          const delay = RETRY_DELAYS_MS[attempt]
          if (transient && delay !== undefined) {
            retryCounts.set(tileId, attempt + 1)
            window.setTimeout(() => {
              if (!required.has(tileId)) return
              tileStates.delete(tileId)
              scheduleRef.current()
            }, delay)
          }
        })
        .finally(() => {
          pending.delete(tileId)
          reportStatus()
        })
    }

    const emitViewBbox = (): void => {
      const reportBbox = onViewBboxRef.current
      if (reportBbox === undefined) return
      const crs = spatial.crs
      if (crs === undefined || !canTransformCrs(crs, CRS_EPSG_4326)) {
        reportBbox(undefined)
        return
      }
      const visible = visibleWorldBounds(camera, viewport, cameraAdapter)
      try {
        const corners = [
          { x: visible.x, y: visible.y },
          { x: visible.x + visible.width, y: visible.y },
          { x: visible.x + visible.width, y: visible.y + visible.height },
          { x: visible.x, y: visible.y + visible.height },
        ].map((point) => transformMapPoint(point, crs, CRS_EPSG_4326))
        const xs = corners.map(({ x }) => x)
        const ys = corners.map(({ y }) => y)
        reportBbox([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
      } catch {
        reportBbox(undefined)
      }
    }

    const syncBlinkTimer = (): void => {
      const nextKey =
        comparisonState.mode === 'blink' && !document.hidden
          ? `${comparisonState.firstLayerId}:${comparisonState.secondLayerId}:${comparisonState.intervalMilliseconds}`
          : undefined
      if (nextKey === blinkTimerKey && (nextKey === undefined || blinkTimer !== undefined)) return
      if (blinkTimer !== undefined) window.clearInterval(blinkTimer)
      blinkTimer = undefined
      blinkTimerKey = nextKey
      if (comparisonState.mode !== 'blink' || nextKey === undefined) return
      blinkTimer = window.setInterval(() => {
        blinkPhase = blinkPhase === 0 ? 1 : 0
        draw()
      }, comparisonState.intervalMilliseconds)
    }

    const scheduleTiles = (): void => {
      onProjectViewportRef.current?.({
        kind: 'map',
        centerX: camera.center.x,
        centerY: camera.center.y,
        zoom: camera.zoom,
      })
      comparisonState = comparisonRef.current
      syncBlinkTimer()
      const visible = visibleWorldBounds(camera, viewport, cameraAdapter)
      const contexts = contextsForScene()
      const planInputs: TileLayerPlanInput[] = [...contexts.values()].map((context) => ({
        layerId: context.layer.id,
        sourceId: context.layer.sourceId ?? `derived:${context.layer.id}`,
        visible: true,
        adapter: context.adapter,
      }))
      const plan = planMultiLayerTiles(planInputs, visible, TILE_SIZE, PREFETCH_TILES)
      const nextRequired = new Set<string>()
      const requests: Array<
        readonly [LayerContext, (typeof plan.layers)[number]['regions'][number], string]
      > = []
      for (const layerPlan of plan.layers) {
        const context = contexts.get(layerPlan.layerId)
        if (context === undefined) continue
        for (const candidate of layerPlan.regions) {
          const tileId = displayTileId(context, candidate)
          nextRequired.add(tileId)
          if (renderer.has(tileId)) {
            renderer.touch(tileId)
            tileStates.set(tileId, { kind: 'ready' })
          } else if (
            !pending.has(tileId) &&
            tileStates.get(tileId)?.kind !== 'failed-permanent' &&
            tileStates.get(tileId)?.kind !== 'failed-transient'
          )
            requests.push([context, candidate, tileId])
        }
      }
      for (const tileId of required) {
        if (nextRequired.has(tileId)) continue
        pending.get(tileId)?.abort()
        tileStates.set(tileId, { kind: 'superseded' })
      }
      required = nextRequired
      for (const [context, candidate, tileId] of requests) requestTile(context, candidate, tileId)
      draw()
      reportStatus()
      emitViewBbox()
    }

    scheduleRef.current = scheduleTiles
    retryFailedRef.current = () => {
      for (const tileId of required) {
        if (tileStates.get(tileId)?.kind === 'failed-transient') {
          tileStates.delete(tileId)
          retryCounts.delete(tileId)
        }
      }
      statisticsErrors.clear()
      scheduleTiles()
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect
      if (box === undefined) return
      const previous = viewport
      viewport = { width: Math.max(1, box.width), height: Math.max(1, box.height) }
      renderer.configure(viewport)
      limits = cameraLimitsForWorldLayer(
        cameraAdapter.worldBounds(),
        cameraAdapter.pixelBounds(),
        viewport,
      )
      if (!fitted) {
        camera = fitCameraToLayer(cameraAdapter, viewport, 24, limits)
        fitted = viewport.width > 32 && viewport.height > 32
      } else camera = resizeCamera(camera, previous, viewport, cameraAdapter.worldBounds(), limits)
      scheduleTiles()
    })
    resizeObserver.observe(canvas.parentElement ?? canvas)

    const queuePointSample = (event: PointerEvent): void => {
      if (samplingTimer !== undefined) window.clearTimeout(samplingTimer)
      samplingController?.abort()
      const bounds = canvas.getBoundingClientRect()
      const world = cameraAdapter.screenToWorld(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        camera,
        viewport,
      )
      samplingTimer = window.setTimeout(() => {
        const layer = selectedSampleLayer(layersRef.current, selectedLayerRef.current)
        if (layer === undefined) return
        const raster = rastersRef.current.find(
          (candidate) => String(candidate.sourceId) === String(layer.sourceId),
        )
        if (raster === undefined) return
        const sourceAdapter = worldAdapterForDataset(raster)
        if (sourceAdapter === undefined) return
        const pixel = sourceAdapter.worldToPixel(world)
        const controller = new AbortController()
        samplingController = controller
        void client
          .sampleRasterPoint(
            {
              datasetHandleId: raster.handleId,
              generation: raster.generation,
              sourceIdentity: String(layer.sourceId),
              layerId: layer.id,
              displayAxes: raster.selection.displayAxes,
              fixedIndices: raster.selection.fixedIndices,
              pixel,
              projectMapCoordinate: world,
            },
            controller.signal,
          )
          .then((sample) => {
            if (!controller.signal.aborted) onPointer(toViewportPointer(layer, raster, sample))
          })
          .catch((error: unknown) => {
            if (!isAbort(error, controller)) onPointer(undefined)
          })
      }, SAMPLE_DELAY_MS)
    }

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const bounds = canvas.getBoundingClientRect()
      camera = zoomCameraAtScreenPointInSpace(
        camera,
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        event.deltaY < 0 ? 1.15 : 1 / 1.15,
        viewport,
        cameraAdapter,
        limits,
      )
      scheduleTiles()
    }
    const updateSwipe = (clientX: number): void => {
      if (comparisonState.mode !== 'swipe') return
      const bounds = canvas.getBoundingClientRect()
      const swipePosition = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width))
      comparisonState = { ...comparisonState, swipePosition }
      comparisonRef.current = comparisonState
      onComparisonChangeRef.current(comparisonState)
      draw()
    }
    const endPointerInteraction = (): void => {
      dragPoint = undefined
      swipeDragging = false
    }
    const eventWorld = (event: PointerEvent): Point => {
      const bounds = canvas.getBoundingClientRect()
      return cameraAdapter.screenToWorld(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        camera,
        viewport,
      )
    }
    const finishDrawing = (): void => {
      const tool = drawingToolRef.current
      if (tool === 'line' && drawingPoints.length >= 2) {
        onDrawGeometryRef.current?.({ kind: 'line', points: [...drawingPoints] })
        drawingPoints = []
      } else if (tool === 'polygon' && drawingPoints.length >= 3) {
        const first = drawingPoints[0]
        if (first !== undefined)
          onDrawGeometryRef.current?.({ kind: 'polygon', rings: [[...drawingPoints, first]] })
        drawingPoints = []
      }
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      const tool = drawingToolRef.current
      if (tool !== 'pan') {
        const world = eventWorld(event)
        if (tool === 'point') onDrawGeometryRef.current?.({ kind: 'point', x: world.x, y: world.y })
        else if (tool === 'rectangle') drawingPoints = [world]
        else {
          drawingPoints.push(world)
          if (event.detail >= 2) finishDrawing()
        }
        event.preventDefault()
        return
      }
      const bounds = canvas.getBoundingClientRect()
      const divider =
        comparisonState.mode === 'swipe'
          ? bounds.left + bounds.width * comparisonState.swipePosition
          : Number.NEGATIVE_INFINITY
      swipeDragging = Math.abs(event.clientX - divider) <= 12
      dragPoint = { x: event.clientX, y: event.clientY }
      canvas.setPointerCapture(event.pointerId)
      if (swipeDragging) updateSwipe(event.clientX)
    }
    const onPointerMove = (event: PointerEvent): void => {
      queuePointSample(event)
      if (drawingToolRef.current !== 'pan') return
      if (dragPoint === undefined) return
      if (swipeDragging) updateSwipe(event.clientX)
      else {
        camera = panCameraInSpace(
          camera,
          { x: event.clientX - dragPoint.x, y: event.clientY - dragPoint.y },
          viewport,
          cameraAdapter,
          limits,
        )
        dragPoint = { x: event.clientX, y: event.clientY }
        scheduleTiles()
      }
    }
    const onPointerUp = (event: PointerEvent): void => {
      if (drawingToolRef.current === 'rectangle' && drawingPoints[0] !== undefined) {
        const start = drawingPoints[0]
        const end = eventWorld(event)
        drawingPoints = []
        if (start.x !== end.x && start.y !== end.y)
          onDrawGeometryRef.current?.({
            kind: 'rectangle',
            minX: Math.min(start.x, end.x),
            minY: Math.min(start.y, end.y),
            maxX: Math.max(start.x, end.x),
            maxY: Math.max(start.y, end.y),
          })
        return
      }
      endPointerInteraction()
    }
    const onPointerLeave = (): void => {
      samplingController?.abort()
      if (samplingTimer !== undefined) window.clearTimeout(samplingTimer)
      onPointer(undefined)
    }
    const onVisibility = (): void => syncBlinkTimer()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (drawingToolRef.current !== 'pan' && (event.key === 'Enter' || event.key === 'Escape')) {
        if (event.key === 'Enter') finishDrawing()
        else drawingPoints = []
        event.preventDefault()
        return
      }
      const pan = 32
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (comparisonState.mode === 'swipe' && event.shiftKey) {
          const delta = event.key === 'ArrowLeft' ? -0.02 : 0.02
          comparisonState = {
            ...comparisonState,
            swipePosition: Math.min(1, Math.max(0, comparisonState.swipePosition + delta)),
          }
          comparisonRef.current = comparisonState
          onComparisonChangeRef.current(comparisonState)
          draw()
        } else {
          camera = panCameraInSpace(
            camera,
            { x: event.key === 'ArrowLeft' ? pan : -pan, y: 0 },
            viewport,
            cameraAdapter,
            limits,
          )
          scheduleTiles()
        }
        event.preventDefault()
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        camera = panCameraInSpace(
          camera,
          { x: 0, y: event.key === 'ArrowUp' ? pan : -pan },
          viewport,
          cameraAdapter,
          limits,
        )
        scheduleTiles()
        event.preventDefault()
      } else if (event.key === '+' || event.key === '=') {
        camera = zoomCameraAtScreenPointInSpace(
          camera,
          { x: viewport.width / 2, y: viewport.height / 2 },
          1.25,
          viewport,
          cameraAdapter,
          limits,
        )
        scheduleTiles()
        event.preventDefault()
      } else if (event.key === '-' || event.key === '_') {
        camera = zoomCameraAtScreenPointInSpace(
          camera,
          { x: viewport.width / 2, y: viewport.height / 2 },
          0.8,
          viewport,
          cameraAdapter,
          limits,
        )
        scheduleTiles()
        event.preventDefault()
      } else if (event.key === '0') {
        camera = fitCameraToLayer(cameraAdapter, viewport, 24, limits)
        scheduleTiles()
        event.preventDefault()
      } else if (event.key.toLowerCase() === 'f') {
        const layer = layersRef.current.find(({ id }) => id === selectedLayerRef.current)
        const raster = rastersRef.current.find(
          ({ sourceId }) => String(sourceId) === String(layer?.sourceId),
        )
        const selectedAdapter = raster === undefined ? undefined : worldAdapterForDataset(raster)
        if (selectedAdapter !== undefined)
          camera = fitCameraToLayer(selectedAdapter, viewport, 24, limits)
        scheduleTiles()
        event.preventDefault()
      } else if (event.key === '1') {
        const world = cameraAdapter.worldBounds()
        const pixels = cameraAdapter.pixelBounds()
        const nativeZoom = Math.min(pixels.width / world.width, pixels.height / world.height)
        camera = zoomCameraAtScreenPointInSpace(
          camera,
          { x: viewport.width / 2, y: viewport.height / 2 },
          nativeZoom / camera.zoom,
          viewport,
          cameraAdapter,
          limits,
        )
        scheduleTiles()
        event.preventDefault()
      }
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', endPointerInteraction)
    canvas.addEventListener('lostpointercapture', endPointerInteraction)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('keydown', onKeyDown)
    document.addEventListener('visibilitychange', onVisibility)
    scheduleTiles()
    return () => {
      onExportFrameRef.current?.(undefined)
      onViewportProposalRef.current?.(undefined)
      scheduleRef.current = () => undefined
      retryFailedRef.current = () => undefined
      resizeObserver.disconnect()
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', endPointerInteraction)
      canvas.removeEventListener('lostpointercapture', endPointerInteraction)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('visibilitychange', onVisibility)
      for (const controller of pending.values()) controller.abort()
      for (const controller of statisticsPending.values()) controller.abort()
      samplingController?.abort()
      if (samplingTimer !== undefined) window.clearTimeout(samplingTimer)
      if (blinkTimer !== undefined) window.clearInterval(blinkTimer)
      renderer.dispose()
      cancelAnimationFrame(frameRequest)
    }
  }, [client, rastersIdentity, onOverview, onPointer, onSettled])

  return (
    <div className="geo-viewport">
      <canvas
        aria-describedby="geo-viewport-status"
        aria-label="Geo raster viewport. Arrow keys pan, plus and minus zoom, 0 fits the project, F fits the selected layer, and 1 shows native resolution. Shift plus left or right arrow adjusts a swipe divider."
        data-comparison-mode={comparison.mode}
        data-drawing-tool={drawingTool}
        data-swipe-position={comparison.mode === 'swipe' ? comparison.swipePosition : undefined}
        ref={canvasRef}
        role="img"
        tabIndex={0}
      />
      <div
        aria-live="polite"
        className="geo-viewport-status"
        id="geo-viewport-status"
        role="status"
      >
        <span title={status?.errors.join('\n')}>{status?.message ?? 'Preparing viewport'}</span>
        {status?.errors[0] === undefined ? null : (
          <span className="geo-viewport-status__detail">{status.errors[0]}</span>
        )}
        {(status?.retryableFailures ?? 0) > 0 ? (
          <button onClick={() => retryFailedRef.current()} type="button">
            Retry failed display requests
          </button>
        ) : null}
      </div>
    </div>
  )
}

function runtimeInputsForDerived(
  layer: DerivedGeoRasterLayer,
  layers: readonly GeoLayer[],
  sources: readonly GeoRasterSource[],
  rasters: readonly OpenedDatasetDescriptor[],
): readonly DerivedRasterRuntimeInputV1[] | undefined {
  const inputs: DerivedRasterRuntimeInputV1[] = []
  for (const input of layer.recipe.inputs) {
    const sourceLayer = layers.find(
      (candidate): candidate is GeoRasterLayer =>
        candidate.kind === 'raster' && candidate.id === input.layerId,
    )
    if (sourceLayer === undefined) return undefined
    const source = sources.find(({ id }) => id === sourceLayer.sourceId)
    const raster = rasters.find(
      (candidate) => String(candidate.sourceId) === String(sourceLayer.sourceId),
    )
    const affine = source?.spatialReference.pixelToModel
    const sourceCrs = source === undefined ? undefined : domainCrsKey(source.spatialReference.crs)
    if (
      source === undefined ||
      raster === undefined ||
      affine === undefined ||
      sourceCrs === undefined
    )
      return undefined
    const corners = [
      affinePoint(affine, 0, 0),
      affinePoint(affine, source.width, 0),
      affinePoint(affine, source.width, source.height),
      affinePoint(affine, 0, source.height),
    ]
    const xs = corners.map(({ x }) => x)
    const ys = corners.map(({ y }) => y)
    const nodata = scalarNodata(source.spatialReference)
    inputs.push({
      layerId: sourceLayer.id,
      datasetHandleId: raster.handleId,
      generation: raster.generation,
      sourceIdentity: JSON.stringify({ id: source.id, locator: source.locator }),
      sourceRevision: revisionForSource(source),
      grid: {
        schemaVersion: 1,
        crs: sourceCrs,
        width: source.width,
        height: source.height,
        affine,
        pixelInterpretation:
          source.spatialReference.pixelInterpretation === 'pixel-is-point' ? 'point' : 'area',
        extent: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        sampleType: sourceRasterSampleType(raster.dataset.sampleType),
        noData: nodata === undefined ? { kind: 'none' } : { kind: 'value', value: nodata },
        resampling: 'nearest',
      },
    })
  }
  return inputs
}

function sourceRasterSampleType(
  sampleType: string,
): DerivedRasterRuntimeInputV1['grid']['sampleType'] {
  if (
    ![
      'uint8',
      'uint16',
      'uint32',
      'uint64',
      'int8',
      'int16',
      'int32',
      'float32',
      'float64',
    ].includes(sampleType)
  )
    throw new Error(`Raster sample type ${sampleType} cannot be analyzed.`)
  return sampleType as DerivedRasterRuntimeInputV1['grid']['sampleType']
}

function affinePoint(
  affine: readonly [number, number, number, number, number, number],
  column: number,
  row: number,
): Readonly<{ x: number; y: number }> {
  return {
    x: affine[0] * column + affine[1] * row + affine[2],
    y: affine[3] * column + affine[4] * row + affine[5],
  }
}

function mappingForDerivedLayer(
  layer: DerivedGeoRasterLayer,
): Readonly<{ mapping: DisplayMapping; statisticsRevision: string }> {
  const outputNoData = layer.recipe.outputNoData
  const nodata = outputNoData.kind === 'value' ? outputNoData.value : undefined
  const mapping = displayMappingFromStyle(layer.style, nodata)
  if (layer.style.minimum !== undefined && layer.style.maximum !== undefined) {
    return {
      mapping: { ...mapping, range: 'manual' },
      statisticsRevision: stableHash(`manual:${layer.style.minimum}:${layer.style.maximum}`),
    }
  }
  return {
    mapping: { ...mapping, range: 'auto' },
    statisticsRevision: 'viewport-local-exploratory',
  }
}

function requiredValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}.`)
  return value
}

function mappingForLayer(
  layer: GeoRasterLayer,
  source: GeoRasterSource,
  raster: OpenedDatasetDescriptor,
  statistics: DisplayStatistics | undefined,
): Readonly<{ mapping: DisplayMapping; statisticsRevision: string }> {
  const base = displayMappingFromStyle(layer.style, scalarNodata(raster.dataset.spatialReference))
  const indices = mappedComponents(layer)
  const transforms =
    (layer.style.valueMode ?? 'raw') === 'physical'
      ? Object.fromEntries(indices.map((index) => [String(index), bandTransform(source, index)]))
      : undefined
  const primaryTransform = transforms?.[String(indices[0] ?? 0)]
  const rawNodata = scalarNodata(raster.dataset.spatialReference)
  const nodata =
    rawNodata === undefined || primaryTransform === undefined
      ? rawNodata
      : rawNodata * primaryTransform.scale + primaryTransform.offset
  if (layer.style.minimum !== undefined && layer.style.maximum !== undefined) {
    return {
      mapping: {
        ...base,
        range: 'manual',
        minimum: layer.style.minimum,
        maximum: layer.style.maximum,
        ...(nodata === undefined ? {} : { nodata }),
        ...(transforms === undefined ? {} : { componentTransforms: transforms }),
      },
      statisticsRevision: stableHash(`manual:${layer.style.minimum}:${layer.style.maximum}`),
    }
  }
  if ((layer.style.rangeMode ?? 'stable') === 'viewport-local') {
    return {
      mapping: {
        ...base,
        range: 'auto',
        ...(nodata === undefined ? {} : { nodata }),
        ...(transforms === undefined ? {} : { componentTransforms: transforms }),
      },
      statisticsRevision: 'viewport-local-exploratory',
    }
  }
  const ranges = Object.fromEntries(
    (statistics?.components ?? []).map((component) => [
      String(component.component),
      layer.style.stretch === 'percentile'
        ? { minimum: component.percentileLow, maximum: component.percentileHigh }
        : { minimum: component.minimum, maximum: component.maximum },
    ]),
  )
  return {
    mapping: {
      ...base,
      range: 'manual',
      channelRanges: ranges,
      ...(nodata === undefined ? {} : { nodata }),
      ...(transforms === undefined ? {} : { componentTransforms: transforms }),
    },
    statisticsRevision: statistics?.statisticsRevision ?? 'statistics-pending',
  }
}

function mappedComponents(layer: GeoRasterLayer): readonly number[] {
  const mapping = layer.style.mapping
  const values =
    mapping.gray !== undefined
      ? [mapping.gray]
      : [
          mapping.red ?? 0,
          mapping.green ?? mapping.red ?? 0,
          mapping.blue ?? mapping.green ?? mapping.red ?? 0,
        ]
  return [...new Set(values)]
}

function statisticsKey(
  layer: GeoRasterLayer,
  source: GeoRasterSource,
  raster: OpenedDatasetDescriptor,
  indices: readonly number[],
): string {
  return stableHash(
    JSON.stringify({
      source: source.id,
      revision: revisionForSource(source),
      dataset: raster.dataset.id,
      indices,
      nodata: scalarNodata(raster.dataset.spatialReference),
      scaleOffset: indices.map((index) => bandTransform(source, index)),
      valueMode: layer.style.valueMode ?? 'raw',
      stretch: layer.style.stretch ?? 'minmax',
      percentileLow: layer.style.percentileLow ?? 2,
      percentileHigh: layer.style.percentileHigh ?? 98,
      algorithm: 'atlas-display-statistics-v1',
      budget: [65_536, 1_048_576, 16],
    }),
  )
}

function bandTransform(
  source: GeoRasterSource,
  index: number,
): Readonly<{ scale: number; offset: number }> {
  const band = source.bands.find((candidate) => candidate.index === index)
  return { scale: band?.scale ?? 1, offset: band?.offset ?? 0 }
}

function displayTileId(
  context: LayerContext,
  candidate: Readonly<{ x: number; y: number; width: number; height: number }>,
): string {
  return stableHash(
    JSON.stringify({
      source: context.source?.id ?? `derived:${context.layer.id}`,
      sourceRevision: context.sourceRevision,
      dataset: context.raster?.dataset.id ?? 'derived',
      handle: context.raster?.handleId ?? context.layer.id,
      generation: context.raster?.generation ?? 0,
      layer: context.layer.id,
      styleRevision: context.styleRevision,
      statisticsRevision: context.statisticsRevision,
      overview: context.overview,
      region: candidate,
    }),
  )
}

function revisionForSource(source: GeoRasterSource): string {
  return stableHash(JSON.stringify(source.locator))
}

function selectedSampleLayer(
  layers: readonly GeoLayer[],
  selectedLayerId: string | undefined,
): GeoRasterLayer | undefined {
  const rasterLayers = layers.filter((layer): layer is GeoRasterLayer => layer.kind === 'raster')
  const selected = rasterLayers.find(({ id, visible }) => visible && id === selectedLayerId)
  if (selected !== undefined) return selected
  return rasterLayers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.visible)
    .sort((left, right) => right.layer.zIndex - left.layer.zIndex || right.index - left.index)[0]
    ?.layer
}

function toViewportPointer(
  layer: GeoRasterLayer,
  raster: OpenedDatasetDescriptor,
  sample: RasterPointSample,
): GeoViewportPointer {
  return {
    sourceId: String(layer.sourceId),
    datasetHandleId: String(raster.handleId),
    layerId: layer.id,
    pixel: sample.pixel,
    sourceMapCoordinate: sample.sourceMapCoordinate,
    projectMapCoordinate: sample.projectMapCoordinate,
    nodata: sample.nodata,
    bands: sample.components.map(({ name, unit, value, nodata }) => ({
      name,
      ...(unit === undefined ? {} : { unit }),
      value: value ?? undefined,
      nodata,
    })),
  }
}

export function orderedDisplayLayers(layers: readonly GeoLayer[]): readonly GeoLayer[] {
  return layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.visible)
    .sort((left, right) => left.layer.zIndex - right.layer.zIndex || left.index - right.index)
    .map(({ layer }) => layer)
}

export function displayStyleRevision(layer: GeoLayer): string {
  return stableHash(
    JSON.stringify({
      style: layer.style,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      zIndex: layer.zIndex,
    }),
  )
}

export function canvasSmoothingEnabled(resample: GeoLayer['style']['resample']): boolean {
  return resample === 'bilinear'
}

function traceGeometry(
  context: CanvasRenderingContext2D,
  geometry: GeoMapGeometry,
  screen: (point: Point) => Point,
): void {
  const traceLine = (points: readonly Point[], close = false): void => {
    const first = points[0]
    if (first === undefined) return
    const start = screen(first)
    context.moveTo(start.x, start.y)
    for (const point of points.slice(1)) {
      const next = screen(point)
      context.lineTo(next.x, next.y)
    }
    if (close) context.closePath()
  }
  if (geometry.kind === 'point') {
    const point = screen({ x: geometry.x, y: geometry.y })
    context.moveTo(point.x + 5, point.y)
    context.arc(point.x, point.y, 5, 0, Math.PI * 2)
  } else if (geometry.kind === 'multi-point') {
    for (const value of geometry.points) {
      const point = screen(value)
      context.moveTo(point.x + 5, point.y)
      context.arc(point.x, point.y, 5, 0, Math.PI * 2)
    }
  } else if (geometry.kind === 'rectangle') {
    traceLine(
      [
        { x: geometry.minX, y: geometry.minY },
        { x: geometry.maxX, y: geometry.minY },
        { x: geometry.maxX, y: geometry.maxY },
        { x: geometry.minX, y: geometry.maxY },
      ],
      true,
    )
  } else if (geometry.kind === 'line') traceLine(geometry.points)
  else if (geometry.kind === 'multi-line') {
    for (const line of geometry.lines) traceLine(line)
  } else if (geometry.kind === 'polygon') {
    for (const ring of geometry.rings) traceLine(ring, true)
  } else {
    for (const polygon of geometry.polygons) {
      for (const ring of polygon) traceLine(ring, true)
    }
  }
}

export function canvasCompositeOperation(mode: GeoLayer['blendMode']): GlobalCompositeOperation {
  switch (mode) {
    case 'normal':
      return 'source-over'
    case 'multiply':
    case 'screen':
    case 'lighten':
    case 'darken':
      return mode
  }
}

function isTransient(error: unknown): boolean {
  if (!(error instanceof ImagingRpcError)) return true
  return error.detail.retryable && !permanentErrorCodes.has(error.detail.code)
}

const permanentErrorCodes = new Set<StructuredRpcError['code']>([
  'INVALID_PAYLOAD',
  'MALFORMED_METADATA',
  'UNSUPPORTED',
  'UNSUPPORTED_COMPRESSION',
  'UNSUPPORTED_LAYOUT',
])

function isAbort(error: unknown, controller: AbortController): boolean {
  return (
    controller.signal.aborted ||
    (error instanceof ImagingRpcError && error.detail.code === 'ABORTED') ||
    (error instanceof DOMException && error.name === 'AbortError')
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof ImagingRpcError) return error.detail.message
  return error instanceof Error ? error.message : 'Unknown display failure'
}

function labelForLayer(
  layerId: string,
  layers: readonly GeoLayer[],
  sources: readonly GeoRasterSource[],
): string {
  const layer = layers.find(({ id }) => id === layerId)
  const source = sources.find(({ id }) => id === layer?.sourceId)
  const locator = source?.locator
  const datetime =
    locator?.kind === 'stac-asset' || locator?.kind === 'tnm-product' ? locator.datetime : undefined
  return `${layer?.label ?? layerId}${datetime === undefined ? '' : ` · ${datetime}`}`
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `atlas-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function rasterSize(dataset: DatasetDescriptor): Size {
  return {
    width: dataset.axes.find((axis) => axis.id === 'x')?.length ?? 1,
    height: dataset.axes.find((axis) => axis.id === 'y')?.length ?? 1,
  }
}

function overviewSizes(dataset: DatasetDescriptor, full: Size) {
  if (dataset.levels.length === 0) return [{ level: 0, width: full.width, height: full.height }]
  return dataset.levels.map((level) => ({
    level: level.level,
    width: level.axisLengths.find((axis) => axis.axisId === 'x')?.length ?? full.width,
    height: level.axisLengths.find((axis) => axis.axisId === 'y')?.length ?? full.height,
  }))
}

function adapterForOverview(
  spatial: SpatialReference,
  affine: NonNullable<SpatialReference['pixelToModel']>,
  full: Size,
  dataset: DatasetDescriptor,
  overview: number,
): CoordinateSpaceAdapter {
  const size = overviewSizes(dataset, full).find((level) => level.level === overview) ?? {
    level: overview,
    width: full.width,
    height: full.height,
  }
  const levelReference = dataset.levels.find((level) => level.level === overview)?.spatialReference
  const pixelToWorld = pixelToWorldForOverview(
    affine,
    full.width,
    full.height,
    size.width,
    size.height,
    levelReference?.pixelToModel,
  )
  return createWorldSpaceAffineAdapter({
    pixelToWorld,
    width: size.width,
    height: size.height,
    pixelInterpretation: spatial.pixelInterpretation,
  })
}

function worldAdapterForDataset(
  raster: OpenedDatasetDescriptor,
): CoordinateSpaceAdapter | undefined {
  const spatial = raster.dataset.spatialReference
  const affine = spatial?.pixelToModel
  if (spatial === undefined || affine === undefined) return undefined
  const size = rasterSize(raster.dataset)
  return createWorldSpaceAffineAdapter({
    pixelToWorld: affine,
    ...(spatial.modelToPixel === undefined ? {} : { worldToPixel: spatial.modelToPixel }),
    width: size.width,
    height: size.height,
    pixelInterpretation: spatial.pixelInterpretation,
  })
}

function sameCrs(left: SpatialReference | undefined, right: SpatialReference | undefined): boolean {
  return crsKey(left) === crsKey(right)
}

function crsKey(spatial: SpatialReference | undefined): string {
  const crs = spatial?.crs
  if (crs === undefined) return 'unknown'
  return `${crs.kind}:${crs.authority ?? ''}:${String(crs.code ?? crs.name ?? '')}`
}

function unionWorldBounds(bounds: readonly Bounds[]): Bounds {
  const first = bounds[0]
  if (first === undefined) return { x: 0, y: 0, width: 1, height: 1 }
  let minX = first.x
  let minY = first.y
  let maxX = first.x + first.width
  let maxY = first.y + first.height
  for (const box of bounds.slice(1)) {
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1e-6, maxX - minX),
    height: Math.max(1e-6, maxY - minY),
  }
}

function withWorldBounds(adapter: CoordinateSpaceAdapter, world: Bounds): CoordinateSpaceAdapter {
  return {
    kind: adapter.kind,
    worldYDirection: adapter.worldYDirection,
    pixelToWorld: (pixel) => adapter.pixelToWorld(pixel),
    worldToPixel: (point) => adapter.worldToPixel(point),
    pixelBounds: () => adapter.pixelBounds(),
    worldBounds: () => world,
    worldToScreen: (point, camera, viewport) => adapter.worldToScreen(point, camera, viewport),
    screenToWorld: (point, camera, viewport) => adapter.screenToWorld(point, camera, viewport),
  }
}

function unknownRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}
}

function finiteUnknown(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Viewport ${label} must be finite.`)
  return value
}
