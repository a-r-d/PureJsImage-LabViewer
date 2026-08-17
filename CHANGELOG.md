# Changelog

All notable changes to Materials Workbench are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The application is not yet versioned for release (`0.0.0`).

## [Unreleased]

### Changed

- The generated calibrated particle field is ten isolated disks on the sinusoidal
  SEM-style background, not 1-pixel modulo speckles. The gallery card and the
  default particle-count workflow now describe the same image.
- The batch particle fixture is a mirrored copy of those same disks, not another
  1-pixel speckle field. Opening the touching-particle example turns Watershed on
  so the advertised split is the default.
- The calibrated particle background wave is weak enough that default Otsu
  thresholding separates the ten disks. The previous strong checkerboard made
  Otsu split the illumination, then Edge exclude dropped every object.
- ROI inspector measurements are labeled Area / Perimeter / Centroid rows with pixel and
  physical units instead of a single run-on line.
- Selecting an area ROI now targets particle analysis to that region and includes
  edge-touching objects, so a drawn box no longer silently counts zero.
- Statistics headlines say "1 result" instead of "analysis outputs". Viewport physical
  coordinates use two decimal places.
- FFT plan summaries show peak memory and compute time instead of a raw JSON identity dump.
- Line profile after an FFT (or any multi-output analysis) measures the source again instead
  of crashing, and the Line Profile tab shows the distance/value series.
- FFT results headline is "N peaks". The inverse-FFT disclaimer no longer cites PureJsImage
  0.10.0.
- Switching to a derived analysis plane (FFT magnitude, leveled AFM surface) re-runs display
  auto-range, so leftover source 0–255 mapping no longer crushes log1p spectra to black.
  A singleton top histogram bin (DC or a hot pixel) is excluded from that stretch so
  lattice spots stay visible.
- FFT viewport labels skip the DC/beam-center peak, use d-spacing, and keep one label per
  distinct spacing so conjugate spots do not stack the same text.
- Line-profile and other series results hide the coarse 16-sample bar preview when the real
  polyline is already shown.
- AFM height profiles default to the current plane or selected rectangle instead of a
  hardcoded 0–255 corner. Results lead with Rq/Ra/Rz instead of a raw JSON dump.

- Dark and light themes use a sharper instrument palette: deeper canvas, more distinct
  chrome surfaces, and a teal-cyan accent instead of washed sky blue. Scientific ROI
  overlays stay a cooler blue so they remain readable on grayscale micrographs.
- Essential chrome type (status bar, navigator groups, viewport breadcrumb) is 11 px.
  Selected navigator rows and mode-rail tools have a clearer inset accent.
- Linux Chromium visual goldens were updated after inspecting the diffs: the layout is
  unchanged; only the new palette and chrome highlights differ. Darwin goldens were not
  regenerated on this host.

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
