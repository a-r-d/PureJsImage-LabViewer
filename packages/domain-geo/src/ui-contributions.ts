import type { DomainUiContributions } from '@pji-workbench/workbench-core'

export const GEO_TERMINOLOGY = Object.freeze({
  applicationTitle: 'PureJsImage Atlas',
  shellHeading: 'PureJsImage Atlas',
  emptyKicker: 'Kentucky From Above and local COGs',
  emptyHeading: 'Search a catalog, then click a tile to open it',
  emptyBody:
    'Click a tile name after search. Atlas stays in the source CRS and fetches only the HTTP ranges needed for the current view. You can also open a local GeoTIFF or paste a Cloud Optimized GeoTIFF URL.',
})

export const geoUiContributions: DomainUiContributions = Object.freeze({
  applicationTitle: GEO_TERMINOLOGY.applicationTitle,
  shellHeading: GEO_TERMINOLOGY.shellHeading,
  emptyState: Object.freeze({
    kicker: GEO_TERMINOLOGY.emptyKicker,
    heading: GEO_TERMINOLOGY.emptyHeading,
    body: GEO_TERMINOLOGY.emptyBody,
  }),
  panels: Object.freeze([
    Object.freeze({ id: 'geo-catalog', title: 'Catalog', surface: 'inspector' as const }),
    Object.freeze({ id: 'geo-layers', title: 'Layers', surface: 'inspector' as const }),
    Object.freeze({ id: 'geo-display', title: 'Display', surface: 'inspector' as const }),
    Object.freeze({ id: 'geo-xray', title: 'COG X-ray', surface: 'inspector' as const }),
  ]),
  routes: Object.freeze([
    Object.freeze({
      path: '/',
      id: 'geo-workbench',
      component: 'GeoApp',
      title: 'PureJsImage Atlas',
      readyAttribute: 'data-workbench-ready',
    }),
  ]),
})
