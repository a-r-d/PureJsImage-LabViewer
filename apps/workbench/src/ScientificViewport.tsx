import type {
  AnalysisOverlayTile,
  AnalysisOverlayView,
  AnalysisResultHandleId,
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
import type { WorkspaceSnapshot } from '@pji-workbench/workspace'
import { useEffect, useRef } from 'react'
import { measureUxNextPaint } from './ux-instrumentation.js'

const TILE_SIZE = 256
const PREFETCH_TILES = 1

export function displayRangeFromTile(
  range: Readonly<{ minimum: number; maximum: number }>,
  histogram: readonly number[],
): Readonly<{ minimum: number; maximum: number }> {
  const { minimum, maximum } = range
  if (!(maximum > minimum) || histogram.length === 0) return range
  const total = histogram.reduce((sum, count) => sum + count, 0)
  if (total === 0) return range
  const lastIndex = histogram.length - 1
  const topCount = histogram[lastIndex] ?? 0
  if (topCount / total >= 0.001) return range
  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    if ((histogram[index] ?? 0) === 0) continue
    return {
      minimum,
      maximum: minimum + ((index + 1) / histogram.length) * (maximum - minimum),
    }
  }
  return range
}

export interface ScientificViewportApi {
  fit(): void
  oneToOne(): void
  exportPng(): Promise<Blob>
}

export type RoiTool = 'select' | 'point' | 'line' | 'polyline' | 'rectangle' | 'ellipse' | 'polygon'
export type ViewportRoi = WorkspaceSnapshot['analysis']['roiSet']['rois'][number]

export interface AnalysisOverlaySelection {
  readonly resultHandleId: AnalysisResultHandleId
  readonly output: string
  readonly view?: AnalysisOverlayView
  readonly tableOutput?: string
}

export interface AnalysisDatasetSelection extends AnalysisOverlaySelection {
  readonly descriptor: OpenedDatasetDescriptor['dataset']
}

interface ScientificViewportProps {
  readonly client: ImagingWorkerClient
  readonly opened: OpenedDatasetDescriptor
  readonly selection: PlaneSelection
  readonly component: number
  readonly mapping: DisplayMapping
  readonly onReady: (api: ScientificViewportApi | null) => void
  readonly onTile: (tile: RenderTile, first: boolean) => void
  readonly onRenderSettled?: (settled: boolean) => void
  readonly rois?: readonly ViewportRoi[]
  readonly selectedRoiId?: string | undefined
  readonly roiTool?: RoiTool
  readonly onCreateRoi?: (geometry: ViewportRoi['geometry']) => void
  readonly onSelectRoi?: (roiId?: string) => void
  readonly onDeleteRoi?: (roiId: string) => void
  readonly analysisOverlay?: AnalysisOverlaySelection | undefined
  readonly analysisDataset?: AnalysisDatasetSelection | undefined
  readonly analysisPoints?: readonly Readonly<{ x: number; y: number; label: string }>[]
  readonly selectedLabel?: number | undefined
  readonly onSelectLabel?: (label?: number) => void
}

interface CachedTile {
  readonly tile: RenderTile
  readonly canvas: HTMLCanvasElement
}

interface CachedOverlay {
  readonly tile: AnalysisOverlayTile
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
  #overlays = new Map<string, CachedOverlay>()
  #selectedLabel: number | undefined
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

  uploadOverlay(tile: AnalysisOverlayTile): void {
    const canvas = document.createElement('canvas')
    canvas.width = tile.width
    canvas.height = tile.height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Unable to allocate a bounded overlay tile.')
    const pixels = new Uint8ClampedArray(tile.rgba)
    if (this.#selectedLabel !== undefined) {
      for (let index = 0; index < tile.labels.length; index += 1) {
        if (tile.labels[index] !== this.#selectedLabel) continue
        const offset = index * 4
        pixels[offset] = 255
        pixels[offset + 1] = 255
        pixels[offset + 2] = 255
        pixels[offset + 3] = 220
      }
    }
    context.putImageData(new ImageData(pixels, tile.width, tile.height), 0, 0)
    context.save()
    context.strokeStyle = 'rgba(255, 255, 255, 0.95)'
    context.fillStyle = 'rgba(255, 255, 255, 0.98)'
    context.lineWidth = 1.5
    context.font = '600 12px ui-monospace, monospace'
    context.textBaseline = 'bottom'
    for (const annotation of tile.annotations) {
      const x = annotation.x - tile.region.x
      const y = annotation.y - tile.region.y
      if (tile.view === 'numbered') {
        context.fillText(String(annotation.label), x + 4, y - 4)
      } else if (tile.view === 'centroids') {
        context.beginPath()
        context.moveTo(x - 5, y)
        context.lineTo(x + 5, y)
        context.moveTo(x, y - 5)
        context.lineTo(x, y + 5)
        context.stroke()
      } else if (
        tile.view === 'ellipses' &&
        annotation.majorAxis !== undefined &&
        annotation.minorAxis !== undefined
      ) {
        context.beginPath()
        context.ellipse(
          x,
          y,
          Math.max(0.5, annotation.majorAxis / 2),
          Math.max(0.5, annotation.minorAxis / 2),
          annotation.orientationRadians ?? 0,
          0,
          Math.PI * 2,
        )
        context.stroke()
      }
    }
    context.restore()
    this.#overlays.set(tile.tileId, { tile, canvas })
    this.#canvas.dataset['overlayTileCount'] = String(this.#overlays.size)
  }

  selectLabel(label?: number): void {
    if (label === this.#selectedLabel) return
    this.#selectedLabel = label
    for (const { tile } of [...this.#overlays.values()]) this.uploadOverlay(tile)
  }

  has(tileId: string): boolean {
    return this.#tiles.has(tileId)
  }

  hasOverlay(tileId: string): boolean {
    return this.#overlays.has(tileId)
  }

  retain(tileIds: ReadonlySet<string>): void {
    for (const key of this.#tiles.keys()) {
      if (!tileIds.has(key)) this.#tiles.delete(key)
    }
  }

  retainOverlays(tileIds: ReadonlySet<string>): void {
    for (const key of this.#overlays.keys()) {
      if (!tileIds.has(key)) this.#overlays.delete(key)
    }
    this.#canvas.dataset['overlayTileCount'] = String(this.#overlays.size)
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

  labelAt(point: Point): number | undefined {
    for (const { tile } of this.#overlays.values()) {
      if (
        point.x < tile.region.x ||
        point.y < tile.region.y ||
        point.x >= tile.region.x + tile.width ||
        point.y >= tile.region.y + tile.height
      ) {
        continue
      }
      const x = Math.floor(point.x - tile.region.x)
      const y = Math.floor(point.y - tile.region.y)
      const label = tile.labels[y * tile.width + x]
      return label === 0 ? undefined : label
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
    for (const { tile, canvas } of this.#overlays.values()) {
      const start = worldToScreen(tile.region, frame.camera, frame.viewport)
      const end = worldToScreen(
        { x: tile.region.x + tile.width, y: tile.region.y + tile.height },
        frame.camera,
        frame.viewport,
      )
      context.imageSmoothingEnabled = false
      context.drawImage(canvas, start.x, start.y, end.x - start.x, end.y - start.y)
    }
    context.restore()
    context.strokeStyle = '#80909b'
    context.lineWidth = 1
    context.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)

    for (const overlay of frame.overlays) {
      const points = overlay.points.map((point) =>
        worldToScreen(point, frame.camera, frame.viewport),
      )
      const first = points[0]
      if (first === undefined) continue
      context.save()
      context.strokeStyle = overlay.selected ? '#fff4a8' : '#35d6c3'
      context.fillStyle = overlay.selected ? '#fff4a8' : '#35d6c3'
      context.lineWidth = overlay.selected ? 2 : 1.5
      context.setLineDash(overlay.selected ? [] : [6, 4])
      context.beginPath()
      context.moveTo(first.x, first.y)
      for (const point of points.slice(1)) context.lineTo(point.x, point.y)
      if (overlay.kind !== 'line' && overlay.kind !== 'polygon') context.closePath()
      if (overlay.kind === 'polygon') context.closePath()
      context.stroke()
      context.setLineDash([])
      for (const point of points) {
        context.beginPath()
        context.arc(point.x, point.y, overlay.selected ? 4.5 : 3, 0, Math.PI * 2)
        context.fill()
      }
      if (overlay.label !== undefined) {
        context.font = '11px ui-sans-serif, sans-serif'
        context.fillText(overlay.label, first.x + 7, first.y - 7)
      }
      context.restore()
    }

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
    this.#overlays.clear()
    this.#canvas.dataset['overlayTileCount'] = '0'
    this.#context.clearRect(0, 0, this.#viewport.width, this.#viewport.height)
  }
}

function roiPoints(roi: ViewportRoi): readonly Point[] {
  const geometry = roi.geometry
  if (geometry.kind === 'point') return [geometry.point]
  if (geometry.kind === 'line-segment') return [geometry.start, geometry.end]
  if (geometry.kind === 'polyline' || geometry.kind === 'polygon') return geometry.points
  if (geometry.kind === 'rectangle') {
    return [
      { x: geometry.x, y: geometry.y },
      { x: geometry.x + geometry.width, y: geometry.y },
      { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
      { x: geometry.x, y: geometry.y + geometry.height },
    ]
  }
  return [
    { x: geometry.center.x - geometry.radiusX, y: geometry.center.y },
    { x: geometry.center.x, y: geometry.center.y - geometry.radiusY },
    { x: geometry.center.x + geometry.radiusX, y: geometry.center.y },
    { x: geometry.center.x, y: geometry.center.y + geometry.radiusY },
  ]
}

function roiOverlay(roi: ViewportRoi, selected: boolean) {
  const kind =
    roi.geometry.kind === 'line-segment' || roi.geometry.kind === 'polyline'
      ? ('line' as const)
      : roi.geometry.kind === 'ellipse'
        ? ('ellipse' as const)
        : roi.geometry.kind === 'polygon'
          ? ('polygon' as const)
          : ('rectangle' as const)
  return { id: roi.id, kind, points: roiPoints(roi), selected, label: roi.name ?? roi.id }
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
  onRenderSettled,
  rois = [],
  selectedRoiId,
  roiTool = 'select',
  onCreateRoi,
  onSelectRoi,
  onDeleteRoi,
  analysisOverlay,
  analysisDataset,
  analysisPoints = [],
  selectedLabel,
  onSelectLabel,
}: ScientificViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<CanvasScientificRenderer | null>(null)
  const redrawRef = useRef<(() => void) | null>(null)
  const selectedLabelRef = useRef(selectedLabel)
  selectedLabelRef.current = selectedLabel
  const coordinateRef = useRef<HTMLSpanElement>(null)
  const zoomRef = useRef<HTMLSpanElement>(null)
  const tileStatusRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    onRenderSettled?.(false)
    const renderedOpened =
      analysisDataset === undefined ? opened : { ...opened, dataset: analysisDataset.descriptor }
    const resolutionSelection =
      analysisDataset === undefined ||
      analysisDataset.descriptor.levels.some(({ level }) => level === selection.resolutionLevel)
        ? selection
        : {
            ...selection,
            resolutionLevel: analysisDataset.descriptor.levels[0]?.level ?? 0,
          }
    const renderedAxes = new Set(renderedOpened.dataset.axes.map(({ id }) => id))
    const renderedSelection = {
      ...resolutionSelection,
      fixedIndices: resolutionSelection.fixedIndices.filter(({ axisId }) =>
        renderedAxes.has(axisId),
      ),
    }
    const bounds = imageBounds(renderedOpened, renderedSelection)
    const horizontalAxis = renderedOpened.dataset.axes.find(
      ({ id }) => id === renderedSelection.displayAxes[0],
    )
    const verticalAxis = renderedOpened.dataset.axes.find(
      ({ id }) => id === renderedSelection.displayAxes[1],
    )
    const horizontalCalibration = calibrationFor(horizontalAxis)
    const verticalCalibration = calibrationFor(verticalAxis)
    const renderer = new CanvasScientificRenderer(canvas)
    renderer.selectLabel(selectedLabelRef.current)
    rendererRef.current = renderer
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
    let drawingStart: Point | undefined
    let spacePressed = false
    let previousPointer: Point = { x: 0, y: 0 }
    const pending = new Map<string, AbortController>()

    const frequencyWorkspace =
      analysisDataset?.output === 'magnitude' || analysisDataset?.output === 'power'
    const annotations = [
      ...(frequencyWorkspace
        ? [{ x: bounds.width / 2, y: bounds.height / 2, label: 'Beam center' }]
        : []),
      ...analysisPoints,
    ]
    canvas.dataset['analysisAnnotationCount'] = String(annotations.length)
    const frame = (): ViewportRenderFrame => ({
      camera,
      viewport,
      imageBounds: bounds,
      tiles: [...rendererTileIds].map((id) => ({
        id,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        opacity: 1,
      })),
      overlays: [
        ...(analysisDataset === undefined
          ? rois.map((roi) => roiOverlay(roi, roi.id === selectedRoiId))
          : []),
        ...annotations.map(({ x, y, label }, index) => ({
          id: `analysis-annotation-${index}`,
          kind: 'rectangle' as const,
          points: [
            { x: x - 2, y: y - 2 },
            { x: x + 2, y: y - 2 },
            { x: x + 2, y: y + 2 },
            { x: x - 2, y: y + 2 },
          ],
          selected: false,
          label,
        })),
      ],
    })
    const draw = (): void => {
      cancelAnimationFrame(frameRequest)
      frameRequest = requestAnimationFrame(() => {
        renderer.render(frame())
        canvas.dataset['cameraCenterX'] = String(camera.center.x)
        canvas.dataset['cameraCenterY'] = String(camera.center.y)
        canvas.dataset['cameraZoom'] = String(camera.zoom)
        if (zoomRef.current !== null)
          zoomRef.current.textContent = `${Math.round(camera.zoom * 100)}%`
        window.__PJI_WORKBENCH_METRICS__.viewportFrames += 1
        if (rendererTileIds.size > 0) onRenderSettled?.(true)
      })
    }
    redrawRef.current = draw
    let rendererTileIds = new Set<string>()

    const scheduleTiles = (): void => {
      onRenderSettled?.(false)
      const visible = visibleWorldBounds(camera, viewport)
      const candidates = planVisibleTileRegions(bounds, visible, TILE_SIZE, PREFETCH_TILES)
      const scheduledCandidates =
        mapping.range === 'auto' && (mapping.minimum === undefined || mapping.maximum === undefined)
          ? candidates.slice(0, 1)
          : candidates
      const required = new Set<string>()
      const requiredOverlays = new Set<string>()
      for (const candidate of scheduledCandidates) {
        const region = {
          x: candidate.x,
          y: candidate.y,
          width: candidate.width,
          height: candidate.height,
        }
        const mappingKey = `${mapping.range}:${mapping.minimum ?? 'pending'}:${mapping.maximum ?? 'pending'}`
        const tileId = `${opened.generation}:${analysisDataset?.resultHandleId ?? 'source'}:${requestGeneration}:${renderedSelection.displayAxes.join('-')}:${renderedSelection.resolutionLevel}:${component}:${mappingKey}:${candidate.column}:${candidate.row}`
        required.add(tileId)
        if (!renderer.has(tileId) && !pending.has(tileId)) {
          const controller = new AbortController()
          pending.set(tileId, controller)
          const currentGeneration = requestGeneration
          const requestId = tileSequence
          tileSequence += 1
          const tileRequest = {
            tileId,
            datasetHandleId: opened.handleId,
            generation: opened.generation,
            displayAxes: renderedSelection.displayAxes,
            fixedIndices: renderedSelection.fixedIndices,
            resolutionLevel: renderedSelection.resolutionLevel,
            component,
            mapping,
            region,
            priority: candidate.priority,
          }
          const requested =
            analysisDataset === undefined
              ? client.requestTile(tileRequest, controller.signal)
              : client.requestAnalysisDatasetTile(
                  {
                    ...tileRequest,
                    resultHandleId: analysisDataset.resultHandleId,
                    output: analysisDataset.output,
                  },
                  controller.signal,
                )
          void requested
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

        if (analysisOverlay !== undefined) {
          const overlayTileId = `overlay:${analysisOverlay.resultHandleId}:${analysisOverlay.output}:${analysisOverlay.view ?? 'labels'}:${analysisOverlay.tableOutput ?? 'none'}:${candidate.column}:${candidate.row}`
          requiredOverlays.add(overlayTileId)
          if (!renderer.hasOverlay(overlayTileId) && !pending.has(overlayTileId)) {
            const overlayController = new AbortController()
            pending.set(overlayTileId, overlayController)
            void client
              .requestAnalysisOverlay(
                {
                  tileId: overlayTileId,
                  datasetHandleId: opened.handleId,
                  generation: opened.generation,
                  resultHandleId: analysisOverlay.resultHandleId,
                  output: analysisOverlay.output,
                  view: analysisOverlay.view ?? 'labels',
                  ...(analysisOverlay.tableOutput === undefined
                    ? {}
                    : { tableOutput: analysisOverlay.tableOutput }),
                  selection,
                  component: 0,
                  region,
                },
                overlayController.signal,
              )
              .then((tile) => {
                if (overlayController.signal.aborted) return
                renderer.uploadOverlay(tile)
                draw()
              })
              .catch((error: unknown) => {
                if (!overlayController.signal.aborted && tileStatusRef.current !== null) {
                  tileStatusRef.current.textContent =
                    error instanceof Error ? error.message : 'Analysis overlay failed'
                }
              })
              .finally(() => pending.delete(overlayTileId))
          }
        }
      }
      for (const [tileId, controller] of pending) {
        if (!required.has(tileId) && !requiredOverlays.has(tileId)) controller.abort()
      }
      rendererTileIds = required
      renderer.retain(required)
      renderer.retainOverlays(requiredOverlays)
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
    const exportPng = (): Promise<Blob> =>
      new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob === null) reject(new Error('The rendered viewport could not be encoded as PNG.'))
          else resolve(blob)
        }, 'image/png')
      })
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
      if (event.button === 0 && !spacePressed && roiTool !== 'select') {
        event.preventDefault()
        drawingStart = screenToWorld(pointerPosition(event), camera, viewport)
        canvas.setPointerCapture(event.pointerId)
        return
      }
      if (event.button === 0 && !spacePressed && roiTool === 'select') {
        const screen = pointerPosition(event)
        const hit = rois.toReversed().find((roi) =>
          roiPoints(roi).some((point) => {
            const candidate = worldToScreen(point, camera, viewport)
            return Math.hypot(candidate.x - screen.x, candidate.y - screen.y) <= 9
          }),
        )
        if (hit !== undefined) onSelectRoi?.(hit.id)
        else {
          const world = screenToWorld(screen, camera, viewport)
          const label = renderer.labelAt(world)
          canvas.dataset['lastHitLabel'] = String(label ?? 0)
          canvas.dataset['lastHitX'] = String(world.x)
          canvas.dataset['lastHitY'] = String(world.y)
          onSelectLabel?.(label)
        }
        draw()
        return
      }
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
        const physicalX =
          horizontalCalibration === undefined
            ? undefined
            : horizontalCalibration.origin + world.x * horizontalCalibration.unitsPerPixel
        const physicalY =
          verticalCalibration === undefined
            ? undefined
            : verticalCalibration.origin + world.y * verticalCalibration.unitsPerPixel
        const physical =
          horizontalCalibration === undefined || verticalCalibration === undefined
            ? ''
            : ` · ${physicalX?.toFixed(2)}, ${physicalY?.toFixed(2)} ${horizontalCalibration.unit}`
        const dSpacing =
          physicalX === undefined ||
          physicalY === undefined ||
          !horizontalCalibration?.unit.startsWith('1/')
            ? ''
            : (() => {
                const radialFrequency = Math.hypot(physicalX, physicalY)
                return radialFrequency <= 0
                  ? ''
                  : ` · d=${(1 / radialFrequency).toFixed(4)} ${horizontalCalibration.unit.slice(2)}`
              })()
        coordinateRef.current.textContent = `${Math.floor(world.x)}, ${Math.floor(world.y)} px${physical}${dSpacing}${value === undefined ? '' : ` · ${value.toPrecision(5)}`}`
      }
      if (panning) {
        measureUxNextPaint('viewport.pan')
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
      if (drawingStart !== undefined) {
        const start = drawingStart
        const end = screenToWorld(pointerPosition(event), camera, viewport)
        drawingStart = undefined
        const x = Math.max(0, Math.min(start.x, end.x))
        const y = Math.max(0, Math.min(start.y, end.y))
        const width = Math.max(0.5, Math.abs(end.x - start.x))
        const height = Math.max(0.5, Math.abs(end.y - start.y))
        if (roiTool === 'point') onCreateRoi?.({ kind: 'point', point: end })
        else if (roiTool === 'line') onCreateRoi?.({ kind: 'line-segment', start, end })
        else if (roiTool === 'polyline') onCreateRoi?.({ kind: 'polyline', points: [start, end] })
        else if (roiTool === 'rectangle') onCreateRoi?.({ kind: 'rectangle', x, y, width, height })
        else if (roiTool === 'ellipse') {
          onCreateRoi?.({
            kind: 'ellipse',
            center: { x: x + width / 2, y: y + height / 2 },
            radiusX: width / 2,
            radiusY: height / 2,
          })
        } else if (roiTool === 'polygon') {
          onCreateRoi?.({
            kind: 'polygon',
            points: [
              { x, y },
              { x: x + width, y },
              { x: x + width, y: y + height },
              { x, y: y + height },
            ],
          })
        }
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
        return
      }
      if (!panning) return
      panning = false
      canvas.setAttribute('data-panning', 'false')
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault()
      measureUxNextPaint('viewport.zoom')
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
      if (event.key === 'Escape') drawingStart = undefined
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedRoiId !== undefined) {
        event.preventDefault()
        onDeleteRoi?.(selectedRoiId)
        return
      }
      if (
        event.target !== canvas ||
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      )
        return
      event.preventDefault()
      measureUxNextPaint('viewport.pan')
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
    onReady({ exportPng, fit, oneToOne })

    return () => {
      requestGeneration += 1
      onReady(null)
      onRenderSettled?.(false)
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
      if (rendererRef.current === renderer) rendererRef.current = null
      if (redrawRef.current === draw) redrawRef.current = null
      renderer.dispose()
    }
  }, [
    analysisOverlay,
    analysisDataset,
    analysisPoints,
    client,
    component,
    mapping,
    onCreateRoi,
    onDeleteRoi,
    onReady,
    onRenderSettled,
    onSelectRoi,
    onSelectLabel,
    onTile,
    opened,
    roiTool,
    rois,
    selectedRoiId,
    selection,
  ])

  useEffect(() => {
    rendererRef.current?.selectLabel(selectedLabel)
    redrawRef.current?.()
  }, [selectedLabel])

  return (
    <div className="mock-viewport scientific-viewport">
      <canvas
        aria-label={`Scientific image viewport for ${opened.dataset.name ?? opened.dataset.id}`}
        data-analysis-overlay={analysisOverlay?.output ?? 'none'}
        data-analysis-overlay-view={analysisOverlay?.view ?? 'labels'}
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
