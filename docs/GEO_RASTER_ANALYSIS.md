# Geo raster analysis

Atlas derived rasters are virtual, JSON-safe layers. A project stores the normalized operation
recipe and provenance, while `packages/imaging` evaluates only requested tiles or explicitly
bounded regions in the imaging Worker. The browser window never receives source pixels and the
Worker never materializes a complete COG merely to display an analysis result.

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
requires a versioned inverse-transform descriptor and a matching host provider. The geo app
currently provides `pji-workbench.proj4-inverse@1` only for EPSG:4326 and EPSG:3857; other CRS
pairs are refused.

## Identity, bounds, and lifecycle

Derived cache identity includes the normalized recipe, every source identity and revision or
validator, every source grid, operation version, parameters, resampling, and no-data policy.
Worker requests carry fixed output, working-memory, and tile-pixel limits. Terrain operations read
one extra source pixel around a requested tile so adjacent output tiles agree at their shared
edge. Cancellation is propagated to source tile requests; closing an input dataset or releasing a
derived layer aborts dependent work.

Dry-run reports the input identities and grids, target grid, transform requirements, resampling,
no-data policy, output shape, estimated tile count, transferred bytes, managed memory, and
accuracy warnings. Export is intentionally not implemented yet; there is no hidden whole-raster
fallback.
