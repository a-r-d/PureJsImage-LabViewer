# Changelog

All notable changes to Materials Workbench are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The application is not yet versioned for release (`0.0.0`).

## [Unreleased]

### Added

- CDC PHIL 6486 *Staphylococcus aureus* SEM JPEG as an enabled bundled analysis example. The
  workbench opens the original 2100 × 1630 public-domain JPEG (not a GSF derivative) with a
  reviewed bright-object threshold/components starting point.
- Imaging Worker codec-adapter plane cache. JPEG, PNG, WebP, BMP, and JP2 readers that only
  decode origin-relative bands now serve viewport tiles and analysis plane reads from one
  origin-decoded plane.
- Particle-count headline and completion copy when an objects table is present.

### Changed

- Particle analysis defaults to watershed off and a 64-pixel minimum object size, with
  human-readable plan estimates and an explicit plan-before-run note.
- ROI tool buttons use title-case labels. Bundled and generated sources read as "example" and
  "generated" instead of raw locator kinds.
- Empty inspector tabs and the agent panel use more specific first-use copy. Example-gallery
  Clear filters is disabled when no filters are set.

### Fixed

- Interior tiles and connected-components on scientific JPEG (and the other codec adapters)
  no longer fail after the first origin band.
- Icon buttons blur after click so tooltip/focus rings do not linger on the app bar.
