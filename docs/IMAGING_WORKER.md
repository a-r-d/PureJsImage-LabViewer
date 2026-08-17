# Imaging Worker and scientific viewer

## Ownership

`packages/imaging` owns the module Worker and every live PureJsImage object. The Worker creates the
scientific library, documents, datasets, numeric tile sources, tile runtime, and the built-in
analysis controller bundle. The main thread receives only versioned portable descriptors, opaque
IDs, diagnostics, and bounded render tiles.

The only non-JSON attachment is a browser `Blob` used by `source.open-local`. It is a
structured-clone input handle, never a PureJsImage object. Pixel storage, readers, and runtime
handles do not cross the boundary.

## Public PureJsImage imports

The integration uses these documented `purejsimage@0.11.0` paths and symbols:

| Package path | Symbols |
| --- | --- |
| `purejsimage/scientific` | `createScientificLibrary`, `normalizeScientificRelativeName`, `resolveNumericTileSource`, `numericTileSampleOffset`, `supportsScientificPlaneRead` |
| `purejsimage/scientific/browser` | `createScientificFileContext` |
| `purejsimage/scientific/readers/png` | `pngReader` |
| `purejsimage/scientific/readers/jpeg` | `jpegReader` |
| `purejsimage/scientific/readers/webp` | `webpReader` |
| `purejsimage/scientific/readers/bmp` | `bmpReader` |
| `purejsimage/scientific/readers/jp2` | `jp2Reader` |
| `purejsimage/scientific/readers/tiff` | `tiffReader` |
| `purejsimage/scientific/readers/ome-tiff` | `omeTiffReader` |
| `purejsimage/scientific/readers/aperio-svs` | `aperioSvsReader` |
| `purejsimage/scientific/readers/digital-micrograph` | `digitalMicrographReader` |
| `purejsimage/scientific/readers/tia-ser` | `tiaSerReader` |
| `purejsimage/scientific/readers/tia-emi` | `tiaEmiReader` |
| `purejsimage/scientific/readers/ncem-emd` | `ncemEmdReader` |
| `purejsimage/scientific/readers/velox-emd` | `veloxEmdReader` |
| `purejsimage/scientific/readers/blockfile` | `blockfileReader` |
| `purejsimage/scientific/readers/mib` | `mibReader` |
| `purejsimage/scientific/readers/gsf` | `gsfReader`, `encodeGsf` |
| `purejsimage/scientific/readers/nanonis-sxm` | `nanonisSxmReader` |
| `purejsimage/scientific/readers/igor-binary-wave` | `igorBinaryWaveReader` |
| `purejsimage/scientific/readers/digital-surf` | `digitalSurfReader` |
| `purejsimage/scientific/readers/x3p` | `x3pReader` |
| `purejsimage/scientific/readers/mrc` | `mrcReader` |
| `purejsimage/scientific/readers/nrrd` | `nrrdReader` |
| `purejsimage/scientific/readers/meta-image` | `metaImageReader` |
| `purejsimage/scientific/readers/nifti` | `niftiReader` |
| `purejsimage/scientific/readers/envi` | `enviReader` |
| `purejsimage/scientific/readers/fits` | `fitsReader` |
| `purejsimage/scientific/readers/cbf` | `cbfReader` |
| `purejsimage/scientific/readers/rpl` | `rplReader` |
| `purejsimage/scientific/readers/emsa` | `emsaReader` |
| `purejsimage/scientific/readers/ebsd-text` | `ebsdTextReader` |
| `purejsimage/scientific/readers/npy` | `npyReader` |
| `purejsimage/analysis/runtime` | `createTileRuntime`, `numericTileSourceToTileSource`, `createTileDatasetIdentityForScientificDataset` |
| `purejsimage/analysis` | `createBuiltInAnalysisBundle`, `createAnalysisController` |
| `purejsimage/sources/http-range` | `HttpRangeSource` |

Each of the 31 readers is behind an explicit dynamic import. The Vite Worker uses ES module
output so individual format chunks stay independently loadable. Filename extensions choose a
probe set; unknown extensions load the full catalog. One-dimensional series-only documents such
as EMSA/MAS can open, but the viewport still requires a two-dimensional plane. Sparse Velox
spectra remain outside this surface. JPEG, PNG, WebP, BMP, and JP2 scientific adapters can
decode origin-relative bands but reject many interior tiled requests; the imaging Worker
materializes one cached plane and crops viewport tiles and analysis plane reads from it. No `purejsimage/src` path is permitted;
`tooling/scripts/check-boundaries.mjs` enforces this for source and dynamic imports.

## RPC protocol

`packages/contracts` defines schema version 1 and validates unknown input before dispatch. Requests
cover initialization, local/sample/remote source opening, source and dataset close, dataset open,
plane selection, tile request, request cancellation, diagnostics, and the crash-only test seam.

Limits are part of the contract:

- 2 MiB JSON control message;
- 4,096 code units per string;
- 256 collection items;
- metadata depth 8;
- 262,144 pixels per render tile.

Unknown kinds, malformed payloads, unsupported versions, stale opaque IDs, exceeded limits, and
range/CORS failures return structured errors. A tile request ID maps to an `AbortController`; a
`request.cancel` message aborts that exact operation. Source, dataset, plane, and display changes
use generation IDs so late tiles cannot enter a newer cache.

## Source and dataset lifecycle

1. Build and probe a candidate document without changing the active source.
2. On success, atomically activate it and release the prior datasets, runtimes, and document.
3. Enumerate portable dataset summaries and open the selected dataset lazily.
4. Create one bounded tile runtime and built-in analysis bundle for that dataset.
5. On dataset close, abort its pending tiles, dispose the runtime, and remove the opaque handle.
6. On source close, close every dataset first and call the document close hook once.

Failed source opening leaves the current UI workspace untouched. A Worker crash is visible and
requires the user to restart and rebind the source; project state is not silently discarded.

## Renderer tile contract

The viewport asks for 256 by 256 regions covering the visible world plus one prefetch tile. Visible
regions are scheduled first. Each request contains the dataset handle, display axes, fixed indices,
resolution level, component, non-destructive display mapping, region, priority, tile identity, and
generation.

The Worker copies one selected quantitative component into a bounded `Float32Array`, derives a
64-bin histogram and an RGBA display tile, then releases the PureJsImage `NumericTile`. The renderer
owns small canvas uploads and quantitative arrays only. It never stores a complete plane in React
state. Camera and pointer updates remain outside broad React subscriptions. Cursor readout uses the
numeric values, while the canvas uses the mapped RGBA values.

## Debugging remote range reads

Remote URLs must use HTTPS except `http://localhost`, `127.0.0.1`, and `[::1]` development sources.
The server must return `206`, a valid `Content-Range`, identity encoding, and stable validators when
provided. It must also allow the workbench origin through CORS and expose `Content-Range` to the
browser.

Request `diagnostics.get` to inspect `rangeRequests`, `rangeBytesFetched`, `rangeCacheBytes`, tile
runtime memory, time to first completed tile, and release counters. In tests, compare
`rangeBytesFetched` with `source.size`; opening and a small first tile must remain below the complete
file size. A `200` response to a Range request is treated as a range-unavailable error rather than
silently downloading the complete object.
