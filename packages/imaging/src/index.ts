export {
  omeZarrDirectoryFingerprint,
  selectOmeZarrDirectoryRoot,
} from './ome-zarr-directory.js'
export { authoredOmeZarrDisplayMapping } from './ome-zarr-display.js'
export { PUREJSIMAGE_PACKAGE_VERSION } from './package-version.js'
export type {
  RasterAssetPreflight,
  RasterDatasetSummary,
  RasterPreflightCompatibility,
  RasterPreflightOptions,
  RasterPreflightStage,
  RasterTransportProbe,
} from './raster-preflight.js'
export {
  preflightBadgeLabel,
  preflightRasterAsset,
  RASTER_PREFLIGHT_RANGE_END,
} from './raster-preflight.js'
export {
  createImagingWorkerClient,
  ImagingRpcError,
  ImagingWorkerClient,
  type ImagingWorkerClientOptions,
  isStaleIdError,
} from './worker-client.js'
export { durableOmeZarrRootUrl } from './worker-host/ome-zarr-rpc.js'
export {
  type ImagingAnalysisCatalogExtras,
  ImagingWorkerHost,
  type ImagingWorkerHostOptions,
} from './worker-host.js'
export {
  OME_ZARR_ZIP_FILE_ACCEPT,
  SUPPORTED_FILE_ACCEPT,
  SUPPORTED_READERS,
} from './worker-readers.js'

// Compile-time probes deliberately verify documented package paths without exporting live objects.
export type PublicScientificApi = typeof import('purejsimage/scientific')
export type PublicScientificBrowserApi = typeof import('purejsimage/scientific/browser')
export type PublicOmeZarrReaderApi = typeof import('purejsimage/scientific/readers/ome-zarr')
export type PublicAnalysisApi = typeof import('purejsimage/analysis')
export type PublicAnalysisRuntimeApi = typeof import('purejsimage/analysis/runtime')
export type PublicHttpRangeApi = typeof import('purejsimage/sources/http-range')
export type PublicTiffApi = typeof import('purejsimage/tiff')
export type PublicGeoApi = typeof import('purejsimage/geo')
export type PublicGeoBrowserApi = typeof import('purejsimage/geo/browser')
export type PublicGeoTiffReaderApi = typeof import('purejsimage/geo/readers/geotiff')
export type PublicGeoZarrReaderApi = typeof import('purejsimage/geo/readers/geozarr')
