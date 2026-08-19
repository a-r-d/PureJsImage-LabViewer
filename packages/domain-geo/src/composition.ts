import { CrsTransformError, sameCrs } from './crs.js'
import type { GeoLayer, GeoProject, GeoRasterSource } from './model.js'

export function orderedGeoLayers(layers: readonly GeoLayer[]): readonly GeoLayer[] {
  return layers
    .map((layer, index) => ({ layer, index }))
    .sort((left, right) => left.layer.zIndex - right.layer.zIndex || left.index - right.index)
    .map(({ layer }) => layer)
}

export function visibleGeoLayers(layers: readonly GeoLayer[]): readonly GeoLayer[] {
  return orderedGeoLayers(layers).filter((layer) => layer.visible && layer.opacity > 0)
}

export function sourceForLayer(project: GeoProject, layer: GeoLayer): GeoRasterSource | undefined {
  if (layer.sourceId === undefined) return undefined
  return project.sources.find((source) => source.id === layer.sourceId)
}

/**
 * Same-CRS composition only. Native source CRS display does not reproject pixels.
 */
export function assertSameCrsComposition(project: GeoProject): void {
  for (const source of project.sources) {
    if (sameCrs(source.spatialReference.crs, project.crs)) continue
    throw new CrsTransformError(
      'UNSUPPORTED_TRANSFORM',
      `Source ${source.id} cannot be composed into the project CRS without pixel reprojection`,
      source.spatialReference.crs,
      project.crs,
    )
  }
}
