import { assertFinite } from './assert.js'
import type { Bounds, Point } from './types.js'

export function aabbFromPoints(points: readonly Point[]): Bounds {
  if (points.length === 0) {
    throw new RangeError('At least one point is required to compute bounds')
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    const x = assertFinite(point.x, 'Point x')
    const y = assertFinite(point.y, 'Point y')
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function intersectBounds(left: Bounds, right: Bounds): Bounds | undefined {
  const x = Math.max(left.x, right.x)
  const y = Math.max(left.y, right.y)
  const maxX = Math.min(left.x + left.width, right.x + right.width)
  const maxY = Math.min(left.y + left.height, right.y + right.height)
  if (!(maxX > x) || !(maxY > y)) return undefined
  return { x, y, width: maxX - x, height: maxY - y }
}

export function boundsCorners(bounds: Bounds): readonly Point[] {
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ]
}
