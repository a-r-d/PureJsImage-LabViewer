# BBBC039 particle-analysis evaluation

## Scope and claim

This report measures the checked-in corpus `0.2.0` against independent upstream BBBC039 instance
masks. It demonstrates a repeatable improvement on selected U2OS fluorescence fields. It does not
establish universal particle-analysis validity, SEM/TEM performance, calibrated morphometry, or
locally adjudicated gold accuracy.

The source archives are checksum-pinned. The deterministic selector operates independently inside
the published BBBC039 partitions and freezes 8 training, 4 validation, and 4 test fields. The 16
selected fields contain 1,179 annotated instances in total, including two blank negative controls.

## Frozen profiles

The common pipeline is Otsu/light thresholding, binary open radius 1, hole filling, 64-pixel minimum
object size, and 8-connectivity.

- `before`: coefficient-of-variation guard disabled; watershed disabled.
- `guard`: rejects finite ROI pixels as background when coefficient of variation is below `0.1`;
  watershed disabled.
- `watershed`: guard `0.1`, distance-peak separation `20 px`, minimum peak height `4 px`.

The guard threshold and watershed parameters were chosen from training and validation. The
watershed values are a named BBBC039 profile, not the application-wide default, because pixel-scale
marker distances are specimen dependent.

## Results

| Split | Profile | Truth | Predicted | Macro instance F1 | Mask IoU | Boundary F1 | Mean absolute count error |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| training | before | 597 | 496 | 0.6793 | 0.7569 | 0.7393 | 20.375 |
| training | guard | 597 | 465 | 0.8043 | 0.8819 | 0.8643 | 16.500 |
| training | watershed | 597 | 526 | 0.8494 | 0.8796 | 0.8634 | 8.875 |
| validation | before | 250 | 219 | 0.6043 | 0.6792 | 0.6849 | 18.250 |
| validation | guard | 250 | 198 | 0.8543 | 0.9292 | 0.9349 | 13.000 |
| validation | watershed | 250 | 221 | 0.9361 | 0.9284 | 0.9360 | 7.250 |
| test | before | 332 | 232 | 0.6630 | 0.8910 | 0.8810 | 25.000 |
| test | guard | 332 | 232 | 0.6630 | 0.8910 | 0.8810 | 25.000 |
| test | watershed | 332 | 266 | 0.7641 | 0.8862 | 0.8714 | 17.000 |

The guard improvement comes entirely from correctly suppressing the two selected blank fields; it
does not change nonblank fields. On held-out nonblank fields it is exactly neutral. The watershed
profile reduces touching-object undercount and improves instance F1 while slightly reducing mask
and boundary overlap, so all metrics remain visible rather than collapsing the result into one
score.

## Reproduction

```text
pnpm corpus:verify:particles
pnpm test:particle-corpus
pnpm corpus:benchmark:bbbc039 -- --split train --output .local/bbbc039-train.json
pnpm corpus:benchmark:bbbc039 -- --split validation --output .local/bbbc039-validation.json
pnpm corpus:benchmark:bbbc039 -- --split test --allow-test --reference-only --output .local/bbbc039-test.json
```

The benchmark's F1 ordering is descriptive. Its Pareto front includes count error, instance F1,
mask IoU, and boundary F1. A higher count is never classified as improvement by itself.

## Limitations and leakage note

This was an exploratory tranche. The held-out fields were first opened after the blank-field guard,
then reopened after the separately training/validation-selected watershed change. The test metrics
therefore provide useful regression evidence but are not a pristine one-shot release estimate.
Future qualification needs untouched fields from another source, at least 30 locally adjudicated
real fields across the North Star strata, scientist-selected acceptance thresholds, repeated live
agent evals, and independent user studies.
