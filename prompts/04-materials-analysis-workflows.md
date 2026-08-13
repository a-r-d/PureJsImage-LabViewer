# Codex prompt 04 — materials analysis workflows

```text
Continue in the repository after viewer and workspace persistence are functional.

Read AGENTS.md, docs/PRODUCT_NORTH_STAR.md, docs/UX_SYSTEM.md, and the installed PureJsImage analysis/ROI/result declarations. Inspect current code and preserve changes. Do not commit, push, publish, or deploy.

Implement the first complete materials workflow through public PureJsImage APIs:

ROI measurement and
threshold → connected components → object table/distribution.

Do not reimplement analysis algorithms in the app.

## Analysis controller integration

In the imaging Worker:

- create the built-in analysis bundle/controller/runtime using documented APIs;
- expose the JSON-safe operation catalog and descriptions;
- validate/normalize graph commands;
- dry-run and return structured issues and resource estimates;
- execute/cancel;
- retain/release lazy outputs correctly;
- summarize results;
- page/stream large table columns through bounded RPC.

The UI and later AI agent must use the same service.

## ROI tools

Implement viewport tools for:

- point;
- line/polyline where supported;
- rectangle;
- ellipse;
- polygon.

Requirements:

- calibrated coordinates and measurements;
- clear pixel versus physical display;
- handles and hit testing independent of zoom;
- keyboard cancellation/deletion;
- ROI list/rename/visibility;
- serialize through workspace/PureJsImage ROI contracts;
- no private duplicate geometry semantics.

## Measurements

Support:

- ROI statistics;
- histogram;
- line profile;
- display plot and pinned result;
- units;
- CSV/JSON export through a deliberate user action.

Result panels use bounded summaries and paged data.

## Threshold preview

Build an operation inspector generated from operation descriptors where practical.

For threshold:

- component/plane selection;
- threshold parameters from normalized schema;
- live bounded preview as a temporary layer;
- debounce/cancel stale previews;
- Apply commits one graph change;
- Cancel discards preview;
- display validation issues inline;
- preserve quantitative source values.

Do not create history entries for every slider movement.

## Connected components

After threshold is committed, let the user add connected components.

Before execution display:

- plane/component;
- connectivity;
- estimated peak memory;
- estimated work/tiles where available;
- outputs.

On success display:

- label overlay;
- object count;
- virtualized table;
- sortable/filterable numeric columns;
- calibrated and pixel units;
- selection linking table row ↔ label overlay;
- histogram/distribution for area, ECD, aspect ratio, and orientation;
- export selected/all rows.

Do not load a 100,000-row table into React DOM or model context.

Add client-side result filtering only when bounded and efficient; otherwise request paged/filtered data through the Worker contract.

## Pipeline

Show graph nodes in readable sequence with:

- operation title/version;
- normalized parameters;
- status;
- provider/provenance summary;
- warning/validation state;
- result links;
- enable/select/delete/edit actions consistent with graph semantics.

Editing a node creates a new validated workspace revision and invalidates downstream runtime materializations.

## Error/cancel behavior

Cover:

- limit exceeded;
- missing calibration;
- unsupported component/axis pair;
- cancellation;
- source identity mismatch;
- provider/runtime failure;
- result released/stale handle.

The previous committed project remains intact when execution fails.

## Tests

Generated exact fixtures:

- isolated particles;
- touching diagonal particles for 4/8 connectivity;
- border-spanning particles;
- anisotropic calibration;
- missing calibration;
- varied display range that must not alter quantitative result.

Add tests for:

- manual ROI statistics and line profile;
- threshold preview cancellation and commit;
- exact object count and selected measurements;
- label/table linking;
- virtualized 100,000-row result behavior;
- project save/reopen/replay;
- no full result table across RPC by default;
- memory/limit plan display;
- execution cancellation/release;
- keyboard-only analysis path;
- screenshots for main workflow states.

Use a small licensed real SEM subset if the corpus has an enabled entry; generated tests remain the correctness gate.

## Documentation

Add a user workflow document and a developer operation-integration guide. Clearly list morphology/watershed/FFT as future operations if still absent.

## Verification

Run focused analysis/ROI/result tests, Playwright workflow, accessibility, visual, performance on generated fixtures, build, and pnpm check.

Report:

- exact public PureJsImage operations used;
- UI-generated versus hand-authored parameter controls;
- RPC result paging design;
- object-table performance;
- analysis memory/timing fixtures;
- test results;
- git diff --stat;
- remaining scientific workflow limitation.

Do not commit or push.
```
