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

The integration uses these documented `purejsimage@0.10.0` paths and symbols:

| Package path | Symbols |
| --- | --- |
| `purejsimage/scientific` | `createScientificLibrary`, `normalizeScientificRelativeName`, `resolveNumericTileSource`, `numericTileSampleOffset`, `supportsScientificPlaneRead` |
| `purejsimage/scientific/browser` | `createScientificFileContext` |
| `purejsimage/scientific/readers/gsf` | `gsfReader`, `encodeGsf` |
| `purejsimage/scientific/readers/envi` | `enviReader` |
| `purejsimage/scientific/readers/fits` | `fitsReader` |
| `purejsimage/scientific/readers/mrc` | `mrcReader` |
| `purejsimage/scientific/readers/cbf` | `cbfReader` |
| `purejsimage/scientific/readers/ome-tiff` | `omeTiffReader` |
| `purejsimage/scientific/readers/aperio-svs` | `aperioSvsReader` |
| `purejsimage/analysis/runtime` | `createTileRuntime`, `numericTileSourceToTileSource`, `createTileDatasetIdentityForScientificDataset` |
| `purejsimage/analysis` | `createBuiltInAnalysisBundle`, `createAnalysisController` |
| `purejsimage/sources/http-range` | `HttpRangeSource` |

Each reader is behind an explicit dynamic import. The Vite Worker uses ES module output so GSF,
ENVI, FITS, MRC, CBF, OME-TIFF, and Aperio code remain independently loadable chunks. No
`purejsimage/src` path is permitted; `tooling/scripts/check-boundaries.mjs` enforces this for source
and dynamic imports.

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
