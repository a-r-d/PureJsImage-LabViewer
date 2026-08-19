export { PUREJSIMAGE_PACKAGE_VERSION } from './package-version.js'
export {
  createImagingWorkerClient,
  ImagingRpcError,
  ImagingWorkerClient,
} from './worker-client.js'
export { ImagingWorkerHost } from './worker-host.js'
export { SUPPORTED_FILE_ACCEPT, SUPPORTED_READERS } from './worker-readers.js'

// Compile-time probes deliberately verify documented package paths without exporting live objects.
export type PublicScientificApi = typeof import('purejsimage/scientific')
export type PublicScientificBrowserApi = typeof import('purejsimage/scientific/browser')
export type PublicAnalysisApi = typeof import('purejsimage/analysis')
export type PublicAnalysisRuntimeApi = typeof import('purejsimage/analysis/runtime')
export type PublicHttpRangeApi = typeof import('purejsimage/sources/http-range')
export type PublicTiffApi = typeof import('purejsimage/tiff')
