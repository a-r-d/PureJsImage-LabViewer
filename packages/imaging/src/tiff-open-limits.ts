/**
 * PureJsImage codec defaults (`maxInputBytes` 128 MiB, `maxPixels` 256 Mpx) assume the whole
 * raster is decoded. Atlas COGs are range-read; object size and IFD pixel count are not a
 * decode budget. Keep width/height/decoded-byte defaults.
 */
export function tiffOpenLimits(sourceSize: number): {
  readonly maxInputBytes: number
  readonly maxPixels: number
} {
  return {
    maxInputBytes: Math.max(1, sourceSize),
    maxPixels: 10_000_000_000,
  }
}
