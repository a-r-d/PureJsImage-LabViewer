import type {
  DatasetDescriptor,
  OpenedDatasetDescriptor,
  RenderTile,
  SpatialReference,
} from '@pji-workbench/contracts'
import {
  CRS_EPSG_4326,
  canTransformCrs,
  displayMappingFromStyle,
  type GeoRasterLayer,
  scalarNodata,
  transformMapPoint,
} from '@pji-workbench/domain-geo'
import { ImagingRpcError, type ImagingWorkerClient } from '@pji-workbench/imaging'
import {
  type Bounds,
  type Camera,
  type CoordinateSpaceAdapter,
  createWorldSpaceAffineAdapter,
  fitCameraToLayer,
  type Point,
  panCameraInSpace,
  planMultiLayerTiles,
  resizeCamera,
  type Size,
  sampleViewportPointer,
  scaleAffineToOverview,
  selectOverviewLevel,
  type TileLayerPlanInput,
  visibleWorldBounds,
  zoomCameraAtScreenPointInSpace,
} from '@pji-workbench/viewport'
import { useEffect, useRef } from 'react'

const TILE_SIZE = 256
const PREFETCH_TILES = 1

export interface GeoViewportPointer {
  readonly pixel: Point
  readonly world: Point
  readonly bands: readonly Readonly<{ name: string; value: number | undefined }>[]
}

export interface GeoViewportProps {
  readonly client: ImagingWorkerClient
  readonly rasters: readonly OpenedDatasetDescriptor[]
  readonly layers: readonly GeoRasterLayer[]
  readonly onPointer: (sample: GeoViewportPointer | undefined) => void
  readonly onOverview: (level: number) => void
  readonly onSettled: (settled: boolean) => void
  readonly onViewBbox?: (bbox: readonly [number, number, number, number] | undefined) => void
}

interface CachedTile {
  readonly tile: RenderTile
  readonly canvas: HTMLCanvasElement
  readonly layerId: string
}

class CanvasGeoRenderer {
  readonly #canvas: HTMLCanvasElement
  #context: CanvasRenderingContext2D
  readonly #tiles = new Map<string, CachedTile>()
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
    this.#context.setTransform(this.#ratio, 0, 0, this.#ratio, 0, 0)
  }

  has(tileId: string): boolean {
    return this.#tiles.has(tileId)
  }

  upload(layerId: string, tile: RenderTile): void {
    const canvas = document.createElement('canvas')
    canvas.width = tile.width
    canvas.height = tile.height
    const context = canvas.getContext('2d')
    if (context === null) return
    const pixels = new Uint8ClampedArray(tile.rgba.length)
    pixels.set(tile.rgba)
    context.putImageData(new ImageData(pixels, tile.width, tile.height), 0, 0)
    this.#tiles.set(tile.tileId, { tile, canvas, layerId })
  }

  retain(tileIds: ReadonlySet<string>): void {
    for (const key of this.#tiles.keys()) {
      if (!tileIds.has(key)) this.#tiles.delete(key)
    }
  }

  sample(layerId: string, pixel: Point): readonly number[] | undefined {
    for (const cached of this.#tiles.values()) {
      if (cached.layerId !== layerId) continue
      const { region } = cached.tile
      if (
        pixel.x < region.x ||
        pixel.y < region.y ||
        pixel.x >= region.x + cached.tile.width ||
        pixel.y >= region.y + cached.tile.height
      ) {
        continue
      }
      const x = Math.floor(pixel.x - region.x)
      const y = Math.floor(pixel.y - region.y)
      const offset = y * cached.tile.width + x
      if (cached.tile.bandValues !== undefined) {
        return cached.tile.bandValues.map((band) => band[offset] ?? Number.NaN)
      }
      const value = cached.tile.values[offset]
      return value === undefined ? undefined : [value]
    }
    return undefined
  }

  render(camera: Camera, adapter: CoordinateSpaceAdapter, layers: readonly GeoRasterLayer[]): void {
    const context = this.#context
    context.setTransform(this.#ratio, 0, 0, this.#ratio, 0, 0)
    context.fillStyle = '#050709'
    context.fillRect(0, 0, this.#viewport.width, this.#viewport.height)
    const ordered = [...layers].sort((left, right) => left.zIndex - right.zIndex)
    for (const layer of ordered) {
      if (!layer.visible) continue
      for (const cached of this.#tiles.values()) {
        if (cached.layerId !== layer.id) continue
        this.#drawTile(cached, adapter, camera, layer.opacity)
      }
    }
  }

  #drawTile(
    cached: CachedTile,
    adapter: CoordinateSpaceAdapter,
    camera: Camera,
    opacity: number,
  ): void {
    const { region } = cached.tile
    const origin = adapter.worldToScreen(
      adapter.pixelToWorld({ x: region.x, y: region.y }),
      camera,
      this.#viewport,
    )
    const xAxis = adapter.worldToScreen(
      adapter.pixelToWorld({ x: region.x + cached.tile.width, y: region.y }),
      camera,
      this.#viewport,
    )
    const yAxis = adapter.worldToScreen(
      adapter.pixelToWorld({ x: region.x, y: region.y + cached.tile.height }),
      camera,
      this.#viewport,
    )
    const ratio = this.#ratio
    this.#context.save()
    this.#context.globalAlpha = opacity
    this.#context.imageSmoothingEnabled = camera.zoom < 1
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

  dispose(): void {
    this.#tiles.clear()
  }
}

export function GeoViewport({
  client,
  rasters,
  layers,
  onPointer,
  onOverview,
  onSettled,
  onViewBbox,
}: GeoViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layersRef = useRef(layers)
  layersRef.current = layers
  const rastersRef = useRef(rasters)
  rastersRef.current = rasters
  const onViewBboxRef = useRef(onViewBbox)
  onViewBboxRef.current = onViewBbox
  const scheduleRef = useRef<() => void>(() => undefined)
  const rastersIdentity = rasters
    .map((raster) => `${raster.handleId}:${raster.generation}`)
    .join('|')
  const layersKey = [
    rastersIdentity,
    ...layers.map(
      (layer) =>
        `${layer.id}:${layer.sourceId}:${layer.visible}:${layer.opacity}:${JSON.stringify(layer.style)}`,
    ),
  ].join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: layersKey is the refetch signal; the effect only calls the latest scheduler.
  useEffect(() => {
    scheduleRef.current()
  }, [layersKey])

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
    let camera: Camera = fitCameraToLayer(cameraAdapter, viewport)
    let fitted = false
    let frameRequest = 0
    const requestGeneration = 1
    let overview = 0
    const adapter = cameraAdapter
    const pending = new Map<string, AbortController>()

    const draw = (): void => {
      cancelAnimationFrame(frameRequest)
      frameRequest = requestAnimationFrame(() => {
        renderer.render(camera, adapter, layersRef.current)
      })
    }

    const scheduleTiles = (): void => {
      onSettled(false)
      const nextOverview = selectOverviewLevel(
        overviewSizes(primary.dataset, full),
        camera,
        viewport,
        cameraAdapter.worldBounds(),
      )
      if (nextOverview !== overview) {
        overview = nextOverview
        onOverview(overview)
      }
      const visible = visibleWorldBounds(camera, viewport, cameraAdapter)
      const required = new Set<string>()
      const planInputs: TileLayerPlanInput[] = []
      const contexts = new Map<
        string,
        {
          readonly raster: OpenedDatasetDescriptor
          readonly overview: number
          readonly mapping: ReturnType<typeof displayMappingFromStyle>
        }
      >()
      for (const layer of layersRef.current) {
        if (!layer.visible) continue
        const raster = rastersRef.current.find(
          (candidate) => String(candidate.sourceId) === String(layer.sourceId),
        )
        if (raster === undefined) continue
        const rasterSpatial = raster.dataset.spatialReference
        const rasterAffine = rasterSpatial?.pixelToModel
        if (rasterSpatial === undefined || rasterAffine === undefined) continue
        const rasterFull = rasterSize(raster.dataset)
        const rasterWorld = createWorldSpaceAffineAdapter({
          pixelToWorld: rasterAffine,
          ...(rasterSpatial.modelToPixel === undefined
            ? {}
            : { worldToPixel: rasterSpatial.modelToPixel }),
          width: rasterFull.width,
          height: rasterFull.height,
          pixelInterpretation: rasterSpatial.pixelInterpretation,
        })
        const layerOverview = selectOverviewLevel(
          overviewSizes(raster.dataset, rasterFull),
          camera,
          viewport,
          rasterWorld.worldBounds(),
        )
        const layerAdapter = adapterForOverview(
          rasterSpatial,
          rasterAffine,
          rasterFull,
          raster.dataset,
          layerOverview,
        )
        const mapping = displayMappingFromStyle(layer.style, scalarNodata(rasterSpatial))
        planInputs.push({
          layerId: layer.id,
          sourceId: layer.sourceId,
          visible: true,
          adapter: layerAdapter,
        })
        contexts.set(layer.id, { raster, overview: layerOverview, mapping })
      }
      const plan = planMultiLayerTiles(planInputs, visible, TILE_SIZE, PREFETCH_TILES)
      for (const layerPlan of plan.layers) {
        const context = contexts.get(layerPlan.layerId)
        if (context === undefined) continue
        const mappingKey = JSON.stringify(context.mapping)
        const component = context.mapping.bands?.gray ?? context.mapping.bands?.red ?? 0
        for (const candidate of layerPlan.regions) {
          const tileId = `${context.raster.handleId}:${layerPlan.layerId}:${context.overview}:${mappingKey}:${candidate.column}:${candidate.row}`
          required.add(tileId)
          if (renderer.has(tileId) || pending.has(tileId)) continue
          const controller = new AbortController()
          pending.set(tileId, controller)
          const currentGeneration = requestGeneration
          void client
            .requestTile(
              {
                tileId,
                datasetHandleId: context.raster.handleId,
                generation: context.raster.generation,
                displayAxes: context.raster.selection.displayAxes,
                fixedIndices: context.raster.selection.fixedIndices,
                resolutionLevel: context.overview,
                component,
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
            .then((tile) => {
              if (currentGeneration !== requestGeneration || controller.signal.aborted) return
              renderer.upload(layerPlan.layerId, tile)
              draw()
              if (pending.size === 0) onSettled(true)
            })
            .catch((error: unknown) => {
              if (
                !controller.signal.aborted &&
                error instanceof ImagingRpcError &&
                error.detail.code === 'ABORTED'
              ) {
                window.setTimeout(() => scheduleRef.current(), 0)
              }
            })
            .finally(() => {
              pending.delete(tileId)
              if (pending.size === 0 && currentGeneration === requestGeneration) onSettled(true)
            })
        }
      }
      for (const [tileId, controller] of pending) {
        if (!required.has(tileId)) controller.abort()
      }
      renderer.retain(required)
      draw()
      if (required.size === 0) onSettled(true)
      emitViewBbox()
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
        const xs = corners.map((corner) => corner.x)
        const ys = corners.map((corner) => corner.y)
        reportBbox([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
      } catch {
        reportBbox(undefined)
      }
    }

    scheduleRef.current = scheduleTiles

    const resizeObserver = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect
      if (box === undefined) return
      const previous = viewport
      viewport = { width: Math.max(1, box.width), height: Math.max(1, box.height) }
      renderer.configure(viewport)
      if (!fitted) {
        camera = fitCameraToLayer(cameraAdapter, viewport)
        fitted = viewport.width > 32 && viewport.height > 32
      } else {
        camera = resizeCamera(camera, previous, viewport, cameraAdapter.worldBounds())
      }
      scheduleTiles()
    })
    resizeObserver.observe(canvas.parentElement ?? canvas)
    scheduleTiles()

    const pointer = (event: PointerEvent): void => {
      const bounds = canvas.getBoundingClientRect()
      const screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
      const sample = sampleViewportPointer(screen, camera, viewport, cameraAdapter)
      const visibleLayer = [...layersRef.current]
        .sort((left, right) => right.zIndex - left.zIndex)
        .find((layer) => layer.visible)
      const sampledRaster =
        visibleLayer === undefined
          ? primary
          : (rastersRef.current.find(
              (candidate) => String(candidate.sourceId) === String(visibleLayer.sourceId),
            ) ?? primary)
      const sampledWorld = worldAdapterForDataset(sampledRaster) ?? cameraAdapter
      const sampledSpatial = sampledRaster.dataset.spatialReference
      const sampledAffine = sampledSpatial?.pixelToModel
      const sampledFull = rasterSize(sampledRaster.dataset)
      const sampledOverview =
        sampledSpatial === undefined || sampledAffine === undefined
          ? 0
          : selectOverviewLevel(
              overviewSizes(sampledRaster.dataset, sampledFull),
              camera,
              viewport,
              sampledWorld.worldBounds(),
            )
      const sampledOverviewAdapter =
        sampledSpatial === undefined || sampledAffine === undefined
          ? sampledWorld
          : adapterForOverview(
              sampledSpatial,
              sampledAffine,
              sampledFull,
              sampledRaster.dataset,
              sampledOverview,
            )
      const bands =
        visibleLayer === undefined
          ? []
          : (
              renderer.sample(visibleLayer.id, sampledOverviewAdapter.worldToPixel(sample.world)) ??
              []
            ).map((value, index) => ({
              name: `B${index}`,
              value,
            }))
      onPointer({
        pixel: sampledWorld.worldToPixel(sample.world),
        world: sample.world,
        bands,
      })
    }

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const bounds = canvas.getBoundingClientRect()
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
      camera = zoomCameraAtScreenPointInSpace(
        camera,
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        factor,
        viewport,
        cameraAdapter,
      )
      scheduleTiles()
    }
    let last: Point | undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      last = { x: event.clientX, y: event.clientY }
      canvas.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent): void => {
      pointer(event)
      if (last === undefined) return
      camera = panCameraInSpace(
        camera,
        { x: event.clientX - last.x, y: event.clientY - last.y },
        viewport,
        cameraAdapter,
      )
      last = { x: event.clientX, y: event.clientY }
      scheduleTiles()
    }
    const onPointerUp = (): void => {
      last = undefined
    }
    const onPointerLeave = (): void => onPointer(undefined)

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    onOverview(overview)
    return () => {
      scheduleRef.current = () => undefined
      resizeObserver.disconnect()
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
      for (const controller of pending.values()) controller.abort()
      renderer.dispose()
      cancelAnimationFrame(frameRequest)
    }
  }, [client, rasters, onOverview, onPointer, onSettled])

  return (
    <div className="geo-viewport">
      <canvas aria-label="Geo raster viewport" ref={canvasRef} role="img" tabIndex={0} />
    </div>
  )
}

function rasterSize(dataset: DatasetDescriptor): Size {
  return {
    width: dataset.axes.find((axis) => axis.id === 'x')?.length ?? 1,
    height: dataset.axes.find((axis) => axis.id === 'y')?.length ?? 1,
  }
}

function overviewSizes(dataset: DatasetDescriptor, full: Size) {
  if (dataset.levels.length === 0) {
    return [{ level: 0, width: full.width, height: full.height }]
  }
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
  const pixelToWorld =
    levelReference?.pixelToModel ??
    scaleAffineToOverview(affine, full.width, full.height, size.width, size.height)
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
  if (first === undefined) {
    return { x: 0, y: 0, width: 1, height: 1 }
  }
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
