# Materials analysis workflow

The first complete workbench workflow measures a region of interest (ROI), previews and commits a
threshold, and turns the mask into a calibrated object table. Source pixels remain local and
quantitative analysis always uses the source dataset, never its display range.

## Draw and measure an ROI

1. Open a scientific image and choose **ROI** in the Inspector.
2. Choose Point, Line, Polyline, Rectangle, Ellipse, or Polygon. Drag in the viewport to create the
   ROI. The stored coordinates are identified explicitly as pixel coordinates; calibrated values
   are derived by PureJsImage from the dataset axes.
3. Use Select to choose a handle. Handles remain a constant screen size while zooming. Press
   **Escape** to cancel an in-progress draw or **Delete** to remove the selected ROI.
4. Rename or hide an ROI in the ROI list. Hidden ROIs remain in the project but are not rendered.
5. Choose Statistics, Histogram, or Line profile. Line profile requires a line or polyline ROI.
   Results are bounded summaries and may be pinned into the project. Export is performed only from
   the explicit CSV or JSON buttons.

If calibration is unavailable, the workflow continues in pixels and reports pixel units. It never
invents physical units.

## Threshold and connected components

1. Choose **Analysis** in the Inspector.
2. Set the comparison and threshold for the currently selected component. **Preview** creates a
   temporary, debounced label layer. Moving the value cancels and releases a stale preview. Preview
   changes do not enter project history.
3. Review the dry-run peak-memory, compute-time, and output-size estimates. An unresolved estimate
   is shown as unresolved rather than guessed.
4. Choose **Apply threshold** to create one immutable graph revision, or **Cancel preview** to
   discard the temporary result.
5. Choose 4- or 8-connectivity and run connected components. Validation and planning complete
   before project state changes. A failure leaves the previously committed project intact.
6. The Results panel shows the label overlay and a 50-row page of the object table. Column sort and
   numeric filtering run in the imaging Worker. Selecting a row highlights the matching viewport
   label. The table includes pixel measurements and physical measurements when calibration supports
   them.
7. Export the current page or all filtered rows as CSV/JSON through the deliberate export buttons.
   All-row export requests 200 rows per Worker message; no complete table crosses the RPC boundary.

## Pipeline and lifecycle

The Pipeline tab shows operation title, version, and normalized parameters in execution order.
Editing or replacing the graph creates a semantic project revision and the runtime reconciler
cancels obsolete work. Results and lazy datasets are opaque handles: closing a dataset or replacing
an execution releases the result, then its prepared plan, then the tile runtime.

Morphology, watershed segmentation, and FFT analysis are not in the installed PureJsImage 0.10.0
built-in catalog. They remain future operations and are not approximated in the application.

