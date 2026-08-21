# Changelog

All notable changes to Materials Workbench are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The application is not yet versioned for release (`0.0.0`).

## [Unreleased]

### Added

- Shared `AgentConversationShell` for Science and Atlas, restricted Markdown answers, session-only
  OpenRouter keys by default with an explicit remember-on-this-browser option, visible revocable
  session grants, a deterministic conversation ledger, hardened replay, and
  `analysis.particle.quality.read` plus dedicated ROI/histogram/profile/FFT/surface/stack/compare
  actions. Atlas keeps labeled scripted action-contract evals and adds controller-backed grading.

- The workbench consumes `purejsimage@0.15.0`. Science opens remote, directory, and ZIP OME-Zarr
  stores through explicit source kinds on the imaging Worker. Atlas does not gain an OME-Zarr
  source workflow merely because the format is multiscale.

- Atlas virtual raster analysis through the shared semantic action host: normalized band math,
  explicit virtual band stacks, hillshade/slope/aspect, raster difference, bounded region
  statistics, and line profiles. Derived layers persist normalized recipes and provenance, render
  as on-demand Worker tiles, include source revisions and grids in cache identity, and abort with
  their input datasets. Exact alignment is the default; same-CRS resampling is explicit and
  cross-CRS work requires the versioned EPSG:4326/EPSG:3857 inverse-transform provider. Dry-run
  reports source/target grids, byte and memory estimates, transforms, resampling, no-data, output,
  and accuracy warnings. See `docs/GEO_RASTER_ANALYSIS.md`.

- Atlas catalog adapters for STAC API, static STAC, and USGS TNMAccess. The registry lists NOAA
  Digital Coast, USGS 3DEP, USGS Landsat, and Kentucky From Above. CatalogPanel talks only to
  `CatalogService`. Imaging raster preflight uses bounded streaming and advances through
  metadata-only, range-readable, TIFF-compatible, and decoder-ready stages; Ready requires a
  successful documented-reader open and bounded native sample. Catalog probes use bounded
  concurrency, cancellation, and short-lived failure caching, and Open reuses the verified report
  rather than repeating preflight. Aborted in-flight probes are not reused by a replacement
  catalog selection. `s3://` assets stay metadata-only. Opt-in diagnostics:
  `pnpm geo:probe-catalogs` and `PJI_GEO_LIVE=1 pnpm test:e2e:geo:live`. See
  `docs/GOVERNMENT_GEO_SOURCES.md`.

### Fixed

- Science stack alignment selects the non-display volume axis rather than the first
  non-space axis, so generated NRRD stacks can be aligned. The generated drifting-stack
  NRRD now declares `kinds: space space space`. Worker analysis errors include the nested
  operation cause instead of only the graph wrapper.
- Biome formatting for the OME-Zarr source surface. Visual goldens include the OME-Zarr
  open controls and the shared agent conversation shell. The empty-workspace Chromium
  Linux golden is the Playwright `v1.62.1-noble` capture so host font rasterization does
  not fail CI. Chromium screenshot compare allows a 2.5% pixel ratio for remaining
  container-vs-host antialiasing. Science save/reload e2e waits until the project is
  marked saved, Atlas comparison waits until the second COG settles, and bundled example
  opens use a 90s test timeout without changing first-tile budgets. JPEG/PNG codec
  adapters share one origin-decoded plane between viewport tiles and analysis so
  opening an analyzed example does not decode the still twice. If the live dataset
  handle goes stale after the first tile, Science reopens the example once before
  applying the committed analysis, and replace-one open ignores an already-gone
  previous source.
- Atlas catalog fetch throws are classified as a browser network block, not “Catalog
  unavailable.” CORS is claimed only when the error names CORS. LandsatLook still cannot be
  searched from `geo.purejsimage.com` until USGS allows that origin; Atlas does not proxy.
  The geo CSP no longer includes the invalid host `http://[::1]:*`.
- Atlas scales overview geo tags that copy the full-resolution pixel size, and raises the
  world-space zoom cap so geographic-degree COGs (NOAA CUDEM) fill the map instead of rendering
  as a postage stamp. A launch demo picker opens pinned Kentucky ortho and NOAA Puerto Rico
  terrain scenes with display mapping already set.
- Atlas catalog tiles open the preferred Cloud Optimized GeoTIFF on click. The empty-state Search
  button runs a catalog search instead of only switching the already-open Catalog tab. The map
  shows an opening state with Cancel while HTTP Range fetches are in flight, instead of staying on
  the empty placeholder with no network activity.
- Atlas constructs its imaging Worker from `apps/geo` the same way science does, so Vite bundles
  PureJsImage reader modules into the Worker instead of fetching optimized-dep URLs that fail as
  a fake CORS error. Opening a local or remote COG can actually load in `pnpm dev:geo`.
- Atlas reconstructs a numeric `Content-Range` when object stores hide that header from Worker
  JavaScript. KyFromAbove S3 answers Range requests with HTTP 206 but CORS only exposes `ETag`;
  Chrome also empties the 416 XML body (ORB). Object size is taken from the CORS-readable HEAD
  `Content-Length`. A 200 full-body response is still classified as missing Range support.
- Atlas TIFF opens raise PureJsImage `maxInputBytes` to the object size and `maxPixels` to 10
  billion. The codec defaults (128 MiB / 256 Mpx) were written for whole-file decodes and
  rejected live KyFromAbove COGs even though only HTTP ranges are read.
- Atlas draws overview tiles with the overview affine, not the full-resolution pixel-to-world
  transform, so a fitted COG fills the map instead of appearing as a postage stamp.

### Added

- Bounded multi-source imaging Worker: one Worker owns a map of source records keyed by stable
  handles. Dataset handles resolve to their owning source. Tile, analysis, and diagnostics paths
  never consult a global active source. Opening is transactional; a failed second open leaves the
  first readable. Closing one source releases that source's datasets, tile runtimes, pending
  requests, range caches, document, and companion range sources. Configurable limits cap open
  sources, datasets per source, total range cache, total tile-runtime memory, and in-flight
  requests; the Worker refuses with `LIMIT_EXCEEDED` instead of silently evicting a visible source.
  Analysis extensions are injected by the app. The generic imaging host used by Atlas does not
  install the materials toolbox; science installs it in `apps/science` Worker entry.
- Science `createScienceImagingWorkerClient()` keeps replace-one-source behavior by closing the
  previous source only after a successful open.
- Atlas retains independent COG sources and requests tiles per dataset handle so two rasters can
  stay open and render concurrently.

- PureJsImage Atlas MVP in `apps/geo`: open a local GeoTIFF/COG or a remote HTTPS URL, render it
  in the source CRS, select overviews from viewport resolution, style grayscale/RGB bands with
  min/max or percentile stretch, gamma, and nodata transparency, and inspect cursor pixel,
  source, and WGS84 coordinates. The COG X-ray panel reports container layout, IFDs, overviews,
  affine/CRS, range request count, bytes fetched, cache hits/misses, percent of source fetched,
  and the active overview. Remote opens use HTTP Range only; tile requests cancel on camera
  change and ignore stale generations. The imaging Worker classifies CORS, missing Range,
  unsupported TIFF layout, unsupported compression, and malformed GeoTIFF metadata separately.
  Percentile stretch is computed from the mapped tile, not a full-raster histogram. Nodata is
  excluded from stretch statistics. Striped GeoTIFFs still open for inspection; X-ray reports they
  are not Cloud Optimized. Duplicate display layers style one raster (visibility, opacity, order);
  opening another GeoTIFF or URL keeps the previous source open. Atlas also browses STAC catalogs
  through a generic client and a registry; Kentucky From Above is the first entry. Collection IDs
  stay in registry/story configuration. Catalog provenance
  (provider, collection, item, asset, license, attribution, item URL) is stored on the geo source
  and in shareable deep links that never include signed query strings. Curated stories are data:
  Kentucky Through Time, Natural Color / CIR display presets, Terrain Lab (DEM/DTM; no DSM
  collection is published yet), and COG Anatomy. Normal CI uses recorded STAC JSON fixtures and a
  local COG; live KyFromAbove smoke is opt-in (`ATLAS_LIVE_STAC=1`).
- Geo domain model in `packages/domain-geo`: georeferenced raster sources, styled raster and
  derived layers, comparison state, map-coordinate ROIs, and provenance/recipe references.
  Proj4js lives only in domain-geo and currently transforms EPSG:4326 ↔ EPSG:3857; other
  projections return typed errors. Same-CRS layer composition does not warp pixels.
- Viewport coordinate-space adapters: science keeps image space (pixel = world); geo uses a
  world-space affine adapter with pixel↔world mapping, rotated/sheared envelopes from
  transformed corners, map-coordinate pointer samples, fit-layer/fit-bounds, and multi-layer
  tile selection that shares cached source tiles. Camera state stays outside React panels.
- JSON-safe spatial references on dataset descriptors: CRS authority/code/name/citation, full
  six-parameter pixel-to-model and model-to-pixel affines, model bounds, raster type, and
  nodata. The imaging Worker copies PureJsImage spatial-reference values across the RPC boundary; project
  save/load and inspector facts use the same typed object. Unknown CRS metadata is kept.
- Architecture decision record for a shared showcase monorepo (gallery, science, and geo;
  medical later), compile-time domain profiles, separate deploys, and a characterization
  suite that locks current science workbench behavior without moving application code.
- Headless `packages/workbench-core` runtime and compile-time domain profile types.
  Science-specific catalogs, workflows, actions, panels, and terminology live in
  `packages/domain-science`.
- Separately built `apps/gallery`, `apps/science`, and `apps/geo` applications with
  independent Vite/Wrangler configs. Medical is documented as planned and has no
  application package. Gallery does not load the imaging runtime.

### Changed

- The workbench consumes `purejsimage@0.14.0`. Remote `HttpRangeSource.open` uses `openSignal` for
  the probe and `lifetimeSignal` for subsequent reads; aborting the per-source lifetime controller
  releases in-flight range work. The imaging RPC schema version is 2.
- Browser CI runs science and geo Playwright in `mcr.microsoft.com/playwright:v1.62.1-noble` with a
  Chromium/Firefox/WebKit matrix. Science uses two workers; geo uses four. Jobs skip
  `playwright install --with-deps`.
- `pnpm build` bundle check enforces gzip ceilings (300 KiB science route chunks, 1,000 KiB
  language Worker, 200 KiB gallery total, 2 MiB geo total) and that science still ships its
  index and Worker chunks. It no longer goldens every hashed asset name and exact gzip byte
  count, so Vite reader splits and 1-byte minifier drift do not fail deploy.
- The workbench consumes `purejsimage@0.12.0`. The reviewed science reader-registry
  characterization fixture records the package version bump only. Science datasets without a
  spatial reference are unchanged. The Worker still wires the same 31 readers; dicom and
  ome-zarr remain unpublished on this surface. The reviewed science gzip inventory records
  the expected 0.12.0/spatial-reference growth: index +2,670, imaging Worker +1,753,
  JPEG +2,393, WebP +1,662, PNG +180, reader +755, and the two TIFF chunks +4,000
  combined (Vite hash order swapped their logical names). The 300 KiB route-chunk and
  1,000 KiB language-Worker ceilings are unchanged.
- The science workbench moved from `apps/workbench` to `apps/science`
  (`@pji-workbench/science`). Cloudflare worker name and `lab.purejsimage.com`
  route are unchanged. Deploy with
  `pnpm --filter @pji-workbench/science exec wrangler deploy`
  (was `@pji-workbench/app`). `pnpm dev:workbench` remains a compatibility alias.
  The reviewed science gzip baseline records a 762-byte index-chunk increase from
  that move; the 300 KiB route-chunk and 1,000 KiB language-Worker ceilings are
  unchanged.   Gallery stays under a 200 KiB gzip total and does not ship imaging Workers. Geo Atlas ships
  the imaging Worker and is capped at 2 MiB gzip total; it still must not ship the script or
  TypeScript language Workers.
- The generated calibrated particle field is ten isolated disks on the sinusoidal
  SEM-style background, not 1-pixel modulo speckles. The gallery card and the
  default particle-count workflow now describe the same image.
- The batch particle fixture is a mirrored copy of those same disks, not another
  1-pixel speckle field. Opening the touching-particle example turns Watershed on
  so the advertised split is the default.
- The calibrated particle background wave is weak enough that default Otsu
  thresholding separates the ten disks. The previous strong checkerboard made
  Otsu split the illumination, then Edge exclude dropped every object.
- ROI Statistics, Histogram, and Line profile sit directly under the draw tools
  so a newly drawn region can be measured without scrolling past calibration.
- Opening a new source or example drops leftover ROIs and particle targeting from
  the previous file so a measure box cannot silently shrink the next particle count.
- ROI Statistics results lead with mean and labeled scalars instead of a raw JSON
  dump. Opening an analyzed example no longer fails the gallery with a stale
  "Dataset changed" abort.
- Inspector and results tab switches no longer write “Changed project workspace view”
  undo entries. The last visible tabs are stored when the project is saved or exported.
  The saved/unsaved indicator compares that same visible snapshot, so Save after a
  title edit no longer stays on Unsaved changes.
- Opening a new file or example replaces leftover sources and the previous analysis
  graph, so a second example no longer piles up in the navigator.
- An imported project that still needs its original file shows a rebind card instead of
  the first-run “Start with an original file” empty state. Recent names are labeled
  recent, not rebind required.
- Script Studio keeps the run-status footer visible when the capability review is
  closed. The first viewport resize fits the specimen instead of leaving a 1:1 crop.
  Locking display auto-range no longer remounts the viewport, so remaining tiles fill
  the fitted frame instead of leaving black corners.
- New project and opening a new source both clear leftover analysis results, overlays,
  and batch rows so a previous particle count cannot linger on the next file.
- The mode rail stays above the results panel and scrolls when the window is short,
  so Examples and Script Studio remain clickable at a 200-percent-equivalent viewport.
- Analyzed examples wait for the first useful tile before running the preset, so the
  specimen appears before the imaging Worker starts the included analysis.
- Chromium visual baselines for the opened workspace now match the ten-disk sample,
  fit-on-open camera, teal histogram, and generated source label.
- The original 2100×1630 S. aureus JPEG has a 6 s first-tile budget. Firefox must
  decode the full original file before the first 256-pixel tile; GSF derivatives stay
  at 4 s.
- A committed particle-count graph can be applied as a local-file batch; invert is not a
  portable batch recipe. Batch identity cells show a filename/reader label instead of the
  full scientific-identity JSON.
- The example library includes a generated 64×64×8 drifting stack (NRRD) so the stack
  workspace can be used without a local volume. Analysis-result tiles no longer forward
  `targetSampleType` into PureJsImage plane requests, so mean-projection output can
  render.
- The workbench root can scroll, so 200 percent page zoom no longer traps inspector
  tabs under the viewport canvas. Batch rows include dry-run issue text when a recipe
  is refused for a file.
- Particle analysis exposes Cancel run next to Dry-run / Run so an admitted plan
  can be stopped without hunting the advanced-materials cancel control.
- Analysis histograms (HHV-6, ROI Histogram) plot bin counts instead of a
  16-sample preview or a bin-edge diagonal.
- ROI inspector measurements are labeled Area / Perimeter / Centroid rows with pixel and
  physical units instead of a single run-on line.
- Selecting an area ROI now targets particle analysis to that region and includes
  edge-touching objects, so a drawn box no longer silently counts zero.
- Statistics headlines say "1 result" instead of "analysis outputs". Viewport physical
  coordinates use two decimal places.
- FFT plan summaries show peak memory and compute time instead of a raw JSON identity dump.
- Line profile after an FFT (or any multi-output analysis) measures the source again instead
  of crashing, and the Line Profile tab shows the distance/value series.
- FFT results headline is "N peaks". The inverse-FFT disclaimer no longer cites PureJsImage
  0.10.0.
- Switching to a derived analysis plane (FFT magnitude, leveled AFM surface) re-runs display
  auto-range, so leftover source 0–255 mapping no longer crushes log1p spectra to black.
  A singleton top histogram bin (DC or a hot pixel) is excluded from that stretch so
  lattice spots stay visible. The lock now uses quantitative tile values, not the first
  tile's leftover display mapping, so Run FFT workspace (including notch) no longer stays
  black after the source 0–255 stretch.
- FFT viewport labels skip the DC/beam-center peak, use d-spacing, and keep one label per
  distinct spacing so conjugate spots do not stack the same text.
- Line-profile and other series results hide the coarse 16-sample bar preview when the real
  polyline is already shown.
- AFM height profiles default to the current plane or selected rectangle instead of a
  hardcoded 0–255 corner. Results lead with Rq/Ra/Rz instead of a raw JSON dump.

- Dark and light themes use a sharper instrument palette: deeper canvas, more distinct
  chrome surfaces, and a teal-cyan accent instead of washed sky blue. Scientific ROI
  overlays stay a cooler blue so they remain readable on grayscale micrographs.
- Essential chrome type (status bar, navigator groups, viewport breadcrumb) is 11 px.
  Selected navigator rows and mode-rail tools have a clearer inset accent.
- Linux Chromium visual goldens were updated after inspecting the diffs: the layout is
  unchanged; only the new palette and chrome highlights differ. Darwin goldens were not
  regenerated on this host.

### Added

- CDC PHIL 6486 *Staphylococcus aureus* SEM JPEG as an enabled bundled analysis example. The
  workbench opens the original 2100 × 1630 public-domain JPEG (not a GSF derivative) with a
  reviewed bright-object threshold/components starting point.
- Imaging Worker codec-adapter plane cache. JPEG, PNG, WebP, BMP, and JP2 readers that only
  decode origin-relative bands now serve viewport tiles and analysis plane reads from one
  origin-decoded plane.
- Particle-count headline and completion copy when an objects table is present.

### Changed

- Particle analysis defaults to watershed off and a 64-pixel minimum object size, with
  human-readable plan estimates and an explicit plan-before-run note.
- ROI tool buttons use title-case labels. Bundled and generated sources read as "example" and
  "generated" instead of raw locator kinds.
- Empty inspector tabs and the agent panel use more specific first-use copy. Example-gallery
  Clear filters is disabled when no filters are set.

### Fixed

- Playwright `--project` filters now apply to both science and geo suites. Independent
  `test:e2e:science` and `test:e2e:geo` scripts replace the previous `&&` chain that dropped
  extra arguments on the first command. Chromium CI installs and runs Chromium only; the
  cross-browser job installs and runs Firefox and WebKit only. Failure artifacts use
  `test-results/science` and `test-results/geo`.
- Interior tiles and connected-components on scientific JPEG (and the other codec adapters)
  no longer fail after the first origin band.
- Icon buttons blur after click so tooltip/focus rings do not linger on the app bar.
