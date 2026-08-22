# Geo raster analysis

Atlas derived rasters are virtual, JSON-safe layers. A project stores the normalized operation
recipe and provenance, while `packages/imaging` evaluates only requested tiles or explicitly
bounded regions in the imaging Worker. The browser window never receives source pixels and the
Worker never materializes a complete COG merely to display an analysis result.

## Package and application boundary

Atlas continues to persist `DerivedRasterRecipeV1`, semantic action IDs, project revisions, source
revisions, style revisions, masks, and bounded dry-run reports. `packages/imaging` is the sole
runtime adapter from those JSON-safe application contracts to the released `purejsimage/geo`
surface.

PureJsImage owns normalized `GeoTargetGrid` semantics, canonical grid identity, relationship,
pixel-alignment and pyramid-compatibility checks, coordinate-transform validation, source-window
planning, nodata-aware sampling, and raster kernels. Each non-exact input is represented by a
`GeoRasterView` containing only its selected level, non-spatial indices, and source band. The
Worker calls `readReprojectedGeoRegion()` only for the current output tile or bounded terrain halo;
it reuses the source dataset and releases the returned Geo/scientific tiles exactly once.

The application still owns multi-input scheduling, virtual-layer and cache lifecycle, cross-tile
statistics, ROI masks, progress, display mapping, semantic actions, approvals, and project
persistence. Package runtime objects are never written into a project.

## Supported operations

- band math, normalized difference, linear combination, and raster difference;
- virtual band stacks with explicit input names and output order;
- hillshade, slope, and aspect with a one-pixel source halo;
- bounded region statistics and line profiles.

The corresponding semantic actions are `geo.analysis.*`; removal is
`geo.derived_layer.remove`. UI, scripts, tests, and a future agent invoke the same action host.
Creation actions always run `geo.analysis.dry_run` before changing the project.

## Value and grid policy

Every recipe input declares `raw` or `scaled`, component, scale, offset, and no-data policy.
Catalog scale/offset metadata may inform a recipe, but the Worker never guesses a Landsat or other
provider-specific transform. A saved recipe remains explicit and replayable.

Every recipe also stores a target grid: CRS identity, dimensions, affine, pixel interpretation,
extent, sample type, no-data, and nearest/bilinear resampling. Exact alignment is the default.
Mismatched inputs are refused unless the recipe selects resampling. Cross-CRS resampling also
requires a versioned transform descriptor and a matching host provider. The geo app retains its
restricted proj4 allowlist and definitions, exposes only a narrow coordinate function, and
`packages/imaging` constructs the public `GeoCoordinateTransformProvider`. Atlas currently
provides `pji-workbench.proj4-inverse@1` only for EPSG:4326 and EPSG:3857; other CRS pairs are
refused.

Nearest reprojection preserves the native source sample type. Bilinear reprojection requests a
floating-point target and preserves the recipe's minimum-valid-weight policy. Exact signed and
unsigned 64-bit nodata is represented only as a canonical decimal string. Atlas's current
quantitative derived operations still reject 64-bit integer sources explicitly rather than round
them; 64-bit interpolation is not supported.

## Identity, bounds, and lifecycle

Derived cache identity schema v2 includes the normalized recipe, PureJsImage Geo engine/version,
transform implementation identity, every source identity and revision or validator, every source
grid, operation version, parameters, resampling, and no-data policy. Canonical JSON makes identity
independent of object-key insertion order. Persisted v1 recipes remain readable without
reinterpretation; new derived provenance additively records the package version, grid identities,
relationships, alignment, pyramid compatibility, and transform identity/version/accuracy.

Worker requests carry fixed output, working-memory, tile-pixel, and source-pixel limits. Terrain
operations read one extra source pixel around a requested tile so adjacent output tiles agree at
their shared edge. Cancellation is propagated to package and source reads; closing an input
dataset or releasing a derived layer aborts dependent work.

Dry-run reports the input identities and grids, target grid, transform requirements, resampling,
no-data policy, output shape, estimated tile count, transferred bytes, managed memory, and
accuracy warnings. Export is intentionally not implemented yet; there is no hidden whole-raster
fallback.

Antimeridian-crossing reprojection remains deliberately unsupported until Atlas can split and
compose requests explicitly. Unknown or unregistered CRS definitions are refused for cross-CRS
work. Arbitrary local transform plugins, 64-bit bilinear interpolation, and whole-derived-raster
export are also outside the current scope.
