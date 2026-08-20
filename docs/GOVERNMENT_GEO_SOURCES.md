# Government geo sources

Status of public U.S. government raster catalogs Atlas can discover. **Node `fetch` succeeding is not evidence of browser CORS.** Browser CORS is recorded only from Playwright (`PJI_GEO_LIVE=1`) or DevTools. Probed **2026-08-19** with `pnpm geo:probe-catalogs` (Node) plus targeted Range GETs.

## NOAA Digital Coast (static STAC)

Protocol: static STAC. Atlas never crawls the global DEM/imagery indexes. Curated collections:

| Collection | Catalog / item collection | Sample raster |
| --- | --- | --- |
| Puerto Rico CUDEM 9524 | `…/NCEI_third_Topobathy_PuertoRico_9524/stac/catalog.json` | `ncei13_n17x75_w065x75_2022v1.tif` (17 011 840 bytes) |
| Palm Coast FL RGBN 10213 | `…/PalmCoastFL_RGBN_2024_10213/stac/catalog.json` | `456000e3342000n.tif` (6 998 098 bytes) |
| Wisconsin NAIP 2018 9158 | `…/WI_NAIP_2018_9158/stac/catalog.json` | Browse budget 512 KiB; item collection is expected to overflow |

Relative STAC hrefs are real (`./catalog.json`, `../tile.tif`). Catalog JSON uses `type: Catalog` plus `rel: item` links; Atlas reads the configured item-collection document instead of `/search`.

### Puerto Rico CUDEM tile (Node, 2026-08-19)

- Host: `noaa-nos-coastal-lidar-pds.s3.amazonaws.com`
- HEAD 200, `Content-Type: image/tiff`, `Content-Length: 17011840`
- GET `Range: bytes=0-65535` → **HTTP 206**, `Content-Range: bytes 0-65535/17011840`, identity encoding, classic TIFF little-endian magic `II*`
- `Access-Control-Allow-Origin` / `Access-Control-Expose-Headers`: **absent in Node**. Browser CORS is not proven by this probe.
- **Browser confirmation (Chromium, `http://127.0.0.1:5173`, 2026-08-19):** Atlas opened `ncei13_n17x75_w065x75_2022v1`. Overview IFDs copy the full-resolution pixel scale; Atlas now scales that affine. World-space zoom is no longer capped at 64 (screen pixels per degree), so a 0.25° tile can fill the viewport.

### Palm Coast 4-band tile (Node, 2026-08-19)

- Host: `coastalimagery.blob.core.windows.net` (Azure Blob)
- HEAD 200, `Content-Length: 6998098`, `Access-Control-Allow-Origin: *`
- `Access-Control-Expose-Headers` includes `Content-Type`, `ETag`, `Content-Length` — **not** `Content-Range`
- GET Range → **HTTP 206**, `Content-Range: bytes 0-65535/6998098`, classic TIFF little-endian
- Live STAC `eo:bands` for this item name **b1–b5 as red, green, blue, gray, alpha**. They do **not** name NIR. Atlas does not offer CIR and does not infer NIR from sample count. Natural color uses samples 0,1,2. Dataset title is still “4-Band” / RGBN ([Digital Coast 10213](https://coast.noaa.gov/dataviewer/#/imagery/search/where:ID=10213)).

## USGS LandsatLook (STAC API)

- Root: `https://landsatlook.usgs.gov/stac-server/` (Node HEAD 200, GET Range 206 on the JSON document)
- `Access-Control-Allow-Origin` on the STAC root was `https://landsatlook.usgs.gov/stac-server` — **not** `*` and **not** the Atlas origin.
- **Browser confirmation (Firefox, `https://geo.purejsimage.com`, 2026-08-19):** three GETs to `https://landsatlook.usgs.gov/stac-server/` failed. Console: `CORS header 'Access-Control-Allow-Origin' does not match 'https://landsatlook.usgs.gov/stac-server/'`. JS exception is `NetworkError when attempting to fetch resource.` Atlas does not proxy; USGS must allow this origin.
- Search link advertises **GET and POST**. Atlas uses GET when both exist.
- Collection `landsat-c2l2-sr` items expose **one COG per band**. HTTPS is the primary `href`; `alternate.s3` is requester-pays `s3://usgs-landsat/…`. Atlas never rewrites `s3://` to guessed HTTPS.
- Node GET Range on a LandsatLook `…/SR_B4.TIF` data URL returned **HTTP 200 HTML** (`<!DO…`), not TIFF. That asset is not a proven browser Range COG from this probe.
- Surface Reflectance scale `DN * 0.0000275 - 0.2` is documented Landsat Collection 2 behavior when STAC `raster:bands` omits scale/offset. It is not applied in generic raster code.

## USGS 3DEP via TNMAccess (not STAC)

- `GET https://tnmaccess.nationalmap.gov/api/v1/datasets` — Node HEAD 403, GET 200, `Access-Control-Allow-Origin: *`
- `GET /api/v1/products` with `URLSearchParams` (`datasets`, `bbox`, `max`, `offset`, `outputFormat=json`) — same CORS `*` on GET
- Dataset tags used: `National Elevation Dataset (NED) 1/3 arc-second`, `… 1 arc-second`, `Digital Elevation Model (DEM) 1 meter`, `Seamless 1-m DEM (S1M)`
- Cincinnati 1/3" search returned GeoTIFF `downloadURL` on `prd-tnm.s3.amazonaws.com` (example `USGS_13_n40w085_20210617.tif`, 451 301 905 bytes)
- That object: HEAD 200, GET Range **HTTP 206** `bytes 0-255/451301905`, classic TIFF little-endian. **No** `Access-Control-Allow-Origin` on the S3 object in Node.
- Identity for deep links: `collectionId` = dataset tag, `itemId` = ScienceBase `sourceId`, `assetKey` = `geotiff`

## Kentucky From Above (STAC API)

Unchanged. STAC `https://spved5ihrl.execute-api.us-west-2.amazonaws.com/`. COGs on `kyfromabove.s3.us-west-2.amazonaws.com` answer HTTP 206 but CORS often hides `Content-Range`; Atlas reconstructs it from HEAD `Content-Length`.

## What Atlas will and will not do

Atlas can **discover** these assets from catalog JSON. **Ready** means a tiny HTTPS Range probe plus TIFF inspect succeeded in that runtime. Node success does not imply the browser can open the layer. Only Ready candidates call `openRemote`. `s3://` stays metadata-only.
