import { describe, expect, it } from 'vitest'

import {
  calculateScaleBar,
  constrainCamera,
  fitCameraToBounds,
  hitTest,
  panCamera,
  resizeCamera,
  screenToWorld,
  translateCamera,
  worldToScreen,
  zoomCameraAtScreenPoint,
} from '../src/index.js'

const imageBounds = { x: 0, y: 0, width: 2_048, height: 1_536 }
const viewport = { width: 1_000, height: 700 }

describe('camera math', () => {
  it('translates without mutating the input point', () => {
    const point = { x: 4, y: -2 }
    expect(translateCamera(point, { x: 3, y: 5 })).toEqual({ x: 7, y: 3 })
    expect(point).toEqual({ x: 4, y: -2 })
  })

  it('round trips between world and screen coordinates', () => {
    const camera = { center: { x: 640, y: 480 }, zoom: 1.75 }
    const world = { x: 812, y: 293 }
    expect(screenToWorld(worldToScreen(world, camera, viewport), camera, viewport)).toEqual(world)
  })

  it('fits bounds with padding and keeps the image centered', () => {
    const camera = fitCameraToBounds(imageBounds, viewport, 50)
    expect(camera.center).toEqual({ x: 1_024, y: 768 })
    expect(camera.zoom).toBeCloseTo(600 / 1_536)
  })

  it('keeps the world point under the cursor stable while zooming', () => {
    const camera = fitCameraToBounds(imageBounds, viewport)
    const pointer = { x: 720, y: 250 }
    const before = screenToWorld(pointer, camera, viewport)
    const next = zoomCameraAtScreenPoint(camera, pointer, 1.5, viewport, imageBounds)
    expect(screenToWorld(pointer, next, viewport).x).toBeCloseTo(before.x)
    expect(screenToWorld(pointer, next, viewport).y).toBeCloseTo(before.y)
  })

  it('constrains pan, zoom, and resize to the image limits', () => {
    const camera = { center: { x: 1_024, y: 768 }, zoom: 1 }
    const panned = panCamera(camera, { x: 100_000, y: 100_000 }, viewport, imageBounds)
    expect(panned.center).toEqual({ x: 500, y: 350 })
    expect(constrainCamera({ center: camera.center, zoom: 500 }, imageBounds, viewport).zoom).toBe(
      64,
    )
    expect(
      resizeCamera(camera, viewport, { width: 3_000, height: 2_000 }, imageBounds).center,
    ).toEqual({ x: 1_024, y: 768 })
  })

  it('chooses a stable calibrated scale bar', () => {
    expect(
      calculateScaleBar({ center: { x: 0, y: 0 }, zoom: 2 }, { unitsPerPixel: 0.5, unit: 'nm' }),
    ).toEqual({ worldLength: 40, screenLength: 80, label: '20 nm' })
  })

  it('hit tests the highest priority overlapping overlay', () => {
    const camera = { center: { x: 100, y: 100 }, zoom: 2 }
    const result = hitTest({ x: 500, y: 350 }, camera, viewport, [
      { id: 'image', bounds: { x: 0, y: 0, width: 200, height: 200 }, priority: 0 },
      { id: 'roi-1', bounds: { x: 80, y: 80, width: 40, height: 40 }, priority: 2 },
    ])
    expect(result).toEqual({ id: 'roi-1', worldPoint: { x: 100, y: 100 } })
  })
})
