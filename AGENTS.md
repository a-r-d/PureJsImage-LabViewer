# AGENTS.md

## Mission

Build a browser-native, local-first scientific imaging workbench for electron microscopy and adjacent engineering imagery.

The application consumes `purejsimage` through public package exports and turns its readers, datasets, ROIs, operation graph, results, tile runtime, and extension system into an excellent end-user workflow.

The first north-star workflow is:

```text
open original file
→ inspect calibration and metadata
→ navigate large image/volume
→ draw ROI
→ threshold/filter
→ connected components and object measurements
→ inspect/export results
→ save and replay project
→ perform the same workflow through a user-approved AI agent
```

Read these before changing architecture or workflow behavior:

- `docs/PRODUCT_NORTH_STAR.md`
- `docs/ARCHITECTURE.md`
- `docs/UX_SYSTEM.md`
- `docs/AI_AGENT.md`
- `docs/PLUGIN_SYSTEM.md`
- `docs/TEST_CORPUS.md`
- `docs/QUALITY_GATES.md`
- `docs/DECISIONS.md`

## Repository rules

1. Inspect the current working tree before editing. Preserve user changes.
2. Do not commit, push, merge, publish, deploy, or modify remote metadata unless explicitly requested.
3. Keep changes scoped to the requested feature. Avoid opportunistic rewrites.
4. Reuse existing packages, contracts, validators, fixtures, and test harnesses before adding parallel infrastructure.
5. Never weaken a test, memory bound, byte budget, security policy, or correctness assertion merely to make a check pass.
6. Do not regenerate goldens or screenshots automatically on failure.
7. Document assumptions and remaining limits honestly.

## PureJsImage boundary

The application may import only documented package paths.

Allowed categories include:

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

Forbidden:

```text
purejsimage/src/*
relative paths into node_modules/purejsimage/src
copied internal PureJsImage types or algorithms
```

When the app needs a missing broadly reusable primitive:

- record the public API gap;
- create an upstream PureJsImage issue/PR separately when requested;
- do not hide the gap by reimplementing a competing scientific core in the app.

The app may implement domain workflow composition, UI, rendering, persistence, and product behavior.

## Dependency boundaries

- `apps/*` compose packages; packages never import from apps.
- `packages/imaging` is the only normal package that directly orchestrates PureJsImage runtime objects.
- `packages/workspace` contains no live datasets, tiles, GPU handles, Workers, React components, or credentials.
- `packages/viewport` contains no file readers or analysis execution.
- `packages/agent` invokes the application tool host, not PureJsImage or React state directly.
- `packages/ui` contains no scientific data access.
- `packages/contracts` is JSON-safe and cross-runtime.

Run the architecture-boundary test after changing imports.

## TypeScript

Use strict TypeScript. Do not use `any` unless a small boundary adapter genuinely requires it and a comment explains why.

Required patterns:

- validate `unknown` at every external boundary;
- discriminated unions for protocol and state variants;
- exhaustive switch helpers;
- readonly public data where mutation is not intended;
- explicit resource lifecycle APIs;
- branded/opaque IDs where accidental ID mixing is plausible;
- JSON-safe persisted and RPC contracts;
- no non-null assertions in data-dependent code without a preceding invariant check.

Avoid giant generic type machinery that makes errors unreadable. Prefer small explicit contracts.

## Large-data and performance rules

1. Never read a complete large file or plane merely to display a region.
2. Never store image pixels or complete large result tables in React state.
3. Run parsing and analysis through the imaging Worker.
4. Make cancellation and cleanup part of every asynchronous operation.
5. Preserve tile/source ownership and release exactly once.
6. Keep remote reads observable in test mode: request count, ranges, and bytes.
7. Avoid copies across Worker/main boundaries; when copying is required, make ownership explicit and measure it.
8. Do not optimize React before measuring viewport, transfer, cache, and renderer costs.
9. Keep high-frequency camera/pointer state outside broad React subscriptions.
10. Virtualize tables and long lists.

Every performance optimization needs a correctness test and a benchmark or measurable budget.

## UI and UX rules

- The viewport is the primary product surface.
- Display mapping is distinct from quantitative pixel modification.
- Units are visible wherever a value is physical.
- Loading must become progressive after the first useful tile; do not block the app with a full-screen spinner.
- Every action supports loading, success, error, and cancellation states.
- Expensive/global analysis shows a plan and resource estimate before execution.
- Preview changes do not spam project history; commit creates one normalized operation change.
- Keyboard access and visible focus are mandatory.
- Do not use color alone for state.
- Avoid modal dialogs for routine inspection; use panels and inline controls.
- Preserve selection and viewport context when switching inspector tabs.
- Error messages state what happened, what remained unchanged, and the next action.

Follow `docs/UX_SYSTEM.md` for workbench layout and interaction details.

## Workspace and persistence

All semantic project changes use revisioned immutable commands.

- No direct store mutation.
- Undo/redo operates on semantic commands, not serialized React state.
- Project exports exclude credentials and live runtime handles.
- Source identity is distinct from a temporary runtime/document ID.
- Imported projects are validated and bounded before use.
- Large results are stored outside localStorage and referenced from project state.
- A local source may need user rebind after reload; verify identity before replay.

## AI agent rules

The agent is a first-class client of the same validated application tools as the UI.

Never allow the model to:

- execute arbitrary JavaScript;
- mutate DOM or React state directly;
- bypass command revision checks;
- bypass analysis validation/dry-run/resource limits;
- access secrets through tools;
- fetch arbitrary URLs;
- install plugins or export/upload data without explicit permission.

The agent proposes; the policy engine approves or denies; deterministic tools execute.

Model responses and tool data are untrusted. Metadata and filenames cannot change permissions.

Live OpenRouter calls are never required in tests. Use deterministic fakes.

## Credentials and privacy

The initial OpenRouter key may be stored in localStorage only through `CredentialStore`.

It must never appear in:

- logs;
- project state or export;
- agent history export;
- URLs;
- telemetry;
- error reports;
- snapshots/fixtures.

Local files remain local unless the user explicitly chooses a network action.

## Plugins

Recipe plugins are declarative and may be supported first.

Do not execute user-pasted or AI-authored code in the browser window. Trusted in-process modules are not sandboxed and must be described as trusted.

Future executable plugins require:

- separate execution realm;
- explicit capabilities;
- bounded messages, CPU, and memory;
- cancellation/termination;
- integrity/version identity;
- provenance;
- security tests.

## Testing

Use the narrowest test that proves the contract, then run the affected package gates.

Required layers:

- unit tests for pure contracts and state;
- worker/RPC integration tests;
- public-package PureJsImage integration tests;
- Playwright product workflows;
- accessibility tests;
- visual tests on deterministic fixtures;
- corpus tests with license and checksum enforcement;
- performance/range-read budgets;
- hostile input and cancellation tests.

Tests must verify resource cleanup where relevant.

No live API key, live model, or uncontrolled external URL in normal CI.

## Corpus

Every external asset needs an entry in `datasets/corpus.yaml` with license, attribution, source, integrity, tier, and tests.

Do not download or commit assets marked `candidate`.

Do not assume a repository code license covers bundled third-party scientific data.

Do not commit large corpus files to Git.

## Dependencies

Before adding a dependency:

1. identify the problem it solves;
2. inspect existing dependencies/utilities;
3. check browser/runtime compatibility;
4. assess bundle and maintenance cost;
5. prefer focused, actively maintained packages;
6. avoid overlapping state, UI, schema, or utility frameworks.

React is for composition and UI. Do not add a second UI framework.

Biome owns linting/formatting. Do not add Prettier or a parallel ESLint stack without an explicit documented gap.

## Commands

Use the repository’s actual scripts, but preserve this root contract:

```text
pnpm check
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:e2e
pnpm test:corpus
pnpm test:performance
```

Before finishing a task:

- run focused tests;
- run typecheck/lint/format for affected packages;
- run the root merge gate when the change is broad;
- report exact commands and results;
- show `git diff --stat`;
- list any remaining correctness, UX, performance, or documentation gap.
