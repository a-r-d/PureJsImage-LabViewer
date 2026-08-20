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

/**
 * Overview IFDs often copy the full-resolution ModelPixelScale. Drawing overview
 * pixels with that unscaled affine produces a postage-stamp subset of the fitted
 * world. Keep tagged overview geo tags only when they already cover the same
 * world extent as a scaled full-resolution affine.
 */
export function pixelToWorldForOverview(
  full: AffineTransform,
  fullWidth: number,
  fullHeight: number,
  overviewWidth: number,
  overviewHeight: number,
  tagged?: AffineTransform,
): AffineTransform {
  if (overviewWidth === fullWidth && overviewHeight === fullHeight) {
    return tagged ?? full
  }
  const scaled = scaleAffineToOverview(full, fullWidth, fullHeight, overviewWidth, overviewHeight)
  if (tagged === undefined) return scaled
  const taggedExtent = affineWorldExtent(tagged, overviewWidth, overviewHeight)
  const scaledExtent = affineWorldExtent(scaled, overviewWidth, overviewHeight)
  const widthClose =
    Math.abs(taggedExtent.width - scaledExtent.width) <= Math.max(1e-12, scaledExtent.width * 0.05)
  const heightClose =
    Math.abs(taggedExtent.height - scaledExtent.height) <=
    Math.max(1e-12, scaledExtent.height * 0.05)
  return widthClose && heightClose ? tagged : scaled
}

function affineWorldExtent(
  affine: AffineTransform,
  width: number,
  height: number,
): { readonly width: number; readonly height: number } {
  const corners = [
    applyAffine(affine, 0, 0),
    applyAffine(affine, width, 0),
    applyAffine(affine, 0, height),
    applyAffine(affine, width, height),
  ]
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

function applyAffine(
  affine: AffineTransform,
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  return {
    x: affine[0] * x + affine[1] * y + affine[2],
    y: affine[3] * x + affine[4] * y + affine[5],
  }
}
