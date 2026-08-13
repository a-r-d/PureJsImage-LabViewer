# Scientific test corpus

## Goals

The corpus is not just a demo gallery. It validates:

- file opening and reader detection;
- metadata and calibration;
- local versus remote parity;
- HTTP Range behavior and byte budgets;
- display correctness;
- ROI measurement;
- particle analysis;
- project replay;
- agent construction of real workflows;
- responsiveness on realistic dimensions.

Every external dataset must have:

- stable source record;
- explicit reuse license;
- attribution text;
- integrity metadata;
- expected size;
- defined test tasks;
- a corpus tier controlling when it downloads.

Unknown or ambiguous licenses are not accepted into automated downloads.

## Corpus tiers

### Tier 0: generated fixtures

Checked into the repository or generated deterministically during tests.

Examples:

- gradients and impulse images;
- calibrated anisotropic grids;
- circles, ellipses, touching particles, fibers, pores, and checkerboards;
- MRC volume with known X/Y/Z calibration;
- synthetic GSF surface;
- synthetic CBF detector frame;
- synthetic ENVI cube;
- small pyramidal TIFF/SVS-like fixture;
- malformed, truncated, hostile, and resource-limit files.

These provide exact goldens and run in every CI job.

### Tier 1: compact real corpus

Downloaded and checksum-verified in normal CI or a dedicated corpus job. Keep the selected subset below roughly 250 MB compressed.

Use a small, representative subset rather than mirroring complete archives.

### Tier 2: medium scheduled corpus

100 MB–5 GB datasets used nightly or manually. Tests may selectively download files rather than entire deposits.

### Tier 3: large remote corpus

Multi-gigabyte or terabyte-scale sources used to validate range access, cancellation, memory, and long workflows. These run on a schedule or manually with explicit cost controls.

## Recommended sources

### NIST Detection Limits for SEM Image Segmentation

Source: `https://doi.org/10.18434/mds2-3838`

Content:

- six simulated SEM collections;
- controlled Poisson noise and contrast variation;
- segmentation models and image-quality/accuracy metrics.

License/status: NIST public data repository. Capture the exact current version and file hashes from the NIST machine-readable record before enabling an automated download.

Use for:

- threshold robustness across noise/contrast;
- segmentation preview UI;
- deterministic classification/metric import;
- visual regression over controlled image degradation;
- agent reasoning about low-confidence segmentation.

### Indentation mark segmentation data

Source: `https://doi.org/10.5281/zenodo.7639190`

Content:

- 1,120 SEM images;
- 1,024 × 768 PNG;
- ground-truth masks;
- images from multiple SEM instruments and varied brightness/contrast.

License: CC BY 4.0.

Use for:

- paired image/mask visualization;
- overlay alignment;
- threshold and segmentation comparison;
- line and polygon ROI workflows;
- visual tests under varied contrast;
- later plugin/agent workflow for detecting indentation geometry.

The full image archive is large. Normal CI should use a curated, attributed subset whose selection and checksums are committed to the corpus manifest.

### Plastisphere SEM image set

Source: `https://doi.org/10.5281/zenodo.20036141`

Content:

- 132 real SEM images;
- Thermo Fisher Phenom ProX;
- polyethylene and polyurethane particles from wastewater and river samples;
- approximately 132 MB archive.

License: CC BY 4.0.

Use for:

- real-world SEM display variability;
- particle outline/ROI workflows;
- metadata and attribution surfaces;
- object measurement and agent-assisted exploratory analysis;
- product screenshots using licensed data.

### EMPIAR

Source: `https://www.ebi.ac.uk/empiar/`

License: CC0 for EMPIAR data.

EMPIAR preserves deposited formats such as MRC, TIFF, DM4, and raw FEI data, making it particularly valuable for reader and large-data testing.

Recommended entries:

#### EMPIAR-10847

- 120.1 MB;
- 20 TIFF cryo-FIB-SEM slices;
- 3,072 × 2,048;
- 10.377 nm pixel spacing.

Use as the first real scheduled FIB-SEM corpus because it is small enough for frequent automation.

#### EMPIAR-10479

- 2.8 GB;
- 844-frame FIB-SEM TIFF;
- 2,048 × 1,768;
- 6.25 nm pixel spacing.

Use for medium-scale volume navigation, cancellation, memory, and project replay.

#### EMPIAR-11002

- 4.1 GB;
- 1,798 TIFF slices;
- 2,556 × 966;
- 5 × 5 × 8 nm metadata.

Use for anisotropic calibration and volume workflows.

#### EMPIAR-10231 or another licensed 4D-STEM DM4 entry

Use later for DM4 and 4D-STEM reader/application validation. Do not enable until the exact entry, files, checksums, and practical test subset are pinned.

### OpenSlide/Aperio public test data

Use explicitly CC0 slide files such as the CMU Aperio examples after recording the exact source, license statement, file checksum, and attribution in the manifest.

Use for:

- whole-slide reader detection;
- pyramid/associated-image enumeration;
- local versus HTTP Range parity;
- first-tile byte budget;
- resolution-level selection;
- ROI and analysis at a chosen level.

Do not assume every file on a test-data server has the same license. License each selected file individually.

### RosettaSciIO and HyperSpy test assets

These projects are valuable references for DM3/DM4, EMD, SER/EMI, and other scientific formats. Their repository code license does not automatically establish a permissive license for every bundled external test file.

Use generated fixtures or individually verified assets. Do not bulk-copy their test data.

### py4DSTEM tutorials

Use as workflow and expected-behavior references for:

- real-space/diffraction-space linking;
- virtual detector images;
- diffraction calibration;
- strain/orientation workflows.

Dataset links in notebooks require individual license and checksum review before inclusion.

## Corpus manifest

`datasets/corpus.yaml` is the source of truth. Each entry includes:

```yaml
- id: example
  status: enabled | candidate | disabled
  tier: generated | ci | scheduled | large-remote
  modalities: [SEM]
  formats: [png]
  source:
    landingPage: https://example.org/record
    acquisition: zenodo-record | empiar-entry | direct | generated
    recordId: optional
  license:
    id: CC-BY-4.0
    url: https://creativecommons.org/licenses/by/4.0/
    attribution: Required attribution text
    verifiedAt: 2026-08-13
  integrity:
    algorithm: sha256 | md5
    digest: ...
  expectedBytes: 123
  selection:
    include: [specific/files]
  tests:
    - open
    - metadata
    - local-remote-parity
```

The downloader refuses:

- `candidate` entries;
- missing license information;
- unpinned direct downloads;
- checksum mismatches;
- archives with path traversal;
- extracted byte/file-count limit violations.

## Test server

Create a Playwright fixture server that can serve corpus files with:

- HTTP Range support;
- request log and byte counters;
- configurable latency;
- cancellation detection;
- missing/invalid validators;
- CORS modes;
- deliberate truncation and server errors.

Every remote reader workflow should assert:

- response count;
- bytes served;
- requested ranges;
- first useful tile budget;
- no full-file request unless explicitly required by the format.

## Product test matrix

| Test | Generated | NIST | Indentation | Plastisphere | EMPIAR | Aperio |
|---|---:|---:|---:|---:|---:|---:|
| open/detect | yes | yes | yes | yes | yes | yes |
| metadata/calibration | yes | partial | partial | partial | yes | yes |
| local/remote parity | yes | optional | optional | yes | yes | yes |
| ROI statistics | yes | yes | yes | yes | yes | yes |
| threshold preview | yes | yes | yes | yes | yes | yes |
| connected components | exact | metric | mask comparison | exploratory | selected slices | selected level |
| line profile | exact | yes | yes | yes | yes | yes |
| project replay | exact | yes | yes | yes | yes | yes |
| agent workflow | deterministic mock | yes | yes | yes | yes | yes |
| range-byte budget | yes | n/a | n/a | n/a | where served | critical |
| performance | yes | yes | yes | yes | scheduled | critical |

## Goldens

Goldens should be semantic whenever possible:

- normalized metadata JSON;
- calibration values;
- operation graph and invocation hash;
- ROI geometry;
- result statistics and object counts;
- selected result rows under tolerances;
- tile/range metrics;
- screenshot at a small number of stable viewport states.

Avoid broad pixel screenshots as the sole correctness signal. GPU rasterization can vary slightly between systems.

For algorithms, use:

- analytically generated fixtures;
- library conformance tests;
- independent reference outputs generated by a pinned, documented scientific stack when necessary.

Do not regenerate goldens automatically on failure.
