# Example library and scientific corpus strategy

## Goals

The example system serves three purposes simultaneously:

1. Instant product demonstrations for a first-time user.
2. Deterministic scientific correctness tests.
3. Real-world compatibility and performance coverage.

Every example is a versioned scenario, not merely an image thumbnail.

The Prompt 11 baseline implements this contract in `packages/test-corpus`. Five distinct,
deterministic GSF scenarios are enabled offline and share their descriptors with the workbench
gallery, fixture resolver, workflow buttons, and tests. Researched real datasets remain in a
separate candidate/scheduled/excluded queue until every gate below is satisfied. See
`docs/CORPUS_AUDIT.md` for the per-entry evidence and remaining blockers.

## Example descriptor

```ts
interface ExampleScenarioV1 {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly modality: string
  readonly vendor?: string
  readonly format: string
  readonly source: ExampleSource
  readonly license: ExampleLicense
  readonly preview: ExamplePreview
  readonly tags: readonly string[]
  readonly learningGoals: readonly string[]
  readonly defaultView?: ExampleViewState
  readonly workflows: readonly ExampleWorkflowV1[]
  readonly expected: readonly ExampleExpectedAssertionV1[]
  readonly budgets: ExampleBudgetsV1
  readonly testPlan: ExampleTestPlanV1
}
```

The same normalized descriptor should drive:

- the home-page example gallery;
- the test-corpus downloader/cache;
- E2E fixture setup;
- workflow buttons;
- expected result assertions;
- agent eval tasks;
- attribution and source links.

## Storage tiers

### Generated tier

Tiny deterministic fixtures generated on demand in CI. Exact shapes, values, masks, calibration, tile boundaries, and expected results are known.

### Bundled demo tier

Small redistributable real or derived subsets stored as static application assets only after exact license verification, attribution, integrity pinning, and size review.

### Hosted demo tier

Larger assets hosted under project control and fetched on demand. Must support CORS and Range where appropriate. Pin SHA-256 and immutable URLs.

### External/scheduled tier

Large source datasets downloaded manually or in scheduled tests. Never required for normal app startup or normal PR CI.

## Minimum diverse demo library

Aim for at least twelve useful scenarios over time:

1. Generated calibrated particles with known counts and touching objects.
2. Noisy/low-contrast SEM segmentation challenge.
3. Real SEM indentation with a ground-truth mask.
4. Real SEM polymer/plastisphere surface.
5. TEM nanoparticles with instance/semantic labels.
6. SEM metal-carbide or additive-manufacturing phases with masks.
7. AFM/GSF height field with leveling and roughness workflow.
8. MRC/FIB-SEM calibrated volume with stack navigation/projection.
9. Electron diffraction/CBF or detector frame with radial profile.
10. HRTEM image with FFT/d-spacing workflow.
11. Hyperspectral ENVI cube with band ratio and spectrum inspection.
12. Aperio/whole-slide pyramid proving range-backed multiresolution analysis.

Later candidates:

- DM4/SBF-SEM volume;
- 4D-STEM diffraction stack;
- EDS maps and line scan;
- registered before/after or drift stack.

## Licensing rules

- Keep every external entry disabled or candidate until exact selected files and license are verified.
- Record landing page, exact immutable download URL, selected file path, file size, SHA-256, license ID, license URL, attribution, citation, and verification date.
- Do not infer that a repository’s code license covers its data.
- Do not enable non-commercial data in a product demo without a deliberate product decision.
- Preserve attribution in the gallery and exported project.
- External archives must be protected against traversal, decompression bombs, file-count limits, and unexpected symlinks.

## Workflow examples

Each enabled scenario should ship with one or more buttons such as:

- Count precipitates;
- Separate touching particles;
- Measure particle-size distribution;
- Compare segmentation to ground truth;
- Remove SEM background and find edges;
- Compute FFT and radial profile;
- Measure AFM roughness after leveling;
- Align stack and plot drift;
- Navigate a calibrated volume;
- Select a pyramid level and count objects.

The workflow is a validated recipe or sandboxed script and can be opened in the pipeline or Script Studio.

## Correctness levels

- Exact: integer labels, counts, dimensions, hashes, masks.
- Tolerance: floating measurements, interpolation, FFT, registration.
- Structural: metadata presence, units, axes, source identity, range behavior.
- Product: visible overlays, linked selections, project replay, error recovery.
- Performance: bytes fetched, peak managed memory, first useful tile, cancellation latency.

## Current candidates worth expanding

The existing manifest already includes useful generated, NIST, Zenodo, EMPIAR, OpenSlide, and future DM4 candidates. Add candidates only after verifying exact records. Strong areas to search include:

- NIST SEM detection-limit/noise datasets;
- Zenodo SEM indentation images and masks;
- TEM nanoparticle images with segmentation labels;
- additive-manufacturing SEM phase/defect masks;
- EMPIAR CC0 FIB-SEM and SBF-SEM volumes;
- EMPIAR DM4 and scanning electron-diffraction data;
- OpenSlide CC0 Aperio test data;
- data papers containing SEM/TEM plus EDS/diffraction companion imagery.

No candidate becomes an enabled app example merely because its landing page is public.

## Runtime delivery contract

Generated fixtures resolve to semantic sample locators, never repository-relative paths. Bundled
assets must use application-owned immutable paths. Downloaded assets require exact HTTPS URL, byte
size, SHA-256, and a verified cache key. Range-backed assets are opened through the imaging
runtime's bounded Range source and are explicitly refused by the full-file downloader.

The shared delivery layer reports progress, accepts cancellation, caps retries and bytes, verifies
cache hits before reuse, evicts corruption, and provides an offline-only mode. Archive decoders are
injected behind a validation boundary; the complete member directory is checked for traversal,
symlinks, duplicates, file count, member size, expanded bytes, and compression ratio before any
member is materialized.

Normal CI exercises only generated/bundled data. Controlled scheduled jobs may resolve external
records after manifest verification; public servers are never an implicit PR gate.

## Scenario correctness artifacts

`scenarioTestArtifacts()` is the only Playwright-facing projection of enabled scenarios. It emits
validated, immutable fixture locators, semantic workflow steps, oracle identities and tolerances,
resource budgets, screenshot states, accessibility/replay flags, agent-eval case IDs, and declared
capabilities. Browser tests do not parse an additional YAML dialect or restate gallery metadata.

Generated sources have a reviewed reference file at `packages/test-corpus/expected/generated-v1.json`.
It records the independent analytic implementation/version, calibration, dimensions, representative
quantitative samples, and tolerance. CI reads this file and compares it with production fixture output;
it never rewrites the reference. Algorithm-specific unit/reference tests remain the numerical oracle
for segmentation, FFT, registration, AFM, and batch behavior. Screenshots cover presentation only.

Scenario execution tiers are `pr`, `main`, `nightly`, `scheduled`, `manual`, and `local-expensive`.
The PR tier is offline and bounded. Scheduled external scenarios may declare future capability
coverage, but remain non-runnable until their exact-file, license, integrity, and delivery gates pass.
