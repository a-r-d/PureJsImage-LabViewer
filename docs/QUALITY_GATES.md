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
pnpm test:sandbox:release
pnpm test:sandbox:debug
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
- enabled-scenario license, exact-file, workflow, expected-result, and budget completeness;
- corrupt/offline cache, retry, cancellation, byte-limit, and Range/full-download separation;
- archive traversal, encoded traversal, symlink, duplicate, file-count, expansion, and ratio refusal;
- PureJsImage integration through only public exports;
- science-workbench characterization fixtures for the action catalog, reader registry,
  analysis identities, routes, project save/load, and recorded bundle/performance baselines.
  Normal CI must not regenerate those fixtures on failure.
- `packages/workbench-core` unit tests for source/project/activity controllers. The package
  must not depend on React or domain packages.
- `packages/domain-science` unit tests for the science domain profile, reader/example
  registries, and science action handlers.

Tests should assert cleanup and cancellation, not just output.

Normal PR CI runs generated and small bundled corpus tiers only. Hosted/external scenarios require
explicit scheduled tags and controlled mirrors; no deterministic gate calls an uncontrolled public
server. `docs/CORPUS_AUDIT.md` records why each non-enabled entry remains unavailable.

The normalized scenario artifact declares its tier and capability coverage. CI validates that the
complete product capability matrix has an owning scenario even when a scheduled scenario is not yet
eligible to run. Generated fixture pixels are checked against reviewed independent JSON references;
reference files are input-only and are never updated by the test command.

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

The former monolithic smoke suite is split by stable semantic surface. Cross-file helpers perform
only deterministic setup and common navigation; assertions remain in the focused specifications.
Each executed `@scenario` case attaches a bounded evidence record. The custom reporter writes
`test-results/scenario-report.json` and `scenario-report.md`, grouped by capability and scenario,
with status, browser, oracle/tolerance, resource budgets, source/tile timing measurements,
project/invocation identities, and failure artifact paths. Measurements that the active source/runtime
cannot expose are `null`, never guessed; scheduled range and large-data runs are responsible for
populating those fields.

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

Linux Chromium is the canonical CI visual-rendering environment. Darwin and Linux keep separate,
OS-qualified baselines because browser text rasterization is not pixel-equivalent across those
platforms. Each host compares against its own baseline with at most 1.5% differing pixels to absorb
bounded same-platform font and GPU rasterization variance. Missing or changed goldens must fail;
normal test runs never create or update them automatically.

The Playwright environment pins UTC, `en-US`, color scheme, reduced motion, a device scale factor
of 1, and explicit viewports. Each isolated browser context starts without persisted IndexedDB;
the harness clears local storage once while preserving within-test reload coverage, and fixes
visible UUID/time formatting. Screenshots wait for loaded fonts and real application signals:

```text
data-workbench-ready="true"
data-render-settled="true"
data-analysis-settled="true"
```

The render signal is updated by completed viewport draws without routing camera or tile churn
through React state. An intentional baseline update requires artifact inspection and three
consecutive passing no-update runs.

Capture:

- empty state;
- dataset open;
- ROI selected;
- threshold preview;
- labels overlay;
- object table;
- agent proposal;
- error state.
- bounded UI-lab dark/light wide and dark narrow states.

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
The reviewed science-workbench baseline in `tooling/baselines/science-workbench.json` records
current gzip asset sizes and the performance budgets enforced by the bundle and Playwright
checks. Update it only after inspecting an intentional size or budget change.

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
- sandbox source/output/message/API/console/memory/stack/deadline limits;
- QuickJS release behavior plus debug-variant handle/runtime leak detection;
- no ambient DOM, storage, network, credentials, clock, random, or unrestricted module loader;
- CSP allows only `wasm-unsafe-eval` for the self-hosted QuickJS module and still forbids
  JavaScript `unsafe-eval`.

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
8. scheduled `corpus-medium-performance`: main/nightly/scheduled datasets and Range budgets.

Use concurrency cancellation for superseded pull-request runs.

The normal route/editor/script chunks retain the 300 KiB gzip per-chunk ceiling. The dedicated
TypeScript language Worker has a separate 1,000 KiB gzip ceiling because it contains the compiler;
browser coverage proves that this Worker is not requested on normal startup and is requested only
after a language action. Both ceilings are enforced by `tooling/scripts/check-bundle-budget.mjs`.

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
