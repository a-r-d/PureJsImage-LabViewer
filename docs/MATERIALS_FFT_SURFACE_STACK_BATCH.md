# Frequency, surface, stack, registration, and batch semantics

This document defines the Prompt 09 trusted materials-extension contract. These operations use
only public PureJsImage operation, dataset, ROI, result, extension, and runtime exports.

## Admission and lifecycle

- One 2D global plane is admitted up to 4,194,304 samples.
- A selected stack is admitted up to 8,388,608 samples.
- Estimated peak working memory is refused above 512 MiB.
- FFT reads only the rectangular source ROI, not the complete plane. Other global surface and stack
  operations read only the explicitly selected admitted plane/range.
- Every source numeric tile is released in `finally`; materialized output ownership is released with
  the analysis result handle.
- All row, column, transform, fit, projection, and registration loops contain cancellation
  checkpoints. A cancelled or rejected operation creates no partial committed graph.

## FFT and diffraction helper

`pji-workbench.materials.frequency.fft-2d@1` computes a separable forward complex transform.
Power is `real² + imaginary²`; magnitude is its square root. Quantitative power remains raw.
`log1p(magnitude)` is an explicit presentation output and is recorded in result metadata rather
than applied to source data.

Power-of-two axes use the bounded radix-2 path. Exact direct DFT is admitted for non-power-of-two
axes up to 512 samples; larger non-power-of-two FFT or registration axes are refused during
planning with guidance to select a smaller ROI or power-of-two dimensions.

The centered output moves zero frequency to `floor(width / 2), floor(height / 2)`. For calibrated
linear axes, frequency steps are `1 / (N * abs(pixelSpacing))`. Cursor d-spacing is `1 / radial
frequency` and is shown only when X and Y share a spatial unit. Radial integration is an annular
mean; azimuthal integration is an angular-bin mean over the selected radius range.

Peak annotations are strict 8-neighbor local maxima above an absolute threshold, sorted by
magnitude with deterministic coordinate tie-breaking, then distance-suppressed. A threshold of
zero in the UI resolves to 10 percent of the admitted spectrum maximum. Bandpass radii are in
cycles/pixel. A notch removes symmetric disks at `(fx, fy)` and `(-fx, -fy)`.

Beam-center annotation, radial intensity, ring candidates, frequency/d-spacing readout, profile
CSV, and peak CSV are initial diffraction helpers. They do not perform crystallographic indexing,
phase identification, or detector-geometry refinement.

The complex buffer is private to one execution. Inverse FFT is deliberately not exposed because
PureJsImage 0.10.0 has no public complex-valued scientific-dataset contract. Exposing only a
magnitude dataset and claiming it were invertible would be scientifically false.

## Stack and registration

Arbitrary-axis navigation and min/max/mean projection use PureJsImage's public built-ins. The
materials extension adds sum projection, montage, per-plane statistics, and phase-correlation
alignment.

- Invalid values are ignored for projection/statistics; all-invalid pixels remain NaN.
- Montage plane order is increasing selected-axis index; unused contact-sheet cells are NaN.
- Phase correlation uses the normalized cross-power spectrum and reports integer X/Y shifts,
  correlation peak, and peak ratio for every frame.
- A frame is rejected if either shift exceeds `maximumShift` or its peak ratio is below
  `minimumPeakRatio`. Rejection fails the complete operation without a partial aligned output.
- `pad` keeps the source dimensions and uses the explicit fill value outside translated frames.
- `crop-overlap` uses a deterministic `maximumShift` margin on every side. This stable descriptor
  is intentionally more conservative than cropping to only the observed shifts and makes replay
  output dimensions independent of measured noise.
- ROI propagation subtracts each accepted frame's alignment offset from the reference ROI.

No rotation, scale, elastic, subpixel, or non-rigid registration is claimed.

## AFM/SPM surface workflow

All corrections create a new floating dataset and never mutate the raw height field:

- subtract mean: degree-zero least squares;
- first-order plane: least-squares `a + bx + cy`;
- row/line median: subtract the finite admitted median independently from each row;
- polynomial background: normalized-coordinate least squares with degree limited to 0, 1, or 2.

The selected area ROI is the admitted analysis field; samples outside it form an exclusion mask and
do not affect fits, histograms, roughness, or grain threshold selection. X/Y calibration comes from
the two spatial axes. Z units come independently from the selected component.

Definitions:

- `Ra = mean(abs(z - mean(z)))`;
- `Rq = sqrt(mean((z - mean(z))²))`;
- `Rz = max(z) - min(z)` over the admitted area.

The height profile uses bilinear sampling and anisotropic X/Y physical distance. Grain masks call
the same reference global threshold implementation used by the particle workflow; downstream
connected components and particle measurements therefore remain composable shared graph steps.

## Local-first batch recipes

The batch runner accepts one already validated committed recipe graph and independently processes
selected local files in isolated imaging Workers. Public target adapters normalize multiple
selected dataset/plane pairs and enabled manifest-backed corpus scenarios into the same per-item
contract; disabled corpus scenarios are excluded before execution. Concurrency is limited to 1–8
in the reusable runner and 1–4 in the UI. No item uploads or network requests occur.

Each row records source identity, source name, recipe SHA-256, deterministic output stem, and
queued/running/succeeded/failed/cancelled status. The UI can cancel an individual queued/running
item or the complete run. Failure or cancellation affects only that item.
Successful rows from the same recipe hash can be supplied as resume metadata and are not rerun.
The in-memory normalized metadata is JSON-safe and exportable; durable IndexedDB batch-history UI
is deferred because the project currently persists the committed recipe graph rather than large
execution tables.

Deterministic output stems are `NNNN-normalized-source-recipehash12`. Batch results remain bounded
summaries; raw source bytes and full tables are never placed in React state.

## Reproducibility and tests

Reference tests cover exact sinusoidal lattices, reciprocal calibration/d-spacing, inverse-buffer
round trip (internal only), radial tile-order invariance, known translations, min/max/mean/sum,
montage, drift/ROI propagation, exact planes and quadratic backgrounds, known Ra/Rq/Rz, shared
grain thresholding, cancellation, bounded concurrency, partial failure, resume, Worker result
paging/export, browser accessibility, CSV, and project replay.

Numerical FFT, phase correlation, least-squares correction, and roughness results are tolerance
based. Integer masks, montage placement, deterministic names, statuses, and ROI propagation are
bit exact.
