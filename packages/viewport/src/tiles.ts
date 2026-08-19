import { assertPositive } from './assert.js'
import type { Bounds, PlannedTileRegion } from './types.js'

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
