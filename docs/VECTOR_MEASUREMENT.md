# Focused vector and measurement support

Atlas supports vector geometry only where it advances raster analysis. It is not a general-purpose vector GIS.

## Supported scope

- RFC 7946 `Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon`, and `MultiPolygon` import and export.
- Map-coordinate point, line, rectangle, and polygon drawing.
- Vertex-preserving ROI create, update, select, list, and removal through semantic actions.
- Point sampling for every raster band, line profiles, and polygon or rectangle zonal statistics.
- WGS84-compliant GeoJSON export, explicitly labeled native-CRS export, and bounded rendered viewport PNG export.

Atlas intentionally does not provide arbitrary vector styling, topology editing, geocoding, routing, spatial joins, vector tiles, shapefiles, or GeoPackages.

## Import policy

GeoJSON import is bounded by document bytes, feature count, total coordinates, nesting, and per-feature property bytes. Only plain JSON objects and finite coordinates are accepted. `__proto__`, `prototype`, and `constructor` keys are refused at every nesting level. Polygon rings must be closed. Self-intersecting rings are refused by default because raster masking would otherwise be ambiguous.

RFC 7946 input is interpreted as WGS84 longitude and latitude. A legacy `crs` member is never silently honored or ignored: import pauses with a typed compatibility warning until the user confirms a CRS definition supported by the active transform registry. The legacy member and confirmed interpretation are retained in ROI provenance.

## Measurement policy

Projected geometry uses planar Cartesian measurement only. Its linear unit must resolve to metre, international foot, or US survey foot; otherwise Atlas refuses the measurement. Area uses the squared native unit, and useful converted values remain labeled.

Geographic geometry uses the WGS84 Vincenty inverse method for line distance and the WGS84 authalic-sphere method for polygon area. Results identify planar versus geodesic mode, method, CRS, ellipsoid, and units. Atlas refuses missing or non-convergent methods rather than substituting an unlabeled estimate.

## Raster interaction policy

ROI geometry is transformed into the raster grid CRS without mutating the persisted geometry. Provenance records the transform identity, declared accuracy class, original CRS, and grid CRS. Unsupported transforms are refused.

Zonal statistics split the ROI bounds on the same 256-pixel tile grid used by derived raster work. Pixel inclusion follows the source `pixel-is-area` or `pixel-is-point` declaration. Exterior rings include samples and interior rings exclude holes. Nodata and non-finite samples are excluded and counted. Raw versus scaled values is an explicit request and result field. Every tile and scanline observes cancellation.

The dry-run response reports bounded region pixels and aligned tile count before expensive work starts. No zonal operation loads a complete raster.

## Export policy

Ordinary GeoJSON export always transforms geometry to WGS84 and emits no legacy `crs` member. Atlas provenance lives under the `atlas:provenance` property namespace. A transform without declared exact accuracy produces an approximate-transform warning.

Native projected coordinates use the explicitly labeled `native-crs-GeoJSON` format and set `compliant: false`; they are never represented as ordinary RFC 7946 GeoJSON. Rendered PNG export is bounded by dimensions, megapixels, and encoded bytes and includes visible layer titles, attribution, and a CRS note, with ROI overlay inclusion requested explicitly.
