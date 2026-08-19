/** Intended public hosts. This repository deploys Cloudflare UI apps, not the library homepage. */
export const LIBRARY_SITE_URL = 'https://purejsimage.com'
export const SCIENCE_APP_URL = 'https://lab.purejsimage.com'
export const GEO_APP_URL = 'https://geo.purejsimage.com'

export const SHOWCASE_CARDS = Object.freeze([
  Object.freeze({
    id: 'science',
    title: 'Science',
    summary:
      'Electron microscopy and materials imaging workbench. Open local files, inspect calibration, and replay analysis.',
    href: SCIENCE_APP_URL,
    status: 'live' as const,
    hostLabel: 'lab.purejsimage.com',
  }),
  Object.freeze({
    id: 'geo',
    title: 'Geo',
    summary:
      'Geospatial raster showcase on the shared workbench shell. Domain workflows are still being added.',
    href: GEO_APP_URL,
    status: 'live' as const,
    hostLabel: 'geo.purejsimage.com',
  }),
  Object.freeze({
    id: 'medical',
    title: 'Medical',
    summary:
      'Medical imaging showcase. Planned; this repository does not ship a medical application yet.',
    href: undefined,
    status: 'planned' as const,
    hostLabel: 'Not scheduled',
  }),
])
