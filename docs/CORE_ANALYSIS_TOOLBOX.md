# Core analysis toolbox

## Public PureJsImage inventory

This inventory was verified against the public exports of the pinned `purejsimage@0.10.0` package. The scientific analysis registry exposes eleven operations:

1. select resolution level;
2. crop;
3. resample;
4. slice;
5. projection;
6. threshold;
7. Gaussian blur;
8. statistics;
9. histogram;
10. line profile;
11. connected components.

The separate public image-operation registry also contains image crop, resize, right-angle rotation, flip/flop, window/LUT, and encoding operations. Those consume `purejsimage.image`, not the scientific-dataset value used by the workbench, so adapting them would hide a value-model conversion. The workbench therefore reuses the seven applicable scientific operations directly and does not convert scientific inputs into display images.

## Trusted materials extension

`packages/materials-analysis` is a trusted in-process PureJsImage extension composed into the existing analysis controller. It imports only public `purejsimage/analysis`, `purejsimage/extensions`, `purejsimage/operations`, and `purejsimage/scientific` exports. It adds right-angle rotate, X/Y flip, translation, explicit numeric conversion, normalize, clamp, invert, gamma/log/square-root, constant arithmetic, compatible-dataset arithmetic, box/rank/convolution/unsharp/gradient/Laplacian/outlier filters, and bounded local-mean background subtraction.

Every extension operation has a namespaced semantic ID and version, closed parameter schema with normalization, scientific-dataset ports, output inference, reproducibility tolerance, reference-provider provenance, and a bounded cost estimate. Point operations read only the requested output tile. Neighborhood operations read the requested tile plus an explicitly limited halo. Geometry maps each requested output rectangle back to its minimum source rectangle. Cancellation is checked at every row or bounded loop checkpoint. No operation retains a complete source plane.

No-data is propagated by default. Filters that offer `ignore` explicitly renormalize over finite samples. Boundaries are explicit (`clamp`, `mirror`, or constant); operations with a fixed policy say so in the catalog. Quantitative operations produce floating-point datasets unless an explicit conversion operation chooses another storage type. Calibration is preserved, swapped, or reversed according to geometry rather than silently discarded.

## Product integration and limits

The operation browser uses the controller descriptors for categories, title/description/tag search, schema-driven controls, availability, recent/favorite preferences, preview, Apply, Cancel, Reset, documentation, estimates, and presets. The command palette lists the same descriptors. Execution continues to use the shared semantic analysis action and Worker host; there is no privileged UI-only path.

Preview results are retained only behind a cancellable result handle and rendered through bounded derived-dataset tile requests. Apply records one normalized graph revision. File calibration remains in the dataset reference; manual or known-line corrections are separate revisioned project overrides with anisotropic X/Y spacing and supported unit conversion.

CSV/JSON result export is limited to 100,000 rows and 16 MiB. Profile and histogram exports use a bounded Worker RPC rather than serializing live result objects. PNG export captures the rendered viewport and therefore has an explicit display mapping; it never changes or uploads source samples. Project and recipe graphs continue through existing bounded persistence.

## Upstream gaps and deliberately unsupported scope

The following broadly reusable scientific primitives are not in the pinned public scientific registry and remain candidates for PureJsImage rather than copied private cores:

- width-averaged line profiles;
- calibrated Feret diameters and solidity in connected-component results (the public result currently includes area, perimeter, centroid, equivalent circular diameter, major/minor axes, aspect ratio, orientation, and circularity);
- a public multi-dataset binding workflow for end-user image-calculator selection;
- an adapter, if desired upstream, between public image operations and scientific datasets with explicit quantitative/calibration semantics.

The image calculator provider is implemented and deterministic, but the browser marks it unavailable until the project has a clean second compatible dataset binding. Morphology, watershed, FFT, AFM leveling, batch execution, and the AI agent are intentionally outside Prompt 7.
