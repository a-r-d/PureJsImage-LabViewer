import type { DomainUiContributions } from '@pji-workbench/workbench-core'

export const GEO_TERMINOLOGY = Object.freeze({
  applicationTitle: 'Geo Workbench',
  shellHeading: 'PureJsImage Geo',
  emptyKicker: 'Local-first geospatial rasters',
  emptyHeading: 'Geospatial workflows will land here',
  emptyBody:
    'This showcase uses the shared workbench shell. Geospatial readers, tiles, and analysis are not included yet.',
})

export const geoUiContributions: DomainUiContributions = Object.freeze({
  applicationTitle: GEO_TERMINOLOGY.applicationTitle,
  shellHeading: GEO_TERMINOLOGY.shellHeading,
  emptyState: Object.freeze({
    kicker: GEO_TERMINOLOGY.emptyKicker,
    heading: GEO_TERMINOLOGY.emptyHeading,
    body: GEO_TERMINOLOGY.emptyBody,
  }),
  panels: Object.freeze([]),
  routes: Object.freeze([
    Object.freeze({
      path: '/',
      id: 'geo-workbench',
      component: 'GeoApp',
      title: 'Geo Workbench',
      readyAttribute: 'data-workbench-ready',
    }),
  ]),
})
