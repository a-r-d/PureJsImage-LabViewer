# Codex prompt 09 — materials fft surface stack batch


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

Add the materials-specific capabilities that make the workbench more useful than a generic browser image editor.

Implement these as one or more explicit materials-analysis extension bundles using public PureJsImage contracts. Keep each operation independently versioned and testable.

## Frequency-domain tools

Add:

- 2D FFT;
- centered magnitude and power spectrum;
- raw/log display mapping as presentation, not hidden data mutation;
- radial profile/radial integration;
- azimuthal profile;
- spatial-frequency and d-spacing cursor readout when calibration permits;
- simple bandpass/notch masks;
- basic local peak annotation with explicit thresholds;
- inverse FFT only if the value/complex-data contract is truthful.

Provide an “FFT workspace” linking source ROI, transform, profile plot, frequency cursor, annotations, and provenance.

## Stack/volume and registration

Add or expose:

- arbitrary-axis plane navigation;
- min/max/mean/sum projection;
- montage/contact sheet;
- stack statistics;
- translation registration through phase correlation;
- stack/frame alignment;
- drift trajectory plot;
- crop/ROI propagation through a stack.

Use bounded tile/global execution and explicit registration tolerance/edge policy.

## AFM/SPM surface workflow

For calibrated scalar height fields add:

- mean-plane subtraction;
- first-order plane leveling;
- row/line median correction;
- optional bounded polynomial background with clear degree limits;
- height histogram;
- Ra, Rq/RMS, Rz with documented definitions;
- grain detection using the shared segmentation pipeline;
- profile extraction;
- exclusion masks;
- independent X/Y and Z units.

Add an “AFM surface” preset that preserves raw data and makes each correction visible in history.

## Diffraction/detector helpers

Add only well-defined initial helpers:

- beam-center annotation;
- radial intensity integration;
- ring/peak candidate detection;
- calibrated radius/d-spacing readout where metadata permits;
- exportable profile and annotations.

Do not claim crystallographic indexing or phase identification.

## Batch recipes

Add a local-first batch runner that applies one validated recipe to:

- multiple user-selected local files;
- multiple selected datasets/planes;
- multiple enabled corpus scenarios in test mode.

Requirements:

- bounded concurrency;
- per-item cancellation/status/error;
- one failed item does not corrupt others;
- aggregate result table;
- deterministic naming;
- no hidden upload;
- source identity and recipe/script hash per row;
- resumable local run metadata where practical.

## Tests

Use exact synthetic sinusoidal lattices, known translations, known planes/slopes, known roughness, calibrated rings, and small stacks. Add tolerance-based differential/oracle tests, cancellation, memory, tile invariance, batch partial failure, and project replay.

Do not add the AI agent or full Script Studio here.
