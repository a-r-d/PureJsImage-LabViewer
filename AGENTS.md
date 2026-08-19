# AGENTS.md

## Mission

Build a browser-native, local-first scientific imaging workbench for electron microscopy and adjacent engineering imagery.

The application consumes PureJsImage only through public package exports and turns readers, datasets, ROIs, operation graphs, results, tile runtime, scripts, extensions, and an approval-gated AI agent into an excellent end-user workflow.

The north-star workflow is:

```text
open original file
→ inspect calibration and metadata
→ navigate large image/volume
→ create ROI
→ filter/segment/analyze
→ inspect linked overlays, plots, and tables
→ save and replay the exact work
→ edit or write a reusable analysis script
→ perform the same workflow through a user-approved AI agent
```

Read these before changing architecture or workflow behavior:

- `docs/PRODUCT_NORTH_STAR.md`
- `docs/ARCHITECTURE.md`
- `docs/UX_SYSTEM.md`
- `docs/ANALYSIS_80_PERCENT.md`
- `docs/SCRIPTING_PLUGIN_V2.md`
- `docs/EXAMPLE_LIBRARY_AND_CORPUS.md`
- `docs/AGENT_V2.md`
- `docs/AGENT_EVALS.md`
- `docs/QUALITY_GATES.md`
- `docs/DECISIONS.md`
- `docs/adr/0001-shared-showcase-monorepo.md`

## Repository rules

1. Inspect HEAD and the working tree before editing. Preserve user changes.
2. Do not commit, push, merge, publish, deploy, or modify remote metadata unless explicitly requested.
3. Keep changes scoped. Avoid opportunistic rewrites.
4. Reuse existing contracts, validators, fixtures, and harnesses before adding parallel infrastructure.
5. Never weaken a test, numerical tolerance, memory bound, byte budget, security policy, permission, or correctness assertion merely to pass a gate.
6. Do not regenerate goldens or screenshots automatically on failure. Establish determinism, inspect the diff, and document intentional updates.
7. Document assumptions, unsupported inputs, numerical policies, and remaining limitations honestly.

## PureJsImage boundary

Import only documented package paths. Never import `purejsimage/src/*`, copy private PureJsImage algorithms/types, or reach through `node_modules` to source files.

`packages/imaging` and explicit application extension/provider packages are the only normal packages that orchestrate live PureJsImage runtime objects.

When a missing primitive is broadly reusable:

- record the public API/operation gap;
- create an upstream PureJsImage change separately when requested;
- do not disguise the gap with an incompatible local scientific core.

Domain workflows, product composition, UI, persistence, sandbox hosting, and materials-specific extensions belong here.

## Dependency boundaries

- `apps/*` compose packages; packages never import apps.
- `packages/contracts` contains bounded JSON-safe cross-runtime contracts.
- `packages/actions` owns semantic action descriptors, schemas, policy metadata, and registry composition—not React or live datasets.
- `packages/workbench-core` owns the headless workbench runtime, compile-time domain profile types, and identifiable source/project/activity controllers. It must not import React, PureJsImage, or domain packages.
- `packages/workbench-react` owns the shared React workbench shell. It must not import imaging, domain-science, domain-geo, or materials-analysis.
- `packages/domain-science` owns science/materials example IDs, workflows, actions, panels, terminology, and empty states. It depends on `packages/materials-analysis`.
- `packages/domain-geo` owns geo project model, CRS helpers, Atlas terminology, and COG inspector
  reports. It must not import domain-science or materials-analysis.
- `packages/imaging` owns live source/dataset/analysis Worker orchestration.
- `packages/workspace` owns immutable revisioned semantic state, not tiles, Workers, credentials, or React components.
- `packages/viewport` owns rendering/view interaction, not file readers or analysis execution.
- `packages/plugin-sdk` owns recipe/script/plugin artifacts, manifests, permissions, hashing, compatibility, and sandbox RPC contracts.
- `packages/scripts` owns the isolated script Worker/QuickJS host, not application policy decisions.
- `packages/agent` invokes the same action host as UI/scripts and never imports React state or PureJsImage directly.
- `packages/test-corpus` owns licensed scenario manifests, fixture resolution, and oracle metadata.
- `packages/ui` contains no scientific data access.

## TypeScript

Use strict TypeScript and validate every external `unknown` boundary.

- discriminated unions;
- exhaustive switches;
- readonly public data;
- explicit lifecycle APIs;
- opaque IDs where mixing is plausible;
- JSON-safe persisted/RPC values;
- no non-null assertion without a preceding invariant;
- no `any` except a small documented adapter boundary.

Prefer small explicit contracts over inscrutable generic machinery.

## Scientific correctness

Every analysis operation or recipe must define:

- semantic ID/version;
- accepted datasets/components/axes;
- parameter schema and normalization;
- output descriptor/result schema;
- calibration/units behavior;
- no-data/non-finite behavior;
- boundary and interpolation policy;
- reproducibility class/tolerance;
- memory/work estimate;
- cancellation checkpoints;
- provenance;
- deterministic fixtures and, where applicable, corpus scenarios.

Do not hide numerical algorithms in React components or ad hoc RPC handlers.

## Large-data and performance

1. Never read a complete large file/plane merely to display a region.
2. Never keep source pixels or complete large result tables in React state.
3. Parsing and analysis run through the imaging Worker or another explicit isolated runtime.
4. Cancellation and cleanup are part of every async operation.
5. Release tiles/resources exactly once.
6. Keep remote ranges and bytes observable in tests.
7. Avoid main/Worker copies; make ownership explicit when copying.
8. Keep high-frequency camera/pointer state outside broad React subscriptions.
9. Virtualize long tables/lists.
10. Every optimization needs a correctness test and a measured budget.

## UI and UX

- The specimen viewport is the primary surface.
- Display mapping is distinct from quantitative pixel modification.
- Units and calibration source are visible wherever values are physical.
- Loading becomes progressive after the first useful tile.
- Every action supports loading, success, error, and cancellation.
- Expensive/global work shows a plan before execution.
- Preview does not spam history; commit creates one normalized change.
- Keyboard access, visible focus, 200 percent zoom, reduced motion, and WCAG-AA text contrast are mandatory.
- Essential text should not use 9 px typography.
- Icon buttons require accessible labels and tooltips; no emoji as product icons.
- Preserve selection/view context between panels.

## Unified semantic actions

The normal UI, command palette, recipes, scripts, tests, and AI agent use one action registry.

Each action has:

- stable ID/version;
- title/description/category;
- JSON Schema input/output;
- availability explanation;
- required permissions;
- mutability/cost/risk classification;
- validation/dry-run/execute behavior;
- bounded result summary;
- cancellation/provenance.

Do not build special privileged paths for scripts or the agent.

## Scripts and executable plugins

User- and AI-authored code may execute only in the dedicated sandbox architecture documented in `docs/SCRIPTING_PLUGIN_V2.md`.

Never execute pasted or generated code:

- in the browser window;
- in the React application realm;
- in the imaging Worker;
- through `eval`, `Function`, blob-import, data-URL import, or an unrestricted module Worker;
- with ambient DOM, storage, network, credentials, source bytes, or host objects.

Sandboxed scripts run in a separate Worker and separate QuickJS-WASM runtime with default-deny capabilities, bounded RPC, memory/stack/time/message/tool-call quotas, cancellation/termination, content identity, and provenance.

Trusted build-time extensions are not sandboxed and must be described as trusted.

## AI agent

The agent is built after the semantic action surface is stable.

The agent:

- proposes semantic actions;
- receives bounded context and result summaries;
- passes schema validation, policy, revision checks, dry-run, resource limits, and approvals;
- cannot mutate DOM/React state directly;
- cannot access credentials;
- cannot read arbitrary files/URLs;
- cannot install/run scripts without the staged review/permission flow;
- cannot bypass cancellation or validation.

Normal CI uses deterministic fake-model transports. Live OpenRouter evaluations are manual and local-only.

## Credentials and privacy

The initial OpenRouter key may be stored in localStorage only through `CredentialStore`. It must never enter logs, project state/export, history export, URLs, telemetry, errors, snapshots, fixtures, scripts, or tool results.

Conversation/script/example metadata belongs in IndexedDB where appropriate. Local files stay local unless the user explicitly approves a network action.

## Corpus

Every external asset has a normalized manifest entry with exact selected files, source, immutable URL, license, attribution, integrity, tier, and expected tests before enablement.

- candidates are not downloaded or shown as enabled examples;
- unknown/missing license or integrity is refused;
- large data is not committed to Git;
- archive extraction is bounded and traversal-safe;
- scenario definitions drive examples and tests.

## Testing

Use the narrowest proof first, then affected package gates.

Required layers:

- unit contracts;
- Worker/RPC integration;
- public PureJsImage package integration;
- operation reference/differential tests;
- scenario-driven Playwright workflows;
- accessibility and keyboard tests;
- deterministic visual tests;
- corpus tests with license/checksum enforcement;
- range/memory/cancellation/lifecycle budgets;
- hostile inputs;
- script sandbox security tests;
- fake-model agent tests;
- local-only live-model evals.

No live model, API key, uncontrolled external URL, or paid request in normal CI.
