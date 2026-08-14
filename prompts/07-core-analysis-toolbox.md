# Codex prompt 07 — core analysis toolbox


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

Expand the application from one particle-count vertical slice to the common everyday image-processing and measurement toolbox described in `docs/ANALYSIS_80_PERCENT.md`.

Before adding an operation, enumerate the actual PureJsImage operation catalog. Use existing public operations when available. Broadly reusable missing primitives should be documented as upstream PureJsImage gaps. Application/materials-specific operations belong in a new explicit extension package, for example `packages/materials-analysis`, using only public PureJsImage operation/provider APIs.

## Operation-browser product surface

Implement a searchable operation catalog with:

- categories;
- search by title/description/tags;
- recent and favorites;
- availability and reason unavailable;
- parameter forms driven by descriptors;
- domain-enhanced controls where schemas are insufficient;
- preview, Apply, Cancel, Reset;
- operation documentation, units, output, no-data policy, and cost;
- recipe/workflow presets;
- command-palette and action-registry integration.

## Core operations

Implement or expose, with deterministic reference behavior and tests:

### Geometry and numeric

- crop;
- resize/resample;
- rotate 90/180/270;
- horizontal/vertical flip;
- translation;
- numeric type conversion with explicit clipping/scaling;
- normalize and clamp;
- invert data;
- gamma, log, square-root transforms;
- add/subtract/multiply/divide constant;
- image calculator for compatible datasets if the graph/value model supports a second dataset cleanly.

### Filters and correction

- Gaussian;
- mean/box;
- median;
- minimum and maximum;
- arbitrary convolution kernel;
- sharpen/unsharp mask;
- Sobel or Scharr gradient;
- Laplacian;
- outlier/despeckle filter;
- background subtraction with a documented bounded algorithm.

### Calibration and measurement

- display file-provided X/Y calibration and its source;
- set/correct scale from a known line distance as a revisioned project command, preserving original metadata;
- anisotropic X/Y support;
- units conversion;
- ROI statistics: area, perimeter where supported, centroid, mean/median/min/max/std/variance/integrated intensity;
- histogram/percentiles;
- line and width-averaged profiles;
- Feret/equivalent diameter/major-minor/aspect/orientation/circularity/solidity when the object geometry exists;
- explicit pixel versus physical outputs.

### Export

- bounded CSV for tables/profiles/histograms;
- rendered PNG export with explicit display mapping;
- project/recipe export through existing persistence;
- no hidden source conversion or upload.

## Scientific contracts

For every new operation define:

- operation ID/version;
- parameter normalization;
- supported sample/components/axes;
- output descriptor;
- no-data/non-finite behavior;
- boundary/interpolation policy;
- units/calibration propagation;
- reproducibility/tolerance;
- memory estimate and cancellation;
- stable action entry;
- provenance.

## Tests

Use generated exact fixtures for kernels, transforms, anisotropic calibration, no-data, tile boundaries, cancellation, and preview/commit/replay.

Add E2E workflows for:

- calibrate from a line and measure a second object;
- crop/filter/profile/export;
- image arithmetic where supported;
- operation search/favorite/recent;
- keyboard preview/apply/cancel;
- project reload with equivalent numerical outputs.

Do not implement morphology, watershed, FFT, AFM leveling, batch, or the agent in this prompt.
