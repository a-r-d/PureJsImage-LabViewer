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
