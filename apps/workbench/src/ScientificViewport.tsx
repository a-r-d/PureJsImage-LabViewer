import type {
  AxisDescriptor,
  DisplayMapping,
  OpenedDatasetDescriptor,
  PlaneSelection,
  RenderTile,
} from '@pji-workbench/contracts'
import type { ImagingWorkerClient } from '@pji-workbench/imaging'
import {
  type Bounds,
  type Camera,
  calculateScaleBar,
  fitCameraToBounds,
  type Point,
  panCamera,
  planVisibleTileRegions,
  resizeCamera,
  type Size,
  screenToWorld,
  type ViewportRenderer,
  type ViewportRenderFrame,
  worldToScreen,
  zoomCameraAtScreenPoint,
} from '@pji-workbench/viewport'
import { useEffect, useRef } from 'react'

const TILE_SIZE = 256
const PREFETCH_TILES = 1

export interface ScientificViewportApi {
  fit(): void
  oneToOne(): void
}

interface ScientificViewportProps {
  readonly client: ImagingWorkerClient
  readonly opened: OpenedDatasetDescriptor
  readonly selection: PlaneSelection
  readonly component: number
  readonly mapping: DisplayMapping
  readonly onReady: (api: ScientificViewportApi | null) => void
  readonly onTile: (tile: RenderTile, first: boolean) => void
}

interface CachedTile {
  readonly tile: RenderTile
  readonly canvas: HTMLCanvasElement
}

function levelAxis(axis: AxisDescriptor, opened: OpenedDatasetDescriptor, level: number): number {
  return (
    opened.dataset.levels
      .find((candidate) => candidate.level === level)
      ?.axisLengths.find(({ axisId }) => axisId === axis.id)?.length ?? axis.length
  )
}

function imageBounds(opened: OpenedDatasetDescriptor, selection: PlaneSelection): Bounds {
  const horizontal = opened.dataset.axes.find(({ id }) => id === selection.displayAxes[0])
  const vertical = opened.dataset.axes.find(({ id }) => id === selection.displayAxes[1])
  if (horizontal === undefined || vertical === undefined) {
    throw new Error('The selected display axes are missing from the dataset descriptor.')
  }
  return {
    x: 0,
    y: 0,
    width: levelAxis(horizontal, opened, selection.resolutionLevel),
    height: levelAxis(vertical, opened, selection.resolutionLevel),
  }
}

function calibrationFor(axis: AxisDescriptor | undefined) {
  if (axis?.coordinates.type !== 'linear' || axis.unit === undefined) return undefined
  return { origin: axis.coordinates.origin, unitsPerPixel: axis.coordinates.step, unit: axis.unit }
}

class CanvasScientificRenderer implements ViewportRenderer {
  readonly #canvas: HTMLCanvasElement
  #context: CanvasRenderingContext2D
  #viewport: Size = { width: 1, height: 1 }
  #tiles = new Map<string, CachedTile>()
  calibration: { readonly unitsPerPixel: number; readonly unit: string } | undefined

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('The scientific viewport requires a 2D canvas context.')
    this.#canvas = canvas
    this.#context = context
  }

  configure(viewport: Size): void {
    this.#viewport = viewport
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    this.#canvas.width = Math.max(1, Math.round(viewport.width * ratio))
    this.#canvas.height = Math.max(1, Math.round(viewport.height * ratio))
    this.#context = this.#canvas.getContext('2d') ?? this.#context
    this.#context.setTransform(ratio, 0, 0, ratio, 0, 0)
  }

  upload(tile: RenderTile): void {
    const canvas = document.createElement('canvas')
    canvas.width = tile.width
    canvas.height = tile.height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Unable to allocate a bounded render tile.')
    const pixels = new Uint8ClampedArray(tile.rgba.length)
    pixels.set(tile.rgba)
    context.putImageData(new ImageData(pixels, tile.width, tile.height), 0, 0)
    this.#tiles.set(tile.tileId, { tile, canvas })
  }

  has(tileId: string): boolean {
    return this.#tiles.has(tileId)
  }

  retain(tileIds: ReadonlySet<string>): void {
    for (const key of this.#tiles.keys()) {
      if (!tileIds.has(key)) this.#tiles.delete(key)
    }
  }

  valueAt(point: Point): number | undefined {
    for (const { tile } of this.#tiles.values()) {
      const { region } = tile
      if (
        point.x < region.x ||
        point.y < region.y ||
        point.x >= region.x + tile.width ||
        point.y >= region.y + tile.height
      ) {
        continue
      }
      const x = Math.floor(point.x - region.x)
      const y = Math.floor(point.y - region.y)
      return tile.values[y * tile.width + x]
    }
    return undefined
  }

  render(frame: ViewportRenderFrame): void {
    const context = this.#context
    const { width, height } = this.#viewport
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#050709'
    context.fillRect(0, 0, width, height)

    const topLeft = worldToScreen({ x: 0, y: 0 }, frame.camera, frame.viewport)
    const bottomRight = worldToScreen(
      { x: frame.imageBounds.width, y: frame.imageBounds.height },
      frame.camera,
      frame.viewport,
    )
    context.save()
    context.beginPath()
    context.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)
    context.clip()
    for (const descriptor of frame.tiles) {
      const cached = this.#tiles.get(descriptor.id)
      if (cached === undefined) continue
      const start = worldToScreen(cached.tile.region, frame.camera, frame.viewport)
      const end = worldToScreen(
        {
          x: cached.tile.region.x + cached.tile.width,
          y: cached.tile.region.y + cached.tile.height,
        },
        frame.camera,
        frame.viewport,
      )
      context.imageSmoothingEnabled = frame.camera.zoom < 1
      context.drawImage(cached.canvas, start.x, start.y, end.x - start.x, end.y - start.y)
    }
    context.restore()
    context.strokeStyle = '#80909b'
    context.lineWidth = 1
    context.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)

    if (this.calibration !== undefined) {
      const scale = calculateScaleBar(frame.camera, this.calibration)
      const scaleX = Math.max(18, width - scale.screenLength - 22)
      const scaleY = height - 23
      context.strokeStyle = '#f3f6f8'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(scaleX, scaleY)
      context.lineTo(scaleX + scale.screenLength, scaleY)
      context.stroke()
      context.fillStyle = '#f3f6f8'
      context.font = '11px ui-monospace, monospace'
      context.textAlign = 'center'
      context.fillText(scale.label, scaleX + scale.screenLength / 2, scaleY - 7)
    }
  }

  dispose(): void {
    this.#tiles.clear()
    this.#context.clearRect(0, 0, this.#viewport.width, this.#viewport.height)
  }
}

function visibleWorldBounds(camera: Camera, viewport: Size): Bounds {
  const topLeft = screenToWorld({ x: 0, y: 0 }, camera, viewport)
  const bottomRight = screenToWorld({ x: viewport.width, y: viewport.height }, camera, viewport)
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  }
}

export function ScientificViewport({
  client,
  opened,
  selection,
  component,
  mapping,
  onReady,
  onTile,
}: ScientificViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const coordinateRef = useRef<HTMLSpanElement>(null)
  const zoomRef = useRef<HTMLSpanElement>(null)
  const tileStatusRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const bounds = imageBounds(opened, selection)
    const horizontalAxis = opened.dataset.axes.find(({ id }) => id === selection.displayAxes[0])
    const verticalAxis = opened.dataset.axes.find(({ id }) => id === selection.displayAxes[1])
    const horizontalCalibration = calibrationFor(horizontalAxis)
    const verticalCalibration = calibrationFor(verticalAxis)
    const renderer = new CanvasScientificRenderer(canvas)
    if (
      horizontalCalibration !== undefined &&
      verticalCalibration !== undefined &&
      horizontalCalibration.unit === verticalCalibration.unit
    ) {
      renderer.calibration = {
        unitsPerPixel: horizontalCalibration.unitsPerPixel,
        unit: horizontalCalibration.unit,
      }
    }
    let viewport: Size = { width: 1, height: 1 }
    let camera: Camera = {
      center: { x: bounds.width / 2, y: bounds.height / 2 },
      zoom: 1,
    }
    let frameRequest = 0
    let requestGeneration = 1
    let tileSequence = 1
    let firstTile = true
    let panning = false
    let spacePressed = false
    let previousPointer: Point = { x: 0, y: 0 }
    const pending = new Map<string, AbortController>()

    const frame = (): ViewportRenderFrame => ({
      camera,
      viewport,
      imageBounds: bounds,
      tiles: [...rendererTileIds].map((id) => ({
        id,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        opacity: 1,
      })),
      overlays: [],
    })
    const draw = (): void => {
      cancelAnimationFrame(frameRequest)
      frameRequest = requestAnimationFrame(() => {
        renderer.render(frame())
        if (zoomRef.current !== null)
          zoomRef.current.textContent = `${Math.round(camera.zoom * 100)}%`
        window.__PJI_WORKBENCH_METRICS__.viewportFrames += 1
      })
    }
    let rendererTileIds = new Set<string>()

    const scheduleTiles = (): void => {
      const visible = visibleWorldBounds(camera, viewport)
      const candidates = planVisibleTileRegions(bounds, visible, TILE_SIZE, PREFETCH_TILES)
      const scheduledCandidates =
        mapping.range === 'auto' && (mapping.minimum === undefined || mapping.maximum === undefined)
          ? candidates.slice(0, 1)
          : candidates
      const required = new Set<string>()
      for (const candidate of scheduledCandidates) {
        const region = {
          x: candidate.x,
          y: candidate.y,
          width: candidate.width,
          height: candidate.height,
        }
        const mappingKey = `${mapping.range}:${mapping.minimum ?? 'pending'}:${mapping.maximum ?? 'pending'}`
        const tileId = `${opened.generation}:${requestGeneration}:${selection.displayAxes.join('-')}:${selection.resolutionLevel}:${component}:${mappingKey}:${candidate.column}:${candidate.row}`
        required.add(tileId)
        if (renderer.has(tileId) || pending.has(tileId)) continue
        const controller = new AbortController()
        pending.set(tileId, controller)
        const currentGeneration = requestGeneration
        const requestId = tileSequence
        tileSequence += 1
        void client
          .requestTile(
            {
              tileId,
              datasetHandleId: opened.handleId,
              generation: opened.generation,
              displayAxes: selection.displayAxes,
              fixedIndices: selection.fixedIndices,
              resolutionLevel: selection.resolutionLevel,
              component,
              mapping,
              region,
              priority: candidate.priority,
            },
            controller.signal,
          )
          .then((tile) => {
            if (currentGeneration !== requestGeneration || controller.signal.aborted) return
            renderer.upload(tile)
            rendererTileIds.add(tile.tileId)
            window.__PJI_WORKBENCH_METRICS__.tilesTransferred += 1
            window.__PJI_WORKBENCH_METRICS__.tileBytesTransferred +=
              tile.rgba.byteLength + tile.values.byteLength
            window.__PJI_WORKBENCH_METRICS__.tilePixelsTransferred += tile.width * tile.height
            window.__PJI_WORKBENCH_METRICS__.largestTilePixels = Math.max(
              window.__PJI_WORKBENCH_METRICS__.largestTilePixels,
              tile.width * tile.height,
            )
            if (tileStatusRef.current !== null) {
              tileStatusRef.current.textContent = `${rendererTileIds.size} bounded tiles`
            }
            onTile(tile, firstTile)
            firstTile = false
            draw()
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted && tileStatusRef.current !== null) {
              tileStatusRef.current.textContent =
                error instanceof Error ? error.message : `Tile ${requestId} failed`
            }
          })
          .finally(() => pending.delete(tileId))
      }
      for (const [tileId, controller] of pending) {
        if (!required.has(tileId)) controller.abort()
      }
      rendererTileIds = required
      renderer.retain(required)
      draw()
    }

    const fit = (): void => {
      camera = fitCameraToBounds(bounds, viewport, 32)
      scheduleTiles()
    }
    const oneToOne = (): void => {
      camera = resizeCamera({ center: camera.center, zoom: 1 }, viewport, viewport, bounds)
      scheduleTiles()
    }
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const previous = viewport
      viewport = {
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      }
      renderer.configure(viewport)
      camera = resizeCamera(camera, previous, viewport, bounds)
      scheduleTiles()
    })
    resizeObserver.observe(canvas)

    const pointerPosition = (event: Pick<MouseEvent, 'clientX' | 'clientY'>): Point => {
      const canvasBounds = canvas.getBoundingClientRect()
      return { x: event.clientX - canvasBounds.left, y: event.clientY - canvasBounds.top }
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 1 && !(event.button === 0 && spacePressed)) return
      event.preventDefault()
      panning = true
      previousPointer = pointerPosition(event)
      canvas.setPointerCapture(event.pointerId)
      canvas.setAttribute('data-panning', 'true')
    }
    const handlePointerMove = (event: PointerEvent): void => {
      const point = pointerPosition(event)
      const world = screenToWorld(point, camera, viewport)
      if (coordinateRef.current !== null) {
        const value = renderer.valueAt(world)
        const physical =
          horizontalCalibration === undefined || verticalCalibration === undefined
            ? ''
            : ` · ${(horizontalCalibration.origin + world.x * horizontalCalibration.unitsPerPixel).toFixed(2)}, ${(verticalCalibration.origin + world.y * verticalCalibration.unitsPerPixel).toFixed(2)} ${horizontalCalibration.unit}`
        coordinateRef.current.textContent = `${Math.floor(world.x)}, ${Math.floor(world.y)} px${physical}${value === undefined ? '' : ` · ${value.toPrecision(5)}`}`
      }
      if (panning) {
        camera = panCamera(
          camera,
          { x: point.x - previousPointer.x, y: point.y - previousPointer.y },
          viewport,
          bounds,
        )
        previousPointer = point
        scheduleTiles()
      }
    }
    const stopPanning = (event: PointerEvent): void => {
      if (!panning) return
      panning = false
      canvas.setAttribute('data-panning', 'false')
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault()
      camera = zoomCameraAtScreenPoint(
        camera,
        pointerPosition(event),
        Math.exp(-event.deltaY * 0.0012),
        viewport,
        bounds,
      )
      scheduleTiles()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Space') spacePressed = true
      if (
        event.target !== canvas ||
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      )
        return
      event.preventDefault()
      camera = panCamera(
        camera,
        {
          x: event.key === 'ArrowLeft' ? -30 : event.key === 'ArrowRight' ? 30 : 0,
          y: event.key === 'ArrowUp' ? -30 : event.key === 'ArrowDown' ? 30 : 0,
        },
        viewport,
        bounds,
      )
      scheduleTiles()
    }
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') spacePressed = false
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', stopPanning)
    canvas.addEventListener('pointercancel', stopPanning)
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    onReady({ fit, oneToOne })

    return () => {
      requestGeneration += 1
      onReady(null)
      for (const controller of pending.values()) controller.abort()
      pending.clear()
      cancelAnimationFrame(frameRequest)
      resizeObserver.disconnect()
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', stopPanning)
      canvas.removeEventListener('pointercancel', stopPanning)
      canvas.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      renderer.dispose()
    }
  }, [client, component, mapping, onReady, onTile, opened, selection])

  return (
    <div className="mock-viewport scientific-viewport">
      <canvas
        aria-label={`Scientific image viewport for ${opened.dataset.name ?? opened.dataset.id}`}
        data-panning="false"
        ref={canvasRef}
        role="img"
        tabIndex={0}
      />
      <div className="mock-viewport__readout">
        <span ref={coordinateRef}>Move over a loaded tile to inspect its source value</span>
        <span ref={tileStatusRef}>Requesting first bounded tile…</span>
        <span ref={zoomRef}>100%</span>
      </div>
    </div>
  )
}
