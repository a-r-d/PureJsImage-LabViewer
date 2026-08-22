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

The initial checked-in gate establishes count coverage and a controlled undercount-to-improvement
case. Precision/recall, merge/split, mask IoU, and performance budgets remain required before this
suite can be called a complete algorithm qualification.

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
