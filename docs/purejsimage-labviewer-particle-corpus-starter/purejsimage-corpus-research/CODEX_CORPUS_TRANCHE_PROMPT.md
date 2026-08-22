# Codex prompt: build the real-image corpus tranche for PureJsImage LabViewer

Work in the current `PureJsImage-LabViewer` repository. Inspect the repository structure and the new particle-counting North Star before changing anything. Adapt paths to the actual architecture rather than blindly creating parallel conventions.

## Goal

Build a license-clean, reproducible real-image corpus system for the Science materials-analysis workflow. This tranche is infrastructure plus a small core corpus, not a model-training project and not a UI redesign.

The corpus must support:

- exact source provenance and license evidence
- checksummed downloads
- deterministic extraction and derivation
- image and mask pairing
- instance, semantic, and ignore masks
- physical calibration
- explicit border-object policy
- deterministic hard-case selection
- fast core CI and opt-in extended evaluation
- aggregate reports beyond total count error

Do not commit, push, publish, or deploy.

## First inspect

1. Read `docs/PARTICLE_COUNTING_NORTH_STAR.md` and the particle pipeline benchmark tests.
2. Find the existing fixture, test-data, cache, generated-artifact, and license conventions.
3. Find the current image decoders and supported native formats. Do not silently convert every source to 8-bit PNG if the project can exercise 16-bit TIFF, HDF5, or DM3.
4. Find the current object-measurement schema and map corpus metadata onto it rather than creating duplicate concepts.

## Corpus layout

Prefer this shape unless the repository already has a better established equivalent:

```text
packages/materials-analysis/testdata/corpus/
  manifest.v1.json
  README.md
  LICENSES/
  core/
    images/
    masks/
    ignore/
    native/
  derived/
    transforms/
scripts/corpus/
  fetch-corpus.mjs
  verify-corpus.mjs
  select-hard-cases.py
  report-corpus.mjs
```

The normal clone and normal CI must remain small. Do not put multi-gigabyte source archives in Git or Git LFS. Cache extended downloads outside the repository.

## License policy

Fail closed.

A source is accepted only when the manifest records evidence that it permits all three:

1. commercial use
2. redistribution
3. derivative works

Store a source-level notice with title, authors, DOI or canonical URL, exact license, attribution text, access date, and notes about derived files.

For NIST-derived files, acknowledge NIST and record the date and nature of every modification. Never imply NIST endorsement.

Do not import a source because it is merely free to download or described as royalty-free.

## Implement these source definitions

Use the supplied `corpus-manifest-v1.yaml` research artifact as source material, but convert it into the repository's canonical JSON or TypeScript schema.

### Core source A: NIST lipid nanoparticle cryoEM

Landing page: `https://data.nist.gov/od/id/mds2-2753`
License: NIST open-data terms

Exact archives:

- `https://data.nist.gov/od/ds/mds2-2753/R111_S404_pH4_1p5pcPEG_noRNA.zip`
- `https://data.nist.gov/od/ds/mds2-2753/R111_S405_pH7_1p5pcPEG_noRNA.zip`
- `https://data.nist.gov/od/ds/mds2-2753/R111_S406_pH4_1p5pcPEG_RNA.zip`
- `https://data.nist.gov/od/ds/mds2-2753/R111_S407_pH7_1p5pcPEG_RNA.zip`

Import all 38 image and mask pairs. Preserve native TIFF and 0.223 nm per pixel calibration. Treat pH and RNA condition as domain groups. Do not randomize every image into one undifferentiated split.

### Core source B: BBBC039

Landing page: `https://bbbc.broadinstitute.org/BBBC039`
License: CC0

Fetch native 16-bit TIFF images and labels. Select 16 deterministic pairs using the hard-case selector below. Keep the two preview pairs from the supplied seed archive only as lightweight wiring tests, not final scientific release gates.

### Core source C: BBBC005 focus control

Landing page: `https://bbbc.broadinstitute.org/BBBC005`
License: copyright waived to the extent possible

Import the exact three seed files and then add a small orthogonal native subset spanning count and blur. The same source scene must be evaluated across focus levels.

### Core source D: NIST and USGS asbestos smoke tests

Import the exact seed files:

- NIST `Picture3.png`
- USGS `Anthophyllite_asbestos_SEM.jpg`

These have no upstream masks. Mark them `smoke-test`, not `gold`, until adjudicated. The NIST montage must be used to test scale-bar, text, border, and panel-divider exclusion.

### Core source E: NIST SEM detection-limit controls

Landing page: `https://doi.org/10.18434/mds2-3838`

Pin and verify:

- `mask_sets.zip`: `5925dc95478e2cfc3c9ec54bfef888c7596db35fdf41bb929d6b96b8562ab562`
- `metrics_sets.zip`: `a2b89522c6d8d3fae6afefa97dd99932b564d6455beb96ae0c69083622cffa36`
- `intensity_sets.zip`: `5cd9f4caff80e9afab83515032347a17e9974554ea148f01280090504807e078`

Do not fetch or vendor the trained model archive.

### Extended source definitions

Add manifest definitions and download support, but do not make normal CI fetch them:

- Dryad HRTEM nanoparticle data: `https://doi.org/10.7941/D1SP93`, CC0
- RODARE carbide SEM data: `https://doi.org/10.14278/rodare.4124`, CC BY 4.0
- Concrete crack data: `https://doi.org/10.17632/jwsn7tfbrp.1`, CC BY 4.0
- DeepParticle: `https://doi.org/10.6084/m9.figshare.26511253`, Apache 2.0
- Kaolin particle masks: `https://doi.org/10.17632/45rtjx6pdt.1`, CC BY 4.0, weak labels until reviewed
- Grain segmentation DRM data: `https://doi.org/10.17632/t4wvpy29fz.4`, CC BY 4.0

Do not import BAM CC BY-NC-ND data, BBBC004, BBBC020, or any source whose primary record lacks a compatible license.

Treat EMPS as extended and quarantined until its per-image permission and redistribution chain is recorded. Do not infer that the GitHub MIT license automatically clears every article-derived figure.

## Manifest schema

Each source must include:

- stable source ID
- title and authors
- DOI or canonical landing URL
- exact download URLs
- source license and evidence URL
- attribution text
- commercial-use, redistribution, and derivative-work booleans
- archive checksum when upstream provides one
- access date

Each fixture must include:

- stable fixture ID
- source ID
- original filename and source checksum
- local path and local checksum
- native and derived format
- dimensions, channels, bit depth
- physical pixel size and unit when known
- instance mask, semantic mask, and ignore mask paths
- object counts including and excluding border objects
- edge policy
- derivation operations with exact parameters
- review status
- tasks and named failure modes
- split and domain group

Validate the manifest with a runtime schema. Unknown keys should fail validation so metadata does not silently rot.

## Deterministic hard-case selector

Implement a deterministic selector over image and mask pairs. Compute at least:

- object count
- foreground fraction
- median, p10, p90, and coefficient of variation of object area
- fraction of instances touching an image edge
- near-touching graph density after 1, 2, and 4 pixel dilation
- eccentricity p90
- solidity p10
- perimeter-to-area p90
- image intensity gradient
- local boundary contrast
- focus score
- estimated SNR

Select the median case, feature extremes, and cluster medoids. Deduplicate and emit a selection report explaining why every fixture was chosen. Freeze the exact source array index or crop rectangle in the manifest.

Do not visually cherry-pick the entire corpus.

## Ground truth and edge policy

Use this default policy unless the North Star already specifies a different one:

- partial border objects stay in the segmentation mask
- partial border objects are excluded from morphology and size-distribution metrics
- count metrics are reported both including and excluding border objects
- ambiguous pixels, scale bars, text, panel separators, and unresolvable contacts go into an ignore mask

Upstream masks are not automatically adjudicated. Add states:

- `upstream-unreviewed`
- `reviewed`
- `adjudicated-gold`
- `weak-label`
- `smoke-test-only`

## Evaluation integration

Add a corpus runner that executes the current particle pipeline against selected fixtures and writes machine-readable JSON plus a readable Markdown summary.

Report:

- count error including and excluding border objects
- matched-instance precision, recall, and F1
- merge and split rates
- matched mask IoU or Dice
- boundary F1
- centroid error
- area and equivalent-diameter bias
- aspect-ratio and orientation bias
- foreground-fraction error
- runtime and peak memory
- exact settings and before/after refinement history

A higher count must never be classified as an improvement by itself.

## Tests

Add tests for:

1. manifest schema validation
2. checksum mismatch rejection
3. license-policy rejection
4. source-to-fixture provenance completeness
5. image and mask dimension matching
6. instance-ID preservation
7. deterministic hard-case selection
8. edge-policy metrics
9. ignore-mask behavior
10. no network access in normal unit tests
11. core-corpus runner output stability
12. extended sources remaining opt-in

Use local HTTP fixtures or mocked fetches for downloader tests. Do not make the test suite depend on live third-party servers.

## Documentation

Update the particle-counting North Star with:

- the corpus tiers
- exact source list
- license policy
- adjudication states
- edge policy
- selection algorithm
- metric definitions
- commands for fetching, verifying, selecting, and running the corpus

Clearly distinguish deterministic synthetic tests, upstream-labeled real images, adjudicated gold images, and unlabeled smoke tests.

## Validation

Run the narrowest relevant tests first, then the full repository validation that is practical. Report exact commands, pass/fail counts, downloaded bytes, generated fixture count, corpus size, and any unrelated pre-existing flakes.

Do not weaken tests, skip license checks, silently regenerate checksums, or convert scientific native data to lossy JPEG.
