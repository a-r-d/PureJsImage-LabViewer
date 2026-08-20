# Atlas project persistence

Atlas project documents use `GeoProject` schema version 2. The document is bounded, JSON-safe
semantic state; it is not a snapshot of the imaging Worker.

## Durable state and source lifetimes

The project stores project/viewport state, CRS, source metadata and validators, band metadata,
layers and comparison parameters, normalized derived recipes and target grids, map-coordinate
ROIs, workflow action/provenance records, and useful selection state.

Source locators represent different lifetimes explicitly:

- STAC stores catalog, collection, item, and asset identity. A current asset href is resolved when
  opening and is never durable identity.
- TNM stores its deterministic product identity and resolves the exact returned product.
- remote URLs store a normalized durable URL and compare available HTTP validators before reuse.
- local files store fingerprint evidence only. A user must select the primary and any companion
  files again.

`File`, `Blob`, Worker IDs, dataset handles, tile buffers, cancellation objects, credentials,
signed URLs, and promises are excluded. Derived pixel products are not persisted; recipes remain
unbound until all inputs have runtime bindings.

## Transactional open

Opening follows `parse -> validate -> migrate -> plan -> review -> prepare -> commit`. Runtime
sources and datasets for the candidate project are prepared separately. If any preparation fails
or is cancelled, those candidate bindings are released and the current project remains live. The
controller swaps projects only after every required source is ready.

Changed content requires confirmation. A validator, checksum, projection, or catalog band change
invalidates every transitively dependent derived cache while retaining the recipe for replay.
Provider, license, attribution, and other descriptive metadata are refreshed without pretending a
descriptive-only change is raster content.

## Storage and interchange

The browser store is IndexedDB database `purejsimage-atlas-projects-v2`. It is limited to 64
projects. Each canonical project document is limited to 2 MiB and also inherits the model's
source, layer, ROI, workflow, provenance, property, and coordinate limits. Imports reject excessive
depth, non-plain JSON, non-finite numbers, prototype-pollution keys, credential-shaped keys,
unsupported versions, and checksum mismatches.

Exports include the schema, application version, PureJsImage version, and an FNV-1a checksum. The
checksum detects accidental corruption only and is explicitly not a security claim.

Schema-1 migration is deterministic. It moves a legacy root catalog onto its source, converts
legacy source evidence to semantic locators where possible, moves the active global preset to
raster layer style, establishes explicit project metadata/selection/viewport, and supplies the
old single-comparison default.

## Deep links

Version-2 Atlas hashes support one asset, a curated workflow with bounded scalar parameters and
public source identities, or a two-source comparison. Optional display preset and inspector state
remain concise. Links reject unknown parameters and never serialize project JSON, credentials, or
asset hrefs. Larger state is exchanged as an Atlas project document.
