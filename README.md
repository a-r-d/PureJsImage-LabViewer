# PureJsImage Materials Workbench starter kit

This bundle is a launch plan for a new repository that consumes `purejsimage@0.10.0` as a normal published dependency and builds a browser-native scientific imaging application around it.

Working repository name: **`purejsimage-materials-workbench`**  
Working product name: **Materials Workbench**

The name is intentionally provisional. The architecture is not.

## Product thesis

Build a zero-install, local-first scientific image workbench for electron microscopy and adjacent engineering imagery. The first release should make this complete workflow excellent:

```text
open original scientific file
  → inspect metadata and calibration
  → navigate and adjust display
  → draw calibrated ROI
  → threshold or filter
  → connected components / particle measurement
  → inspect tables and distributions
  → save and replay a reproducible analysis
  → ask an AI assistant to construct or modify that same analysis
```

The application is not an ImageJ clone. It borrows the workflows scientists rely on from ImageJ/Fiji, DigitalMicrograph, Gwyddion, HyperSpy, napari, py4DSTEM, and industrial volume-analysis tools, while exploiting capabilities that are unusually natural in a web-native application:

- no installation or plugin installation rights required;
- direct local-file and HTTP Range access to original files;
- bounded analysis of data too large to load wholesale;
- reproducible, inspectable operation graphs;
- an agent that uses the same validated command API as the UI;
- editable browser plugins and recipes with explicit permissions;
- optional cloud storage and compute later, not a prerequisite for local work.

## Recommended stack

- **React**, not Preact, for ecosystem compatibility, accessibility tooling, error boundaries, test support, and fewer compatibility surprises. Rendering and analysis performance belong in the viewport and worker layers rather than in framework micro-optimizations.
- **Vite** plus the official **Cloudflare Vite plugin**.
- **pnpm workspaces** plus **Turborepo**.
- **TypeScript strict mode** with project references and incremental builds.
- **Biome** for formatting and linting.
- **Vitest** for unit, contract, and integration tests.
- **Playwright** for browser workflow, visual, accessibility, range-read, and performance tests.
- **React Testing Library** only for genuinely DOM-oriented component behavior; prefer framework-independent package tests for core logic.
- **Web Workers** for PureJsImage document access, analysis planning/execution, and large-data work.
- **WebGL2 initially** behind a renderer interface; WebGPU remains an optional later renderer/compute implementation.
- **Cloudflare Pages/Workers static asset deployment** for the initial client.

## Repository shape

```text
apps/
  workbench/              React application and Cloudflare deployment entry

packages/
  contracts/              stable JSON-safe cross-boundary contracts
  workspace/              project state, commands, undo/redo, persistence
  imaging/                public PureJsImage integration and worker RPC
  viewport/               renderer-independent camera, tiles, overlays, picking
  agent/                  OpenRouter gateway, tool loop, approvals, local history
  plugin-sdk/             plugin manifests, capabilities, recipes, sandbox protocol
  ui/                     design tokens and reusable accessible React components
  test-corpus/            corpus manifest schema, download/verification utilities

services/
  README.md               future backend boundary; no speculative backend yet

apps-e2e/
  workbench/              Playwright workflows and fixture server

tooling/
  typescript/
  vitest/
  playwright/
  scripts/

docs/
  PRODUCT_NORTH_STAR.md
  ARCHITECTURE.md
  UX_SYSTEM.md
  AI_AGENT.md
  PLUGIN_SYSTEM.md
  TEST_CORPUS.md
  QUALITY_GATES.md
  DECISIONS.md
```

Packages are private workspace packages by default. Do not add publishing/versioning machinery until there is a concrete package that outside consumers should install.

## Suggested execution order

Run the prompts in `prompts/` sequentially:

1. `00-bootstrap-monorepo.md`
2. `01-workbench-shell-and-design-system.md`
3. `02-purejsimage-worker-and-viewer.md`
4. `03-workspace-project-and-history.md`
5. `04-materials-analysis-workflows.md`
6. `05-openrouter-agent.md`
7. `06-plugin-foundation.md`
8. `07-test-corpus-and-product-e2e.md`
9. `08-ux-performance-and-accessibility.md`
10. `09-cloudflare-deployment.md`
11. `10-final-hardening.md`

Each prompt assumes the previous prompt has completed, but still requires Codex to inspect the actual tree and preserve user changes.

## Files intended to be copied into the new repository immediately

- `AGENTS.md`
- everything under `docs/`
- `datasets/corpus.yaml`
- `datasets/README.md`
- `services/README.md`

The files under `templates/` are reference configurations. The bootstrap prompt should verify current compatible dependency versions before using them rather than copying stale version pins blindly.

## Initial completion criterion

The skeleton is successful when a clean browser session can:

1. open a supported local or remote scientific file through public PureJsImage exports;
2. render a calibrated plane with pan, zoom, display range, and metadata;
3. draw an ROI and obtain a line profile or statistics;
4. run threshold → connected components and display a virtualized object table;
5. save and reload a local project containing the analysis graph and ROI set;
6. let a mocked AI agent propose the same graph through validated tools;
7. pass the complete unit, browser, corpus, accessibility, visual, and performance gates.
