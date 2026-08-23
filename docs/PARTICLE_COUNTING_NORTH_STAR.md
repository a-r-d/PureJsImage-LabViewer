# Particle Counting North Star

## Outcome

A scientist can ask once to count and measure particles, see a bounded and inspectable result, and
ask for a correction without the agent trading an undercount for an unexplained overcount. The
system must distinguish three claims:

1. the workflow executed;
2. the segmentation improved against visible and quantitative evidence;
3. the count is validated against an independent oracle.

Only benchmark scenarios with an instance mask support the third claim. Quality diagnostics and a
model-visible preview support a provisional reliability assessment, not ground truth.

## Benchmark pyramid

### Tier 1: generated exact-oracle corpus in every pull request

The deterministic suite in
`packages/materials-analysis/tests/particle-pipeline-benchmark.test.ts` reconstructs grayscale
planes and independent instance masks from fixed seeds. It currently covers ten high-density cases
with more than 900 particles across light/dark polarity, density, background gradient, texture, and
noise, plus a 120-particle dim/gradient refinement case. Unlike the older measurement fixtures, the
benchmark runs the actual grayscale threshold, cleanup, component labeling, filtering, and
measurement path.

Required gates:

- per-scenario count error and aggregate count error;
- object precision/recall at an explicit IoU threshold;
- merge and split rates;
- foreground mask IoU;
- calibrated size error where calibration is known;
- deterministic repeat equality;
- time, memory, cancellation, and maximum-object admission.

The checked-in gate now measures count, one-to-one instance precision/recall/F1, merge/split rate,
mask IoU, boundary F1, deterministic retained-byte estimates, and runtime across the full generated
suite. Area, equivalent-diameter, aspect-ratio, orientation, centroid, ignore-mask, and edge-policy
metrics are covered by focused evaluator tests. This closes the original metric-infrastructure gap;
it does not turn generated data or upstream preview masks into a complete algorithm qualification.

### Tier 2: curated real images with adjudicated masks

Add real SEM/TEM powder and particle fields only after the corpus manifest records the exact file,
immutable source, license, checksum, redistribution status, calibration, and annotation protocol.
Each field needs two independent annotations plus adjudication of edge objects, agglomerates,
satellites, pores, scale bars, and ambiguous boundaries. Do not use a visual estimate or the current
algorithm output as ground truth.

Target strata:

- 25–100, 100–500, and 500+ visible objects;
- isolated, touching, agglomerated, irregular, porous, and satellite-rich particles;
- uniform and strongly shaded fields;
- low contrast, charging, texture, debris, scale bars, and cropped edge objects;
- calibrated and explicitly uncalibrated images from multiple instruments and laboratories.

The fixture-level foundation now lives at
`packages/materials-analysis/testdata/corpus/manifest.v1.json`. Corpus `0.3.0` checks in 41 unique
assets (18,703,137 bytes): sixteen deterministic native BBBC039 16-bit TIFF/instance-mask pairs,
two BBBC039 preview pairs, the BBBC005 focus-control trio, a NIST asbestos montage, and a USGS
anthophyllite SEM. BBBC039 remains `upstream-unreviewed`, not locally adjudicated gold; the asbestos
files remain `smoke-test-only`. The official metadata for all four NIST lipid-nanoparticle archives
is now checksum- and size-pinned. Explicit fetch and bounded preparation produce all 38 calibrated
image/semantic-mask pairs in an external cache; they are not instance masks or adjudicated gold.
See `docs/PARTICLE_ANALYSIS_NIST_LNP_EVAL.md` for the first condition-level evidence.

Core source definitions cover NIST lipid nanoparticle cryoEM, BBBC039, BBBC005, the two asbestos
smoke sources, and NIST SEM detection-limit controls. Dryad HRTEM nanoparticles, RODARE carbide SEM,
concrete cracks, DeepParticle, kaolin masks, and directional-reflectance grains are opt-in extended
sources. EMPS is quarantined pending a per-image permission chain. BAM CC BY-NC-ND, BBBC004, and
BBBC020 are excluded.

### Corpus policy and selection

The manifest fails on unknown keys and records source title/authors, landing page, license evidence,
attribution, commercial-use/redistribution/derivative rights, access date, exact downloads, and
checksums. A fixture records original and local identity, native/derived format, dimensions, bit
depth, calibration, instance/semantic/ignore masks, both border counts, transforms, review state,
tasks, failure modes, split, domain group, and exact source selection. Review states are
`upstream-unreviewed`, `reviewed`, `adjudicated-gold`, `weak-label`, and `smoke-test-only`.

Partial border objects remain in masks and inclusive counts but are excluded from default
morphometry and size distributions. Reports expose both counts. Ambiguous pixels, text, scale bars,
panel separators, and unresolved contacts belong in an ignore mask. Gold counting fixtures require
an instance mask, ignore mask, and reviewer evidence.

`computeParticleCorpusFeatures` calculates object count, foreground fraction, area quantiles and
variation, edge fraction, near-touching graph density at 1/2/4 pixels, eccentricity, solidity,
perimeter-to-area, illumination gradient, boundary contrast, focus, estimated SNR, bit depth, and
channel count. `selectParticleCorpusHardCases` deterministically retains a multivariate median,
every feature minimum/maximum, and cluster medoids; every selection carries its reasons.
When a source-specific fixture budget is supplied, the selector retains the median and medoids,
then greedily maximizes coverage of the remaining extreme reasons with stable ID tie-breaking.
BBBC039 applies that policy independently to the published partitions, freezing eight training,
four validation, and four held-out test fields so later tuning cannot change the test composition.

### Corpus commands

```text
pnpm corpus:verify:particles
pnpm test:particle-corpus
pnpm corpus:report:particles -- --output .local/particle-corpus
pnpm corpus:fetch:particles -- --source bbbc039
pnpm corpus:fetch:particles -- --source dryad-hrtem-nanoparticles --extended
pnpm corpus:select:particles -- features.json selection.json
pnpm corpus:benchmark:bbbc039 -- --split validation --output .local/bbbc039-validation.json
pnpm corpus:prepare:nist-lnp -- --cache <external-cache>
pnpm corpus:benchmark:nist-lnp -- --inventory <inventory.v1.json> --condition s404-ph4-no-rna --output <report.json>
```

Verification and normal tests perform no network access. Fetching is explicit, refuses blocked or
checksum-incomplete records, requires `--extended` for extended sources, and caches outside the
repository. The report emits JSON and Markdown with exact settings, before/after refinement,
inclusive/exclusive count error, instance precision/recall/F1, merge/split, mask IoU/Dice, boundary
F1, centroid and morphology biases, foreground error, runtime, and managed-memory estimate.

The current BBBC039 evidence and its leakage/qualification limits are frozen in
`docs/PARTICLE_ANALYSIS_BBBC039_EVAL.md`. The particle workflow now exposes a low-information ROI
guard and a watershed minimum-peak-height control. Both are explicit, schema-validated settings and
are retained in Agent diagnostics; no specimen-dependent watershed scale is silently applied. The
guard defaults to disabled because NIST cryo-EM training evidence shows that the BBBC039-selected
`0.1` threshold rejects valid low-contrast fields. Specimen profiles must opt in explicitly.

The trusted operation catalog now also contains an explicit multiscale local-contrast
particle-likelihood primitive with declared inner/outer pixel radii and light, dark, or absolute
response. The first frozen NIST train/validation/transfer evaluation improves semantic overlap over
the prior global-threshold baseline but remains condition-dependent and weak on boundaries. It is a
building block, not a promoted default or a count oracle; see `docs/PARTICLE_ANALYSIS_NIST_LNP_EVAL.md`.

### Tier 3: local live-agent evals

Live evals use a small representative subset because they are paid and nondeterministic. They grade
the action sequence and visible outcome, not the numerical algorithm in isolation:

- one-prompt count, measure, preview, diagnostics, units, and limitation;
- a realistic two-turn “it is undercounted” correction;
- touching-particle baseline versus watershed refinement;
- concise final answers and bounded evidence;
- no raw tables, credentials, hidden reasoning, or unsupported reliability claims.

Run repeated trials and report pass@1, action failures, count oracle failures, response length,
latency, and known cost. Normal CI continues to use fake transports only.

## Refinement contract

The model chooses the scientific patch. The host does not infer “undercounted” with keywords or
silently search parameters. A refinement must instead receive:

- the prior count, settings, result identity, diagnostics, and preview;
- the proposed small settings patch and a valid dry-run identity;
- one approved execution;
- the new count, settings, diagnostics, and a fresh preview;
- an explicit conclusion: improved, regressed, or ambiguous.

A count delta is descriptive. It is never, by itself, an improvement score. The agent should stop
when evidence is adequate, revert or propose one further bounded change when it regresses, and ask
for user adjudication when the image remains ambiguous.

## User experience contract

- Default final answers are at most 180 words unless the user asks for detail.
- Put result, evidence, and limitations first; keep action traces collapsed.
- Fold unusually long responses behind “Show full response” without discarding copyable content.
- Let the Agent surface expand over the workbench and exit with Escape.
- Let the Results area collapse to its header so the viewport and Agent gain vertical space.
- Preserve the conversation, approvals, result links, and viewport selection across layout changes.

## Release gates

Do not describe particle counting as broadly validated until all of these are true:

1. the generated exact-oracle suite includes the full metric set and passes on supported browsers;
2. at least 30 adjudicated real fields span the strata above, including ten 500+ object fields;
3. count error, precision/recall, merge/split, mask IoU, and size-error thresholds are selected with
   scientists and reported per stratum rather than only as one aggregate;
4. the realistic follow-up live eval meets its agreed pass@1 target on every supported model;
5. five independent scientists complete initial and refinement workflows without hidden operator
   intervention, and manual corrections are recorded.

Until then, the product should say that it provides a reproducible bounded workflow with
inspectable provisional diagnostics, not a universal particle-count guarantee.
