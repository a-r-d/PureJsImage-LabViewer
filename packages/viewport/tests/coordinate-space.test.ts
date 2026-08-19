import type { AffineTransform, PixelInterpretation } from '@pji-workbench/contracts'
import { describe, expect, it } from 'vitest'

import {
  createImageSpaceAdapter,
  createWorldSpaceAffineAdapter,
  fitCameraToBounds,
  fitCameraToLayer,
  invertAffine,
  panCamera,
  panCameraInSpace,
  planMultiLayerTiles,
  planVisibleTileRegions,
  sampleViewportPointer,
  scaleAffineToOverview,
  screenToWorld,
  selectOverviewLevel,
  ViewportCameraSession,
  ViewportTransformError,
  visibleWorldBounds,
  worldToScreen,
  zoomCameraAtScreenPoint,
  zoomCameraAtScreenPointInSpace,
} from '../src/index.js'

const imageBounds = { x: 0, y: 0, width: 2_048, height: 1_536 }
const viewport = { width: 1_000, height: 700 }

const NORTH_UP_AFFINE: AffineTransform = [10, 0, 100, 0, -20, 200]
const ROTATED_AFFINE: AffineTransform = [2, 0.5, 10, -0.25, -3, 20]
const NEGATIVE_Y_AFFINE: AffineTransform = [5, 0, 0, 0, -8, 80]

describe('image-space adapter', () => {
  const adapter = createImageSpaceAdapter(imageBounds)

  it('keeps the existing science camera mapping', () => {
    const camera = fitCameraToBounds(imageBounds, viewport)
    const world = { x: 812, y: 293 }
    expect(adapter.kind).toBe('image')
    expect(adapter.worldBounds()).toEqual(imageBounds)
    expect(adapter.pixelToWorld({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 })
    expect(adapter.worldToScreen(world, camera, viewport)).toEqual(
      worldToScreen(world, camera, viewport),
    )
    expect(adapter.screenToWorld({ x: 400, y: 220 }, camera, viewport)).toEqual(
      screenToWorld({ x: 400, y: 220 }, camera, viewport),
    )
    expect(panCameraInSpace(camera, { x: 40, y: -12 }, viewport, adapter)).toEqual(
      panCamera(camera, { x: 40, y: -12 }, viewport, imageBounds),
    )
    expect(
      zoomCameraAtScreenPointInSpace(camera, { x: 720, y: 250 }, 1.5, viewport, adapter),
    ).toEqual(zoomCameraAtScreenPoint(camera, { x: 720, y: 250 }, 1.5, viewport, imageBounds))
  })

  it('plans the same visible tiles as the image-space helper', () => {
    const adapterCamera = fitCameraToBounds(imageBounds, viewport)
    const visible = visibleWorldBounds(adapterCamera, viewport, adapter)
    expect(planVisibleTileRegions(adapter.pixelBounds(), visible, 256, 1)).toEqual(
      planVisibleTileRegions(imageBounds, visible, 256, 1),
    )
  })
})

describe('world-space affine adapter', () => {
  it('maps a north-up affine onto the model envelope', () => {
    const adapter = createWorldSpaceAffineAdapter({
      pixelToWorld: NORTH_UP_AFFINE,
      width: 4,
      height: 2,
      pixelInterpretation: 'pixel-is-area',
    })
    expect(adapter.pixelToWorld({ x: 0, y: 0 })).toEqual({ x: 100, y: 200 })
    expect(adapter.pixelToWorld({ x: 4, y: 2 })).toEqual({ x: 140, y: 160 })
    expect(adapter.worldBounds()).toEqual({ x: 100, y: 160, width: 40, height: 40 })
  })

  it('uses a negative Y scale so row 0 is north', () => {
    const adapter = createWorldSpaceAffineAdapter({
      pixelToWorld: NEGATIVE_Y_AFFINE,
      width: 2,
      height: 4,
    })
    expect(NEGATIVE_Y_AFFINE[4]).toBeLessThan(0)
    expect(adapter.pixelToWorld({ x: 0, y: 0 }).y).toBe(80)
    expect(adapter.pixelToWorld({ x: 0, y: 4 }).y).toBe(48)
    expect(adapter.worldBounds()).toEqual({ x: 0, y: 48, width: 10, height: 32 })
  })

  it('computes rotated and sheared bounds from transformed corners', () => {
    const adapter = createWorldSpaceAffineAdapter({
      pixelToWorld: ROTATED_AFFINE,
      width: 4,
      height: 2,
    })
    expect(adapter.worldBounds()).toEqual({ x: 10, y: 13, width: 9, height: 7 })
    expect(adapter.pixelToWorld({ x: 4, y: 0 })).toEqual({ x: 18, y: 19 })
    expect(adapter.pixelToWorld({ x: 4, y: 2 })).toEqual({ x: 19, y: 13 })
  })

  it('round-trips world and pixel coordinates', () => {
    const adapter = createWorldSpaceAffineAdapter({
      pixelToWorld: ROTATED_AFFINE,
      worldToPixel: invertAffine(ROTATED_AFFINE),
      width: 4,
      height: 2,
    })
    const pixel = { x: 3, y: 1 }
    const world = adapter.pixelToWorld(pixel)
    expect(world.x).toBeCloseTo(2 * 3 + 0.5 * 1 + 10)
    expect(world.y).toBeCloseTo(-0.25 * 3 - 3 * 1 + 20)
    expect(adapter.worldToPixel(world).x).toBeCloseTo(3, 12)
    expect(adapter.worldToPixel(world).y).toBeCloseTo(1, 12)
  })

  it('fits a layer to its world envelope and keeps north at the top of the screen', () => {
    const adapter = createWorldSpaceAffineAdapter({
      pixelToWorld: NORTH_UP_AFFINE,
      width: 4,
      height: 2,
    })
    const mapViewport = { width: 400, height: 400 }
    const session = new ViewportCameraSession(fitCameraToLayer(adapter, mapViewport, 0))
    expect(session.camera.center).toEqual({ x: 120, y: 180 })
    expect(session.camera.zoom).toBe(10)
    const north = adapter.worldToScreen({ x: 100, y: 200 }, session.camera, mapViewport)
    const south = adapter.worldToScreen({ x: 100, y: 160 }, session.camera, mapViewport)
    expect(north.y).toBeLessThan(south.y)
    expect(north).toEqual({ x: 0, y: 0 })
    expect(south).toEqual({ x: 0, y: 400 })
  })

  it('samples map coordinates under the pointer while panning and zooming', () => {
    const adapter = createWorldSpaceAffineAdapter({
      pixelToWorld: NORTH_UP_AFFINE,
      width: 4,
      height: 2,
    })
    const mapViewport = { width: 400, height: 400 }
    const session = new ViewportCameraSession(fitCameraToLayer(adapter, mapViewport, 0))
    const pointer = { x: 200, y: 120 }
    const before = sampleViewportPointer(pointer, session.camera, mapViewport, adapter)
    expect(before.world).toEqual({ x: 120, y: 188 })
    expect(before.pixel.x).toBeCloseTo(2)
    expect(before.pixel.y).toBeCloseTo(0.6)

    session.replace(
      zoomCameraAtScreenPointInSpace(session.camera, pointer, 2, mapViewport, adapter),
    )
    const zoomed = sampleViewportPointer(pointer, session.camera, mapViewport, adapter)
    expect(zoomed.world.x).toBeCloseTo(before.world.x)
    expect(zoomed.world.y).toBeCloseTo(before.world.y)

    session.replace(panCameraInSpace(session.camera, { x: 30, y: 16 }, mapViewport, adapter))
    const dragged = sampleViewportPointer(
      { x: pointer.x + 30, y: pointer.y + 16 },
      session.camera,
      mapViewport,
      adapter,
    )
    expect(dragged.world.x).toBeCloseTo(zoomed.world.x)
    expect(dragged.world.y).toBeCloseTo(zoomed.world.y)
  })

  it('shares cached source tiles across two same-CRS layers', () => {
    const adapter = createWorldSpaceAffineAdapter({
      pixelToWorld: NORTH_UP_AFFINE,
      width: 512,
      height: 256,
    })
    const camera = fitCameraToLayer(adapter, viewport, 0)
    const visible = visibleWorldBounds(camera, viewport, adapter)
    const plan = planMultiLayerTiles(
      [
        { layerId: 'style-gray', sourceId: 'raster-a', visible: true, adapter },
        { layerId: 'style-rgb', sourceId: 'raster-a', visible: true, adapter },
      ],
      visible,
      256,
      0,
    )
    expect(plan.layers).toHaveLength(2)
    expect(plan.layers[0]?.regions.length).toBeGreaterThan(0)
    expect(plan.layers[0]?.regions).toEqual(plan.layers[1]?.regions)
    expect(plan.sourceTiles.length).toBe(plan.layers[0]?.regions.length)
    expect(new Set(plan.sourceTiles.map(({ sourceId }) => sourceId))).toEqual(new Set(['raster-a']))
  })

  it('selects tiles for two same-CRS sources without mixing their caches', () => {
    const left = createWorldSpaceAffineAdapter({
      pixelToWorld: NORTH_UP_AFFINE,
      width: 512,
      height: 256,
    })
    const right = createWorldSpaceAffineAdapter({
      pixelToWorld: [10, 0, 140, 0, -20, 200],
      width: 512,
      height: 256,
    })
    const camera = fitCameraToLayer(left, viewport, 0)
    const visible = visibleWorldBounds(camera, viewport, left)
    const plan = planMultiLayerTiles(
      [
        { layerId: 'west', sourceId: 'west-src', visible: true, adapter: left },
        { layerId: 'east', sourceId: 'east-src', visible: true, adapter: right },
      ],
      visible,
      256,
      0,
    )
    expect(plan.layers.map(({ layerId }) => layerId)).toEqual(['west', 'east'])
    expect(new Set(plan.sourceTiles.map(({ sourceId }) => sourceId))).toEqual(
      new Set(['west-src', 'east-src']),
    )
    expect(plan.sourceTiles.length).toBe(
      (plan.layers[0]?.regions.length ?? 0) + (plan.layers[1]?.regions.length ?? 0),
    )
  })

  it('uses pixel-is-point outer corners when computing the envelope', () => {
    const adapter = createWorldSpaceAffineAdapter({
      pixelToWorld: NORTH_UP_AFFINE,
      width: 4,
      height: 2,
      pixelInterpretation: 'pixel-is-point' satisfies PixelInterpretation,
    })
    expect(adapter.worldBounds()).toEqual({ x: 95, y: 170, width: 40, height: 40 })
  })

  it('rejects a singular affine', () => {
    expect(() =>
      createWorldSpaceAffineAdapter({
        pixelToWorld: [0, 0, 1, 0, 0, 2],
        width: 4,
        height: 2,
      }),
    ).toThrow(ViewportTransformError)
  })
})

describe('overview selection', () => {
  it('picks a coarse overview when the whole raster fits in the viewport', () => {
    const worldBounds = { x: 0, y: 0, width: 10_000, height: 8_000 }
    const camera = { center: { x: 5_000, y: 4_000 }, zoom: 800 / 10_000 }
    expect(
      selectOverviewLevel(
        [
          { level: 0, width: 10_000, height: 8_000 },
          { level: 1, width: 2_500, height: 2_000 },
          { level: 2, width: 625, height: 500 },
        ],
        camera,
        { width: 800, height: 640 },
        worldBounds,
      ),
    ).toBe(2)
  })

  it('scales a full-resolution affine onto an overview grid', () => {
    expect(scaleAffineToOverview(NORTH_UP_AFFINE, 4, 2, 2, 1)).toEqual([20, 0, 100, 0, -40, 200])
  })
})
