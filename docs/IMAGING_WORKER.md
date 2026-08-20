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

The integration uses these documented `purejsimage@0.14.0` paths and symbols:

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

`packages/contracts` defines schema version 2 and validates unknown input before dispatch. Requests
cover initialization (optional resource limits), local/sample/remote/bundled source opening, source
and dataset close, dataset open, plane selection, tile request, request cancellation, diagnostics
(optional `sourceId` filter), and the crash-only test seam. Dataset descriptors may include an
optional JSON-safe `spatialReference` copied from PureJsImage. That field does not bump the RPC
envelope by itself; the schema version 2 bump covers multi-source diagnostics, initialize limits,
and `sourceId` on opened datasets. Local files and remote range sources produce the same application
descriptor. Science datasets without georeferencing omit the field. UI code reads the typed spatial
reference; it does not scrape generic dataset metadata for CRS, affines, bounds, raster type, or
nodata.

Limits are part of the contract:

- 2 MiB JSON control message;
- 4,096 code units per string;
- 256 collection items;
- metadata depth 8;
- 262,144 pixels per render tile.

Worker resource budgets (overridable at `worker.initialize`) default to:

- 8 open sources;
- 8 datasets per source;
- 32 MiB total HTTP range cache;
- 192 MiB total tile-runtime memory;
- 32 in-flight budgeted requests.

Reaching a budget returns `LIMIT_EXCEEDED`. The Worker never silently closes a source the UI still
holds. Unknown kinds, malformed payloads, unsupported versions, stale opaque IDs, exceeded limits, and
range/CORS failures return structured errors. A tile request ID maps to an `AbortController`; a
`request.cancel` message aborts that exact operation. Stale work is rejected by source and dataset
handle identity plus that source's revision; a Worker epoch increments only on reset/dispose.

## Source and dataset lifecycle

One imaging Worker owns a map of source records keyed by a stable source handle. Each source owns
its document, HTTP range sources (with a lifetime `AbortController`), datasets, diagnostics, and
tile runtimes. Dataset handles resolve directly to the owning source. Tile and analysis requests
must not consult a global active source.

1. Build and probe a candidate document without inserting it into the source map.
2. On success, commit it as an additional open source. A failed open aborts only that candidate's
   lifetime and must not mutate or close existing sources.
3. Enumerate portable dataset summaries and open the selected dataset lazily against that source.
4. Create one bounded tile runtime and analysis controller for that dataset. Analysis extensions are
   injected by the app: the generic imaging Worker entry used by Atlas installs none; the science
   Worker entry installs the materials-analysis toolbox.
5. On dataset close, abort its pending tiles, dispose the runtime, and remove the opaque handle.
6. On source close, abort that source's lifetime signal (cancelling in-flight range reads), close
   every dataset, close the document, and drop companion range sources. HttpRangeSource has no
   `close()`; abort `lifetimeSignal` instead. `openSignal` cancels only the open probe.

The science imaging client uses `sourcePolicy: 'replace-one'`: after a successful open it explicitly
closes the previous source. Atlas retains independent sources. Failed source opening leaves the
current UI workspace untouched. A Worker crash is visible and requires the user to restart and rebind
sources; project state is not silently discarded.

## Renderer tile contract

The viewport asks for 256 by 256 regions covering the visible world plus one prefetch tile. Visible
regions are scheduled first. Each request contains the dataset handle of the owning source, display
axes, fixed indices, resolution level, component, non-destructive display mapping, region, priority,
tile identity, and that source's revision. Atlas plans tiles per layer through `planMultiLayerTiles`
so two independent COGs can stay open and render concurrently.

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

Request `diagnostics.get` to inspect per-source range stats (`rangeRequests`, `rangeBytesFetched`,
`rangeCacheBytes`, `rangeCacheHits`, `rangeCacheMisses`, `uniqueBytes`, `openDatasets`) and aggregate
counters (`openSources`, `openDatasets`, `pendingRequests`, `rangeCacheBytes`, `tileRuntimeBytes`),
plus tile runtime memory, time to first completed tile, and release counters. Pass `sourceId` to
filter the `sources` array; aggregate totals remain global. In tests, compare `rangeBytesFetched`
with `source.size`; opening and a small first tile must remain below the complete file size. A `200`
response to a Range request is `RANGE_UNSUPPORTED`. A CORS/`Failed to fetch` probe is `CORS_FAILED`.
TIFF layout and compression failures are classified separately from truncated or malformed GeoTIFF
metadata.

GeoTIFF/COG opens attach a JSON-safe `inspectCog` report under `purejsimage:cog` on source
metadata. Atlas X-ray copy is derived from that report plus the matching per-source range
diagnostics. Atlas retains at least two independent COG sources and requests tiles from each
dataset handle. Duplicate display layers still style one raster; opening another file or URL adds a
second source rather than replacing the first.
