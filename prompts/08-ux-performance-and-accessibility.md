# Codex prompt 08 — UX, performance, and accessibility hardening

```text
Continue in the repository after the complete scientific workflow and corpus tests exist.

Read AGENTS.md, docs/UX_SYSTEM.md, and docs/QUALITY_GATES.md. Inspect current measurements before changing code. Preserve changes. Do not commit, push, publish, or deploy.

Harden the workbench for expert daily use. This prompt is measurement-driven; do not perform broad rewrites based on framework folklore.

## Baseline first

Record before-change metrics for:

- production bundle chunks;
- shell startup;
- time to first useful tile on local and range fixtures;
- pan/zoom frame latency;
- React commits during pointer movement and tile arrival;
- tile upload/draw counts;
- threshold preview latency;
- connected-components duration and peak managed memory;
- 100,000-row result table interaction;
- project save/load;
- worker/main transferred bytes.

Validate correctness before timing.

## Viewport

Improve only measured bottlenecks.

Requirements:

- request prioritization follows visible area and current generation;
- stale tiles never flash after source/plane/level changes;
- no broad React rerender per pointer event/tile upload;
- renderer releases GPU resources on eviction/source close;
- resize/zoom remains stable under rapid tile arrival;
- loading placeholders preserve spatial context;
- first tile can render before all metadata panels settle;
- optional prefetch stays bounded;
- device-pixel-ratio handling remains crisp and memory-aware.

Add development diagnostics for frame time, visible/pending tiles, cache, bytes, worker queue, and GPU tile count.

## Result UX

Ensure object tables/plots remain usable at scale:

- row virtualization;
- stable sorting/filtering;
- keyboard selection;
- linked overlay selection;
- bounded plotting/downsampling;
- units in headers/tooltips/export;
- no full table cloned into React or agent context;
- cancellation/progress for expensive export.

## Interaction polish

Implement/finish:

- context-preserving inspector selection;
- command palette ranking and disabled reasons;
- shortcut reference;
- recent files/projects;
- empty/loading/error/recovery states;
- resizable panels and persisted layout;
- preview versus committed analysis clarity;
- progressive global-operation plan/progress/cancel UI;
- source identity mismatch/rebind flow;
- agent links that focus relevant objects.

Avoid animation that delays work. Respect reduced motion.

## Accessibility

Complete keyboard and screen-reader behavior:

- all panels, tabs, splitters, toolbars, dialogs, tables, tree rows;
- focus restoration;
- ROI toolbar keyboard operation where feasible;
- accessible viewport summary and current coordinates;
- bounded live announcements;
- plot/result textual summary;
- color-independent overlay/selection modes;
- 200% zoom/reflow practical desktop behavior.

Add manual-audit checklist for interactions automated tools cannot verify.

## Bundle/loading

Use code splitting based on measured workflows:

- lazily load reader modules by format or explicit detection strategy;
- lazily load agent/editor/plugin UI;
- avoid loading large analysis/runtime modules before a dataset/workflow needs them where practical;
- preserve deterministic loading/error states;
- enforce route/package bundle ceilings.

Do not create fragile dynamic-import magic that prevents type/package checks.

## Performance gates

Establish checked budgets based on the measured baseline and realistic development/CI environment. Include enough tolerance for normal variance but fail meaningful regressions.

Document environment and methodology.

## Tests

Add/strengthen:

- rapid pan/zoom/plane switch stress test;
- tile cancellation/stale response test;
- source close GPU/worker cleanup;
- 100,000-row table interactions;
- long result plot downsampling;
- accessibility complete workflow;
- reduced motion;
- bundle loading assertions;
- no-layout-shift assertions;
- performance thresholds in Chromium;
- cross-browser core interaction.

## Verification

Run all browser projects, accessibility, visual, performance, corpus compact, build, bundle measurement, and pnpm check.

Report before/after metrics with methodology, bundle changes, accessibility results, known browser differences, test results, git diff --stat, and any budget still not met.

Do not commit or push.
```
