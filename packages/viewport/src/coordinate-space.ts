import type { AffineTransform, PixelInterpretation } from '@pji-workbench/contracts'

import { applyAffine, invertAffine, ViewportTransformError } from './affine.js'
import { assertPositive } from './assert.js'
import {
  constrainCamera,
  DEFAULT_CAMERA_LIMITS,
  fitCameraToBounds,
  projectWorldToScreen,
  unprojectScreenToWorld,
} from './camera.js'
import { aabbFromPoints, boundsCorners } from './geometry.js'
import type { Bounds, Camera, CameraLimits, Point, Size, WorldYDirection } from './types.js'

export type CoordinateSpaceKind = 'image' | 'world'

export interface ViewportPointerSample {
  readonly screen: Point
  readonly world: Point
  readonly pixel: Point
}

export interface CoordinateSpaceAdapter {
  readonly kind: CoordinateSpaceKind
  /** +1 when world Y increases down (image/canvas). -1 when world Y increases north (map). */
  readonly worldYDirection: WorldYDirection
  pixelToWorld(pixel: Point): Point
  worldToPixel(world: Point): Point
  pixelBounds(): Bounds
  worldBounds(): Bounds
  worldToScreen(point: Point, camera: Camera, viewport: Size): Point
  screenToWorld(point: Point, camera: Camera, viewport: Size): Point
}

export interface WorldSpaceAffineOptions {
  readonly pixelToWorld: AffineTransform
  readonly worldToPixel?: AffineTransform
  readonly width: number
  readonly height: number
  readonly pixelInterpretation?: PixelInterpretation
}

export function createImageSpaceAdapter(pixelBounds: Bounds): CoordinateSpaceAdapter {
  assertPositive(pixelBounds.width, 'Image width')
  assertPositive(pixelBounds.height, 'Image height')
  const bounds: Bounds = {
    x: pixelBounds.x,
    y: pixelBounds.y,
    width: pixelBounds.width,
    height: pixelBounds.height,
  }
  return {
    kind: 'image',
    worldYDirection: 1,
    pixelToWorld: (pixel) => ({ x: bounds.x + pixel.x, y: bounds.y + pixel.y }),
    worldToPixel: (world) => ({ x: world.x - bounds.x, y: world.y - bounds.y }),
    pixelBounds: () => bounds,
    worldBounds: () => bounds,
    worldToScreen: (point, camera, viewport) => projectWorldToScreen(point, camera, viewport, 1),
    screenToWorld: (point, camera, viewport) => unprojectScreenToWorld(point, camera, viewport, 1),
  }
}

export function createWorldSpaceAffineAdapter(
  options: WorldSpaceAffineOptions,
): CoordinateSpaceAdapter {
  assertPositive(options.width, 'Raster width')
  assertPositive(options.height, 'Raster height')
  const pixelToWorld = options.pixelToWorld
  const worldToPixel = options.worldToPixel ?? invertAffine(pixelToWorld)
  const pixelBounds: Bounds = { x: 0, y: 0, width: options.width, height: options.height }
  const interpretation = options.pixelInterpretation ?? 'pixel-is-area'
  const world = aabbFromPoints(
    rasterPixelCorners(options.width, options.height, interpretation).map((corner) =>
      applyAffine(pixelToWorld, corner),
    ),
  )
  if (!(world.width > 0) || !(world.height > 0)) {
    throw new ViewportTransformError(
      'INVALID_BOUNDS',
      'The affine transform collapses the raster to an empty world envelope',
    )
  }

  return {
    kind: 'world',
    worldYDirection: -1,
    pixelToWorld: (pixel) => applyAffine(pixelToWorld, pixel),
    worldToPixel: (point) => applyAffine(worldToPixel, point),
    pixelBounds: () => pixelBounds,
    worldBounds: () => world,
    worldToScreen: (point, camera, viewport) => projectWorldToScreen(point, camera, viewport, -1),
    screenToWorld: (point, camera, viewport) => unprojectScreenToWorld(point, camera, viewport, -1),
  }
}

export function visibleWorldBounds(
  camera: Camera,
  viewport: Size,
  adapter: CoordinateSpaceAdapter,
): Bounds {
  return aabbFromPoints(
    boundsCorners({ x: 0, y: 0, width: viewport.width, height: viewport.height }).map((corner) =>
      adapter.screenToWorld(corner, camera, viewport),
    ),
  )
}

export function sampleViewportPointer(
  screen: Point,
  camera: Camera,
  viewport: Size,
  adapter: CoordinateSpaceAdapter,
): ViewportPointerSample {
  const world = adapter.screenToWorld(screen, camera, viewport)
  return { screen, world, pixel: adapter.worldToPixel(world) }
}

export function fitCameraToLayer(
  adapter: CoordinateSpaceAdapter,
  viewport: Size,
  padding = 24,
  limits: CameraLimits = DEFAULT_CAMERA_LIMITS,
): Camera {
  return fitCameraToBounds(adapter.worldBounds(), viewport, padding, limits)
}

export function panCameraInSpace(
  camera: Camera,
  screenDelta: Point,
  viewport: Size,
  adapter: CoordinateSpaceAdapter,
  limits: CameraLimits = DEFAULT_CAMERA_LIMITS,
): Camera {
  const origin = { x: viewport.width / 2, y: viewport.height / 2 }
  const moved = { x: origin.x + screenDelta.x, y: origin.y + screenDelta.y }
  const worldOrigin = adapter.screenToWorld(origin, camera, viewport)
  const worldMoved = adapter.screenToWorld(moved, camera, viewport)
  return constrainCamera(
    {
      center: {
        x: camera.center.x - (worldMoved.x - worldOrigin.x),
        y: camera.center.y - (worldMoved.y - worldOrigin.y),
      },
      zoom: camera.zoom,
    },
    adapter.worldBounds(),
    viewport,
    limits,
  )
}

export function zoomCameraAtScreenPointInSpace(
  camera: Camera,
  screenPoint: Point,
  factor: number,
  viewport: Size,
  adapter: CoordinateSpaceAdapter,
  limits: CameraLimits = DEFAULT_CAMERA_LIMITS,
): Camera {
  assertPositive(factor, 'Zoom factor')
  const worldAnchor = adapter.screenToWorld(screenPoint, camera, viewport)
  const zoom = Math.min(limits.maxZoom, Math.max(limits.minZoom, camera.zoom * factor))
  const nextCenter = {
    x: worldAnchor.x - (screenPoint.x - viewport.width / 2) / zoom,
    y: worldAnchor.y - adapter.worldYDirection * ((screenPoint.y - viewport.height / 2) / zoom),
  }
  return constrainCamera({ center: nextCenter, zoom }, adapter.worldBounds(), viewport, limits)
}

function rasterPixelCorners(
  width: number,
  height: number,
  interpretation: PixelInterpretation,
): readonly Point[] {
  if (interpretation === 'pixel-is-point') {
    return [
      { x: -0.5, y: -0.5 },
      { x: width - 0.5, y: -0.5 },
      { x: width - 0.5, y: height - 0.5 },
      { x: -0.5, y: height - 0.5 },
    ]
  }
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
}
