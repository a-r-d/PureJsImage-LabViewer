# Particle-analysis corpus

This directory is the canonical fixture-level corpus for particle-analysis evaluation. It is
separate from the product example gallery: these files test scientific behavior and are not
automatically exposed as application examples.

The checked-in `0.2.0` core contains 41 unique assets (18,703,137 bytes): sixteen deterministic
native BBBC039 16-bit TIFF/instance-mask pairs, two BBBC039 preview pairs, one BBBC005
in-focus/out-of-focus/semantic-mask trio, and two unlabeled asbestos smoke images. The native
BBBC039 subset follows the source's published partitions with eight training, four validation, and
four held-out test fields. These upstream masks are useful independent annotations but are not
locally adjudicated gold. The asbestos images still require reviewed masks and ignore regions.

`manifest.v1.json` is strict and fail-closed. It records rights evidence, attribution, exact
downloads, source and local SHA-256, dimensions, calibration, label roles, edge policy, derivation,
review state, split, domain group, and failure modes. Core or extended sources must explicitly
permit commercial use, redistribution, and derivatives. EMPS remains quarantined; BAM, BBBC004,
and BBBC020 remain excluded.

Default edge policy:

- retain partial border objects in segmentation masks and inclusive counts;
- exclude partial border objects from default morphology and size distributions;
- report inclusive and exclusive counts separately;
- exclude ambiguous pixels, text, scale bars, panel dividers, and impossible contacts through an
  explicit ignore mask once reviewed.

Commands from the repository root:

```text
pnpm corpus:verify:particles
pnpm test:particle-corpus
pnpm corpus:report:particles -- --output .local/particle-corpus
pnpm corpus:fetch:particles -- --source bbbc039
pnpm corpus:fetch:particles -- --source dryad-hrtem-nanoparticles --extended
pnpm corpus:select:particles -- features.json selection.json
pnpm corpus:benchmark:bbbc039 -- --split validation --output .local/bbbc039-validation.json
pnpm corpus:benchmark:bbbc039 -- --split test --allow-test --reference-only --output .local/bbbc039-test.json
```

Fetching is always explicit. Blocked sources cannot download; extended sources additionally need
`--extended`; every downloadable file needs an exact HTTPS URL and SHA-256. Downloads go outside
the repository by default and are never required by normal tests.

The BBBC039 benchmark never opens the held-out test split without `--allow-test`. Exploratory grids
report a Pareto front across count error, instance F1, mask IoU, and boundary F1; their F1-sorted
view is descriptive and is not an automatic improvement decision. Use `--reference-only` for the
three frozen before/guard/watershed profiles.
