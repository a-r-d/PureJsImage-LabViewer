# Analysis operation integration

This guide describes the shared analysis service used by the UI and reserved for the approved AI
tool host. The service lives in the imaging Worker; React never receives live PureJsImage datasets,
plans, executions, or complete result tables.

## Public PureJsImage surface

The implementation uses documented package exports only:

- `purejsimage/analysis`: built-in bundle, controller, dataset characteristics, and graph lifecycle;
- `purejsimage/analysis/roi`: ROI normalization and semantic identity;
- `purejsimage/analysis/project`: canonical ROI hashing;
- `purejsimage/analysis/results`: validation, summaries, and table contracts;
- `purejsimage/analysis/runtime`: bounded tile runtime;
- `purejsimage/scientific`: source identity and numeric tile adapters.

The first workflows execute `purejsimage.analysis.statistics`,
`purejsimage.analysis.histogram`, `purejsimage.analysis.line-profile`,
`purejsimage.analysis.threshold`, and `purejsimage.analysis.connected-components`, all version 1,
with the pinned `purejsimage.analysis.reference` provider version 1.

## RPC contract

Every request includes a live dataset handle and generation. JSON inputs are bounded by depth,
items, string length, and total message bytes. Tile requests are capped at 512×512 pixels. The
analysis methods are:

- `analysis.catalog`: JSON-safe operation/value/provider capabilities;
- `analysis.normalize-parameters` and `analysis.normalize-roi`: public-validator boundary;
- `analysis.dry-run`: structured issues, warnings, and the public plan/resource estimate;
- `analysis.execute`: an opaque result handle, bounded output summaries, and provenance;
- `analysis.overlay-tile`: one bounded RGBA/label tile from a retained lazy dataset output;
- `analysis.table-page`: at most 200 rows and 32 columns with Worker-side numeric filter/sort;
- `analysis.release`: idempotent application lifecycle for result execution and plan ownership.

`analysis.execute` calls `summarizeResult(..., { maxPreviewValues: 16 })`; it never serializes a
complete table by default. The UI normally asks for 50 rows. Explicit all-row export loops through
200-row pages and writes Blob parts. The UI therefore renders at most one page even when
`totalRows` is 100,000 or more.

## Adding a descriptor-driven control

1. Confirm the operation exists in `analysis.catalog` and use its public id/version.
2. Generate simple enum/number controls from its parameter schema where practical. The current
   threshold comparison and number controls are hand-authored, then passed through
   `analysis.normalize-parameters`; the controller remains authoritative.
3. Build a JSON-safe graph with named `source` and optional `selection` inputs.
4. Dry-run it and render every issue plus the public total estimate. Never bypass a limit or
   unresolved estimate.
5. Execute with an AbortSignal. Retain the execution only while an overlay/table/result consumer
   needs it.
6. On replacement or close, release execution, dispose plan, then dispose the dataset runtime.
7. Add exact generated-fixture tests for correctness, cancellation, ownership, RPC bounds, and
   display-range independence.

## Current fixture budgets

The exact Worker integration fixture is an 8×8 anisotropically calibrated GSF mask. It verifies two
four-connected objects, a three-value label domain (background plus two labels), physical area in
`nm²`, a one-row paged response, and stale-handle rejection after release. The ROI fixture is 4×4
and verifies rectangle count 4, mean 8.5, and a four-sample line profile `[1, 2, 3, 4]`.

Performance instrumentation continues to track source bytes, transferred tile bytes/pixels,
largest tile, viewport frames, and first useful tile time. Analysis messages add no full-result
payload; plan timing and execution elapsed time are displayed from public controller data.

Morphology, watershed, and FFT are intentionally listed as future operations until they appear in
the public PureJsImage catalog. Do not implement competing scientific kernels in this repository.

