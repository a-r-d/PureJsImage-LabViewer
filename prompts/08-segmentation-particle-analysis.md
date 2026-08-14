# Codex prompt 08 — segmentation particle analysis


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

Complete the dominant materials particle/precipitate workflow:

```text
correct/filter
→ threshold
→ binary cleanup
→ watershed touching particles
→ connected components
→ object filters and measurements
→ linked overlays/table/distributions
```

Reuse current connected-components support. Implement broadly reusable primitives upstream or as clean public extensions according to repository policy.

## Thresholding

Add reference implementations and catalog actions for:

- manual lower/upper;
- Otsu;
- Triangle;
- Yen;
- Li;
- mean or another clearly documented common global method;
- adaptive Sauvola;
- optional Phansalkar only with a reliable reference and bounded implementation.

Support dark/light foreground, selected ROI/plane/component, no-data policy, preview histogram, and foreground fraction.

## Binary morphology

Add:

- erode;
- dilate;
- open;
- close;
- fill holes;
- clear border;
- remove small objects;
- outline;
- Euclidean or clearly documented distance transform;
- watershed separation of touching particles.

Skeletonization may be added only after the core workflow is complete and tested.

Global/barrier operations must use PureJsImage’s global-transform/reduction contracts and hard memory accounting. Do not materialize unbounded full planes outside managed runtime contracts.

## Particle analysis

Extend the current object workflow with:

- exclude/include edge objects;
- area range;
- circularity range;
- aspect-ratio range;
- solidity range;
- intensity statistics from a chosen source component;
- object count, area fraction, total/mean/median size;
- table columns for calibrated dimensions;
- outline, mask, numbered label, centroid, and fitted-ellipse views;
- histogram, box/violin-like distribution where appropriate, and cumulative distribution;
- table-row ↔ viewport-object linked selection;
- deterministic CSV export.

## Guided workflow

Add a “Particle analysis” workflow surface/preset that composes the graph while exposing every step. It must never hide the operation graph or make irreversible edits.

The user should be able to:

1. choose ROI/component and foreground polarity;
2. choose threshold method and inspect preview;
3. choose cleanup/watershed settings;
4. dry-run connected components with memory estimate;
5. filter objects;
6. inspect linked table/overlays/distributions;
7. save as a recipe or open it in the Script Studio later.

## Tests

Generated fixtures must include:

- isolated circles/ellipses;
- touching particles that require watershed;
- holes;
- edge objects;
- anisotropic calibration;
- noisy/uneven background;
- objects crossing tile boundaries;
- exact known counts and tolerated measurements.

Test tile-size/concurrency invariance, memory admission, cancellation, project replay, threshold-method reference outputs, linked selection, export, and keyboard/a11y UX.

Do not add AI integration in this prompt.
