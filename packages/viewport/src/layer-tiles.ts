import type { CoordinateSpaceAdapter } from './coordinate-space.js'
import { aabbFromPoints, boundsCorners, intersectBounds } from './geometry.js'
import { planVisibleTileRegions } from './tiles.js'
import type { Bounds, PlannedTileRegion } from './types.js'

export interface TileLayerPlanInput {
  readonly layerId: string
  readonly sourceId: string
  readonly visible: boolean
  readonly adapter: CoordinateSpaceAdapter
}

export interface LayerTilePlan {
  readonly layerId: string
  readonly sourceId: string
  readonly regions: readonly PlannedTileRegion[]
}

export interface PlannedSourceTile {
  readonly sourceId: string
  readonly region: PlannedTileRegion
}

export interface MultiLayerTilePlan {
  readonly layers: readonly LayerTilePlan[]
  readonly sourceTiles: readonly PlannedSourceTile[]
}

export function sourceTileCacheKey(sourceId: string, column: number, row: number): string {
  return `${sourceId}:${column}:${row}`
}

export function planMultiLayerTiles(
  layers: readonly TileLayerPlanInput[],
  visibleWorld: Bounds,
  tileSize = 256,
  prefetchTiles = 1,
): MultiLayerTilePlan {
  const layerPlans: LayerTilePlan[] = []
  const sourceTiles: PlannedSourceTile[] = []
  const seen = new Set<string>()

  for (const layer of layers) {
    if (!layer.visible) {
      layerPlans.push({ layerId: layer.layerId, sourceId: layer.sourceId, regions: [] })
      continue
    }
    const overlap = intersectBounds(visibleWorld, layer.adapter.worldBounds())
    if (overlap === undefined) {
      layerPlans.push({ layerId: layer.layerId, sourceId: layer.sourceId, regions: [] })
      continue
    }
    const pixelVisible = intersectBounds(
      layer.adapter.pixelBounds(),
      worldAabbToPixelAabb(layer.adapter, overlap),
    )
    if (pixelVisible === undefined) {
      layerPlans.push({ layerId: layer.layerId, sourceId: layer.sourceId, regions: [] })
      continue
    }
    const regions = planVisibleTileRegions(
      layer.adapter.pixelBounds(),
      pixelVisible,
      tileSize,
      prefetchTiles,
    )
    layerPlans.push({ layerId: layer.layerId, sourceId: layer.sourceId, regions })
    for (const region of regions) {
      const key = sourceTileCacheKey(layer.sourceId, region.column, region.row)
      if (seen.has(key)) continue
      seen.add(key)
      sourceTiles.push({ sourceId: layer.sourceId, region })
    }
  }

  return { layers: layerPlans, sourceTiles }
}

function worldAabbToPixelAabb(adapter: CoordinateSpaceAdapter, world: Bounds): Bounds {
  return aabbFromPoints(boundsCorners(world).map((corner) => adapter.worldToPixel(corner)))
}
