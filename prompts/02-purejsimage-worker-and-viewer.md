# Codex prompt 02 — PureJsImage worker and scientific viewer

```text
Continue in the current repository.

Before editing:

- inspect the working tree;
- read AGENTS.md and docs/ARCHITECTURE.md;
- inspect the installed `purejsimage@0.10.0` package exports, declarations, and any packaged application example;
- preserve user changes;
- do not commit, push, publish, or deploy.

Replace the mocked viewport data with a real, worker-hosted PureJsImage integration using public package exports only.

## Public package boundary

Import only documented subpaths. Prefer explicit scientific readers rather than an all-readers bundle so format code can load lazily.

Initial reader registry should support the readers actually exported by 0.10.0, including where available:

- GSF;
- ENVI;
- FITS;
- MRC/CCP4;
- CBF/imgCIF;
- OME-TIFF;
- Aperio SVS.

Inspect exact symbol names instead of guessing them.

Add a compile/build test that fails on any `purejsimage/src` import.

## Imaging Worker

Implement a dedicated module Worker owned by packages/imaging.

Worker responsibilities:

- create and own the scientific reader/library registry;
- open local File/Blob sources;
- open HTTPS HTTP Range sources;
- enumerate ScientificDocuments and dataset summaries;
- open/close datasets;
- expose metadata, axes, units, components, supported plane pairs, and resolution levels;
- own analysis runtime/controller bundle for later prompts;
- serve bounded viewport tile requests;
- expose runtime/source diagnostics;
- release every document, dataset, tile, result, and runtime handle exactly once.

Do not transfer live PureJsImage objects across the Worker boundary. Use opaque typed IDs and JSON-safe descriptors.

## RPC

Implement versioned contracts and validators in packages/contracts for:

- worker initialization;
- open local source;
- open remote source;
- close source/document/dataset;
- enumerate/open dataset;
- set current plane selection;
- request/cancel viewport tile;
- metadata/capabilities;
- diagnostics/events;
- structured error response.

Limit strings, item counts, metadata depth, and message sizes. Unknown message kinds and stale IDs return structured errors.

Implement cancellation through explicit request IDs and cancel messages.

## Local and remote source UX

Add:

- file picker;
- drag/drop;
- URL dialog;
- recent source display without persisting file contents;
- source-opening progress and cancellation;
- CORS/range-specific error guidance;
- multiple dataset selection where a document exposes several datasets.

Remote URLs must be HTTPS except localhost development.

## Viewport tile model

Create a viewport-facing render tile contract that is independent of PureJsImage internal types.

The app should request only visible tiles plus a small prefetch margin. Include:

- dataset ID;
- selected display axes/fixed indices;
- resolution level;
- component/display mapping;
- region/tile address;
- generation/request identity.

Display mapping is non-destructive. Quantitative operations continue to use numeric source values.

Use the current renderer interface and upload bounded render tiles. Avoid a complete-plane RGBA buffer.

Implement:

- progressive first tile;
- pan/zoom tile reprioritization;
- stale response rejection after plane/source changes;
- cancellation of no-longer-visible work;
- level selection for pyramids;
- orthogonal plane controls only when dataset capabilities permit them;
- component selection;
- range/min/max controls and a basic histogram-backed auto range;
- cursor pixel and physical value;
- scale bar using calibrated axes.

## Worker lifecycle

When changing source/dataset:

- cancel viewport requests;
- release render resources;
- close old runtime handles;
- reject late messages through generation IDs;
- leave the previous workspace unchanged if the new source fails to open.

Recover from a Worker crash with a user-visible restart path. Do not silently lose a project.

## Tests

Use deterministic generated fixtures and a local range-aware fixture server.

Add tests for:

- each available public reader smoke fixture;
- local versus HTTP Range parity;
- multiple datasets/associated images;
- pyramid level selection;
- calibrated cursor/scale bar;
- unsupported axis pair UI suppression;
- stale/cancelled tile responses;
- Worker crash/restart;
- source close/release;
- malformed RPC payload;
- remote CORS/range errors;
- first useful tile arrives without a complete-file fetch;
- request log and byte budget assertions.

The browser test must prove that no whole file or full plane is transferred to the main thread for a small viewport.

## Documentation

Add a developer document for:

- worker ownership;
- public PureJsImage imports used;
- RPC protocol;
- source/dataset lifecycle;
- renderer tile contract;
- debugging range reads.

## Verification

Run focused imaging/viewport/RPC tests, all browser projects, package boundary checks, build, bundle measurement, and pnpm check.

Report:

- exact PureJsImage public symbols/subpaths used;
- supported readers;
- Worker/RPC lifecycle;
- remote byte-budget measurements;
- first-tile timing;
- bundle chunks by reader;
- test results;
- git diff --stat;
- remaining viewer limitation.

Do not commit or push.
```
