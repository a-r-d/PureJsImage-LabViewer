# UX system

## Product posture

The application should feel like a modern engineering instrument, not a generic dashboard and not a web imitation of a 1990s desktop UI.

Attributes:

- dense enough for expert work;
- calm and legible;
- immediate feedback;
- keyboard-friendly;
- explicit units and provenance;
- no hidden destructive behavior;
- progressive disclosure rather than dozens of always-visible controls.

## Main workbench layout

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ App bar: source · dataset · plane · command palette · save · agent      │
├───────────────┬──────────────────────────────────────┬──────────────────┤
│ Sources       │                                      │ Inspector        │
│ Datasets      │                                      │  Display         │
│ Layers        │              Viewport                │  Measure         │
│ ROIs          │                                      │  Analyze         │
│ Results       │                                      │  Agent           │
│               │                                      │  Metadata        │
├───────────────┴──────────────────────────────────────┴──────────────────┤
│ Timeline / pipeline / status / coordinates / scale / memory / progress │
└─────────────────────────────────────────────────────────────────────────┘
```

### App bar

Contains only globally important actions:

- open file;
- open URL;
- active source/dataset selector;
- command palette;
- undo/redo;
- project save/export;
- agent toggle;
- settings/help.

Do not put operation-specific controls in the app bar.

### Left rail

A hierarchical semantic navigator:

```text
Sources
  experiment.mrc
    density volume
  sample.svs
    pyramid
    associated/label

Layers
  source image
  threshold preview
  connected-component labels

ROIs
  precipitate-region
  background

Results
  object table
  size distribution
```

Selection in this rail changes what the right inspector edits. Visibility and selection are separate states.

### Viewport

The viewport is the product center.

Required behaviors:

- smooth wheel/trackpad zoom around cursor;
- space-drag or middle-button pan;
- fit, 1:1, and calibrated scale shortcuts;
- pixel and physical coordinates under cursor;
- current value/component under cursor;
- scale bar when calibrated;
- tile-loading states that do not block interaction;
- no full-screen spinner after the first tile appears;
- ROI creation/editing with handles that remain usable at any zoom;
- label overlays with adjustable opacity and outline mode;
- comparison modes later: blink, split, difference.

Display mapping is non-destructive and clearly distinguished from analysis operations.

### Right inspector

Use a small number of top-level tabs:

1. **Display** — component, range, scale, palette, overlay opacity.
2. **Measure** — active ROI geometry, statistics, line profile, calibration.
3. **Analyze** — operation catalog, parameters, preview, add-to-pipeline.
4. **Agent** — conversation, proposed steps, approvals, tool trace.
5. **Metadata** — searchable typed metadata and source identity.

The inspector edits the selected semantic object. It should never silently apply settings to an unrelated dataset.

### Bottom area

Switchable modes:

- pipeline/history;
- result table;
- histogram/plot;
- diagnostics.

The status strip remains visible and shows:

- X/Y and physical coordinates;
- zoom;
- resolution level;
- source/read activity;
- analysis progress;
- cancellation;
- managed memory/cache metrics in developer mode.

## First-run experience

The empty state should offer:

- **Open local file**
- **Open remote URL**
- **Try a sample SEM image**
- **Open a saved project**

Below that, show supported scientific reader categories and the privacy statement:

> Local files are processed in this browser unless you explicitly choose a remote service.

The sample workflow should open immediately and guide the user through:

1. draw an ROI;
2. adjust threshold;
3. count particles;
4. inspect the table;
5. ask the agent to explain the result.

## Analysis interaction model

Operations exist in three states:

1. **Preview** — temporary, cancellable, visually marked, not project history.
2. **Committed** — graph node in project history.
3. **Running/materializing** — committed operation with progress and cancellation.

A slider such as threshold should update a bounded preview without creating dozens of history nodes. Clicking **Apply** creates one normalized graph change.

Expensive global operations display a plan before execution:

```text
Connected components
Plane: x/y, component 0
Estimated peak memory: 312 MB
Estimated tiles: 1,024
Connectivity: 8
Output: labels + object table
```

## Agent UX

The agent is not a magic chat overlay obscuring the image.

The agent panel should show:

- user request;
- assumptions derived from calibration/metadata;
- proposed operation steps;
- validation issues;
- estimated execution cost;
- approval controls;
- live tool activity;
- bounded result summary with units;
- links that select the relevant graph node, ROI, or result.

Approval levels:

- read-only inspection: automatic;
- project proposal: automatic but not applied;
- reversible graph/ROI mutation: one-click approval;
- expensive compute or large remote access: explicit cost approval;
- export, upload, external network action, plugin installation: explicit approval every time.

The user can always switch to the normal operation inspector and edit the proposed graph.

## Command palette

Search across:

- operations;
- datasets and layers;
- ROIs and results;
- viewport commands;
- project actions;
- agent actions;
- installed recipes/plugins.

Every command has:

- stable ID;
- label;
- optional shortcut;
- availability predicate;
- explanation when unavailable.

## Keyboard defaults

Suggested initial bindings:

```text
Ctrl/Cmd+O       Open file
Ctrl/Cmd+Shift+O Open URL
Ctrl/Cmd+S       Save project
Ctrl/Cmd+K       Command palette
Ctrl/Cmd+Z       Undo
Ctrl/Cmd+Shift+Z Redo
F                Fit image
1                1:1 pixels
Space+drag       Pan
R                Rectangle ROI
L                Line ROI
P                Polygon ROI
Esc              Cancel active tool/preview
Enter            Commit valid preview
Delete           Delete selected ROI/layer after confirmation policy
?                Shortcut reference
```

Shortcuts must not fire while typing in fields and must be remappable later.

## Design tokens

Use tokens rather than component-local values:

```text
color.background.canvas
color.background.panel
color.border.subtle
color.text.primary
color.text.secondary
color.focus
color.warning
color.error
color.success
space.1 ... space.8
radius.sm / md
font.ui / mono
size.toolbar
size.inspector
```

Default to a dark neutral workbench because microscopy images often contain dark backgrounds, but support a light theme from the same tokens.

Use color sparingly for state, overlays, and scientific palettes. Never use color alone to encode selection or errors.

## Accessibility

- All controls reachable by keyboard.
- Visible focus rings.
- Panels and splitters use proper roles and keyboard resizing.
- Canvas has an accessible name and a text summary of active dataset/plane/ROI.
- Every icon button has an accessible label and tooltip.
- Contrast meets WCAG AA for UI text.
- Reduced-motion mode disables animated panel transitions and nonessential viewport easing.
- Plots and tables expose textual summaries.
- Agent tool calls and progress use appropriate live regions without flooding screen readers.

## Error design

Errors are classified:

- unsupported format/capability;
- invalid/corrupt input;
- limit exceeded;
- cancelled;
- remote access/CORS;
- analysis validation;
- provider/runtime failure;
- project/source identity mismatch;
- agent/network/model error.

Every error panel should answer:

1. What happened?
2. What was protected or left unchanged?
3. What can the user do next?
4. Which technical details can be copied for a bug report?

Do not expose raw stack traces by default.

## UX tests

Playwright must automate:

- empty-state onboarding;
- keyboard-only open/analyze/export path;
- ROI creation and editing;
- threshold preview and commit;
- global analysis plan and cancel;
- object table sorting/filtering/selection;
- agent proposal/approval/rejection;
- project save/reopen/source rebind;
- narrow desktop layout and large monitor layout;
- screen reader landmark and accessible-name assertions;
- no unexpected layout shifts during tile arrival.
