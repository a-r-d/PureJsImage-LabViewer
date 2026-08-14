export const PUREJSIMAGE_PACKAGE_VERSION = '0.10.0' as const

// These compile-time imports deliberately verify documented public package exports without
// pulling the scientific runtime into the bootstrap application bundle.
export type PublicScientificApi = typeof import('purejsimage/scientific')
export type PublicScientificBrowserApi = typeof import('purejsimage/scientific/browser')
