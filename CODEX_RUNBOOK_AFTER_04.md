# Revised Codex runbook after prompt 04

Run prompts 05 through 15 sequentially. Each prompt assumes prior prompts are complete but still requires Codex to inspect the actual repository.


---

# Codex prompt 05 — architecture design system v2


You are working in `a-r-d/PureJsImage-LabViewer` after prompts 00–04.

The baseline originally inspected for this revised roadmap was commit `3729a846a084e38ae830c429ff5b30d448537cb2`, but do not assume that is still HEAD.

Before editing:

1. Read `AGENTS.md` and every architecture/product document relevant to this prompt.
2. Report the current HEAD and `git status --short`.
3. Inspect the current implementation and tests instead of assuming filenames or APIs from this prompt are exact.
4. Preserve every user change.

Do not commit, push, merge, deploy, publish packages, modify remote metadata, weaken tests, or regenerate visual/numerical goldens merely to make a gate pass. Leave one complete inspectable working-tree diff.

The app is already deployed at `lab.purejsimage.com`; deployment work is out of scope.


## Goal

Prepare the application for a much larger scientific, scripting, plugin, corpus, and agent surface without changing the working prompt-04 scientific behavior.

This prompt must:

1. restore a fully deterministic green CI baseline;
2. split monolithic application and Worker orchestration into feature/domain boundaries;
3. establish a unified semantic action registry;
4. implement the first design-system V2 and workbench-shell improvements;
5. add a deterministic UI-lab route for visual/interaction testing.

## 1. Fix visual determinism before changing baselines

The latest inspected Chromium run passed functional tests and failed five visual screenshots by stable one-to-two-percent differences.

Investigate actual/expected/diff/trace artifacts. Make screenshots deterministic by explicitly controlling:

- timezone and locale;
- color scheme and reduced motion;
- device scale factor and viewport;
- browser/font loading;
- all animations and caret blinking;
- Worker startup;
- initial dataset and tile readiness;
- canvas draw completion;
- persisted local/IndexedDB state;
- generated IDs and timestamps visible in screenshots.

Add application readiness signals such as:

```text
data-workbench-ready="true"
data-render-settled="true"
data-analysis-settled="true"
```

These signals must represent real state, not test-only delays.

Only after establishing repeated local stability may intentionally changed baselines be updated. Produce a short visual-baseline report stating which pixels/layout changed and why.

## 2. Decompose the app without changing behavior

Reduce `App.tsx` to top-level composition, providers, routes, and error boundaries. Create feature-oriented modules, adapting names to the current code:

```text
apps/workbench/src/app/
  WorkbenchApp.tsx
  WorkbenchProviders.tsx
  WorkbenchShell.tsx

apps/workbench/src/features/
  source/
  navigator/
  viewport/
  roi/
  analysis/
  results/
  pipeline/
  project/
  examples/
  scripts/
  agent/
  settings/
```

Move stateful orchestration into small hooks/controllers. Avoid a new giant `useWorkbench()` object that simply relocates the monolith.

Rules:

- high-frequency camera/pointer state remains outside broad React subscriptions;
- semantic workspace changes continue through immutable revisioned commands;
- live PureJsImage handles remain in imaging/runtime packages;
- no duplicate project/analysis state in feature components;
- dialogs/panels receive bounded view models and callbacks;
- existing test IDs and accessibility names remain stable unless deliberately improved and tests updated.

Split `packages/imaging/src/worker-host.ts` into domain registrars/handlers such as:

```text
worker-host/source-rpc.ts
worker-host/view-rpc.ts
worker-host/analysis-rpc.ts
worker-host/result-rpc.ts
worker-host/project-rpc.ts
worker-host/runtime.ts
```

Keep one Worker and one request router unless evidence requires more.

Add architecture checks preventing feature cycles and imports from apps into packages.

## 3. Add a unified action registry

Create a focused package such as `packages/actions` if the existing package graph has no appropriate home.

Define JSON-safe descriptors equivalent to:

```ts
interface WorkbenchActionDescriptorV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly version: number
  readonly title: string
  readonly description: string
  readonly category: string
  readonly inputSchema: JsonSchema
  readonly outputSchema: JsonSchema
  readonly mutability: 'read' | 'proposal' | 'mutation'
  readonly cost: 'trivial' | 'interactive' | 'expensive' | 'external'
  readonly permissions: readonly string[]
  readonly cancellable: boolean
}
```

The registry provides:

- deterministic enumeration;
- exact version lookup;
- schema validation;
- availability and unavailable-reason calculation;
- bounded capability manifest for UI/scripts/agent;
- no global singleton;
- no React/PureJsImage runtime imports in descriptor contracts.

Register current actions for source opening, viewport state, ROI, threshold preview/commit, connected components, result access, pipeline/project actions, and panel/selection commands. The UI and command palette should invoke the same action host rather than parallel ad hoc callbacks where practical.

Do not expose an agent yet.

## 4. Design system V2

Update `docs/UX_SYSTEM.md` from `docs/UX_V2.md` in this roadmap bundle or implement equivalent decisions.

Changes:

- raise essential text from 9–10 px to readable 11–13 px sizes;
- use tabular monospace for numerical readouts;
- organize tokens into neutral, semantic, overlay, typography, density, motion, elevation, and scientific-label groups;
- replace the small hand-maintained general icon set with a tree-shaken icon package such as Lucide React; retain custom scientific icons only where necessary;
- add mode rail affordances for Browse, ROI, Analyze, Results, Scripts, Examples, and Agent, with unavailable modes honestly disabled;
- remove the decorative viewport grid whenever real data is visible;
- add a specimen-first viewport separation, compact viewport tool rail, stable readouts, and clearer selected states;
- create an operation-browser shell with search/category/recent/favorite placeholders backed by the action/operation catalog;
- add an example-gallery empty-state shell, but do not yet download external assets;
- split global CSS into tokens/shell/utilities and feature styles;
- support reduced motion and light/dark themes from one token system.

Do not produce a generic card-heavy dashboard or use gradients/glow everywhere. Keep the visual posture restrained and instrument-like.

## 5. UI lab

Add a development/test route such as `/__ui-lab` that renders deterministic states for:

- buttons/icons/tooltips;
- tabs and splitters;
- empty/error/loading states;
- operation parameter controls;
- ROI list;
- result table/plot placeholders;
- dialogs and approval cards;
- light/dark themes;
- narrow/wide panel states.

It must not load external data or persist normal user state.

## Required tests

- existing prompt-04 workflows remain green;
- visual screenshots are stable across three consecutive local runs;
- Chromium, Firefox, and WebKit functional tests pass;
- visual CI uses deterministic readiness gates;
- App and Worker behavior remains equivalent;
- action registry enumeration and validation are deterministic;
- command palette/current UI action integration works;
- architecture dependency rules pass;
- keyboard/focus/a11y tests pass;
- UI-lab screenshot matrix is intentional and bounded.

## Verification

Run at least:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm check
```

Report file-size reductions for the previous App and Worker-host monoliths, CI/visual findings, new action APIs, and any behavior intentionally deferred.


---

# Codex prompt 06 — actions sandbox plugin foundation


You are working in `a-r-d/PureJsImage-LabViewer` after prompts 00–04.

The baseline originally inspected for this revised roadmap was commit `3729a846a084e38ae830c429ff5b30d448537cb2`, but do not assume that is still HEAD.

Before editing:

1. Read `AGENTS.md` and every architecture/product document relevant to this prompt.
2. Report the current HEAD and `git status --short`.
3. Inspect the current implementation and tests instead of assuming filenames or APIs from this prompt are exact.
4. Preserve every user change.

Do not commit, push, merge, deploy, publish packages, modify remote metadata, weaken tests, or regenerate visual/numerical goldens merely to make a gate pass. Leave one complete inspectable working-tree diff.

The app is already deployed at `lab.purejsimage.com`; deployment work is out of scope.


## Goal

Create the contract and security foundation that will let users and the later AI assistant author reusable recipes and arbitrary analysis scripts without executing untrusted code in the page, React realm, or imaging Worker.

This prompt builds a sandbox proof and the complete contracts. It does not yet build the full Script Studio.

## 1. Update project rules and docs

Integrate the important rules from `AGENTS_V2.md` and `docs/SCRIPTING_PLUGIN_V2.md` into the repository.

Correct the old blanket rule “the model may never execute arbitrary JavaScript” to the precise rule:

> User/AI-authored executable code may run only inside the dedicated sandbox Worker and QuickJS-WASM runtime through a default-deny capability host. It never runs in the page, React realm, imaging Worker, or unrestricted module Worker.

## 2. Expand plugin SDK contracts

Extend `packages/plugin-sdk` with bounded validators/normalizers for:

- `RecipeDocumentV1`;
- `AnalysisScriptDocumentV1`;
- script/plugin manifest;
- capabilities and permission grants;
- integrity/content hash;
- compatibility ranges;
- local installation record;
- script test case/result;
- sandbox RPC messages;
- provenance references.

Keep contracts JSON-safe. Bound source length, manifest fields, test count, message size, and capability count.

## 3. Sandbox runtime package

Create `packages/scripts` or the cleanest equivalent.

Architecture:

```text
main/app realm
  → script-host client
    → dedicated browser Worker
      → QuickJS-WASM runtime/context
        → generated @lab/api module
          → bounded capability RPC back to host
```

Use `quickjs-emscripten` or a carefully justified equivalent. Load it lazily only when scripts are used.

Security requirements:

- no DOM/window/document;
- no localStorage, IndexedDB, cookies, clipboard, credentials, or browser APIs;
- no ambient fetch/WebSocket/EventSource;
- no unrestricted dynamic import/module loader;
- only generated `@lab/api` and script-local approved modules;
- memory and stack limits;
- deadline/interrupt handler;
- maximum source bytes, output bytes, messages, message bytes, API calls, and console lines;
- cancellation that disposes the context/runtime and can terminate/recreate the Worker;
- explicit serialization; no host prototypes/functions passed through;
- no SharedArrayBuffer initially;
- deterministic mode with no Date/random/network unless explicitly supplied as recorded capabilities.

Use the debug QuickJS variant in a leak-detection test suite and the release variant for production/performance tests.

Do not claim independent security audit.

## 4. Generated script API

Generate a versioned TypeScript declaration and runtime catalog from the semantic action registry.

Initial sandbox API should support a useful but narrow read/proposal flow against generated fixtures:

- workspace summary;
- source/dataset list and descriptors;
- ROI list/proposal;
- analysis catalog/describe/normalize/dry-run/request-execute;
- result summary/page;
- viewport/UI proposals;
- bounded log output.

Every call routes through the same validator, availability, policy, revision, dry-run, cost, and cancellation paths as normal UI actions.

No raw tile/source bytes enter the sandbox.

## 5. Sandbox proof UI

Add a developer-only or Scripts placeholder surface capable of:

- loading a built-in script fixture;
- showing manifest/capabilities/source;
- running parse/type-contract validation;
- executing it in the sandbox against the generated sample;
- showing bounded logs and proposed actions;
- cancelling/terminating it.

Do not build the full editor/store/import/export yet.

## Security and correctness tests

Prove:

- DOM/window/storage/network are absent;
- attempts to access them fail;
- infinite loops terminate;
- memory/stack/message/tool-call limits work;
- cancellation terminates execution;
- malformed RPC and oversized values are rejected;
- ungranted actions are denied;
- a script cannot obtain OpenRouter credentials;
- host action validation cannot be bypassed;
- script crash cannot corrupt workspace or imaging Worker;
- source hash, manifest, permissions, action/tool trace, and result summary appear in provenance;
- all QuickJS handles/runtimes are disposed without debug leak reports.

## Verification

Run all normal gates plus dedicated sandbox release/debug suites and a browser E2E proof. Report dependency/bundle impact and confirm QuickJS is code-split from normal startup.


---

# Codex prompt 07 — core analysis toolbox


You are working in `a-r-d/PureJsImage-LabViewer` after prompts 00–04.

The baseline originally inspected for this revised roadmap was commit `3729a846a084e38ae830c429ff5b30d448537cb2`, but do not assume that is still HEAD.

Before editing:

1. Read `AGENTS.md` and every architecture/product document relevant to this prompt.
2. Report the current HEAD and `git status --short`.
3. Inspect the current implementation and tests instead of assuming filenames or APIs from this prompt are exact.
4. Preserve every user change.

Do not commit, push, merge, deploy, publish packages, modify remote metadata, weaken tests, or regenerate visual/numerical goldens merely to make a gate pass. Leave one complete inspectable working-tree diff.

The app is already deployed at `lab.purejsimage.com`; deployment work is out of scope.


## Goal

Expand the application from one particle-count vertical slice to the common everyday image-processing and measurement toolbox described in `docs/ANALYSIS_80_PERCENT.md`.

Before adding an operation, enumerate the actual PureJsImage operation catalog. Use existing public operations when available. Broadly reusable missing primitives should be documented as upstream PureJsImage gaps. Application/materials-specific operations belong in a new explicit extension package, for example `packages/materials-analysis`, using only public PureJsImage operation/provider APIs.

## Operation-browser product surface

Implement a searchable operation catalog with:

- categories;
- search by title/description/tags;
- recent and favorites;
- availability and reason unavailable;
- parameter forms driven by descriptors;
- domain-enhanced controls where schemas are insufficient;
- preview, Apply, Cancel, Reset;
- operation documentation, units, output, no-data policy, and cost;
- recipe/workflow presets;
- command-palette and action-registry integration.

## Core operations

Implement or expose, with deterministic reference behavior and tests:

### Geometry and numeric

- crop;
- resize/resample;
- rotate 90/180/270;
- horizontal/vertical flip;
- translation;
- numeric type conversion with explicit clipping/scaling;
- normalize and clamp;
- invert data;
- gamma, log, square-root transforms;
- add/subtract/multiply/divide constant;
- image calculator for compatible datasets if the graph/value model supports a second dataset cleanly.

### Filters and correction

- Gaussian;
- mean/box;
- median;
- minimum and maximum;
- arbitrary convolution kernel;
- sharpen/unsharp mask;
- Sobel or Scharr gradient;
- Laplacian;
- outlier/despeckle filter;
- background subtraction with a documented bounded algorithm.

### Calibration and measurement

- display file-provided X/Y calibration and its source;
- set/correct scale from a known line distance as a revisioned project command, preserving original metadata;
- anisotropic X/Y support;
- units conversion;
- ROI statistics: area, perimeter where supported, centroid, mean/median/min/max/std/variance/integrated intensity;
- histogram/percentiles;
- line and width-averaged profiles;
- Feret/equivalent diameter/major-minor/aspect/orientation/circularity/solidity when the object geometry exists;
- explicit pixel versus physical outputs.

### Export

- bounded CSV for tables/profiles/histograms;
- rendered PNG export with explicit display mapping;
- project/recipe export through existing persistence;
- no hidden source conversion or upload.

## Scientific contracts

For every new operation define:

- operation ID/version;
- parameter normalization;
- supported sample/components/axes;
- output descriptor;
- no-data/non-finite behavior;
- boundary/interpolation policy;
- units/calibration propagation;
- reproducibility/tolerance;
- memory estimate and cancellation;
- stable action entry;
- provenance.

## Tests

Use generated exact fixtures for kernels, transforms, anisotropic calibration, no-data, tile boundaries, cancellation, and preview/commit/replay.

Add E2E workflows for:

- calibrate from a line and measure a second object;
- crop/filter/profile/export;
- image arithmetic where supported;
- operation search/favorite/recent;
- keyboard preview/apply/cancel;
- project reload with equivalent numerical outputs.

Do not implement morphology, watershed, FFT, AFM leveling, batch, or the agent in this prompt.


---

# Codex prompt 08 — segmentation particle analysis


You are working in `a-r-d/PureJsImage-LabViewer` after prompts 00–04.

The baseline originally inspected for this revised roadmap was commit `3729a846a084e38ae830c429ff5b30d448537cb2`, but do not assume that is still HEAD.

Before editing:

1. Read `AGENTS.md` and every architecture/product document relevant to this prompt.
2. Report the current HEAD and `git status --short`.
3. Inspect the current implementation and tests instead of assuming filenames or APIs from this prompt are exact.
4. Preserve every user change.

Do not commit, push, merge, deploy, publish packages, modify remote metadata, weaken tests, or regenerate visual/numerical goldens merely to make a gate pass. Leave one complete inspectable working-tree diff.

The app is already deployed at `lab.purejsimage.com`; deployment work is out of scope.


## Goal

Complete the dominant materials particle/precipitate workflow:

```text
correct/filter
→ threshold
→ binary cleanup
→ watershed touching particles
→ connected components
→ object filters and measurements
→ linked overlays/table/distributions
```

Reuse current connected-components support. Implement broadly reusable primitives upstream or as clean public extensions according to repository policy.

## Thresholding

Add reference implementations and catalog actions for:

- manual lower/upper;
- Otsu;
- Triangle;
- Yen;
- Li;
- mean or another clearly documented common global method;
- adaptive Sauvola;
- optional Phansalkar only with a reliable reference and bounded implementation.

Support dark/light foreground, selected ROI/plane/component, no-data policy, preview histogram, and foreground fraction.

## Binary morphology

Add:

- erode;
- dilate;
- open;
- close;
- fill holes;
- clear border;
- remove small objects;
- outline;
- Euclidean or clearly documented distance transform;
- watershed separation of touching particles.

Skeletonization may be added only after the core workflow is complete and tested.

Global/barrier operations must use PureJsImage’s global-transform/reduction contracts and hard memory accounting. Do not materialize unbounded full planes outside managed runtime contracts.

## Particle analysis

Extend the current object workflow with:

- exclude/include edge objects;
- area range;
- circularity range;
- aspect-ratio range;
- solidity range;
- intensity statistics from a chosen source component;
- object count, area fraction, total/mean/median size;
- table columns for calibrated dimensions;
- outline, mask, numbered label, centroid, and fitted-ellipse views;
- histogram, box/violin-like distribution where appropriate, and cumulative distribution;
- table-row ↔ viewport-object linked selection;
- deterministic CSV export.

## Guided workflow

Add a “Particle analysis” workflow surface/preset that composes the graph while exposing every step. It must never hide the operation graph or make irreversible edits.

The user should be able to:

1. choose ROI/component and foreground polarity;
2. choose threshold method and inspect preview;
3. choose cleanup/watershed settings;
4. dry-run connected components with memory estimate;
5. filter objects;
6. inspect linked table/overlays/distributions;
7. save as a recipe or open it in the Script Studio later.

## Tests

Generated fixtures must include:

- isolated circles/ellipses;
- touching particles that require watershed;
- holes;
- edge objects;
- anisotropic calibration;
- noisy/uneven background;
- objects crossing tile boundaries;
- exact known counts and tolerated measurements.

Test tile-size/concurrency invariance, memory admission, cancellation, project replay, threshold-method reference outputs, linked selection, export, and keyboard/a11y UX.

Do not add AI integration in this prompt.


---

# Codex prompt 09 — materials fft surface stack batch


You are working in `a-r-d/PureJsImage-LabViewer` after prompts 00–04.

The baseline originally inspected for this revised roadmap was commit `3729a846a084e38ae830c429ff5b30d448537cb2`, but do not assume that is still HEAD.

Before editing:

1. Read `AGENTS.md` and every architecture/product document relevant to this prompt.
2. Report the current HEAD and `git status --short`.
3. Inspect the current implementation and tests instead of assuming filenames or APIs from this prompt are exact.
4. Preserve every user change.

Do not commit, push, merge, deploy, publish packages, modify remote metadata, weaken tests, or regenerate visual/numerical goldens merely to make a gate pass. Leave one complete inspectable working-tree diff.

The app is already deployed at `lab.purejsimage.com`; deployment work is out of scope.


## Goal

Add the materials-specific capabilities that make the workbench more useful than a generic browser image editor.

Implement these as one or more explicit materials-analysis extension bundles using public PureJsImage contracts. Keep each operation independently versioned and testable.

## Frequency-domain tools

Add:

- 2D FFT;
- centered magnitude and power spectrum;
- raw/log display mapping as presentation, not hidden data mutation;
- radial profile/radial integration;
- azimuthal profile;
- spatial-frequency and d-spacing cursor readout when calibration permits;
- simple bandpass/notch masks;
- basic local peak annotation with explicit thresholds;
- inverse FFT only if the value/complex-data contract is truthful.

Provide an “FFT workspace” linking source ROI, transform, profile plot, frequency cursor, annotations, and provenance.

## Stack/volume and registration

Add or expose:

- arbitrary-axis plane navigation;
- min/max/mean/sum projection;
- montage/contact sheet;
- stack statistics;
- translation registration through phase correlation;
- stack/frame alignment;
- drift trajectory plot;
- crop/ROI propagation through a stack.

Use bounded tile/global execution and explicit registration tolerance/edge policy.

## AFM/SPM surface workflow

For calibrated scalar height fields add:

- mean-plane subtraction;
- first-order plane leveling;
- row/line median correction;
- optional bounded polynomial background with clear degree limits;
- height histogram;
- Ra, Rq/RMS, Rz with documented definitions;
- grain detection using the shared segmentation pipeline;
- profile extraction;
- exclusion masks;
- independent X/Y and Z units.

Add an “AFM surface” preset that preserves raw data and makes each correction visible in history.

## Diffraction/detector helpers

Add only well-defined initial helpers:

- beam-center annotation;
- radial intensity integration;
- ring/peak candidate detection;
- calibrated radius/d-spacing readout where metadata permits;
- exportable profile and annotations.

Do not claim crystallographic indexing or phase identification.

## Batch recipes

Add a local-first batch runner that applies one validated recipe to:

- multiple user-selected local files;
- multiple selected datasets/planes;
- multiple enabled corpus scenarios in test mode.

Requirements:

- bounded concurrency;
- per-item cancellation/status/error;
- one failed item does not corrupt others;
- aggregate result table;
- deterministic naming;
- no hidden upload;
- source identity and recipe/script hash per row;
- resumable local run metadata where practical.

## Tests

Use exact synthetic sinusoidal lattices, known translations, known planes/slopes, known roughness, calibrated rings, and small stacks. Add tolerance-based differential/oracle tests, cancellation, memory, tile invariance, batch partial failure, and project replay.

Do not add the AI agent or full Script Studio here.


---

# Codex prompt 10 — script studio executable plugins


You are working in `a-r-d/PureJsImage-LabViewer` after prompts 00–04.

The baseline originally inspected for this revised roadmap was commit `3729a846a084e38ae830c429ff5b30d448537cb2`, but do not assume that is still HEAD.

Before editing:

1. Read `AGENTS.md` and every architecture/product document relevant to this prompt.
2. Report the current HEAD and `git status --short`.
3. Inspect the current implementation and tests instead of assuming filenames or APIs from this prompt are exact.
4. Preserve every user change.

Do not commit, push, merge, deploy, publish packages, modify remote metadata, weaken tests, or regenerate visual/numerical goldens merely to make a gate pass. Leave one complete inspectable working-tree diff.

The app is already deployed at `lab.purejsimage.com`; deployment work is out of scope.


## Goal

Turn the sandbox foundation into a first-class Script Studio where users can write, edit, test, install, run, import, and export declarative recipes and sandboxed analysis scripts. Prepare staged actions that the later AI assistant can use without integrating a model yet.

## Editor

Use a focused modular browser editor such as CodeMirror 6. Load editor/language/compiler/sandbox bundles lazily.

Provide:

- scripts/recipes list;
- source editor;
- generated `@lab/api` declarations;
- API search and examples;
- Problems panel;
- manifest/permissions panel;
- test cases and fixture selector;
- bounded console/output;
- graph/result links;
- diff/review view;
- Run, Dry Run, Test, Cancel, Install Locally, Export, Duplicate, Revert.

TypeScript may be transpiled/typechecked in a dedicated lazy language Worker. Do not put the TypeScript compiler into initial workbench startup.

## Local store

Store scripts, recipes, installation records, test results, and editor state in IndexedDB through a versioned repository interface.

- normalized content hash;
- no credentials;
- bounded source/test/log size;
- migration and corruption handling;
- export/import validation;
- exact installed version/content retained for project replay;
- missing/mismatched plugin warnings.

## Script API

Expose the complete stable action surface needed for existing analysis workflows. Generate runtime bindings and TypeScript declarations from the same source.

Scripts should be able to:

- inspect datasets/calibration/metadata;
- create/update ROIs through proposals;
- compose/dry-run/execute operations;
- read bounded result summaries/pages;
- run particle, FFT, AFM, stack, and batch workflows;
- propose viewport/UI selection for presentation;
- export only through explicit host approval.

## Built-in examples

Ship at least:

- particle count recipe;
- watershed particle script;
- FFT radial-profile script;
- AFM leveling/roughness script;
- batch measurement script.

Each has deterministic tests against generated scenarios.

## AI-ready staged actions

Register, but do not connect to a model:

```text
script.create_draft
script.read
script.apply_patch
script.typecheck
script.run_tests
script.diff
script.request_install
script.request_execute
```

They use the same action/policy host and produce bounded JSON-safe results.

## Security tests

Retain all prompt-06 sandbox tests. Add import/export attacks, malicious source, quota exhaustion, script-store corruption, permission changes, script identity mismatch, and project replay tests.

## UX tests

- keyboard-only create/edit/typecheck/test/run;
- API search and autocomplete;
- capability review;
- diff approval;
- cancellation;
- clear distinction among recipe, sandboxed script, and trusted extension;
- no misleading “safe” or “secure” claim beyond documented guarantees.


---

# Codex prompt 11 — example library corpus activation


You are working in `a-r-d/PureJsImage-LabViewer` after prompts 00–04.

The baseline originally inspected for this revised roadmap was commit `3729a846a084e38ae830c429ff5b30d448537cb2`, but do not assume that is still HEAD.

Before editing:

1. Read `AGENTS.md` and every architecture/product document relevant to this prompt.
2. Report the current HEAD and `git status --short`.
3. Inspect the current implementation and tests instead of assuming filenames or APIs from this prompt are exact.
4. Preserve every user change.

Do not commit, push, merge, deploy, publish packages, modify remote metadata, weaken tests, or regenerate visual/numerical goldens merely to make a gate pass. Leave one complete inspectable working-tree diff.

The app is already deployed at `lab.purejsimage.com`; deployment work is out of scope.


## Goal

Build a large, useful in-app example library and turn the existing corpus manifest into an enforceable data/scenario system. Users should be able to see the application’s value immediately, and the same examples should drive deterministic tests.

Integrate `docs/EXAMPLE_LIBRARY_AND_CORPUS.md`.

## Corpus package

Implement `packages/test-corpus` with:

- schema validation/normalization;
- candidate/enabled/disabled status;
- exact selected-file records;
- license and attribution enforcement;
- SHA-256 integrity;
- safe download/cache/extraction;
- generated fixture resolution;
- immutable scenario descriptors;
- workflow/expected-result/budget data;
- test tags/tiers;
- no runtime dependence on repository-relative developer paths.

Refuse unknown licenses, missing integrity for enabled external files, archive traversal, unexpected symlinks, excessive files, or extraction budgets.

## Expand candidates and activate real examples carefully

Research exact small representative files/subsets for:

- NIST SEM segmentation/noise;
- SEM indentation images/masks;
- plastisphere or material-surface SEM;
- TEM nanoparticles with labels;
- SEM additive-manufacturing/phase segmentation;
- AFM/GSF height fields;
- EMPIAR FIB-SEM/SBF-SEM volumes;
- HRTEM/FFT spacing;
- diffraction/CBF;
- ENVI hyperspectral;
- OpenSlide/Aperio pyramid;
- future DM4/4D-STEM.

Do not enable an item until exact file URL, file path, size, SHA-256, license, attribution, and redistribution/hosting decision are verified. Keep unsuitable/non-commercial data as candidate or excluded with a reason.

Normal Git should contain only small generated/bundled assets, thumbnails, manifests, and expected JSON—not large source data.

## In-app example gallery

Add an Examples surface and rich empty-state gallery:

- thumbnail;
- title/summary;
- modality/vendor/format;
- size and local/remote indicator;
- calibration status;
- tags and learning goal;
- license/attribution/source;
- Open example;
- Run workflow;
- Inspect recipe/script;
- download/progress/cancel/error;
- recently used examples.

Provide search/filter by modality, format, vendor, task, and size.

Each enabled example must have one or more verified workflow buttons and expected results.

## Data delivery

Support:

- generated in-browser/local fixtures;
- small static bundled assets;
- project-hosted immutable remote assets;
- scheduled external corpus cache.

For remote large files, preserve Range observability and do not pre-download the complete file merely to show metadata or a thumbnail.

## Tests

- manifest/license/integrity validation;
- downloader/cache/extractor security;
- offline cached behavior;
- example gallery and attribution;
- each enabled workflow reaches expected numerical/structural output;
- remote byte budgets;
- cancellation/retry;
- project save/reopen/source rebind;
- no normal CI dependence on uncontrolled external servers.

Produce a corpus audit report listing every enabled, candidate, excluded, and scheduled item and why.


---

# Codex prompt 12 — corpus scientific e2e


You are working in `a-r-d/PureJsImage-LabViewer` after prompts 00–04.

The baseline originally inspected for this revised roadmap was commit `3729a846a084e38ae830c429ff5b30d448537cb2`, but do not assume that is still HEAD.

Before editing:

1. Read `AGENTS.md` and every architecture/product document relevant to this prompt.
2. Report the current HEAD and `git status --short`.
3. Inspect the current implementation and tests instead of assuming filenames or APIs from this prompt are exact.
4. Preserve every user change.

Do not commit, push, merge, deploy, publish packages, modify remote metadata, weaken tests, or regenerate visual/numerical goldens merely to make a gate pass. Leave one complete inspectable working-tree diff.

The app is already deployed at `lab.purejsimage.com`; deployment work is out of scope.


## Goal

Replace the growing single smoke file with a comprehensive scenario-driven product correctness system using generated and enabled corpus examples.

## Scenario DSL

Use one normalized `ExampleScenarioV1`/workflow definition to drive:

- fixture/source setup;
- app gallery metadata;
- analysis steps;
- expected numerical/structural outputs;
- memory/range/cancellation budgets;
- screenshots;
- accessibility;
- project replay;
- future agent eval cases.

Do not make Playwright tests parse ad hoc YAML directly; load validated generated scenario artifacts from `packages/test-corpus`.

## Split the E2E suite

Suggested organization:

```text
apps-e2e/workbench/tests/
  shell.spec.ts
  source-viewer.spec.ts
  roi-measurement.spec.ts
  core-analysis.spec.ts
  particle-analysis.spec.ts
  fft-materials.spec.ts
  surface-stack.spec.ts
  scripts-plugins.spec.ts
  examples.spec.ts
  project-replay.spec.ts
  lifecycle-hostile.spec.ts
  accessibility.spec.ts
  visual.spec.ts
  performance.spec.ts
```

Use page objects only for stable semantic surfaces; do not hide assertions inside giant helper classes.

## Oracles

For generated fixtures, calculate exact outputs independently from production orchestration.

For floating/reference algorithms:

- generate reviewed expected JSON using an independent reference implementation where practical;
- store algorithm/reference version and tolerance;
- CI validates against the checked-in expected output and never silently rewrites it;
- visual goldens are presentation tests, not numerical oracles.

## Required scenario assertions

Across the library cover:

- reader/dataset detection;
- axes/components/calibration/metadata;
- local versus Range-backed parity;
- first-useful-tile and bytes fetched;
- viewport navigation and value readout;
- every ROI type and units;
- filters/transforms/background;
- threshold/morphology/watershed;
- connected components/object filtering/measurements;
- FFT/profile/d-spacing;
- stack projection/registration;
- AFM leveling/roughness;
- batch partial failure;
- script sandbox and recipe replay;
- project save/reopen/rebind;
- cancellation, crash recovery, memory cleanup, and exactly-once releases;
- keyboard/a11y;
- linked table/viewport selection;
- bounded exports.

## Test tiers

- PR CI: generated + compact enabled real subset, no uncontrolled network.
- Main/nightly: wider real-data subset.
- Scheduled/manual: large EMPIAR/WSI/range/performance datasets.
- Local developer tags for expensive scenarios.

## Visual determinism

Use the readiness contracts from prompt 05. Keep a small deliberate screenshot matrix rather than screenshotting every scenario.

## Reporting

Generate a report by scenario and capability showing:

- pass/fail;
- numerical tolerances;
- source bytes/ranges;
- peak managed memory;
- first tile and completion time;
- cancellation latency;
- screenshots/traces on failure;
- project/invocation identities.

Ensure all browser projects and root `pnpm check` are green.


---

# Codex prompt 13 — ux validation world class polish


You are working in `a-r-d/PureJsImage-LabViewer` after prompts 00–04.

The baseline originally inspected for this revised roadmap was commit `3729a846a084e38ae830c429ff5b30d448537cb2`, but do not assume that is still HEAD.

Before editing:

1. Read `AGENTS.md` and every architecture/product document relevant to this prompt.
2. Report the current HEAD and `git status --short`.
3. Inspect the current implementation and tests instead of assuming filenames or APIs from this prompt are exact.
4. Preserve every user change.

Do not commit, push, merge, deploy, publish packages, modify remote metadata, weaken tests, or regenerate visual/numerical goldens merely to make a gate pass. Leave one complete inspectable working-tree diff.

The app is already deployed at `lab.purejsimage.com`; deployment work is out of scope.


## Goal

Perform a dedicated UX and visual-quality phase after the real analysis, script, and example surfaces exist. This prompt is not a cosmetic repaint; it validates and improves task completion, readability, consistency, accessibility, and perceived performance.

Use `docs/UX_V2.md` as the target and inspect current screenshots, CSS, UI package, and real workflows.

## Information architecture

Refine:

- mode rail and semantic navigator;
- source/dataset/layer/ROI/result hierarchy;
- contextual inspector behavior;
- operation browser and parameter footer;
- bottom drawer for pipeline/results/plots/scripts/diagnostics;
- examples/home experience;
- Script Studio;
- disabled Agent affordance ready for prompt 14.

Avoid duplicate navigation and do not make every feature a permanent panel.

## Visual refinement

- readable typography and density;
- consistent 30–32 px controls and 40–48 px toolbars where appropriate;
- Lucide/general icons plus coherent custom scientific icons;
- restrained semantic colors;
- improved empty/loading/error/cancel states;
- clear selection/hover/focus/disabled styles;
- specimen-first viewport without decorative noise;
- crisp label/ROI overlays;
- virtualized result table and polished plots;
- explicit units/provenance/analysis-state chips;
- subtle elevation and motion with reduced-motion behavior;
- light theme parity without making it the default.

## UX instrumentation and tests

Automate:

- task-level duration events in test mode;
- interaction-to-next-paint or equivalent measured latency for pan/zoom/tab/ROI/threshold;
- layout shift during loading;
- focus order/restoration;
- pointer target size;
- 200 percent zoom;
- reduced motion;
- contrast and axe;
- keyboard-only workflows;
- narrow/wide desktop;
- deterministic visual matrix for both themes and major surfaces.

Do not add user telemetry by default. Test instrumentation remains local/test-only unless an opt-in product design is explicitly approved.

## Human usability protocol

Add `docs/USABILITY_TEST_PROTOCOL.md` with eight concrete tasks from `docs/UX_V2.md`, observer notes, metrics, consent/privacy, and a structured issue template.

Run a self-review using the protocol and record at least the obvious friction found in the current implementation. Fix high-confidence issues in this diff; list questions requiring actual scientist feedback.

## Acceptance

A new user can:

1. choose an example;
2. understand its calibration/task;
3. run or inspect a workflow;
4. find the linked objects/results;
5. edit the operation graph or script;
6. save/reopen the project;

without hidden menus, tiny essential text, unexplained icons, or modal churn.

All corpus/E2E, accessibility, visual, and performance gates remain green.


---

# Codex prompt 14 — openrouter multistep agent


You are working in `a-r-d/PureJsImage-LabViewer` after prompts 00–04.

The baseline originally inspected for this revised roadmap was commit `3729a846a084e38ae830c429ff5b30d448537cb2`, but do not assume that is still HEAD.

Before editing:

1. Read `AGENTS.md` and every architecture/product document relevant to this prompt.
2. Report the current HEAD and `git status --short`.
3. Inspect the current implementation and tests instead of assuming filenames or APIs from this prompt are exact.
4. Preserve every user change.

Do not commit, push, merge, deploy, publish packages, modify remote metadata, weaken tests, or regenerate visual/numerical goldens merely to make a gate pass. Leave one complete inspectable working-tree diff.

The app is already deployed at `lab.purejsimage.com`; deployment work is out of scope.


## Goal

Build the AI assistant as a first-class client of the completed semantic action surface. It must support robust multi-step OpenRouter tool calling, bounded context, approvals, state/history, UI proposals, analysis execution, and script authoring.

Integrate `docs/AGENT_V2.md`.

## Packages and boundaries

Implement the real `packages/agent` with:

- normalized message/event types;
- OpenRouter transport interface and fetch implementation;
- deterministic fake transport;
- agent controller/state machine;
- context builder/compactor;
- tool schema adapter from the action registry;
- policy/approval integration;
- usage/cost/budget tracking;
- local history repository interface;
- secret redaction.

The package must not import React, DOM state, or PureJsImage directly.

## Credentials and settings

Implement `CredentialStore`:

- OpenRouter key in localStorage as requested;
- never included in application state snapshots;
- clear warning about local browser storage;
- delete/reveal/copy protections;
- model, reasoning effort, limits, and provider preferences stored separately from the secret;
- default development selection `openai/gpt-5.6-luna` with medium reasoning, but configurable;
- capability check for tool calling/structured output before a run.

Conversation and event history belongs in IndexedDB, not localStorage.

## Tool loop

Implement a bounded sequential loop initially:

- `parallel_tool_calls: false`;
- append assistant tool-call message and matching tool result correctly;
- validate strict JSON arguments;
- unknown/invalid tool is returned as a structured tool error, not executed;
- policy and approval before mutation/compute/export/script execution;
- max iterations/tool calls/time/tokens/result bytes/cost;
- cancellation for model request and tool execution;
- transient retry classification;
- no blind mutation retry;
- final answer only after tool loop finishes;
- structured outputs where supported for internal planning/summary states.

## Context

Include only bounded relevant data:

- operation/action catalog summaries;
- workspace revision/summary;
- source/dataset/calibration metadata;
- active viewport/ROI/selection;
- graph/pipeline excerpt;
- bounded result summaries;
- installed recipe/script manifests;
- recent conversation plus compacted summary.

No raw full-resolution pixels by default. Add a separate user-approved viewport snapshot context action if justified.

## Tools

Expose semantic tools covering:

- workspace/source/dataset;
- ROI;
- analysis catalog/normalize/dry-run/execute/cancel;
- result summary/page;
- pipeline;
- viewport and UI proposals;
- examples;
- script draft/patch/typecheck/test/install/execute;
- project save/export proposal.

No arbitrary DOM selector, JavaScript eval, filesystem, URL fetch, credentials, or shell.

## Agent UI

Build a serious panel/surface showing:

- conversation;
- context/source indicators;
- proposed steps;
- approval cards with normalized arguments and estimates;
- live tool trace;
- cancel/stop;
- usage/cost/step budget;
- bounded result summaries with units;
- links selecting relevant datasets, ROIs, nodes, results, scripts, or panels;
- retry/edit-plan paths;
- history list and delete/export.

Do not show private chain of thought. Show concise rationale/assumptions and tool activity.

## Tests

Normal CI uses fake transport scenarios for:

- answer without tools;
- metadata/ROI/analysis multi-step chain;
- approval accept/reject;
- malformed/unknown tool;
- stale revision repair;
- validation repair;
- expensive compute approval;
- script draft/typecheck/fix/test/install request;
- UI/viewport proposal;
- cancellation/model error/retry/max steps;
- history reload;
- key never appears in logs/state/export/error/snapshot;
- accessibility and deterministic agent screenshots.

No live OpenRouter call in CI.


---

# Codex prompt 15 — local agent evals final hardening


You are working in `a-r-d/PureJsImage-LabViewer` after prompts 00–04.

The baseline originally inspected for this revised roadmap was commit `3729a846a084e38ae830c429ff5b30d448537cb2`, but do not assume that is still HEAD.

Before editing:

1. Read `AGENTS.md` and every architecture/product document relevant to this prompt.
2. Report the current HEAD and `git status --short`.
3. Inspect the current implementation and tests instead of assuming filenames or APIs from this prompt are exact.
4. Preserve every user change.

Do not commit, push, merge, deploy, publish packages, modify remote metadata, weaken tests, or regenerate visual/numerical goldens merely to make a gate pass. Leave one complete inspectable working-tree diff.

The app is already deployed at `lab.purejsimage.com`; deployment work is out of scope.


## Goal

Add a local-only paid-model evaluation harness for the OpenRouter agent and perform final integrated correctness/security/performance hardening. Live model calls must never run in normal CI.

Integrate `docs/AGENT_EVALS.md`.

## Local eval harness

Add gitignored:

```text
.env.agent-evals.local
.local/agent-evals/
```

Provide commands:

```text
pnpm eval:agent --suite smoke
pnpm eval:agent --suite analysis
pnpm eval:agent --case <id>
pnpm eval:agent:report <run-directory>
```

Require an explicit live-run confirmation flag. Print model, reasoning, case count, max steps, and max cost before sending.

Default local config may use:

```text
model: openai/gpt-5.6-luna
reasoning: medium
```

but all settings remain configurable and model capabilities are checked at runtime.

## Eval cases

Generate evals from enabled example/corpus scenarios where possible. Include:

- identify calibration/metadata;
- create ROI and measure;
- threshold/count known particles;
- watershed touching particles;
- filter by size/circularity;
- FFT and report known spacing;
- AFM leveling and roughness;
- stack alignment/drift;
- create/typecheck/test a script;
- select the right UI/result surface;
- project replay;
- refusal/approval/cancellation/secret tests.

## Graders

Deterministic:

- final workspace hash/commands;
- exact or tolerated numerical results;
- units;
- required/forbidden tools;
- permission/approval compliance;
- no secret leakage;
- step/token/latency/cost budgets;
- object references and project identity.

Human rubric only for clarity, uncertainty, and scientific explanation.

Store redacted JSONL traces locally. Do not store API keys, raw local file bytes, uncontrolled metadata, or hidden reasoning.

## CI separation

- deterministic fake-model evals remain in normal CI;
- live eval scripts fail closed if invoked without the explicit local env and confirmation;
- CI config asserts that no OpenRouter key or live test command is present;
- document how to run and compare local eval reports.

## Final integrated audit

Audit:

- public PureJsImage imports;
- package dependency boundaries;
- Worker/script/agent lifecycle and cancellation;
- memory/range budgets;
- project/script/plugin identity and replay;
- credential/redaction paths;
- corpus licenses/integrity;
- numerical operation coverage;
- accessibility/keyboard/visual stability;
- bundle/code splitting, especially editor, QuickJS, and agent dependencies;
- all action descriptors and tool schemas;
- stale docs/placeholders/disabled controls.

Run the complete quality, corpus, browser, sandbox, fake-agent, visual, and performance gates. Produce `docs/READINESS_REPORT.md` with completed capabilities, known limitations, benchmark/eval commands, and prioritized findings from future scientist use—not speculative framework work.
