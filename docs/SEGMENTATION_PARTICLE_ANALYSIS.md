# Segmentation and particle-analysis reference

## Scope and public boundary

The particle workflow is an explicit PureJsImage analysis graph:

```text
optional background correction
→ reference threshold
→ explicit binary cleanup nodes
→ optional distance-surface watershed
→ PureJsImage connected components
→ particle filtering and measurement
```

The implementation is the trusted `@pji-workbench/materials-analysis` extension. It uses only
documented `purejsimage/analysis`, `purejsimage/analysis/results`, `purejsimage/analysis/roi`,
`purejsimage/operations`, `purejsimage/scientific`, and `purejsimage/extensions` exports. The guided
surface composes these same versioned nodes; it does not have a privileged analysis path.

## Threshold definitions

The selected plane, component, and area ROI define the threshold population. Declared no-data and
non-finite samples do not contribute to automatic thresholds or the histogram. Histograms use 2 to
4,096 uniform bins spanning the selected finite minimum and maximum. A constant population is
expanded by one intensity unit so it still has a valid histogram.

- **Manual** selects the inclusive `[lower, upper]` interval. Dark polarity selects its complement.
- **Otsu** maximizes between-class variance and returns the selected histogram boundary, following
  [Otsu (1979)](https://doi.org/10.1109/TSMC.1979.4310076).
- **Triangle** selects the histogram location farthest from the line between its peak and longer
  tail, following the threshold procedure associated with
  [Zack, Rogers, and Latt (1977)](https://doi.org/10.1177/25.7.70454).
- **Yen** maximizes the two-class correlation criterion from
  [Yen, Chang, and Chang (1995)](https://doi.org/10.1109/83.366472).
- **Li** uses the convergent one-point minimum-cross-entropy iteration described by
  [Li and Tam (1998)](https://doi.org/10.1016/S0167-8655(98)00057-9), based on
  [Li and Lee (1993)](https://doi.org/10.1016/0031-3203(93)90115-D). Non-positive data are shifted
  during logarithmic iteration and shifted back in the reported threshold.
- **Mean** is the selected finite-sample histogram mean.
- **Sauvola** evaluates `mean * (1 + k * (standardDeviation / dynamicRange - 1))` in a clipped
  square neighborhood, using bounded integral sum, square-sum, and count planes. This follows
  [Sauvola and Pietikäinen (2000)](https://doi.org/10.1016/S0031-3203(99)00055-2).

Light polarity uses samples greater than or equal to the automatic threshold; dark polarity uses
samples less than or equal to it. The no-data policy is explicit: background produces `0`,
foreground produces `1`, and propagate produces `NaN` in the threshold result. Binary consumers
treat non-finite values as background. The preview publishes the exact histogram, selected-field
foreground fraction, and resolved global threshold; adaptive Sauvola reports no single threshold.

Phansalkar is deliberately unsupported in this version. Its behavior is not silently approximated
by Sauvola. Skeletonization is also deferred until it has a separately reviewed topology contract.

## Binary and watershed policies

Erosion and dilation use a Euclidean disk with an integer radius from 1 through 64. Open is erosion
then dilation; close is dilation then erosion. The plane exterior is background. Fill holes floods
four-connected exterior background. Clear-border and remove-small-object connectivity is explicitly
4 or 8. Outline is the one-pixel inner four-neighbor boundary.

The distance transform is the exact separable squared-Euclidean transform followed by square root;
distances are in pixels. Watershed finds deterministic regional distance maxima, suppresses peaks
closer than the requested pixel distance, and performs eight-neighbor max-priority flooding. Local
maximum plateaus use ascending-linear-index tie breaking. Collisions become one-pixel watershed lines removed from the
returned binary mask. This is a marker-based distance-surface specialization of the flooding model
described by [Beucher (1992)](https://digitalcommons.usu.edu/microscopy/vol1992/iss6/28/), not a
general grayscale watershed.

## Particle definitions

Only pixels inside the selected ROI enter measurement. An object is an edge object when it touches
the image boundary or the selected ROI boundary. Filters are applied after measurement in ascending
source-label order:

- area is foreground pixel count;
- centroid and bounding box are pixel coordinates;
- pixel perimeter is the sum of exposed four-neighbor pixel edges;
- calibrated perimeter weights horizontal and vertical exposed edges by their physical spacing;
- equivalent circular diameter is `2 * sqrt(area / pi)`;
- fitted-ellipse axes are four times the square roots of the covariance eigenvalues, including the
  `1/12` second moment of each pixel square;
- pixel and calibrated orientation are the corresponding major-axis angles in radians;
- circularity is `4 * pi * area / perimeter²` using consistently pixel or physical quantities;
- solidity is object area divided by the convex-hull area of its pixel-square row spans;
- intensity minimum, maximum, mean, population standard deviation, and integrated intensity use
  finite samples from the selected source component.

The table reports pixel values and, when the two selected spatial axes have compatible linear units,
physical area, perimeter, equivalent diameter, and ellipse axes. Area fraction uses the selected ROI
area rather than the complete plane. Summary results include object count, area fraction, total area,
mean area, and median area. The size result is a deterministic empirical cumulative distribution;
the UI derives a complete 16-bin histogram and five-number box summary from that bounded result.

Colored labels, binary mask, one-pixel outline, numbers, centroids, and fitted ellipses are alternate
views of the same filtered label output. Annotation tiles are capped at 2,048 objects. Overlay reads
use a one-pixel halo for tile-invariant outlines. Table-row and viewport hit-testing share the exact
integer label, so either selection highlights the other.

CSV rows are ordered by ascending source label unless the user explicitly applies a table sort. CSV
and JSON exports are bounded to 100,000 rows and 16 MiB. A declarative recipe stores the complete
visible graph and an ROI identifier through `analysis.graph.request-execute@1`; execution remains
subject to schema validation, permissions, dry-run resource admission, and user approval.

## Admission, cancellation, and unsupported inputs

All new operations are declared as PureJsImage global transforms. The reference provider refuses:

- planes over 4,194,304 pixels;
- any operation estimate over 384 MiB peak working storage;
- `uint64` sources, because conversion through JavaScript numbers could lose integer precision;
- more than 100,000 particle objects;
- more than 1,000,000 convex-hull input points;
- annotation tiles over 2,048 objects.

Particle planning charges 104 working bytes per plane pixel; watershed charges 56. These conservative
estimates cover typed source/output planes and bounded JavaScript measurement structures. Refusal is
a hard plan failure, not a warning. Global loops, ROI rasterization, morphology floods, distance
passes, watershed, and particle scans all contain cancellation checkpoints. Outputs are owned by the
operation result and released exactly once with that result.

Current scope is scalar 2D planes. There is no 3D connectivity, 3D watershed, subpixel contour
perimeter, intensity-weighted centroid, Feret diameter, texture feature, skeleton, or Phansalkar
threshold. These omissions are explicit so a saved method does not imply unsupported semantics.
