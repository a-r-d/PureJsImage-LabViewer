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
