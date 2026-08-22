# NIST lipid-nanoparticle cryo-EM evaluation

## Scope and claim boundary

The NIST source record `mds2-2753` contains 38 calibrated 4096 × 4096 cryo-EM images and
manually supplied binary semantic masks across four preparation conditions. The official metadata
pins all four archives by SHA-256 and byte size. The corpus fetcher verifies those identities before
promotion, and the preparation command validates the complete ZIP directory, member CRCs, expansion
budgets, TIFF dimensions, bit depth, and mask values.

The upstream masks contain particle/non-particle pixels, not independent instance identities. They
support semantic mask IoU/Dice, boundary F1, and foreground-fraction error. They do not support
instance precision/recall, merge/split rates, count-oracle error, or particle morphometry claims.
Those claims still require local instance annotation, ignore masks, and adjudication.

The prepared corpus remains in the explicit external cache. Its approximately 1.12 GB of pinned
archives and 1.8 GB of extracted TIFFs are not committed to Git.

## Reproduction

```text
pnpm corpus:fetch:particles -- --source nist-lnp-cryoem --cache <cache>
pnpm corpus:prepare:nist-lnp -- --cache <cache>
pnpm corpus:benchmark:nist-lnp -- \
  --inventory <cache>/nist-lnp-cryoem/prepared-v1/inventory.v1.json \
  --condition s404-ph4-no-rna \
  --profile particle-default-light \
  --profile bbbc039-guarded-light \
  --profile cryoem-yen-dark \
  --output <report.json>
```

Preparation freezes 8 S404 pH 4/no-RNA pairs, 9 S405 pH 7.4/no-RNA pairs, 10 S406 pH 4/RNA
pairs, and 11 S407 pH 7.4/RNA pairs. S406 and S407 use `_Fra.tif` image names and
`_Fractions_manual_mask.tif` mask names; the importer pairs them by exact acquisition stem and
retains both original names.

## Initial S404 training evidence

The first complete report is exploratory training evidence only. Validation and RNA conditions
were not used to choose a profile.

| Profile | Fields | Macro mask IoU | Macro Dice | Macro boundary F1 | Mean absolute foreground-fraction error |
| --- | ---: | ---: | ---: | ---: | ---: |
| unguarded product default, Otsu/light | 8 | 0.0199 | 0.0382 | 0.0153 | 0.3693 |
| BBBC039 guard `0.1`, Otsu/light | 8 | 0.1250 | 0.1250 | 0.1250 | 0.1301 |
| exploratory Yen/dark | 8 | 0.0867 | 0.1439 | 0.0155 | 0.4215 |

The guarded aggregate is misleading if read without per-field evidence. It rejects seven of eight
fields as empty, including all six positive fields and one true blank field. The other blank field
has coefficient of variation `0.1145`, is not rejected, and is segmented incorrectly. The six
positive fields have coefficients of variation from `0.0275` to `0.0601`. Therefore the
BBBC039-selected `0.1` guard is neither sensitive nor specific for this cryo-EM condition.

The unguarded global thresholds execute but substantially over-segment the faint ring-like
particles. Exploratory local-mean and Sobel/closing profiles on the first training field did not
beat the best global mask IoU, so none is promoted as a NIST profile.

## Resulting product decisions

- The general particle-workflow default keeps the low-information guard disabled (`0`). A user,
  recipe, or agent may enable it explicitly for a qualified specimen profile such as BBBC039.
- A higher count or a non-empty mask is not classified as improvement.
- NIST remains semantic, upstream-unreviewed evidence until local instance annotation and ignore
  masks exist.
- The next algorithm tranche needs a reviewed low-contrast particle-likelihood operation or other
  scientifically specified segmentation primitive. More hidden global-threshold tuning is not a
  credible path from these results.

The benchmark report always serializes its label semantics and claim boundary so downstream agent
or report tooling cannot silently upgrade semantic evidence into count validation.
