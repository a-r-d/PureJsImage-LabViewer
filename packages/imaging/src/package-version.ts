/**
 * Runtime pin for the published PureJsImage package.
 *
 * Authoritative source: `packages/imaging/package.json` `dependencies.purejsimage`.
 * Imaging tests compare this constant to that specifier and to the other package pins.
 * Apps and workbench-core should import this value instead of duplicating version strings.
 */
export const PUREJSIMAGE_PACKAGE_VERSION = '0.16.0' as const
