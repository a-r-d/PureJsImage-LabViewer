export interface Point {
  readonly x: number
  readonly y: number
}

export type CameraPoint = Point

export interface Size {
  readonly width: number
  readonly height: number
}

export interface Bounds extends Point, Size {}

export interface Camera {
  readonly center: Point
  /** Screen pixels per world-space pixel. */
  readonly zoom: number
}

export interface CameraLimits {
  readonly minZoom: number
  readonly maxZoom: number
  readonly overscroll: number
}

export interface Calibration {
  readonly unitsPerPixel: number
  readonly unit: string
}

export interface ScaleBarDescriptor {
  readonly worldLength: number
  readonly screenLength: number
  readonly label: string
}

export interface RenderTileDescriptor {
  readonly id: string
  readonly bounds: Bounds
  readonly opacity: number
}

export interface PlannedTileRegion extends Bounds {
  readonly column: number
  readonly row: number
  readonly priority: 'visible' | 'near-visible'
}

export interface OverlayDescriptor {
  readonly id: string
  readonly kind: 'rectangle' | 'ellipse' | 'polygon' | 'line'
  readonly points: readonly Point[]
  readonly selected: boolean
  readonly label?: string
}

export interface ViewportRenderFrame {
  readonly camera: Camera
  readonly viewport: Size
  readonly imageBounds: Bounds
  readonly tiles: readonly RenderTileDescriptor[]
  readonly overlays: readonly OverlayDescriptor[]
}

export interface ViewportRenderer {
  configure(viewport: Size): void
  render(frame: ViewportRenderFrame): void
  dispose(): void
}

export interface HitTestTarget {
  readonly id: string
  readonly bounds: Bounds
  readonly priority: number
}

export interface HitTestResult {
  readonly id: string
  readonly worldPoint: Point
}

const DEFAULT_LIMITS: CameraLimits = {
  minZoom: 0.01,
  maxZoom: 64,
  overscroll: 0,
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number`)
  }
}

export function translateCamera(point: Point, delta: Point): Point {
  return { x: point.x + delta.x, y: point.y + delta.y }
}

export function worldToScreen(point: Point, camera: Camera, viewport: Size): Point {
  return {
    x: (point.x - camera.center.x) * camera.zoom + viewport.width / 2,
    y: (point.y - camera.center.y) * camera.zoom + viewport.height / 2,
  }
}

export function screenToWorld(point: Point, camera: Camera, viewport: Size): Point {
  assertPositive(camera.zoom, 'Camera zoom')
  return {
    x: (point.x - viewport.width / 2) / camera.zoom + camera.center.x,
    y: (point.y - viewport.height / 2) / camera.zoom + camera.center.y,
  }
}

export function constrainCamera(
  camera: Camera,
  imageBounds: Bounds,
  viewport: Size,
  limits: CameraLimits = DEFAULT_LIMITS,
): Camera {
  assertPositive(imageBounds.width, 'Image width')
  assertPositive(imageBounds.height, 'Image height')
  assertPositive(viewport.width, 'Viewport width')
  assertPositive(viewport.height, 'Viewport height')
  assertPositive(limits.minZoom, 'Minimum zoom')
  assertPositive(limits.maxZoom, 'Maximum zoom')

  const zoom = Math.min(limits.maxZoom, Math.max(limits.minZoom, camera.zoom))
  const halfWorldWidth = viewport.width / (2 * zoom)
  const halfWorldHeight = viewport.height / (2 * zoom)
  const imageCenterX = imageBounds.x + imageBounds.width / 2
  const imageCenterY = imageBounds.y + imageBounds.height / 2
  const overscrollWorld = Math.max(0, limits.overscroll) / zoom
  const minX = imageBounds.x + halfWorldWidth - overscrollWorld
  const maxX = imageBounds.x + imageBounds.width - halfWorldWidth + overscrollWorld
  const minY = imageBounds.y + halfWorldHeight - overscrollWorld
  const maxY = imageBounds.y + imageBounds.height - halfWorldHeight + overscrollWorld

  return {
    zoom,
    center: {
      x: minX > maxX ? imageCenterX : Math.min(maxX, Math.max(minX, camera.center.x)),
      y: minY > maxY ? imageCenterY : Math.min(maxY, Math.max(minY, camera.center.y)),
    },
  }
}

export function fitCameraToBounds(
  bounds: Bounds,
  viewport: Size,
  padding = 24,
  limits: CameraLimits = DEFAULT_LIMITS,
): Camera {
  assertPositive(bounds.width, 'Bounds width')
  assertPositive(bounds.height, 'Bounds height')
  const availableWidth = Math.max(1, viewport.width - padding * 2)
  const availableHeight = Math.max(1, viewport.height - padding * 2)
  const zoom = Math.min(availableWidth / bounds.width, availableHeight / bounds.height)

  return constrainCamera(
    {
      center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      zoom,
    },
    bounds,
    viewport,
    limits,
  )
}

export function zoomCameraAtScreenPoint(
  camera: Camera,
  screenPoint: Point,
  factor: number,
  viewport: Size,
  imageBounds: Bounds,
  limits: CameraLimits = DEFAULT_LIMITS,
): Camera {
  assertPositive(factor, 'Zoom factor')
  const worldAnchor = screenToWorld(screenPoint, camera, viewport)
  const zoom = Math.min(limits.maxZoom, Math.max(limits.minZoom, camera.zoom * factor))
  const nextCenter = {
    x: worldAnchor.x - (screenPoint.x - viewport.width / 2) / zoom,
    y: worldAnchor.y - (screenPoint.y - viewport.height / 2) / zoom,
  }
  return constrainCamera({ center: nextCenter, zoom }, imageBounds, viewport, limits)
}

export function panCamera(
  camera: Camera,
  screenDelta: Point,
  viewport: Size,
  imageBounds: Bounds,
  limits: CameraLimits = DEFAULT_LIMITS,
): Camera {
  const next = {
    center: {
      x: camera.center.x - screenDelta.x / camera.zoom,
      y: camera.center.y - screenDelta.y / camera.zoom,
    },
    zoom: camera.zoom,
  }
  return constrainCamera(next, imageBounds, viewport, limits)
}

export function resizeCamera(
  camera: Camera,
  _previousViewport: Size,
  nextViewport: Size,
  imageBounds: Bounds,
  limits: CameraLimits = DEFAULT_LIMITS,
): Camera {
  return constrainCamera(camera, imageBounds, nextViewport, limits)
}

function formatMeasurement(value: number): string {
  if (value >= 100) return value.toFixed(0)
  if (value >= 10) return value.toFixed(1).replace(/\.0$/, '')
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function calculateScaleBar(
  camera: Camera,
  calibration: Calibration,
  targetScreenLength = 120,
): ScaleBarDescriptor {
  assertPositive(camera.zoom, 'Camera zoom')
  assertPositive(calibration.unitsPerPixel, 'Calibration units per pixel')
  assertPositive(targetScreenLength, 'Target scale bar length')
  const rawPhysicalLength = (targetScreenLength / camera.zoom) * calibration.unitsPerPixel
  const magnitude = 10 ** Math.floor(Math.log10(rawPhysicalLength))
  const normalized = rawPhysicalLength / magnitude
  const niceNormalized = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1
  const physicalLength = niceNormalized * magnitude
  const worldLength = physicalLength / calibration.unitsPerPixel
  return {
    worldLength,
    screenLength: worldLength * camera.zoom,
    label: `${formatMeasurement(physicalLength)} ${calibration.unit}`,
  }
}

export function hitTest(
  screenPoint: Point,
  camera: Camera,
  viewport: Size,
  targets: readonly HitTestTarget[],
): HitTestResult | undefined {
  const worldPoint = screenToWorld(screenPoint, camera, viewport)
  const hit = [...targets]
    .sort((a, b) => b.priority - a.priority)
    .find(
      ({ bounds }) =>
        worldPoint.x >= bounds.x &&
        worldPoint.x <= bounds.x + bounds.width &&
        worldPoint.y >= bounds.y &&
        worldPoint.y <= bounds.y + bounds.height,
    )
  return hit === undefined ? undefined : { id: hit.id, worldPoint }
}

export function planVisibleTileRegions(
  imageBounds: Bounds,
  visibleBounds: Bounds,
  tileSize = 256,
  prefetchTiles = 1,
): readonly PlannedTileRegion[] {
  assertPositive(imageBounds.width, 'Image width')
  assertPositive(imageBounds.height, 'Image height')
  assertPositive(visibleBounds.width, 'Visible width')
  assertPositive(visibleBounds.height, 'Visible height')
  assertPositive(tileSize, 'Tile size')
  if (
    !Number.isSafeInteger(tileSize) ||
    !Number.isSafeInteger(prefetchTiles) ||
    prefetchTiles < 0
  ) {
    throw new RangeError('Tile size and prefetch margin must be safe integers')
  }
  const firstColumn = Math.max(
    0,
    Math.floor((visibleBounds.x - imageBounds.x) / tileSize) - prefetchTiles,
  )
  const firstRow = Math.max(
    0,
    Math.floor((visibleBounds.y - imageBounds.y) / tileSize) - prefetchTiles,
  )
  const finalColumn = Math.min(
    Math.ceil(imageBounds.width / tileSize) - 1,
    Math.floor((visibleBounds.x + visibleBounds.width - imageBounds.x) / tileSize) + prefetchTiles,
  )
  const finalRow = Math.min(
    Math.ceil(imageBounds.height / tileSize) - 1,
    Math.floor((visibleBounds.y + visibleBounds.height - imageBounds.y) / tileSize) + prefetchTiles,
  )
  const regions: PlannedTileRegion[] = []
  for (let row = firstRow; row <= finalRow; row += 1) {
    for (let column = firstColumn; column <= finalColumn; column += 1) {
      const x = imageBounds.x + column * tileSize
      const y = imageBounds.y + row * tileSize
      const width = Math.min(tileSize, imageBounds.x + imageBounds.width - x)
      const height = Math.min(tileSize, imageBounds.y + imageBounds.height - y)
      const visible =
        x < visibleBounds.x + visibleBounds.width &&
        x + width > visibleBounds.x &&
        y < visibleBounds.y + visibleBounds.height &&
        y + height > visibleBounds.y
      regions.push({
        column,
        row,
        x,
        y,
        width,
        height,
        priority: visible ? 'visible' : 'near-visible',
      })
    }
  }
  const center = {
    x: visibleBounds.x + visibleBounds.width / 2,
    y: visibleBounds.y + visibleBounds.height / 2,
  }
  return regions.sort((left, right) => {
    const priority = Number(right.priority === 'visible') - Number(left.priority === 'visible')
    if (priority !== 0) return priority
    const leftDistance = Math.hypot(
      left.x + left.width / 2 - center.x,
      left.y + left.height / 2 - center.y,
    )
    const rightDistance = Math.hypot(
      right.x + right.width / 2 - center.x,
      right.y + right.height / 2 - center.y,
    )
    return leftDistance - rightDistance
  })
}
