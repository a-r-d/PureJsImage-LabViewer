import type { AffineTransform } from '@pji-workbench/contracts'

import { assertPositive } from './assert.js'
import type { Bounds, Camera, Size } from './types.js'

export interface OverviewLevelSize {
  readonly level: number
  readonly width: number
  readonly height: number
}

/**
 * Pick the coarsest overview whose width still covers the viewport at the current zoom.
 * `camera.zoom` is screen pixels per world unit.
 */
export function selectOverviewLevel(
  levels: readonly OverviewLevelSize[],
  camera: Camera,
  viewport: Size,
  worldBounds: Bounds,
): number {
  if (levels.length === 0) return 0
  assertPositive(viewport.width, 'Viewport width')
  assertPositive(worldBounds.width, 'World width')
  const desiredWidth = Math.max(1, camera.zoom * worldBounds.width)
  const sorted = [...levels].sort((left, right) => left.width - right.width)
  const adequate = sorted.find((level) => level.width >= desiredWidth * 0.75)
  return (adequate ?? sorted[sorted.length - 1])?.level ?? 0
}

export function scaleAffineToOverview(
  full: AffineTransform,
  fullWidth: number,
  fullHeight: number,
  overviewWidth: number,
  overviewHeight: number,
): AffineTransform {
  assertPositive(fullWidth, 'Full width')
  assertPositive(fullHeight, 'Full height')
  assertPositive(overviewWidth, 'Overview width')
  assertPositive(overviewHeight, 'Overview height')
  const scaleX = fullWidth / overviewWidth
  const scaleY = fullHeight / overviewHeight
  return [full[0] * scaleX, full[1] * scaleY, full[2], full[3] * scaleX, full[4] * scaleY, full[5]]
}
