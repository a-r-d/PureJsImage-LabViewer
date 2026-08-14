# Roadmap after prompt 04

## Product north star

Build a local-first, browser-native scientific imaging workbench for electron microscopy and adjacent engineering imagery that can:

- open original scientific files and large remote datasets without mandatory conversion;
- preserve calibration, metadata, source identity, and analysis provenance;
- perform the common interactive and quantitative workflows scientists expect;
- make every analysis reproducible as a validated graph, recipe, or sandboxed script;
- let a user or AI author custom analysis without installing desktop software or plugins;
- remain useful with no account, server, or model key.

The target is not a visual clone of ImageJ. ImageJ/Fiji is a workflow north star, while PureJsImage’s advantage is web-native composition and bounded analysis of original datasets that can be too large to load wholesale.

## New prompt sequence

| Prompt | Milestone | Why this comes here |
| --- | --- | --- |
| 05 | Architecture decomposition, deterministic visuals, design system V2 | Prevent the shell and Worker host from becoming the permanent bottleneck before breadth arrives. |
| 06 | Unified action registry and sandbox/plugin foundation | UI, scripts, plugins, tests, and the future agent need one semantic capability model. |
| 07 | Core image analysis and measurement breadth | Establish the common everyday workflow surface. |
| 08 | Threshold, morphology, watershed, and particle analysis | Complete the dominant materials segmentation workflow. |
| 09 | Materials toolkit: FFT, surface, stack, registration, batch | Add the high-value workflows that distinguish this from a generic image editor. |
| 10 | Script Studio and executable plugin authoring | Turn the capability registry into user/AI-authored extensibility. |
| 11 | Example library and corpus activation | Give users many instant demonstrations and give tests licensed real data. |
| 12 | Corpus-driven scientific E2E | Automate numerical, memory, range-read, lifecycle, visual, and replay correctness. |
| 13 | UX validation and visual refinement | Polish real workflows after the surfaces exist, not placeholders. |
| 14 | OpenRouter AI assistant | Build the agent against the complete semantic toolbox. |
| 15 | Local live-model evals and integrated hardening | Tune the real agent manually without putting paid calls in CI. |

The old deployment prompt is removed because the app is already deployed.

## Definition of “80 percent”

“Eighty percent of ImageJ” does not mean implementing 80 percent of menu commands. It means covering the normal end-to-end tasks for the initial audience:

- open and inspect calibrated imagery;
- adjust non-destructive display;
- crop, transform, filter, normalize, and subtract background;
- create and manage ROIs;
- measure intensities, shapes, profiles, and histograms;
- segment through thresholding and morphology;
- split touching objects and analyze particles;
- inspect FFT/power spectra and spatial frequencies;
- navigate stacks/volumes and make projections;
- align images or stack frames;
- level and characterize AFM/SPM surfaces;
- run a workflow over multiple files/planes;
- save, replay, export, script, and customize the workflow.

See `docs/ANALYSIS_80_PERCENT.md` for the detailed matrix.

## Rules for adding analysis operations

For each capability:

1. Inspect the current PureJsImage operation catalog.
2. Prefer an existing public operation or compose existing operations.
3. If the operation is broadly reusable across scientific applications, document an upstream PureJsImage gap before creating an app-local duplicate.
4. If it is application- or materials-specific, implement it as an explicit extension/provider package using public PureJsImage contracts.
5. Add deterministic reference behavior, parameter schema, units, invalid/no-data policy, memory estimate, cancellation, provenance, and fixtures.
6. Make it available through the action registry, normal UI, command palette, recipes, scripts, and eventually the agent.
7. Never hide pixel algorithms in React components or ad hoc Worker message handlers.

## Backend posture

Continue local-first and backend-optional.

A future backend may provide storage, collaboration, remote compute, institutional auth, or plugin distribution. Browser packages should consume interfaces, not a hosted implementation. Keep service contracts JSON-safe and make a future Dockerized service possible, but do not build speculative server features during prompts 05–15.
