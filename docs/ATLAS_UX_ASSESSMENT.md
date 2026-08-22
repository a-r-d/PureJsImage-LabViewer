# Atlas UX assessment

Hands-on pass of the geo app (`pnpm dev:geo`, `http://localhost:5173/`) on 2026-08-22. Chromium, 1920×1080, `devicePixelRatio` 2. Kentucky leaf-off ortho and NOAA Puerto Rico CUDEM were opened, panned, zoomed, and inspected.

Related: `docs/UX_SYSTEM.md`, `docs/UX_V2.md`, `docs/GOVERNMENT_GEO_SOURCES.md`, `docs/USABILITY_TEST_LOG.md`.

## Verdict

Atlas is not Apple-grade, and it does not just work.

Kentucky aerial actually looks like a place. NOAA Puerto Rico is a gray fog square on a black field. The map chrome leaves a dead strip under the canvas. Tiles feel like they reload because the HTTP range cache is thrashing, not because the 64 MiB display LRU is too small.

| Question | Grade | Answer |
| --- | --- | --- |
| Can you pan and zoom? | B | Yes. `+`/`−`, Fit, Layer, 1:1, drag-pan, and arrow keys all move the camera. Wheel zoom is wired. At native resolution a pan into new ground blanks tiles for about 3 seconds (12 concurrent reads). |
| Clear loading indicator? | C+ | Present, easy to miss: a small map-corner overlay plus a footer byte counter. First Kentucky open was so fast the empty state vanished. 1:1 and style changes show “Loading N visible tiles” / “Preparing display range” with a progress bar. No full-map spinner, no skeleton, no overzoomed placeholders. |
| Apple-product UX? | D | No. Eight inspector tabs, 11–12 px type, jargon (IFD, nodata, percentile, EPSG 4269 + PRVD02), always-on 340 px sidebar, black gutters, developer stats on the map. A capable GIS prototype, not a consumer product. |
| Does it just work? | C+ | Kentucky: mostly. NOAA: the map reports ready and still looks like nothing. Clicking NOAA in the demo picker closed the dialog and stayed on Kentucky until a full reload of the deep link. |
| Clear and obvious? | C | The demo picker is the one obvious thing. After that, Fit vs Layer vs 1:1, CIR that never appears, and “229% fetched” are insider controls. “Pan” is a hint, not a tool. |
| Anything broken? | — | Yes: viewport height, NOAA as a visual demo, silent demo-open failure, advertised CIR missing, range-cache thrash, black flash on zoom/style change. |

## What was on the glass

### Kentucky leaf-off ortho — keep

Frankfort-area 6-inch aerial (`N082E280_2019_6IN_cog.tif`). After zoom, houses, a river, fields, and roads are obvious. Pointer readout shows EPSG:3089, WGS84, and RGB. This is the only launch demo that looks like a product.

Fit-to-layer letterboxes a roughly square tile inside a 1580×790 canvas. Demo copy says “Switch to color infrared after it opens.” Display only showed a Natural color button. CIR never appeared because presets are rebuilt from STAC band names (`displayPresetsForCandidate`), not the demo manifest.

Hash: `#v=2&kind=asset&c0=ky-from-above&n0=orthos-phase2&i0=N082E280_2019_6IN_cog.tif&a0=data`

### NOAA Puerto Rico CUDEM — replace in the picker

Unshaded grayscale elevation, 2–98 percentile, nodata transparent (`ncei13_n17x75_w065x75_2022v1`). At overview it is a pale square floating in black. After four zooms to Level 0 the center pixel was still `193,193,193` — a washed coastal DEM with no hillshade. You cannot tell it is Puerto Rico.

Clicking it in the demo picker closed the dialog and left Kentucky loaded. No NOAA STAC request fired. Opening the deep link and reloading did load the item. `openCatalogAsset` / `openStartDemo` swallow errors with `.catch(() => undefined)`.

Hash: `#v=2&kind=asset&c0=noaa-digital-coast&n0=noaa-cudem-pr-9524&i0=ncei13_n17x75_w065x75_2022v1&a0=ncei13_n17x75_w065x75_2022v1`

## The map does not fill the window

Two separate layout failures stack.

Measured at 1920×1080:

| Surface | Size |
| --- | --- |
| Window | 1920×1080 |
| App bar | 44 px |
| Status bar | 27 px |
| Main | 1920×1009 |
| Inspector | 340 px wide |
| Canvas | **1580×790** |
| Dead strip under the canvas | **219 px** |

`.geo-viewport-stack` is `grid-template-rows: auto minmax(0, 1fr)`. After the opening banner goes away, the viewport is the only child and sits in the `auto` row. The `1fr` row is empty black. `.geo-viewport` has no `height: 100%`.

On top of that, Fit shows the full square raster with contain-style letterboxing. There is no basemap, so unused canvas is void black.

## Tile reload: cache size is the wrong diagnosis

The display LRU is 64 MiB / 256 tiles (`DISPLAY_CACHE_BYTES`, `DISPLAY_CACHE_TILES` in `apps/geo/src/GeoViewport.tsx`). After heavy Kentucky use it sat at 47.7 MiB / 196 tiles — under budget. Panning back over already-seen ground stayed “Map ready” (cache hits). The painful reload is the HTTP range cache in the Worker, plus blank-then-fill rendering.

### Display tile LRU (not the bottleneck)

| Moment | Visible | Cached | Status |
| --- | --- | --- | --- |
| Kentucky first view | 9 / 9 L4 | 9 · 1.5 MiB | Instant ready |
| After zoom | 25 / 25 L3 | 44 · 9.7 MiB | Ready |
| 1:1 native | 54 / 54 L0 | 98 · 23.2 MiB | Black, then ~1 s |
| Pan into new ground | 42 / 54 | 108 · 25.7 MiB | 3 s, 12 reading |
| Pan back | 54 / 54 | 126 · 30.2 MiB | Instant hit |
| After style click | 54 / 54 | 180 · 43.7 MiB | Black flash |

`MAX_CONCURRENT_DISPLAY_TILES` is 12. Native pans queue. Zoom and style changes do not keep lower-overview tiles as placeholders, so the canvas goes black. Display tile IDs include `statisticsRevision`; tiles keyed as `statistics-pending` are thrown away when stats arrive.

### NOAA COG X-ray — this is the thrash

Object `ncei13_n17x75_w065x75_2022v1` after zooming to Level 0:

| Fact | Value |
| --- | --- |
| Object size | 16.22 MiB |
| Bytes fetched | 37.19 MiB |
| Source fetched | **229.22%** |
| Range requests | 604 |
| Cache hits | 40 |
| Cache misses | **564** |
| Dimensions | 2712×2712, 512×512 tiles, 1×32-bit |
| Overviews | L0–L3 |
| CRS | EPSG 4269 NAD83 + PRVD02 height |

The footer showed “604 ranges · 229.2% fetched” as if that were healthy telemetry. Hit rate is about 7%. Raising the RGBA LRU will not fix this.

## Demo recommendations

A launch demo has to look like something in under two seconds at Fit. Raw CUDEM grayscale fails that test even when the COG is Ready.

| Demo | Verdict | Why |
| --- | --- | --- |
| Kentucky 6-inch ortho | Keep as hero | People, roofs, river, fields. Instant “this is a map.” |
| NOAA Puerto Rico CUDEM | Remove from picker | Unshaded DEM + nodata + letterboxing = white fog. Fine as a Terrain Lab / X-ray story, not a first click. |
| Palm Coast FL RGBN 10213 | Replace NOAA | Already in the NOAA Digital Coast registry. Natural-color aerial, CORS-proven Azure blob (`docs/GOVERNMENT_GEO_SOURCES.md`). |
| Kentucky CIR as a second click | Fix, then keep | Copy already promises it. Wire `demo.presets` through instead of rediscovering NIR from STAC names. |
| Hillshaded DEM or color relief | Only if shaded | Terrain is a good story after it looks like mountains and coastline. |

## What is actually good

Range-only fetch, CRS in the cursor, COG X-ray that tells the truth (including the ugly 229%), catalog deep links, cancel on open, and a real 1:1 that shows 6-inch houses. The engine is more serious than the first five seconds of UI.

Atlas currently demos its transport and inspector, not a picture of the Earth.

## Fix order

Do these one at a time. Do not bundle them.

| # | Status | Change |
| --- | --- | --- |
| 1 | Done | Make `.geo-viewport-stack` fill the main pane. Default grid is one `minmax(0, 1fr)` row; the opening banner still gets an `auto` row via `:has(.geo-opening-banner)`. `.geo-viewport` is `height: 100%`. |
| 2 | Done | Swap the second launch demo to a filled Palm Coast FL RGBN tile (`474000e3303000n`). The mosaic origin cell `456000e3342000n` is ~99% zero-fill and looks like a white sliver. CUDEM stays behind Terrain Lab / X-ray. |
| 3 | Done | Prefer 16 MiB HTTP range cache per source (32 MiB global cap). X-ray percent fetched is unique object coverage, not transferred bytes. Footer says “% of object”. |
| 4 | Done | Draw cached tiles for a layer (largest world area first) under the required tiles so zoom/style changes keep an overview on screen. |
| 5 | Done | Surface demo/catalog resolve failures (`CATALOG_NOT_FOUND`). Merge `demo.presets` ahead of STAC-discovered presets so Kentucky CIR is offered. |

Constants observed in this session: `DISPLAY_CACHE_BYTES = 64 MiB`, `DISPLAY_CACHE_TILES = 256`, `MAX_CONCURRENT_DISPLAY_TILES = 12`, `PREFETCH_TILES = 1`.
