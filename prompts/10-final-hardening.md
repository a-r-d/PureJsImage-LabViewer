# Codex prompt 10 — final skeleton hardening

```text
Perform the final repository-skeleton audit.

Before editing:

- inspect git status and all current files;
- read AGENTS.md and every docs file;
- inspect installed PureJsImage public declarations/exports;
- preserve user changes;
- do not commit, push, publish, deploy, change remote metadata, or add major features.

This is a validation and cleanup pass, not a rewrite.

## Audit the original goals

Confirm with code/tests that the repository now provides:

1. strict React/TypeScript/Biome/Vitest/Playwright/Cloudflare monorepo tooling;
2. one workbench client and clean multiple-client/backend boundaries;
3. public-package-only PureJsImage consumption;
4. real scientific viewer with local and remote sources;
5. ROI measurement and particle-analysis workflow;
6. local project persistence/replay;
7. first-class OpenRouter agent with policy/approval/history;
8. recipe/plugin foundation without unsafe arbitrary execution;
9. licensed/checksummed scientific corpus automation;
10. world-class keyboard/accessibility/performance groundwork;
11. complete docs and AGENTS.md guidance.

Create `docs/IMPLEMENTATION_STATUS.md` mapping each goal to code, tests, and remaining work.

## Public API/boundary audit

- no private/deep imports;
- no duplicated PureJsImage graph/ROI/result types;
- workspace packages expose only intended entrypoints;
- package exports match actual consumers;
- no accidental backend/browser dependency leaks;
- no circular package dependencies;
- no source-only import that fails built-package tests.

Create or update deterministic API/boundary manifests.

## Resource/lifecycle audit

Review all paths for:

- document/dataset/result/tile/runtime cleanup;
- Worker termination/restart;
- GPU resource release;
- cancellation;
- stale response handling;
- object URL cleanup;
- event listener cleanup;
- IndexedDB transaction failure;
- agent stream cancellation;
- plugin proposal cancellation.

Add hostile tests for any uncovered lifecycle path.

## Security/privacy audit

Prove:

- no API key in project/history/export/log/snapshot/bundle;
- no unsafe eval;
- imported JSON/metadata/model responses are escaped/validated;
- archive extraction safe;
- remote URL policy enforced;
- plugin capabilities default deny;
- agent cannot bypass permissions;
- CSP matches actual production behavior;
- no large licensed data committed accidentally.

## Scientific correctness audit

Using generated and enabled corpus:

- calibration/units correct;
- display range does not alter quantitative values;
- ROI geometry round-trips;
- threshold and connected-components goldens pass;
- result units and object count preserved;
- local/remote parity;
- project replay semantics identical;
- agent/manual graph equivalence;
- pyramid level/associated dataset behavior;
- exact reader detection and errors.

## UX audit

Walk the complete workflow manually and through Playwright:

```text
new session
→ open sample/local/range source
→ inspect/calibrate
→ ROI measure
→ threshold preview/commit
→ connected components
→ table/distribution
→ save/reload/replay
→ agent proposes equivalent workflow
→ recipe export/import
```

Fix only concrete friction/bugs that fit the current architecture.

## Dependency and bundle audit

- remove unused dependencies;
- justify remaining direct dependencies in `docs/DEPENDENCIES.md`;
- confirm workspace version consistency;
- enforce bundle ceilings;
- inspect lazy chunks/readers;
- no duplicate React/runtime copies;
- no development/test/corpus code in production bundle.

## Complete verification

Run from a clean state:

- frozen install;
- format check;
- lint;
- typecheck;
- unit/integration tests;
- architecture/API manifests;
- package builds;
- Chromium/Firefox/WebKit E2E;
- accessibility;
- visual;
- enabled corpus;
- performance;
- security/static checks;
- Cloudflare dry-run;
- root pnpm check.

Do not skip or weaken failures.

## Final report

Create `docs/FINAL_SKELETON_REPORT.md` containing:

- current commit/status;
- architecture/package map;
- implemented workflows;
- PureJsImage public APIs used;
- quality/test matrix;
- corpus status/licenses;
- performance budgets/results;
- accessibility/security results;
- known limitations;
- prioritized next 10 product tasks.

The next-task list should prioritize real scientist workflows, likely:

- FFT/power spectrum/radial profile;
- morphology/watershed;
- DM3/DM4 and vendor metadata/calibration;
- object filtering and batch comparison;
- AFM leveling/roughness/grain workflows;
- EDS/EELS/spectrum-image UX;
- 4D-STEM navigation;
- optional remote storage/compute contracts;
- executable plugin sandbox;
- user testing and issue intake.

At the end print exact command results and git diff --stat. Do not commit or push.
```
