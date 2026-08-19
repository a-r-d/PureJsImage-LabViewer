import type { DomainUiContributions } from '@pji-workbench/workbench-core'

export const GEO_TERMINOLOGY = Object.freeze({
  applicationTitle: 'PureJsImage Atlas',
  shellHeading: 'PureJsImage Atlas',
  emptyKicker: 'Local-first Cloud Optimized GeoTIFF',
  emptyHeading: 'Open a GeoTIFF or COG',
  emptyBody:
    'Open a local GeoTIFF or a remote HTTPS Cloud Optimized GeoTIFF. The viewport stays in the source CRS and fetches only the ranges needed for the current view.',
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
