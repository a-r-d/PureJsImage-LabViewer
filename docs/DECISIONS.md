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

## Shared showcase monorepo with compile-time domain profiles

This repository is the PureJsImage showcase monorepo. Gallery, science, and geo are the
initial applications; medical is added only when that domain is implemented. Each domain
app is separately built and deployed. A lightweight gallery links to those apps. Shared
behavior is a compile-time domain profile, not a runtime third-party plugin host and not a
cloned standalone tree. PureJsImage remains a separate core-library repository. UI and
future agents use the same semantic action host, and large raster work stays behind the
imaging Worker.

See [`docs/adr/0001-shared-showcase-monorepo.md`](./adr/0001-shared-showcase-monorepo.md).
Science lives in `apps/science` with `packages/domain-science`. Gallery and geo are
separately built applications. Shared React chrome is `packages/workbench-react`.
Medical is planned and has no application package.

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

Durable agent credentials, when a domain explicitly enables them, go only through the reviewed
credential store. Atlas instead defaults to a memory-only OpenRouter key: paste is explicit, removal
is explicit, and application-session teardown clears it. Neither mode places credentials in semantic
actions, project state, history, URLs, logs, telemetry, or error reports.

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

## Chromium uses OS-qualified visual goldens

Linux Chromium is the canonical CI renderer, while Darwin and Linux use separate OS-qualified
baselines because text rasterization is not pixel-equivalent. Firefox and WebKit run the functional,
keyboard, persistence, performance, and accessibility workflows but skip pixel comparison. Baselines
change only after deterministic readiness, artifact inspection, and three consecutive no-update passes.

## Normalized corpus scenarios own product correctness coverage

`ExampleScenarioV1` is normalized once in `packages/test-corpus`; its generated scenario artifact
drives fixture setup, gallery assertions, semantic steps, oracle/tolerance metadata, resource budgets,
test tier, screenshots, accessibility, replay, capability coverage, and future agent eval cases.
Playwright may interpret these validated artifacts but does not parse a second scenario language.
Reviewed numerical reference JSON is immutable test input. Browser runs emit scenario/capability
reports, while missing runtime measurements remain explicit rather than being inferred.

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

## Prompt 11 uses one manifest for examples, workflows, delivery, and tests

`packages/test-corpus` owns the immutable `ExampleScenarioV1` manifest and its normalization,
fixture resolution, audit, cache/download, and archive-safety contracts. The workbench gallery
imports only normalized descriptors. It cannot invent a URL, license, workflow, or expected result,
and candidates are segregated as an unavailable research queue.

Enabled generated scenarios resolve through semantic `sampleId` values handled by the imaging
Worker; project replay preserves that identity without a repository path. Existing Script Studio
recipes/scripts remain the workflow artifacts, so a gallery action opens the exact same
approval-gated surface rather than creating a privileged execution path. Range-backed assets are
never converted into full downloads, and normal CI has no uncontrolled network dependency.

## Atlas display tiles are identity-bound RGBA; scientific samples stay in the Worker

Atlas uses a display-specific Worker protocol instead of retaining the legacy quantitative
`RenderTile` objects. Layer statistics are deterministic, sampled from a bounded repeatable grid at
a reduced overview, cached by stable source and policy identity, and reused across tiles and
overviews. Physical-value display applies declared band scale/offset before the fixed range. The
explicit `viewport-local` mode remains available for exploration and is never represented as stable.

Canvas 2D remains the audited cross-browser renderer: normal/multiply/screen/lighten/darken map to
their standard composite operations, resampling controls image smoothing, and stable z-index ties
retain project order. The display cache owns only canvases and metadata under hard byte/tile limits.
All-band native point reads are separate cancellable Worker requests. Same-CRS swipe and blink are
render modes over already-loaded tiles; Atlas does not reproject or reload a source to compare it.

## Atlas workflows are URL-free recipes executed through semantic actions

Catalog story search presets are replaced by versioned `GeoWorkflowRecipe` data in
`packages/domain-geo`. Recipes declare catalog selectors, named asset roles, compatibility checks,
parameters, approvals, outputs, attribution, and truthful blocked-state explanations without
embedding expiring asset URLs. The shared React browser only renders recipe and runner state.

`GeoWorkflowRunner` in `packages/geo-workbench` is the single UI/future-agent execution path. It
invokes the existing controller action host, records every actual input/result, supports bounded
user choices and cancellation, and removes sources and derived layers created by a failed run.
Completed records are validated into `GeoProject.workflowRuns`. Replay resolves catalog,
collection, item, and asset identity directly; it does not repeat catalog search. Named band
metadata controls RGB, CIR, and normalized-difference recipes, so a component count alone never
establishes NIR. A configured provider band override is accepted only with a non-empty audited
product-documentation note, which remains attached to the candidate and workflow action record.

## Atlas projects persist semantic identities, then rehydrate transactionally

`GeoProject` version 2 stores normalized semantic state and source evidence, never live browser or
Worker objects. STAC/TNM sources resolve fresh hrefs from stable identities, remote URLs compare
available validators, and local sources require explicit file/companion reassociation. Candidate
runtime bindings are prepared beside the current project and committed only as a complete set.
See `docs/ATLAS_PROJECT_PERSISTENCE.md` for limits, migrations, and deep-link policy.

## Atlas agents derive tools from the live semantic action host

Atlas has no model-only tool list. `packages/agent` receives a live capability manifest generated
from action descriptors and availability, while `packages/geo-workbench` supplies bounded project
context and policy. Every call retains its action ID/version/revision and executes through the same
controller `ActionHost` as the UI. The OpenRouter adapter is replaceable, BYOK is session-memory-only,
and normal CI uses deterministic transports. Completed conversation turns are retained only in
bounded memory. Model-visible imagery exists only through the bounded, approval-gated
`geo.preview.create` artifact path; browser-screen scope also requires the native display-share
picker. See `docs/ATLAS_AGENT.md`.
