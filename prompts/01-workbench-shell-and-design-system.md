# Codex prompt 01 — workbench shell and design system

```text
Continue in the bootstrapped repository.

Before editing:

- inspect git status and current code;
- read AGENTS.md, docs/UX_SYSTEM.md, docs/PRODUCT_NORTH_STAR.md, and docs/ARCHITECTURE.md;
- preserve user changes;
- do not commit, push, publish, or deploy.

Build the accessible, performance-conscious workbench shell and design system. Use mocked semantic data only; do not implement PureJsImage file access yet.

## Main layout

Implement the desktop workbench described in docs/UX_SYSTEM.md:

- top application bar;
- resizable left semantic navigator;
- central viewport surface;
- resizable right inspector;
- bottom timeline/results/diagnostics region;
- persistent status strip.

Support:

- large monitor layout;
- practical 1,280px desktop layout;
- narrow desktop fallback that collapses one side panel without turning the product into a mobile dashboard;
- saved panel sizes through a preference interface.

Do not add a third-party dashboard/component framework. Build a small coherent component set in packages/ui.

## Design tokens

Create typed tokens for:

- colors;
- typography;
- spacing;
- radii;
- borders;
- focus;
- panel/toolbar dimensions;
- z-index layers;
- overlay scientific colors.

Implement dark and light themes with dark as default. Use CSS custom properties generated or declared from one source of truth.

Ensure UI text contrast meets WCAG AA. Do not use color alone for selection/error state.

## Reusable UI components

Implement only components required by the shell:

- Button/IconButton;
- Tooltip;
- Tabs;
- Panel and keyboard-resizable Splitter;
- Tree/List row;
- Toolbar;
- Status item;
- Dialog/Popover primitives if needed;
- Error boundary state;
- Empty state;
- Progress/cancel row;
- command-palette shell;
- visually hidden utility and accessible icon conventions.

Use native platform semantics where possible. Avoid building a giant generic design system.

Every icon-only action needs an accessible name and tooltip.

## Application state

Create a small composition-root state arrangement, not a global state framework.

Separate:

- ephemeral panel/interaction state;
- semantic workspace mock state;
- persisted preferences.

Use React context only for stable services/themes, not high-frequency viewport state.

Create package-level interfaces so the mock workspace can later be replaced by packages/workspace.

## Viewport shell

In packages/viewport, implement framework-neutral:

- camera state and transforms;
- fit-to-bounds;
- cursor-centered zoom;
- pan constraints;
- scale calculation;
- viewport resize model;
- overlay/layer render descriptors;
- hit-test contract.

In the app, render a deterministic mocked image/grid using Canvas or WebGL2 behind a renderer interface. The viewport must not require a React render for every pointer move.

Implement:

- wheel/trackpad zoom around pointer;
- space-drag and middle-button pan;
- fit and 1:1 commands;
- pixel/physical cursor readout from mock calibration;
- mock scale bar;
- mock ROI overlay;
- keyboard focus and accessible text summary.

Do not implement a production scientific renderer or tile cache yet.

## Navigator and inspector

Left navigator mock hierarchy:

- Sources;
- Datasets;
- Layers;
- ROIs;
- Results.

Right inspector tabs:

- Display;
- Measure;
- Analyze;
- Agent;
- Metadata.

Bottom tabs:

- Pipeline;
- Results;
- Plot;
- Diagnostics.

Selection and visibility are distinct.

## Command palette and shortcuts

Implement a typed command registry with:

- stable ID;
- label;
- category;
- shortcut;
- availability;
- disabled reason;
- execute callback.

Implement the shortcut defaults from docs/UX_SYSTEM.md, taking care not to trigger while typing.

The palette can initially use a simple filtered dialog. Do not add a dependency solely for fuzzy search unless measured/justified.

## Accessibility and tests

Add Vitest/component tests for:

- command availability;
- splitter keyboard behavior;
- theme/preferences;
- camera math;
- shortcut suppression inside inputs;
- focus restoration.

Add Playwright tests for:

- shell landmarks and accessible names;
- keyboard-only panel navigation;
- resizable panels;
- command palette;
- viewport pan/zoom without broad React re-render churn;
- dark/light theme;
- narrow desktop behavior;
- no serious automated accessibility violations;
- deterministic screenshots for empty, opened-mock, ROI, and agent-panel states.

Instrument React renders in a test/dev-only way and assert pointer motion does not rerender the entire workbench tree on every event.

## Verification

Run affected package checks, Playwright Chromium, accessibility, visual tests, root build, and pnpm check.

Report:

- component inventory;
- interaction/state boundaries;
- accessibility results;
- screenshot paths;
- measured viewport render behavior;
- bundle-size effect;
- git diff --stat;
- remaining shell/UX limitation.

Do not commit or push.
```
