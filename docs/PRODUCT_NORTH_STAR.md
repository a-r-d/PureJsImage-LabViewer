# Product north star

## Mission

Create the fastest path from an original electron-microscope or engineering image to a calibrated, reproducible, inspectable result—without requiring software installation, file conversion, a Python environment, or a server upload.

The first product is a **materials and electron-microscopy workbench**, not a generic image editor and not a literal ImageJ clone.

## Primary user

A materials scientist, microscopy facility user, research engineer, graduate student, or failure-analysis engineer who receives large images from instruments and needs to:

- understand the file and its metadata;
- inspect details at multiple scales;
- make calibrated measurements;
- isolate particles, precipitates, pores, grains, fibers, or defects;
- compare regions and samples;
- produce a table, distribution, image overlay, and reproducible method;
- explain or rerun the analysis later.

The first user may be working alone. Collaboration is not assumed to be the primary value.

## Competitive north stars

### ImageJ / Fiji

Borrow:

- immediate file-to-analysis workflow;
- ROI-first interaction;
- thresholding and particle analysis;
- line profiles, histograms, and measurement tables;
- macro-like reproducibility;
- broad operation discoverability.

Transcend:

- no installation or plugin setup;
- no desktop memory assumption;
- native large-file and remote range access;
- web-quality interaction and accessibility;
- structured operation graphs instead of opaque macro text;
- agent-generated workflows using validated operations;
- plugin editing without local installation rights.

### DiameterJ, ParticleSizer, and MIPAR

Borrow:

- task-focused particle, fiber, pore, grain, phase, crack, and defect workflows;
- guided segmentation recipes instead of forcing every user to assemble low-level steps;
- object tables, distributions, orientation, and standards-oriented reporting;
- batch repeatability and reduced operator variability.

Transcend:

- preserve every recipe as a versioned operation graph rather than a hidden protocol;
- permit a user or agent to inspect and modify the workflow;
- run without installing ImageJ plugins, R, Python, or proprietary desktop software;
- operate progressively on large original files;
- link every reported measurement back to source, ROI, label, and operation provenance.

### Vendor materials-analysis suites: Velox and AZtec

Borrow:

- microscope-native metadata and calibration;
- EDS/EELS spectrum-image and compositional-map workflows;
- grain, boundary, texture, phase, and particle analysis;
- linked maps, spectra, profiles, tables, and acquisition context;
- batch/multi-dataset comparison as a later goal.

Transcend:

- vendor-neutral source and project model;
- portable browser access;
- open operation/plugin surface;
- reproducible agent-readable analysis;
- a clean boundary between acquisition software and post-acquisition analysis.

### Gatan DigitalMicrograph / GMS

Borrow:

- electron-microscopy-native terminology;
- calibration and metadata visibility;
- diffraction/FFT and radial-profile workflows;
- scripting and live/custom analysis mindset;
- images, spectra, and multidimensional data as first-class scientific objects.

Transcend:

- vendor-neutral files and workflows;
- browser deployment;
- explicit provenance and portable projects;
- inspectable plugin permissions;
- AI-assisted operation construction.

### Gwyddion

Borrow:

- excellent scanning-probe and height-field workflows;
- line and area measurement;
- leveling, background correction, roughness, grains, and distributions;
- modular data-processing operations.

Transcend:

- one application spanning SEM/TEM, AFM/SPM, detector frames, volumes, and whole-slide pyramids;
- operation graphs and local project replay;
- worker-based large-data execution;
- editable browser recipes/plugins.

### HyperSpy

Borrow:

- arbitrary labeled axes;
- calibration and units as part of the data model;
- multidimensional navigation;
- spectra and spectrum-images;
- decomposition and model-oriented analysis.

Transcend:

- no Python environment;
- GUI and agent both use the same validated operation catalog;
- direct original-file viewing and bounded analysis;
- project histories designed for sharing and review.

### py4DSTEM / py4D-browser

Borrow:

- real-space and diffraction-space navigation;
- virtual detector images;
- diffraction calibration;
- Bragg-disk, strain, orientation, and phase-retrieval workflows as future targets.

Transcend:

- zero-install web app;
- progressive, range-backed access where formats permit;
- interactive graph construction and agent operation;
- a common UI across ordinary 2D EM and 4D-STEM.

### napari

Borrow:

- responsive multidimensional layer model;
- composable overlays and labels;
- command palette and plugin discoverability;
- asynchronous/multiscale rendering.

Transcend:

- scientific analysis is not merely a plugin afterthought;
- native vendor-file readers through PureJsImage;
- deterministic project and operation identity;
- agent tools generated from the operation registry.

### Dragonfly / Avizo-class volume tools

Borrow:

- orthogonal volume slicing;
- segmentation overlays;
- object statistics and 3D reconstruction;
- materials and industrial inspection framing.

Transcend initially only on deployment and reproducibility. Do not pretend the first release matches mature 3D segmentation suites.

## V1 goal workflows

### Workflow A: calibrated image inspection

```text
Open local or remote file
→ identify reader and datasets
→ inspect axes, units, pixel size, metadata, and source identity
→ choose plane/resolution level/component
→ pan and zoom
→ adjust display range without modifying quantitative pixels
→ read cursor coordinates and values
```

Formats initially exercised through PureJsImage should include the available public scientific readers: ordinary codec adapters (PNG, JPEG, WebP, BMP, JP2), native TIFF, OME-TIFF, Aperio SVS, DigitalMicrograph, TIA SER/EMI, NCEM and Velox EMD, ASTAR blockfiles, Merlin MIB, GSF, Nanonis SXM, Igor IBW, Digital Surf SUR/PRO, X3P, MRC/CCP4, NRRD, MetaImage, NIfTI, ENVI, FITS, CBF/imgCIF, RPL/RAW, EMSA/MAS, ANG/CTF, and NPY.

### Workflow B: ROI measurement

```text
Draw rectangle, ellipse, polygon, or line
→ see calibrated geometry
→ calculate statistics, histogram, or line profile
→ pin result to workspace
→ export CSV/JSON/PNG snapshot
```

### Workflow C: particle / precipitate analysis

```text
Select a component or grayscale plane
→ optional blur/background step
→ threshold with live preview
→ connected components
→ inspect label overlay
→ filter objects by area/shape
→ inspect table and size distribution
→ export measurements and reproducible analysis
```

The first object table should make at least these fields obvious:

- label;
- pixel and physical area;
- equivalent circular diameter;
- centroid;
- bounding box;
- major/minor dimensions;
- aspect ratio;
- orientation.

Watershed and morphology are the next logical additions but are not required to establish the skeleton.

### Workflow D: frequency-space inspection

```text
Select ROI or plane
→ FFT / power spectrum
→ center and display logarithmically
→ line or radial profile
→ measure reciprocal-space distances
```

This is a high-priority post-skeleton operation bundle because it is central to TEM, diffraction, lattice-spacing, periodicity, and surface-texture workflows.

### Workflow E: reproducible project

```text
Save source reference + source identity
→ save display state, ROIs, graph, bindings, results, and notes
→ close browser
→ reopen project
→ rebind local source if required
→ validate identity
→ replay or inspect every operation
```

### Workflow F: AI-assisted analysis

```text
User asks: "count the bright precipitates larger than 20 nm²"
→ agent inspects dataset metadata and operation catalog
→ agent proposes an explicit graph and assumptions
→ app validates and dry-runs it
→ user approves execution
→ app executes deterministic tools
→ agent summarizes bounded results with units
→ user can inspect and edit every operation
```

The model never fabricates measurements. It reasons over deterministic tool outputs.

## Unique product advantages

1. **Original-file access.** Open files in place instead of requiring an ingest-and-convert pipeline.
2. **Large-data behavior.** The viewport and analysis operate on bounded regions/tiles.
3. **No installation.** Corporate and university users can use it where desktop installs and plugins are blocked.
4. **Reproducible analysis.** Operations, versions, parameters, bindings, identities, and results are explicit.
5. **Agent-native tooling.** The agent sees a JSON-safe catalog and issues the same validated commands as the UI.
6. **Editable recipes and plugins.** Users can inspect, paste, edit, and eventually safely execute analysis extensions in the browser.
7. **Local-first privacy.** Files and computation stay local unless the user deliberately chooses remote storage or compute.

## Explicit non-goals for the first application skeleton

- full ImageJ/Fiji operation or macro compatibility;
- clinical diagnosis;
- a general Photoshop-style pixel editor;
- real-time multiplayer collaboration;
- arbitrary code execution in the browser window;
- full 3D segmentation or meshing;
- every proprietary EM format;
- autonomous agent execution without user-visible plans and limits.

## Product success criteria

The first serious milestone is reached when five independent scientists can complete particle analysis on their own files without developer assistance and can later reopen and explain the method.

Track:

- time from file open to first useful tile;
- time from file open to first calibrated measurement;
- percentage of files opened without conversion;
- analysis completion rate;
- peak managed memory and bytes fetched;
- project replay success;
- number of manual corrections required to an agent-proposed graph;
- correctness against known masks and measurement goldens;
- recurring weekly use, not raw signups.
