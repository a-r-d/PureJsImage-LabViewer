# Workbench UX and visual system V2

## Design posture

The app should feel like a modern scientific instrument:

- dark, calm, precise, and high-information;
- visually subordinate to the specimen;
- dense without using unreadably tiny text;
- immediate and keyboard-friendly;
- explicit about units, source, calibration, and provenance;
- progressive rather than modal-heavy;
- modern web software, not a visual imitation of a 1990s desktop application.

## Immediate corrections

### Typography

- Base UI text: 13 px at roughly 1.4 line-height.
- Secondary metadata: 11–12 px, never 9 px for essential information.
- Numeric readouts: tabular monospace, 11–12 px.
- Panel titles: 13–14 px semibold.
- Use medium weight and spacing before all-caps microcopy; avoid excessive uppercase.

### Layout

Recommended desktop composition:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Brand/source · command/search · project · undo/redo · scripts · AI  │
├────┬───────────────┬───────────────────────────────┬─────────────────┤
│Mode│ Navigator     │ Viewport                      │ Inspector       │
│rail│ source/layers │ floating tools + readouts     │ contextual      │
│    │ ROI/results   │ specimen-first                │ tabs/operation  │
├────┴───────────────┴───────────────────────────────┴─────────────────┤
│ Bottom drawer: pipeline · results · plots · scripts · diagnostics   │
└──────────────────────────────────────────────────────────────────────┘
```

The mode rail provides stable icons for Browse, ROIs, Analyze, Results, Scripts, Examples, and Agent. It should not replace the semantic navigator; it changes the navigator/inspector mode.

### Viewport

- Remove the decorative grid once real data is visible; use a solid neutral canvas.
- Add a subtle inset border/shadow separating the image plane from panels.
- Put pan/zoom/fit/1:1/ROI tools in a compact floating or edge toolbar.
- Keep coordinates, value, zoom, level, and scale in a stable overlay/status strip.
- Make tile loading visible but non-blocking.
- Make overlays use crisp boundaries and opacity controls.
- Provide blink, split, and side-by-side comparison after single-view interactions are stable.

### Color

Suggested semantic palette:

- neutral charcoal/graphite surfaces;
- cool cyan for primary focus/selection;
- violet for analysis/script states;
- green for success/valid results;
- amber for warnings/estimates;
- coral/red for errors/destructive actions.

Use accent color for focus, active selection, and primary actions—not every border. Scientific palettes and label colors remain separate from UI semantic colors.

### Icons

Adopt a tree-shaken general icon package such as Lucide React for common interface actions. Retain a small custom 24×24 scientific icon set for histogram, FFT, particle labels, line profile, threshold, stack, calibration, spectrum, and diffraction.

Rules:

- one 24×24 grid;
- roughly 1.75 px stroke;
- currentColor;
- no emoji;
- every icon button has label and tooltip;
- selected state uses shape/background plus color, not color alone.

### Surfaces

- Operation browser with search, categories, recent, favorites, and workflow presets.
- Parameter forms generated from descriptors but enhanced with domain-aware controls.
- Preview/Apply/Cancel footer fixed within the inspector.
- Result tables virtualized, sortable, filterable, and linked to overlays.
- Plot surface with export and textual summary.
- Script Studio as a first-class bottom/full-height surface.
- Example gallery with thumbnails, modality/vendor/format tags, workflow buttons, and license attribution.
- Agent panel showing plan, approvals, tool trace, links, and result summaries—not only chat bubbles.

## CSS architecture

Move away from one global feature stylesheet:

```text
apps/workbench/src/styles/
  reset.css
  tokens.css
  shell.css
  utilities.css

apps/workbench/src/features/<feature>/<feature>.css
packages/ui/src/components/<component>.css
```

Use CSS layers and tokens. Keep selectors shallow and feature-scoped. Prefer data attributes for states. Avoid runtime-generated class strings that make visual debugging opaque.

## Motion and effects

- 120–160 ms transitions for panel/tool state.
- No unnecessary viewport easing during quantitative cursor work.
- Respect reduced motion.
- Use subtle opacity/transform transitions; avoid large bouncy motion.
- Skeleton/progressive states only when they communicate useful loading structure.
- Use shadows sparingly: dialogs, command palette, floating toolbar, and viewport separation.

## UX quality tests

Automated:

- axe serious/critical violations;
- complete keyboard-only workflows;
- focus order and focus restoration;
- 200 percent browser zoom;
- reduced motion;
- dark and light contrast checks;
- 1280×720, 1440×900, 1920×1080, and narrow desktop layouts;
- no horizontal page overflow;
- panel splitter keyboard use;
- tooltip/accessible-label checks;
- deterministic screenshot matrix;
- layout-shift budget during tile arrival;
- warm interaction latency for pan, zoom, tab switch, ROI drag, and threshold preview.

Human task scripts:

1. Open an example and find pixel calibration.
2. Draw an ROI and measure mean intensity.
3. Count particles and remove edge objects.
4. Open a result row and locate its object.
5. Inspect/edit the recipe that produced the result.
6. Write a short custom script using the API explorer.
7. Recover from a failed or cancelled analysis.
8. Ask the agent for the same analysis and inspect its proposal.

Record completion time, errors, backtracking, unclear labels, and confidence. Do not collect source pixels or filenames without explicit opt-in.
