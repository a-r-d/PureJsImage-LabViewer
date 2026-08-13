# Quality gates

## Root commands

The completed repository should expose:

```text
pnpm check
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:e2e
pnpm test:a11y
pnpm test:visual
pnpm test:corpus
pnpm test:performance
pnpm deploy:dry-run
```

`pnpm check` is the merge gate and must include all deterministic normal-CI checks.

## TypeScript

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `useUnknownInCatchVariables: true`
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `noPropertyAccessFromIndexSignature: true`
- `verbatimModuleSyntax: true`
- `isolatedModules: true` for browser packages
- project references and incremental builds
- no `skipLibCheck` unless a documented third-party issue makes it temporarily unavoidable

No untyped `postMessage`, storage JSON, agent tool payload, plugin manifest, or project import.

## Biome

Biome owns formatting and linting. Do not run ESLint and Prettier in parallel unless a specific rule unavailable in Biome is proven necessary.

Enforce:

- no unused imports/variables;
- no explicit `any` without a local justification comment;
- no floating promises;
- exhaustive switches through project utilities where Biome cannot enforce them alone;
- import organization;
- accessibility rules for React JSX;
- no dangerous HTML insertion.

## Unit and contract tests

Vitest covers:

- pure workspace commands;
- project normalization/migrations;
- worker RPC validation;
- camera/tile math;
- renderer resource ownership with fakes;
- credential/history redaction;
- agent policy and tool loop;
- plugin manifests/recipes;
- corpus manifest/downloader safety;
- PureJsImage integration through only public exports.

Tests should assert cleanup and cancellation, not just output.

## Browser tests

Playwright projects:

- Chromium: full normal suite and performance budgets;
- Firefox: core workflows;
- WebKit: core workflows;
- optional mobile emulation for open/view only, not the primary expert workbench.

Every browser runs:

- local file open;
- remote range source;
- viewport navigation;
- ROI measurement;
- threshold + connected components;
- project export/import;
- mocked agent proposal and approval;
- worker crash/restart recovery;
- cancellation.

## Accessibility

Automate with Playwright plus an accessibility engine and manual assertions for canvas alternatives.

Gate:

- no critical/serious automated violations;
- keyboard-only main workflow;
- focus restoration after dialogs;
- accessible splitter controls;
- no icon-only control without name;
- status/progress announcements are bounded;
- plots/tables have textual semantics.

## Visual tests

Use a small deterministic generated corpus and fixed viewport/device settings.

Capture:

- empty state;
- dataset open;
- ROI selected;
- threshold preview;
- labels overlay;
- object table;
- agent proposal;
- error state.

Mask genuinely unstable numeric timing text. Do not mask image content or controls to force passes.

## Performance tests

Track distributions, not one anecdotal number:

- app JS/CSS chunk sizes;
- time to interactive shell;
- time to first useful tile;
- pan/zoom frame latency;
- remote bytes fetched and request count;
- analysis planning time;
- threshold preview latency;
- connected-components duration and peak managed memory;
- object-table render/filter latency;
- project save/load;
- agent tool round-trip excluding live model latency.

Fail on meaningful regressions against checked budgets. Record the test machine/browser details.

## Security checks

- dependency audit with reviewed exceptions;
- secret scanning;
- Content Security Policy test;
- no `eval`/`new Function` in production bundle;
- no OpenRouter key in snapshots, logs, storage exports, or telemetry;
- archive extraction traversal tests;
- remote URL scheme and size validation;
- plugin capability tests;
- prompt-injection permission tests;
- worker message size/depth limits.

## Corpus checks

- license present and approved;
- attribution available;
- checksum verified;
- archive extraction bounded;
- dataset version pinned;
- source still resolvable;
- expected tests declared;
- no large corpus committed to Git.

## CI layout

Suggested jobs:

1. `quality`: format, lint, typecheck, unit tests, architecture boundaries.
2. `build`: package builds, workbench build, bundle budgets, Cloudflare dry run.
3. `browser-chromium`: complete browser workflow.
4. `browser-cross`: Firefox and WebKit core suite.
5. `accessibility-visual`: deterministic UI gates.
6. `corpus-compact`: enabled Tier 1 subset with cache.
7. `security`: audit, secret scan, CSP/static bundle checks.
8. scheduled `corpus-medium-performance`: Tier 2 datasets.

Use concurrency cancellation for superseded pull-request runs.

## Definition of done for a feature

A feature is not done until:

- public behavior and limits are documented;
- loading, empty, success, error, and cancellation states exist;
- keyboard behavior exists;
- relevant worker and cleanup paths are tested;
- no private PureJsImage import is used;
- project persistence/replay behavior is decided;
- agent exposure and permission are decided;
- performance effect is measured;
- corpus coverage is added where scientifically meaningful.
