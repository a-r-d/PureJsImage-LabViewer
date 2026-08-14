export {
  createImagingWorkerClient,
  ImagingRpcError,
  ImagingWorkerClient,
} from './worker-client.js'
export { ImagingWorkerHost } from './worker-host.js'
export { SUPPORTED_READERS } from './worker-readers.js'

export const PUREJSIMAGE_PACKAGE_VERSION = '0.10.0' as const

// Compile-time probes deliberately verify documented package paths without exporting live objects.
export type PublicScientificApi = typeof import('purejsimage/scientific')
export type PublicScientificBrowserApi = typeof import('purejsimage/scientific/browser')
export type PublicAnalysisApi = typeof import('purejsimage/analysis')
export type PublicAnalysisRuntimeApi = typeof import('purejsimage/analysis/runtime')
export type PublicHttpRangeApi = typeof import('purejsimage/sources/http-range')
