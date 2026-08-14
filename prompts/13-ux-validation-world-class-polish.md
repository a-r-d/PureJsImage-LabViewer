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
