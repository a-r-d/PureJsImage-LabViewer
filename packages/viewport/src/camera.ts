import { assertPositive } from './assert.js'
import type {
  Bounds,
  Calibration,
  Camera,
  CameraLimits,
  HitTestResult,
  HitTestTarget,
  Point,
  ScaleBarDescriptor,
  Size,
  WorldYDirection,
} from './types.js'

export const DEFAULT_CAMERA_LIMITS: CameraLimits = Object.freeze({
  minZoom: 0.01,
  maxZoom: 64,
  overscroll: 0,
})

export function translateCamera(point: Point, delta: Point): Point {
  return { x: point.x + delta.x, y: point.y + delta.y }
}

export function worldToScreen(point: Point, camera: Camera, viewport: Size): Point {
  return projectWorldToScreen(point, camera, viewport, 1)
}

export function screenToWorld(point: Point, camera: Camera, viewport: Size): Point {
  return unprojectScreenToWorld(point, camera, viewport, 1)
}

export function projectWorldToScreen(
  point: Point,
  camera: Camera,
  viewport: Size,
  worldYDirection: WorldYDirection,
): Point {
  return {
    x: (point.x - camera.center.x) * camera.zoom + viewport.width / 2,
    y: (point.y - camera.center.y) * camera.zoom * worldYDirection + viewport.height / 2,
  }
}

export function unprojectScreenToWorld(
  point: Point,
  camera: Camera,
  viewport: Size,
  worldYDirection: WorldYDirection,
): Point {
  assertPositive(camera.zoom, 'Camera zoom')
  return {
    x: (point.x - viewport.width / 2) / camera.zoom + camera.center.x,
    y: ((point.y - viewport.height / 2) / camera.zoom) * worldYDirection + camera.center.y,
  }
}

export function constrainCamera(
  camera: Camera,
  imageBounds: Bounds,
  viewport: Size,
  limits: CameraLimits = DEFAULT_CAMERA_LIMITS,
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
  limits: CameraLimits = DEFAULT_CAMERA_LIMITS,
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
  limits: CameraLimits = DEFAULT_CAMERA_LIMITS,
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
  limits: CameraLimits = DEFAULT_CAMERA_LIMITS,
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
  limits: CameraLimits = DEFAULT_CAMERA_LIMITS,
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
