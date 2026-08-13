# Codex prompt 07 — corpus automation and product E2E

```text
Continue in the repository.

Read AGENTS.md, docs/TEST_CORPUS.md, docs/QUALITY_GATES.md, datasets/README.md, and datasets/corpus.yaml. Inspect current fixtures/tests. Preserve changes. Do not commit, push, publish, deploy, or download candidate datasets before their manifest requirements are satisfied.

Automate the scientific corpus and convert the main product workflows into deterministic end-to-end specifications.

## Corpus package

In packages/test-corpus implement:

- schema/validator/normalizer for corpus.yaml;
- license policy validation;
- integrity validation;
- resolved lock-file format;
- safe downloader;
- safe archive extraction;
- selection/subset resolution;
- cache management;
- attribution output;
- test metadata API.

Reject:

- candidate/disabled entries in normal fetch;
- unknown/missing license;
- missing integrity for direct files;
- checksum mismatch;
- non-HTTPS URL except localhost tests;
- path traversal/symlinks escaping cache;
- excessive archive files/bytes/depth;
- redirect to disallowed scheme/host policy;
- decompression bombs.

Do not commit downloaded corpus data.

## Generated fixtures

Implement deterministic Tier 0 generators for:

- calibrated particles and touching objects;
- anisotropic spacing;
- fibers/ellipses/orientation;
- gradient/noise/contrast variants;
- small volume with exact orthogonal slices;
- small multilevel whole-slide fixture with associated images;
- GSF, MRC, CBF, ENVI, FITS, OME-TIFF fixtures as supported by public APIs/test tooling;
- malformed/truncated/hostile variants.

Generate semantic goldens and SHA-256 manifests.

## Range-aware fixture server

Create a test server with:

- HTTP Range support;
- ETag/Last-Modified modes;
- request/range/byte log;
- latency and bandwidth simulation;
- disconnect/truncation/errors;
- CORS modes;
- cancellation visibility;
- reset/query test endpoints available only in test process.

## Enable compact real corpus carefully

Review candidate entries. Enable only entries for which the implementation can pin:

- exact selected file URLs;
- exact license/attribution;
- exact SHA-256;
- expected bytes;
- bounded extraction selection.

Prefer a small curated subset of the indentation and/or plastisphere datasets rather than pulling multi-gigabyte archives in every CI run.

If safe selective acquisition is not practical, leave the entry candidate and document the exact unresolved step. Do not weaken policy.

Add scheduled manifest support for EMPIAR entries but do not require large downloads in normal CI.

## E2E specifications

Implement Playwright projects/fixtures that automate:

1. first-run sample workflow;
2. local scientific file open;
3. remote range open with byte budget;
4. metadata/calibration/axis selection;
5. pan/zoom/level/component/display range;
6. ROI statistics and line profile;
7. threshold preview/commit;
8. connected components, label/table linking, distribution/export;
9. save/reload/rebind/replay;
10. mocked agent proposal/approval/execution;
11. recipe install and execution;
12. cancellation at source, tile, analysis, model stages;
13. corrupted/unsupported/limit-exceeded errors;
14. Worker crash and recovery;
15. keyboard-only workflow;
16. accessibility and visual baselines;
17. no credentials in project/history/export.

Use Page Objects or focused domain fixtures only when they reduce duplication without hiding behavior.

## Correctness assertions

Prefer semantic assertions:

- source/dataset identity;
- axes/units/calibration;
- ROI geometry;
- operation graph and parameters;
- object count/selected rows under tolerance;
- result units;
- range bytes/requests;
- project replay identity;
- viewport selected layer/ROI/result.

Screenshots supplement, not replace, semantic correctness.

## Reporting

Generate deterministic machine-readable reports:

- corpus acquisition/license status;
- reader/workflow coverage matrix;
- browser results;
- range budgets;
- performance metrics;
- visual diff references;
- attribution bundle.

## Verification

Run generated corpus, enabled compact corpus, all browser projects, accessibility, visual, project/agent/plugin workflows, build, and pnpm check.

Report:

- enabled/candidate corpus entries and reasons;
- download/cache sizes;
- license/integrity results;
- E2E matrix;
- range budget numbers;
- browser results;
- report artifact paths;
- git diff --stat;
- remaining corpus gap.

Do not commit or push.
```
