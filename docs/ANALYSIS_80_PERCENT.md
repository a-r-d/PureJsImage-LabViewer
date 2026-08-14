# Common scientific-analysis workflow coverage

This document defines the practical feature target after prompt 04. It uses ImageJ/Fiji, Gwyddion, DigitalMicrograph/Velox-style electron-microscopy workflows, and materials particle-analysis tools as north stars without promising command-for-command compatibility.

## Tier A: everyday image and measurement tools

### Display and inspection

- component/channel selection;
- min/max, percentile, manual, log, square-root, and asinh display mapping where supported;
- grayscale and scientific palettes;
- invert display without modifying data;
- cursor pixel value and calibrated coordinates;
- scale bar;
- metadata search and copy;
- resolution-level and plane selection;
- side-by-side/blink/split comparison.

### Calibration

- show file-provided calibration and its source;
- set or correct scale from known distance;
- explicit X/Y anisotropic spacing;
- units conversion without losing source calibration;
- calibration warning when missing or inferred;
- project-level calibration override with provenance.

### ROI and measurements

- rectangle, ellipse, polygon, line, polyline, point, and freehand ROI;
- ROI manager: rename, show/hide, duplicate, delete, reorder, import/export;
- area, perimeter, centroid, center of mass, bounding box;
- mean, median, min, max, standard deviation, variance, integrated intensity;
- histogram and percentiles;
- line profile and width-averaged profile;
- Feret max/min, equivalent circular diameter, major/minor axes, aspect ratio, orientation, circularity, solidity;
- calibrated and pixel-space outputs with explicit units.

### Geometric and numeric operations

- crop;
- resize/resample;
- rotate 90/180/270 and arbitrary-angle rotate where justified;
- horizontal/vertical flip;
- translate;
- convert numeric type with explicit clipping/scaling policy;
- normalize, clamp, invert, gamma, log, exponential and square-root transforms;
- add, subtract, multiply, divide by constants;
- image calculator for compatible datasets;
- mask/ROI-limited operation application.

## Tier B: filters and correction

- Gaussian, mean/box, median, minimum, maximum;
- arbitrary convolution kernels;
- sharpen and unsharp mask;
- Sobel/Scharr gradients and Laplacian;
- local variance and entropy maps where useful;
- despeckle/outlier removal;
- background subtraction: rolling-ball/paraboloid or a documented equivalent;
- flat-field correction where reference imagery exists;
- stripe/scan-line correction for SPM/SEM workflows;
- preview versus commit, cancellation, and tile-size invariance.

## Tier C: segmentation and particle analysis

### Thresholding

- manual lower/upper threshold;
- Otsu;
- Triangle;
- Yen;
- Li;
- mean/minimum or other common global methods where reference behavior is available;
- adaptive/local threshold, initially Sauvola and optionally Phansalkar;
- threshold preview histogram and foreground fraction;
- light/dark foreground and no-data policy.

### Binary morphology

- erode and dilate;
- open and close;
- fill holes;
- clear border;
- remove small objects;
- binary outline;
- distance transform;
- watershed separation;
- skeletonize/thin after the core particle workflow is stable.

### Particle/object workflow

The current reference semantics, admission limits, and explicit omissions are documented in
`docs/SEGMENTATION_PARTICLE_ANALYSIS.md`.

- connected components;
- edge-exclusion policy;
- size, circularity, aspect-ratio, and solidity filters;
- object table and summary statistics;
- numbered outline, mask, label, centroid, and fitted-ellipse overlays;
- distributions and cumulative distributions;
- selection of a table row highlights the object and vice versa;
- CSV export and recipe replay.

## Tier D: materials and instrument workflows

### Frequency and crystallographic helpers

- 2D FFT;
- magnitude and power spectrum;
- centered/log display;
- inverse FFT where the operation contract is clear;
- radial and azimuthal integration;
- spatial-frequency and d-spacing readout when calibrated;
- bandpass/notch masks;
- basic peak detection and annotation;
- saved FFT analysis with source/ROI/calibration provenance.

### Stacks and volumes

- arbitrary-axis plane selection;
- Z or selected-axis min/max/mean/sum projections;
- montage/contact sheet;
- frame/plane navigation and playback;
- stack statistics;
- translation registration and phase-correlation alignment;
- drift trajectory plot;
- crop/ROI propagation through a stack.

### AFM/SPM and height fields

- mean plane and first-order plane leveling;
- row/line median correction;
- polynomial background where numerically justified;
- height histogram;
- Ra, Rq/RMS, Rz and clearly defined roughness statistics;
- grain detection and grain measurements;
- profile extraction;
- masks and excluded regions;
- preserve physical Z units independently from X/Y units.

### Batch and recipes

- run one validated recipe over multiple local files or selected planes;
- bounded concurrency and cancellation;
- per-item status/error without aborting unrelated items;
- aggregate result table;
- deterministic output naming;
- no hidden upload or server requirement.

## Explicitly outside the first “80 percent”

- complete ImageJ macro compatibility;
- all Fiji plugins;
- clinical diagnosis or regulated workflows;
- mature EDS/EELS quantification;
- full EBSD indexing and texture analysis;
- complete 4D-STEM reconstruction suite;
- neural-network model training;
- arbitrary 3D mesh editing;
- every morphology variant or specialist segmentation algorithm.

These may become future plugins, scripts, application modules, or upstream PureJsImage capabilities.
