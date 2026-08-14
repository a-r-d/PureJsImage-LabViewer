# Codex prompt 11 — example library corpus activation


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

Build a large, useful in-app example library and turn the existing corpus manifest into an enforceable data/scenario system. Users should be able to see the application’s value immediately, and the same examples should drive deterministic tests.

Integrate `docs/EXAMPLE_LIBRARY_AND_CORPUS.md`.

## Corpus package

Implement `packages/test-corpus` with:

- schema validation/normalization;
- candidate/enabled/disabled status;
- exact selected-file records;
- license and attribution enforcement;
- SHA-256 integrity;
- safe download/cache/extraction;
- generated fixture resolution;
- immutable scenario descriptors;
- workflow/expected-result/budget data;
- test tags/tiers;
- no runtime dependence on repository-relative developer paths.

Refuse unknown licenses, missing integrity for enabled external files, archive traversal, unexpected symlinks, excessive files, or extraction budgets.

## Expand candidates and activate real examples carefully

Research exact small representative files/subsets for:

- NIST SEM segmentation/noise;
- SEM indentation images/masks;
- plastisphere or material-surface SEM;
- TEM nanoparticles with labels;
- SEM additive-manufacturing/phase segmentation;
- AFM/GSF height fields;
- EMPIAR FIB-SEM/SBF-SEM volumes;
- HRTEM/FFT spacing;
- diffraction/CBF;
- ENVI hyperspectral;
- OpenSlide/Aperio pyramid;
- future DM4/4D-STEM.

Do not enable an item until exact file URL, file path, size, SHA-256, license, attribution, and redistribution/hosting decision are verified. Keep unsuitable/non-commercial data as candidate or excluded with a reason.

Normal Git should contain only small generated/bundled assets, thumbnails, manifests, and expected JSON—not large source data.

## In-app example gallery

Add an Examples surface and rich empty-state gallery:

- thumbnail;
- title/summary;
- modality/vendor/format;
- size and local/remote indicator;
- calibration status;
- tags and learning goal;
- license/attribution/source;
- Open example;
- Run workflow;
- Inspect recipe/script;
- download/progress/cancel/error;
- recently used examples.

Provide search/filter by modality, format, vendor, task, and size.

Each enabled example must have one or more verified workflow buttons and expected results.

## Data delivery

Support:

- generated in-browser/local fixtures;
- small static bundled assets;
- project-hosted immutable remote assets;
- scheduled external corpus cache.

For remote large files, preserve Range observability and do not pre-download the complete file merely to show metadata or a thumbnail.

## Tests

- manifest/license/integrity validation;
- downloader/cache/extractor security;
- offline cached behavior;
- example gallery and attribution;
- each enabled workflow reaches expected numerical/structural output;
- remote byte budgets;
- cancellation/retry;
- project save/reopen/source rebind;
- no normal CI dependence on uncontrolled external servers.

Produce a corpus audit report listing every enabled, candidate, excluded, and scheduled item and why.
