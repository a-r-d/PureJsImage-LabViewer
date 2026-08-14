# Repository review after prompt 04

Baseline inspected: `a-r-d/PureJsImage-LabViewer` on `main` at commit `3729a846a084e38ae830c429ff5b30d448537cb2` (`prompt 4`). Every implementation prompt in this bundle tells Codex to inspect the actual current HEAD and working tree instead of assuming this baseline is still current.

## Current status audit

This review is a historical assessment of the prompt-04 baseline, not a description of the current merge gate. The findings were rechecked at commit `ea3ba35576cff50294b22fbe2c8c9aaac92f8aae` on 2026-08-14:

- finding 1 is operationally resolved: the current build, quality, security, Chromium, Firefox, and WebKit CI jobs pass; Prompt 05 retains the deeper readiness and screenshot-determinism work;
- finding 4 is resolved at the design-contract level by `docs/SCRIPTING_PLUGIN_V2.md`; sandbox and plugin implementation remains assigned to Prompts 06 and 10;
- the recommended order is incorporated into `ROADMAP_AFTER_04.md` and Prompts 05–15;
- findings 2, 3, 5, 6, and 7 remain valid implementation observations and are intentionally assigned to those prompts rather than being treated as undocumented cleanup.

Do not reopen the old Chromium failure or regenerate platform-specific baselines from this historical text. Linux Chromium is the canonical visual environment; all hosts compare against the same reviewed baseline.

## What is already strong

The project is well beyond a skeleton:

- pnpm workspaces and Turborepo are in place;
- strict TypeScript settings include `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, and related checks;
- Biome, Vitest, Playwright, architecture checks, package builds, and Cloudflare dry runs exist;
- the workbench opens real PureJsImage datasets through a Worker;
- local and remote sources, tile transfer, cancellation, worker restart, preferences, project save/replay, ROI measurement, threshold preview, connected components, keyboard access, and accessibility have product tests;
- the app already consumes `purejsimage` 0.10.0 through public exports only;
- deployment to `lab.purejsimage.com` already exists and needs no separate roadmap prompt.

This is a good foundation. The next phase should deepen product capabilities rather than replace the stack.

## Issues to fix before the next feature wave

### 1. CI is not fully green

The latest inspected run passed build, quality, Firefox, and WebKit. Chromium passed the functional scenarios but failed five visual baselines. The failures settle to stable differences of roughly one to two percent after retries.

Do not blindly regenerate every baseline. First make screenshots deterministic:

- pin locale, timezone, color scheme, device scale factor, reduced motion, font loading, and animation state;
- add explicit `data-workbench-ready` and `data-render-settled` test gates;
- wait for Worker initialization, initial tile publication, canvas draw completion, and layout measurement;
- inspect actual/expected/diff artifacts;
- update a baseline only after deciding the new rendering is intentional.

Prompt 05 makes this the first gate.

### 2. Application orchestration is becoming monolithic

`apps/workbench/src/App.tsx` is about 91 KB and owns most source, viewport, workspace, project, ROI, analysis, result, panel, and dialog behavior. `packages/imaging/src/worker-host.ts` is about 42 KB and owns several RPC domains.

This worked for prompts 00–04, but adding dozens of operations, script execution, plugins, examples, and a multi-step agent directly into those files will create fragile coupling.

Before adding breadth:

- reduce `App.tsx` to composition and top-level error boundaries;
- split source, dataset, viewport, ROI, analysis, results, project, examples, scripts, plugins, and later agent into feature controllers/components;
- split the Worker host by RPC domain;
- establish one semantic action/capability registry used by the UI, command palette, scripts, plugins, tests, and later agent.

### 3. Plugin, agent, and corpus packages are placeholders

- `packages/plugin-sdk` currently defines only a small manifest shape.
- `packages/agent` currently defines only a small permission decision surface.
- `packages/test-corpus` is nearly empty.

That is appropriate at prompt 04, but these packages now need real contracts before application-specific code invents parallel APIs.

### 4. The current plugin document is too conservative for the new goal

The current design allows recipes first and defers executable user/AI-authored code. The new product goal requires a real Script Studio and sandboxed analysis scripts.

The safe interpretation is not “run arbitrary JavaScript in the page.” It is:

- execute code in a dedicated sandbox Worker;
- run a separate QuickJS-WASM runtime inside that Worker;
- expose no DOM, browser storage, network, credentials, or raw host objects;
- expose only a capability-checked, bounded, asynchronous `lab` API;
- enforce memory, stack, time, message, and tool-call quotas;
- record script source hash, manifest, permissions, and execution provenance;
- let the UI and AI author scripts through the same draft/typecheck/test/install workflow.

### 5. The scientific operation surface is still a vertical slice

The app has enough for one particle-count workflow, but not the common workflow surface scientists expect from ImageJ/Fiji, Gwyddion, and materials tools.

The goal should not be command-count parity. The useful “80 percent” is workflow coverage:

1. display, calibration, metadata, ROI, histogram, and results;
2. transforms, arithmetic, contrast, filters, background correction, and measurements;
3. threshold methods, binary morphology, watershed, and particle filtering;
4. FFT/power-spectrum, profiles, stack/volume projection, registration/drift, and AFM surface analysis;
5. repeatable recipes, batch runs, scripts, plugins, exports, and replay.

When PureJsImage already exposes a generic operation, use it. When a broadly reusable primitive is missing, record an upstream API/operation gap. App-specific or materials-specific operations should be implemented as explicit extensions through public PureJsImage APIs, not copied into React components.

### 6. E2E coverage is broad but concentrated in one smoke file

The current smoke suite already proves a lot, but it will become unmaintainable as scenarios multiply. Split it into domain suites and build a corpus scenario DSL so the same dataset declaration can drive:

- example-gallery metadata;
- deterministic setup;
- analysis steps;
- expected numerical outputs;
- range/memory/cancellation budgets;
- screenshots and accessibility checks;
- project replay;
- later agent eval tasks.

### 7. The UX foundation is sound but not yet world-class

The existing layout is dense and coherent, but several details need deliberate refinement:

- many labels and controls use 9–10 px text, which is too small for sustained expert use;
- the icon vocabulary is only eleven hand-maintained icons;
- a single large stylesheet and large app component make visual consistency harder;
- the canvas grid adds visual noise after a dataset is loaded;
- the operation experience needs a searchable catalog, recent/favorite operations, parameter forms, previews, and workflow presets;
- the home state needs a rich example library rather than one sample button;
- results, plots, pipeline, scripts, and agent traces need purpose-built surfaces, not generic placeholders.

Prompt 05 introduces the design-system and shell corrections; Prompt 13 performs a dedicated UX-validation and polish phase after the scientific surfaces are real.

## Recommended order

1. Architecture decomposition, action registry, deterministic visuals, and design-system V2.
2. Script/plugin contracts and a sandbox proof before adding more capabilities.
3. Core image analysis breadth.
4. Binary segmentation and particle analysis breadth.
5. Materials-specific FFT, surface, stack, registration, and batch workflows.
6. Full Script Studio and plugin authoring.
7. Example-data library and licensed corpus activation.
8. Corpus-driven scientific E2E and product correctness.
9. Dedicated UX validation and visual refinement.
10. AI assistant, after all semantic tools exist.
11. Local paid-model eval harness and final integrated hardening.

The agent belongs near the end because it should consume a stable toolbox, not define the toolbox while it is being built.
