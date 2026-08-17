# Corpus audit

Verification snapshot: 2026-08-14. The normalized source of truth is
`packages/test-corpus/src/manifest.ts`; this report explains why every catalog entry is enabled,
candidate, scheduled, or excluded. Candidate and scheduled records are visible only in the
gallery's clearly separated planned-datasets view. They cannot be opened, downloaded, or presented as
enabled examples.

## Summary

| Status | Count | Meaning |
| --- | ---: | --- |
| Enabled | 10 | Six generated fixtures plus four exact public-domain bundled micrographs with bounded workflows and normal-CI coverage. |
| Candidate | 5 | Scientifically useful record, but at least one identity, license, subset, or oracle gate remains. |
| Scheduled | 3 | Exact upstream entry is known; large-data qualification belongs in controlled scheduled tests. |
| Excluded | 1 | Capability or licensed exact-scenario boundary is not yet ready. |
| Disabled | 0 | No previously enabled entry is currently suspended. |

## Entry audit

| Scenario | Status | Gate | Reason |
| --- | --- | --- | --- |
| `generated.calibrated-particles` | enabled | ready | Deterministic GSF generator, CC0, offline open, bounded particle recipe, structural oracle. |
| `generated.touching-particles` | enabled | ready | Deterministic overlapping disks, CC0, offline open, bounded watershed script. |
| `generated.periodic-lattice` | enabled | ready | Deterministic calibrated frequencies, CC0, offline open, bounded FFT/radial-profile script. |
| `generated.afm-tilted-surface` | enabled | ready | Deterministic calibrated height field, CC0, offline open, bounded leveling/roughness script. |
| `generated.batch-particles` | enabled | ready | Deterministic mirrored isolated-disk field, CC0, bounded batch proposal and per-item isolation workflow. |
| `generated.drifting-stack` | enabled | ready | Deterministic 64×64×8 NRRD volume with a one-pixel-per-plane disk walk, CC0, offline open, bounded mean-projection script. |
| `cdc.ecoli-sem` | enabled | ready | Exact public-domain 700 × 475 CDC SEM JPEG plus full-resolution grayscale GSF intensity derivative, both SHA-256 pinned; offline source loading and committed threshold/components preset. |
| `cdc.staph-aureus-sem` | enabled | ready | Exact public-domain 2100 × 1630 CDC SEM JPEG (PHIL 6486), SHA-256 pinned and opened as the original JPEG; offline source loading and a committed bright-object threshold/components starting point. |
| `nih.hela-cells-3709` | enabled | ready | Exact public-domain NIH JPEG plus a bounded 1024 × 832 grayscale GSF intensity derivative, both SHA-256 pinned; offline source loading and ROI-first inspection workflow. |
| `nci.hhv6-em` | enabled | ready | Exact public-domain NCI TEM JPEG plus a bounded 1024 × 690 grayscale GSF intensity derivative, both SHA-256 pinned; offline source loading and a committed whole-plane histogram. |
| `nist.sem-detection-limits` | candidate | not ready | NIST publishes SHA-256 for `mask_sets.zip`; exact bytes, immutable file URL, selected archive members, redistribution decision, and result oracle remain pending. |
| `zenodo.indentation-masks` | candidate | not ready | CC BY 4.0 record and exact mask archive URL/bytes are known, but only MD5 is published; a representative image/mask pair and SHA-256 are not pinned. |
| `zenodo.tem-cobalt-segmentation` | candidate | not ready | Relevant calibrated TEM labels are present; exact bytes, selected members, SHA-256, license decision, and oracle remain pending. |
| `zenodo.tio2-particle-masks` | candidate | not ready | Relevant particle masks/classes are present; exact bytes, selected pair, SHA-256, and data-specific license remain pending. |
| `gwyddion.chip-afm` | candidate | not ready | Exact `chip.gsf` URL and 360,120-byte size are known; data-specific license and SHA-256 are not verified. |
| `empiar.cryo-fib-sem-10870` | scheduled | not ready | Entry metadata identifies 37 calibrated TIFF frames; exact small subset, file hashes, license record, byte budget, and hosting decision remain pending. |
| `empiar.pollen-multimodal-10903` | scheduled | not ready | Entry metadata identifies HRTEM fields and FIB-SEM stacks; exact files, hashes, bounded subset, license record, and oracles remain pending. |
| `openslide.cmu1-aperio` | scheduled | not ready | CC0, exact 177,552,579-byte file, SHA-256, and Range support are verified; CORS/range qualification and project-controlled immutable hosting are still required. |
| `future.dm4-4dstem` | excluded | not ready | No exact redistributable scenario passed the corpus gate, and the upstream reader boundary is not yet published for this workbench. |

## Authoritative research records

- [CDC E. coli SEM source record](https://commons.wikimedia.org/wiki/File:Scanning_electron_micrograph_of_an_E._coli_colony.jpg)
  preserves the PHIL 10071 attribution, exact source JPEG, and U.S. Government public-domain
  determination. The workspace GSF converts that JPEG to grayscale intensity values without resizing.
- [CDC Staphylococcus aureus SEM source record](https://commons.wikimedia.org/wiki/File:Staphylococcus_aureus_01.jpg)
  preserves the PHIL 6486 attribution (Janice Carr; CDC/Matthew J. Arduino), exact 2,100 × 1,630
  JPEG, and U.S. Government public-domain determination (PD-USGov-HHS-CDC). The workbench opens that
  original JPEG through the scientific codec adapter; there is no GSF derivative. A 2 µm scale bar
  and instrument legend are source annotations, not machine-readable calibration.
- [NIH HeLa electron micrograph source record](https://commons.wikimedia.org/wiki/File:HeLa_Cells_Image_3709-PH.jpg)
  identifies NIH image 3709-PH and its public-domain status. The workspace GSF is a documented
  1024 × 832 grayscale Lanczos derivative.
- [NCI HHV-6 TEM source record](https://commons.wikimedia.org/wiki/File:HHV-6_-_EM.jpg)
  identifies NCI image 2257, Bernard Kramarsky, the public-domain dedication, and the exact source
  JPEG. The workspace GSF is a documented 1024 × 690 grayscale Lanczos derivative.

- [NIST Detection Limits for SEM Image Segmentation](https://doi.org/10.18434/mds2-3838)
  publishes the archive inventory and SHA-256 values.
- [Zenodo indentation record 7639190](https://doi.org/10.5281/zenodo.7639190) publishes
  1,120 SEM images/masks under CC BY 4.0 and record-level MD5 checksums.
- [Zenodo cobalt-oxide TEM record 14927582](https://doi.org/10.5281/zenodo.14927582)
  describes calibrated TEM images and segmentation output.
- [Zenodo TiO2 particle record 4563942](https://doi.org/10.5281/zenodo.4563942)
  describes micrographs, masks, and occlusion classifications.
- [Gwyddion sample data](https://gwyddion.net/download.php) publishes the compact real
  `chip.gsf` file; the Gwyddion software license is not treated as a license for that data.
- [EMPIAR-10870](https://www.ebi.ac.uk/empiar/EMPIAR-10870/) and
  [EMPIAR-10903](https://www.ebi.ac.uk/empiar/EMPIAR-10903/) are the authoritative volume and
  multimodal entry records.
- [OpenSlide](https://openslide.org/) identifies its test data as freely distributable;
  [the OpenSlide test manifest](https://github.com/openslide/openslide/blob/main/test/cases/slides.yaml)
  pins the CMU-1 SHA-256.

No plastisphere, additive-manufacturing phase-mask, standalone ENVI, or diffraction/CBF record was
added merely to fill a modality slot. The research pass found plausible public landing pages, but
not an exact representative file with a verified data license, SHA-256, bounded delivery plan, and
scientific oracle. Those gaps remain honest backlog rather than unqualified catalog entries.

## Enforcement

- Manifest normalization refuses duplicate/invalid IDs, missing workflows/budgets, unsafe URLs,
  malformed hashes, unknown licensing decisions, and enabled external files without exact URL,
  bytes, SHA-256, and approved redistribution.
- The downloader verifies cache entries and network bytes before use, evicts corrupt cache data,
  caps retries and bytes, supports progress/cancellation/offline cache, and refuses to turn a
  Range-backed asset into a full download.
- Archive extraction validates the complete directory before reading members and refuses traversal,
  encoded traversal, absolute/Windows paths, symlinks, duplicates, excessive counts, expanded size,
  per-file size, and compression ratio.
- Normal CI uses generated fixtures and exact bundled real-data derivatives only. No test depends
  on an uncontrolled public server.
