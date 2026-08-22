# PureJsImage LabViewer real-image corpus plan

Date: 2026-08-22

## Bottom line

Do not optimize for a large pile of microscope images. Optimize for a small, legally clean, versioned set of hard cases with masks, calibration, provenance, and explicit measurement policies.

"Royalty-free" is not a sufficient acceptance rule. A source must explicitly permit redistribution, commercial use, and derivatives. The corpus should fail closed when those rights are not documented.

The recommended design has two tiers:

1. `core`: small enough for normal CI and checked into the repository or a pinned release asset.
2. `extended`: fetched on demand from upstream sources, checksum-pinned, and cached outside a normal clone.

## Recommended V1 gold core

### 1. NIST lipid nanoparticle cryoEM segmentation

Source: https://data.nist.gov/od/id/mds2-2753
License: NIST open-data terms
Use: real particle segmentation, count, morphology, calibration, condition shift

Acquire all 38 manually segmented 4096 x 4096 image and mask pairs from these exact archives:

- `R111_S404_pH4_1p5pcPEG_noRNA.zip`
- `R111_S405_pH7_1p5pcPEG_noRNA.zip`
- `R111_S406_pH4_1p5pcPEG_RNA.zip`
- `R111_S407_pH7_1p5pcPEG_RNA.zip`

Preserve the calibrated pixel spacing of 0.223 nm per pixel. Use the four preparation conditions as held-out domain-shift groups rather than randomly mixing every image.

Why it matters: this is the cleanest real-particle anchor. It has real cryoEM noise, manually supplied masks, native TIFFs, large dimensions, and physical calibration.

### 2. Dryad segmented HRTEM nanoparticles

Source: https://doi.org/10.7941/D1SP93
License: CC0
Use: real particle segmentation, lattice texture, scale shift, noise shift, material shift, native HDF5 and DM3 ingestion

Do not vendor the 33.69 GB dataset. Deterministically extract 24 to 32 patches from these exact image and label pairs:

- `Au_2p2nm_330kx_423e_Std_UTC_FFCorr_Team05_Images.h5` and `_Labels.h5`
- `Au_10nm_330kx_425e_Std_UTC_FFCorr_Team05_Images.h5` and `_Labels.h5`
- `Au_5nm_160kx_425e_Std_UTC_FFCorr_Team05_Images.h5` and `_Labels.h5`
- `Au_5nm_205kx_420e_Std_UTC_FFCorr_Team05_Images.h5` and `_Labels.h5`
- `Au_5nm_260kx_450e_Std_UTC_FFCorr_Team05_Images.h5` and `_Labels.h5`
- `Au_5nm_330kx_80e_Std_UTC_FFCorr_Team05_Images.h5` and `_Labels.h5`
- `Au_5nm_330kx_884e_Std_UTC_FFCorr_Team05_Images.h5` and `_Labels.h5`
- `Ag_5nm_330kx_423e_Std_UTC_FFCorr_Team05_Images.h5` and `_Labels.h5`
- `CdSe_5nm_330kx_421e_Std_UTC_FFCorr_Team05_Images.h5` and `_Labels.h5`
- At least two 330kx Au session-shift pairs from sessions 0821, 1006, 1025, and 1109

Select patches by mask-derived difficulty metrics, not visual preference. This dataset explicitly varies magnification, dose, particle diameter, material, substrate, and microscope session.

### 3. BBBC039 real 16-bit nuclei

Source: https://bbbc.broadinstitute.org/BBBC039
License: CC0
Use: touching objects, intensity heterogeneity, 16-bit TIFF, real fluorescence, instance counting

The full collection has 200 fields and roughly 23,000 manually annotated nuclei. Select 12 to 16 native image and label pairs, including extremes for density, edge contact, object-size variance, low contrast, and touching-object ratio.

Do not use only the preview PNGs in the seed archive for release metrics. Fetch the native 16-bit TIFFs and labels.

### 4. RODARE carbide microstructures in steel

Source: https://doi.org/10.14278/rodare.4124
Direct archive: https://rodare.hzdr.de/api/files/fd67404b-3f61-4559-8792-3c3119a8c5da/data.zip
License: CC BY 4.0
Use: paired detector channels, precipitate or carbide segmentation, cross-channel robustness, calibrated morphology

The source provides 13 paired SEM fields from two reactor-pressure-vessel steels, paired SE2 and InLens channels, and binary labels. Each image is 2048 x 1404. Keep paired channels together so the same ground truth can test detector-domain sensitivity.

### 5. Concrete crack and damage segmentation

NIST source: use the NIST concrete 2D segmentation release and NIST open-data terms.
Exact NIST resources:

- https://isg.nist.gov/deepzoomweb/concreteDownload/rawFOV.zip
- https://isg.nist.gov/deepzoomweb/concreteDownload/contextManualMaskGT.zip
- https://isg.nist.gov/deepzoomweb/concreteDownload/damageAssistedManualMask.zip
- https://isg.nist.gov/deepzoomweb/concreteDownload/damageContextAssistedMask.zip

The NIST data contains sixteen 8192 x 8192 SEM fields with 1.92 micrometers per pixel. Include the documented 1024 x 1024 manual ground-truth patch at row 1, column 3, plus deterministic tiles from each full field.

Additional CC BY 4.0 crack source: https://doi.org/10.17632/jwsn7tfbrp.1
Use these exact hard cases from that collection:

- `609.JPG`: dominant crack plus a very small branch
- `468.JPG`: complex multi-region case
- `460.JPG`: crack spans the full image height
- `133.jpg`: full-height crack plus small branch
- `112.jpg`: long horizontal crack plus smaller branch

Use: thin structures, branching, edge policy, skeleton length, topology preservation, and large-image tiling.

### 6. Fibers and asbestos

Exact public-domain files already included in the seed archive:

- NIST `Picture3.png`: https://www.nist.gov/sites/default/files/images/2024/06/21/Picture3.png
- USGS `Anthophyllite_asbestos_SEM.jpg`: https://upload.wikimedia.org/wikipedia/commons/c/c7/Anthophyllite_asbestos_SEM.jpg

Use: elongated-object segmentation, crossing fibers, skeletonization, orientation distributions, scale-bar exclusion, text exclusion, panel detection, and partial objects at borders.

These are not gold data until masks are manually reviewed. The NIST montage is particularly useful because a naive particle pipeline will count scale bars, panel dividers, labels, and debris.

### 7. BBBC005 and NIST detection-limit controls

BBBC005 source: https://bbbc.broadinstitute.org/BBBC005
License: copyright waived to the extent possible
Use: known synthetic count, blur, focus diagnostics, controlled regression

The full BBBC005 matrix varies cell count from 1 to 100 and blur from 1 to 48. Select a small orthogonal design rather than downloading every image.

NIST detection-limit source: https://doi.org/10.18434/mds2-3838
License: NIST open-data terms
Use: controlled SEM noise and contrast sweeps

Pin these exact upstream checksums:

- `mask_sets.zip`: `5925dc95478e2cfc3c9ec54bfef888c7596db35fdf41bb929d6b96b8562ab562`
- `metrics_sets.zip`: `a2b89522c6d8d3fae6afefa97dd99932b564d6455beb96ae0c69083622cffa36`
- `intensity_sets.zip`: `5cd9f4caff80e9afab83515032347a17e9974554ea148f01280090504807e078`

Do not include the 343 MB trained-model archive in the image corpus.

### 8. DeepParticle marine-plastic images

Source: https://doi.org/10.6084/m9.figshare.26511253
License: Apache 2.0
Use: irregular fragments, fibers and lines, object detection, classification, negative noise examples

Start with `08_03_micro_line_only1.JPG` and its TSV annotation, then select at least one noise-negative, one mixed morphology image, one macro case, and one dense micro case.

## Strong extended sources

### Kaolin clay particle morphology

Source: https://doi.org/10.17632/45rtjx6pdt.1
License: CC BY 4.0

Contains one real SEM image, 4,929 experimentally extracted 85 x 85 particle masks, and 10,000 generated masks. This is useful for shape-distribution and morphology stress tests. The experimental masks were generated with SAM plus filtering, so treat them as weak labels until reviewed, not as unquestioned ground truth.

### Grain segmentation by directional reflectance microscopy

Source: https://doi.org/10.17632/t4wvpy29fz.4
License: CC BY 4.0

Contains nickel, aluminium, titanium, and Inconel 718 datasets; 4D uint8 reflectance data; EBSD Euler angles; and reference grain maps. Use it for grain-size distributions, instance topology, and multidimensional import.

### Low-alloy steel microstructure texture

Source: https://doi.org/10.17632/gd2c72vfrh.1
License: CC BY 4.0

Contains martensite, pearlite, and lower-bainite crops at 32, 64, 128, and 256 pixels, with binary masks and calibrated scales. Use it for texture classification and resolution sensitivity.

### WHA fracture surfaces

Source: https://doi.org/10.18126/aph0-olbz
License: CC BY 4.0

SEM fracture images with varying tungsten composition and activation maps. Use it for texture, fracture-mode clustering, and image-level classification. It is not a particle-count gold set.

## Sources to quarantine or reject

### EMPS

Source: https://github.com/by256/emps

EMPS is extremely useful: 465 electron micrographs, instance masks, and thousands of labeled particles. The images were mined from published Elsevier figures. The paper states that permissions were obtained, Dataset Ninja labels the dataset CC BY 4.0, and the GitHub repository carries MIT. Still, do not infer that a repository-level software license automatically settles every source-figure right. Use it in the extended downloader first, preserve DOI-level provenance per image, and vendor it only after documenting the permission and redistribution chain.

### BAM automatic SEM segmentation data

Reject from the commercial corpus. Its data and masks are CC BY-NC-ND 4.0, which blocks commercial use and derivatives.

### BBBC004 and BBBC020

Reject from the commercial redistributable core. Their licenses include non-commercial restrictions.

### NFFA 100 percent SEM and OD-MetalDAM

Useful material, but the primary records do not make the license chain clear enough for vendoring. Keep them out until the original source declares a compatible license.

## Deterministic hard-case selection

For every candidate with a mask, compute these features:

- object count
- foreground fraction
- object-area median, p10, p90, and coefficient of variation
- edge-touching instance fraction
- near-touching graph density after 1, 2, and 4 pixel dilation
- eccentricity p90
- solidity p10
- perimeter-to-area p90
- size-distribution skew
- local intensity contrast around boundaries
- illumination-plane gradient
- focus score
- estimated SNR
- image bit depth and channel count

Select:

1. The median case.
2. Both extremes for each feature.
3. Cluster medoids over the full feature vector.
4. At least three examples for every named failure mode.

Deduplicate selections, freeze the source checksum and exact array index or crop rectangle, and store the feature vector in the manifest. This gives a reproducible corpus rather than a human-picked gallery.

## Ground-truth policy

Every gold fixture needs:

- an instance mask where the task is counting or morphology
- a semantic mask where only material fraction matters
- an `ignore` mask for ambiguous regions, text, scale bars, panel separators, charging artifacts, and impossible boundaries
- a documented edge policy
- physical calibration when available
- source and derived checksums
- a complete transform chain
- review status and reviewer identity or pseudonym

Recommended edge policy:

- retain partial border objects in the segmentation mask
- exclude them from size-distribution and shape metrics by default
- report count metrics both including and excluding border objects

## Metrics

Total count error is necessary but not sufficient. Release reports should include:

- matched-instance precision, recall, and F1
- merge rate and split rate
- mask IoU or Dice after instance matching
- boundary F1
- centroid error
- object-area and equivalent-diameter bias
- aspect-ratio and orientation bias
- foreground-fraction error
- edge-policy correctness
- calibration error
- runtime, peak memory, and deterministic replay

## Suggested repository layout

```text
packages/materials-analysis/testdata/corpus/
  manifest.v1.json
  LICENSES/
  core/
    images/
    masks/
    ignore/
    native/
  derived/
    transforms/
  README.md
scripts/corpus/
  fetch-corpus.mjs
  verify-corpus.mjs
  select-hard-cases.py
  adjudication-export.mjs
```

Do not put the 33.69 GB Dryad corpus or other large upstream archives in Git or Git LFS. The normal clone should contain only the small core. Extended sources should be fetched by manifest, verified by checksum, and cached outside the repository.
