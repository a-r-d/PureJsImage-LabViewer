import { KY_FROM_ABOVE_CATALOG } from './ky-from-above.js'
import { NOAA_DIGITAL_COAST_CATALOG } from './noaa-digital-coast.js'
import type { CatalogRegistryEntry } from './types.js'
import { USGS_3DEP_CATALOG } from './usgs-3dep.js'
import { USGS_LANDSAT_CATALOG } from './usgs-landsat.js'

export const CATALOG_REGISTRY: readonly CatalogRegistryEntry[] = Object.freeze([
  NOAA_DIGITAL_COAST_CATALOG,
  USGS_3DEP_CATALOG,
  USGS_LANDSAT_CATALOG,
  KY_FROM_ABOVE_CATALOG,
])

export function catalogById(id: string): CatalogRegistryEntry | undefined {
  return CATALOG_REGISTRY.find((entry) => entry.id === id)
}
