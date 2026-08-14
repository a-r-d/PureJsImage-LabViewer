# Initial architecture decisions

These decisions are defaults for the first repository skeleton. Change them only with a short architecture decision record explaining the problem and measurable tradeoff.

## Scientific toolbox operations use a trusted public extension

The workbench composes `packages/materials-analysis` through PureJsImage's public extension host. Applicable built-in scientific operations remain the source of truth; missing scientific transforms and materials-oriented filters use a namespaced reference provider with lazy bounded reads. The app does not adapt quantitative scientific datasets through the display-image operation model, import private package paths, or create a second planner/executor.

Calibration corrections are revisioned project overrides. The original dataset descriptor stays unchanged so provenance can distinguish file metadata from a user correction.

## React over Preact

Use React.

The application shell is not the performance bottleneck. Large-data performance depends on:

- bounded file reads;
- worker isolation;
- tile scheduling and caching;
- viewport draw-call discipline;
- typed-array transfer and ownership;
- avoiding broad state subscriptions;
- virtualized result rendering.

React provides the lowest ecosystem and compatibility risk for accessible components, error boundaries, testing, browser tooling, and future embedded integrations. Do not use React state as the tile cache or pixel pipeline.

## pnpm workspaces plus Turborepo

Use pnpm for deterministic workspace dependency management and Turborepo for task orchestration and caching.

Use TypeScript project references underneath this. Turborepo does not replace TypeScript's dependency graph.

## Vite plus Cloudflare

Use a plain client-side Vite React application and the official Cloudflare Vite plugin. Avoid adopting a full-stack React framework before the application needs server rendering or route loaders.

The initial workbench is one desktop-style route. Settings, dataset inspection, results, and the agent are workbench panels rather than separate pages.

## Source-only private packages

Workspace packages are `private: true` and consumed from source during development. Their build outputs exist for boundary testing and production builds, not publication.

Do not add Changesets, semantic-release, independent package versions, or npm publishing jobs until a package has an identified external user.

## One client now, multiple clients possible later

`apps/workbench` is the only client. Shared packages must not import from it. A future viewer embed, teaching client, pathology client, or desktop shell can compose the same packages.

## Backend boundary without speculative backend code

Do not create a fake CRUD API merely to reserve a directory.

The client depends on interfaces in `packages/contracts`, such as:

- object storage locator;
- project store;
- compute-job service;
- plugin registry;
- identity/session service.

The first implementations remain local. A future open-source Docker service or hosted proprietary implementation can satisfy the same contracts.

## Local-first agent credentials

The initial OpenRouter key is stored in browser local storage because that is the requested onboarding model. The UI must state that local storage is readable by JavaScript running on the origin and by sufficiently privileged browser extensions.

The key must never enter:

- project exports;
- analysis graphs;
- agent history exports;
- application logs;
- telemetry;
- URLs;
- error reports.

Wrap storage behind a credential-store interface so a backend token broker can replace it later.

## Dedicated Worker plus QuickJS-WASM for untrusted scripts

User- and AI-authored JavaScript executes only inside a dedicated browser Worker containing a
separate QuickJS-WASM runtime. `packages/scripts` owns lifecycle, serialization, quotas, and the
generated `@lab/api`; the application owns semantic action handlers, policy, revision checks, and
approvals. The production runtime uses exact `0.31.0` versions of `quickjs-emscripten-core` and the
release-sync WASM variant. Debug tests use the matching debug-sync variant and leak detector.

The runtime is lazy: neither the Scripts UI, Worker, nor QuickJS WASM is fetched on normal startup.
The synchronous variant is sufficient because guest promises are resolved through explicit
capability messages and QuickJS pending-job scheduling; no ambient async host function is exposed.
The CSP grants only `wasm-unsafe-eval`, not JavaScript `unsafe-eval`. This is a restricted execution
environment with defense in depth, not a claim of independent security audit.

## Public PureJsImage package boundary is sacred

The app may import only documented package exports such as:

```text
purejsimage/scientific
purejsimage/scientific/browser
purejsimage/scientific/readers/*
purejsimage/analysis
purejsimage/analysis/roi
purejsimage/analysis/results
purejsimage/analysis/runtime
purejsimage/analysis/project
purejsimage/operations
purejsimage/extensions
```

Never import `purejsimage/src/*`, copied internal types, or unpublished files.

## Versioned semantic actions are the shared invocation boundary

UI commands, command-palette entries, future scripts, tests, and the approval-gated agent use one
versioned JSON-safe action registry and host. Descriptors live in `packages/actions`; they contain
schemas, permissions, mutability, cost, cancellation metadata, and availability reasons but no
React or PureJsImage runtime objects. Application composition supplies handlers and context, so the
package is not a global singleton and exact action versions remain replayable.

## Chromium Linux owns visual goldens

Visual goldens use a pinned Chromium configuration and Linux-named paths on every host. Firefox
and WebKit run the functional, keyboard, persistence, performance, and accessibility workflows but
skip pixel comparison. Baselines change only after deterministic readiness, artifact inspection,
and three consecutive no-update passes.

## Particle analysis is a visible, bounded extension graph

Segmentation and particle measurement live in the trusted `packages/materials-analysis` extension
because PureJsImage 0.10.0 does not yet publish these reference primitives. The extension composes
with the public operation/provider API and reuses PureJsImage connected components. The guided UI
only builds the same graph used by recipes and tests. Full-plane global transforms have hard
pixel/peak-memory admission, cancellation, explicit ROI/no-data/calibration policies, and owned
result lifecycles. See `docs/SEGMENTATION_PARTICLE_ANALYSIS.md` for numerical definitions and limits.

## Prompt 09 materials workflows share one bounded extension bundle

PureJsImage 0.10.0 remains the source of truth for arbitrary-axis slicing and min/max/mean
projection. The trusted materials extension adds FFT/diffraction inspection, sum/montage/stack
statistics, phase-correlation alignment, AFM correction/roughness, and local batch orchestration.
FFT complex values remain execution-private until a truthful public complex-dataset contract exists.
Registration uses explicit integer-shift tolerance and deterministic edge policy; AFM corrections
preserve raw data as visible graph steps; batch files execute in isolated Workers with independent
status. See `docs/MATERIALS_FFT_SURFACE_STACK_BATCH.md`.

## Prompt 10 keeps Studio persistence and compilation local and identity-bound

Script and recipe contracts, normalized hashes, installation snapshots, and repository validation
remain in `packages/plugin-sdk`; IndexedDB and the React/CodeMirror authoring surface remain in the
workbench application. TypeScript 6 is installed under the `typescript-compiler` package alias so
the repository's TypeScript 7 build toolchain is not changed. Its compiler is bundled only into the
dedicated lazy language Worker, with a measured 1,000 KiB gzip Worker budget distinct from the
300 KiB route-chunk budget. QuickJS remains the only execution realm for sandboxed code.

Local installation records retain the exact reviewed document, digest, and permission grant.
Editing changes the digest and produces a visible `changed` state until a fresh review. Staged
script actions use underscore-separated IDs because those names are part of the published roadmap;
the action-ID validator accepts underscores as bounded separators without relaxing any input,
permission, or execution policy.
