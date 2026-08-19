# Architecture

The concrete scientific source, Worker RPC, and renderer tile lifecycle is documented in
[`IMAGING_WORKER.md`](./IMAGING_WORKER.md).

## Design principles

1. **PureJsImage owns scientific data semantics.** The app does not recreate readers, ROIs, analysis graphs, operation validation, results, or tile accounting.
2. **The app owns workflows and presentation.** Panel layout, selection, viewport interaction, workspace organization, user preferences, and onboarding belong here.
3. **No large-data work on the React render path.** File parsing and analysis execute through a worker boundary.
4. **Local-first is a complete mode.** A backend can enhance storage, sharing, compute, and authentication later, but the core app is useful without it.
5. **Every cross-boundary message is versioned and validated.** This includes Worker RPC, project persistence, plugins, agent tools, and future backend APIs.
6. **One source of truth per concern.** Avoid dual state between React, worker, URL, local storage, and project documents.
7. **Measured performance over folklore.** React versus Preact is less important than tile latency, transfer, draw calls, cache reuse, and result virtualization.

## Showcase applications

The repository is a shared showcase monorepo. Science, geo, and a lightweight gallery are
the initial applications; medical is added later and has no package until that domain is
implemented. Each domain app is a separate build and deploy. Shared behavior is selected
by a compile-time domain profile. This is not a runtime third-party plugin ecosystem, and
PureJsImage stays a separate core-library repository.

This repository hosts UI apps on Cloudflare subdomains. It does not publish the
PureJsImage library homepage at `purejsimage.com` (that site is GitHub Pages from the
core-library repository).

| Application | Package | Intended host | Cloudflare worker name |
| --- | --- | --- | --- |
| Science | `@pji-workbench/science` | `lab.purejsimage.com` | `purejsimage-materials-workbench` |
| Geo | `@pji-workbench/geo` | `geo.purejsimage.com` | `purejsimage-geo` |
| Gallery | `@pji-workbench/gallery` | linker only; not bound to apex `purejsimage.com` | `purejsimage-gallery` |

Cloudflare Git deploy for lab (was `@pji-workbench/app`):

```text
pnpm --filter @pji-workbench/science exec wrangler deploy
```

See [`adr/0001-shared-showcase-monorepo.md`](./adr/0001-shared-showcase-monorepo.md).

## Monorepo

```text
apps/gallery
  Lightweight linker to separately deployed domain apps. No imaging Worker.

apps/science
  Electron microscopy / materials workbench, Cloudflare composition root, and science
  characterization suite. Deployed at lab.purejsimage.com.

apps/geo
  Geo Atlas: STAC catalog discovery (generic client + registry; Kentucky From Above is the first
  entry), native-CRS viewport, independent COG sources with per-handle tiles, layer/display
  controls, and COG X-ray. Deployed at geo.purejsimage.com.

packages/actions
  JSON-safe semantic action descriptors, deterministic registry, availability, validation,
  capability manifests, and the shared action host. No React or PureJsImage runtime imports.

packages/contracts
  JSON-safe contracts shared with Workers and future services.
  No React, DOM, Node, or PureJsImage runtime imports unless types-only and deliberate.

packages/workspace
  Immutable workspace state, commands, revisions, undo/redo, project persistence,
  user-visible activity/history, selection, and orchestration state.

packages/workbench-core
  Headless shared workbench runtime and compile-time domain profile types. Owns generic
  source/project/activity controllers and reader/example registry helpers. No React,
  no PureJsImage runtime imports, and no domain-science or domain-geo imports.

packages/workbench-react
  Shared React workbench shell. No imaging or domain packages.

packages/domain-science
  Science/materials example IDs, workflows, semantic actions, panels, terminology, and
  empty states. Depends on packages/materials-analysis.

packages/domain-geo
  Geo project model, CRS helpers, Atlas copy, JSON-safe COG X-ray reports, a generic STAC
  client, and the catalog registry. Collection IDs belong in registry entries, not generic UI.
  Proj4js may transform EPSG:4326 ↔ EPSG:3857 plus CRS definitions registered by a catalog
  (EPSG:3089 for Kentucky From Above). Unsupported projections return typed errors. Pixel
  reprojection and basemaps are out of scope. Must not import domain-science,
  materials-analysis, React, or PureJsImage.

packages/imaging
  The only package that directly composes PureJsImage readers, scientific documents,
  analysis controller/runtime, and worker-side lifecycles. One Worker owns a bounded map of
  independent sources; analysis extensions are injected by the app, not hardcoded.

packages/viewport
  Camera math, coordinate-space adapters (image space and world-space affine), visible
  tile selection including shared multi-layer source tiles, render model, overlay
  geometry, hit testing, and renderer interfaces. Core is framework-neutral. Camera
  state is not owned by React panels.

packages/agent
  OpenRouter client, tool definitions, tool loop, approval policy, message history,
  summaries, redaction, and deterministic mocks.

packages/plugin-sdk
  Manifest schemas, recipe plugins, capability declarations, installation records,
  bounded script/recipe and Script Studio repository contracts, integrity, provenance,
  import/export validation, and sandbox RPC protocol.

packages/scripts
  Dedicated script Worker client, QuickJS-WASM runtime, generated script API, capability RPC,
  deterministic fixtures and built-ins, quotas, cancellation/termination, and sandbox conformance
  tests. Application policy stays in the composition root.

apps/science/features/scripts
  Lazy CodeMirror Studio UI, versioned IndexedDB repository implementation, and dedicated lazy
  TypeScript language Worker. It composes package contracts but owns no scientific algorithm.

packages/ui
  Design tokens and accessible reusable React components. No domain data access.

packages/test-corpus
  Immutable scenario manifests, status/license/integrity normalization, semantic generated-fixture
  resolution, bounded download/cache/archive delivery, audit reports, and corpus metadata shared by
  the gallery and tests. It never exposes repository-relative runtime fixture paths.
```

## Dependency direction

```text
contracts
  ↑        ↑          ↑          ↑
actions workspace  imaging   plugin-sdk
  ↑        ↑          ↑          ↑
  └─────── scripts ────┬─────────┘
          ↑            ↑
          └──── workbench ───────┘
              ↑      ↑
          viewport  agent

ui → React only and generic contracts
```

Rules:

- `apps/science` may import `domain-science`, `materials-analysis`, and shared packages. It must not import `domain-geo`.
- `apps/geo` may import `domain-geo`, `imaging`, `viewport`, `contracts`, and the shared shell. It must not import `domain-science` or `materials-analysis`.
- `apps/gallery` may import `packages/ui` only among workspace packages. It must not import the imaging runtime.
- No package imports from `apps/*`.
- `imaging` may import only documented PureJsImage package exports.
- `viewport` receives tile/render descriptors; it does not open files or execute analysis.
  Science uses the image-space adapter; geo uses a world-space affine adapter. Generic UI
  must not branch on geo vs science.
- `agent` invokes a narrow application tool host, never PureJsImage internals directly.
- `actions` owns semantic descriptors and policy metadata, never live datasets or UI components.
- `workspace` stores semantic references and project state, not live `ScientificDataset` objects or typed pixel buffers.

Add an automated dependency-boundary test. Turborepo ordering alone does not enforce architecture.
The boundary gate also rejects import cycles between `apps/science/src/features/*` roots.

## Workbench composition

`apps/science/src/App.tsx` is only the route selector. `app/WorkbenchProviders.tsx` constructs
the preference, persistence, imaging, runtime, and reconciliation services, while
`packages/workbench-react` owns the top-level shell and readiness contract. Feature folders own
bounded view models and callbacks for source, project, inspector, pipeline, layout, and examples.
High-frequency camera, pointer, and render-settled updates remain outside broad React state.

Current semantic UI commands and the command palette execute through one `WorkbenchActionHost`.
The same registry provides deterministic capability enumeration, exact version lookup, input
validation, availability reasons, permission metadata, and future script/agent manifests.

## Browser runtime

### Main thread

Owns:

- React application shell;
- keyboard, pointer, drag/drop, and accessibility behavior;
- viewport camera and high-frequency interaction state;
- WebGL renderer initially;
- panel layout;
- virtualized tables;
- command dispatch and user approval dialogs.

Do not place full scientific datasets, result columns, or tile caches in React state.

### Imaging Worker

Owns:

- PureJsImage scientific library and explicitly registered readers;
- local Blob/File sources and remote HTTP Range sources;
- open ScientificDocuments and datasets;
- AnalysisController, provider bundles, and TileRuntime;
- operation planning, dry-run, execution, result summarization;
- tile requests and lifecycle cleanup;
- project validation and source identity checks where appropriate.

The worker should support multiple open documents but enforce explicit limits.

The Worker remains one request router, but domain logic and runtime records are split beneath
`packages/imaging/src/worker-host/` into protocol, source, view, analysis, result, and runtime
modules. This preserves one lifecycle owner while preventing the router from becoming the home
for every domain helper.

### Renderer

Start with a WebGL2 renderer on the main thread behind this conceptual interface:

```ts
interface ViewportRenderer {
  configure(config: ViewportRenderConfig): void
  uploadTile(tile: RenderTile): RenderTileHandle
  releaseTile(handle: RenderTileHandle): void
  render(frame: RenderFrame): void
  dispose(): void
}
```

Use transferable buffers or `ImageBitmap` only where ownership and measured performance justify them. Do not copy an entire plane to the main thread.

Atlas currently composites native-CRS tiles with a Canvas 2D renderer. It still copies only
bounded RGBA tiles onto the main thread; quantitative values stay on those same tile objects,
not in React state.

Keep an experimental OffscreenCanvas worker renderer possible, but do not make it a skeleton dependency because browser/debugging behavior varies and input latency must be measured.

### Agent

The agent runs on the main thread or a dedicated small Worker, but all analysis tools cross the same typed host boundary used by the UI.

The agent cannot:

- access dataset bytes directly;
- inspect the OpenRouter key through tools;
- mutate React stores;
- execute user- or AI-authored code anywhere except the dedicated script Worker and its separate
  QuickJS-WASM runtime through the default-deny capability host;
- bypass graph validation, dry-run, limits, or user approvals.

## Worker RPC

Use a small request/response/event protocol owned by `packages/contracts`.

Every message includes:

```ts
interface RpcEnvelope {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly kind: string
  readonly payload: unknown
}
```

Required RPC categories:

- open/close document;
- enumerate/open dataset;
- request/cancel viewport tile;
- inspect metadata/capabilities;
- manage ROI/workspace graph bindings;
- validate/dry-run/execute/cancel analysis;
- summarize/read paged result data;
- project validate/import/export;
- runtime metrics and diagnostics.

Use `AbortSignal` semantics at the application boundary through explicit cancel messages. Do not serialize an `AbortSignal` object.

The protocol must validate unknown payloads before use. Invalid messages return structured errors rather than throwing unhandled worker exceptions.

## State layers

### Ephemeral interaction state

Examples:

- pointer position;
- current pan gesture;
- hover target;
- transient threshold preview slider;
- panel resize drag.

Keep this close to the relevant component or viewport controller.

### Workspace semantic state

Examples:

- open dataset references;
- active dataset and plane selection;
- ROI set;
- operation graph;
- bindings;
- pinned results;
- notes;
- agent-proposed changes pending approval.

Managed by `packages/workspace` through immutable commands with revision preconditions.

### Preferences

Examples:

- theme;
- panel layout;
- shortcut settings;
- OpenRouter model selection;
- recent sources;
- credential presence.

Stored separately from project data. Credentials are never included in project state.

### Live runtime handles

Examples:

- Worker-side documents;
- datasets;
- prepared plans;
- execution results;
- tile leases;
- GPU resources.

Referenced by opaque IDs only. Never persist these IDs as durable source identity.

## Persistence

Use interfaces from the start:

```ts
interface ProjectStore {
  save(project: WorkspaceProject): Promise<void>
  load(id: string): Promise<WorkspaceProject | undefined>
  list(): Promise<readonly ProjectSummary[]>
  delete(id: string): Promise<void>
}
```

Initial implementation:

- IndexedDB for projects and bounded history;
- localStorage only for tiny preferences and the requested OpenRouter key;
- explicit JSON project export/import;
- local files must be rebound after reload unless the browser grants persistent file handles.

Do not store multi-megabyte result tables in localStorage.

## Optional backend boundary

A future service may provide:

- project storage and sharing;
- object-store credentials or signed URLs;
- durable dataset registry;
- asynchronous compute jobs;
- team identity and permissions;
- plugin registry;
- audit and institutional controls.

The client should target these interfaces:

```ts
interface RemoteProjectService extends ProjectStore {}
interface ComputeService { submit(...): Promise<JobReference> }
interface DatasetLocatorService { resolve(...): Promise<SourceLocator> }
interface PluginRegistryService { search(...): Promise<PluginSummary[]> }
```

A Dockerized open-source service and a hosted implementation can both satisfy them. Do not couple client logic to deployment ownership or licensing.

## Security boundaries

- Treat uploaded files, remote bytes, metadata, project JSON, plugin packages, and model responses as untrusted.
- Apply size, depth, item-count, and string-length limits before allocating.
- Never render metadata or model output as unsanitized HTML.
- Keep Content Security Policy strict; avoid `unsafe-eval`.
- OpenRouter requests go directly to OpenRouter only after explicit user action.
- Plugins do not execute in the page realm.
- User/AI-authored executable code runs only in the dedicated script Worker and QuickJS-WASM
  runtime. It never runs in the page, React realm, imaging Worker, or an unrestricted module
  Worker. The generated `@lab/api` module is the only initial import surface.
- The CSP permits `wasm-unsafe-eval` solely so the self-hosted QuickJS module can compile;
  JavaScript `unsafe-eval`, inline script, and cross-origin script remain forbidden.
- Remote URLs require HTTPS except localhost development.
- Do not proxy arbitrary URLs through a future backend without SSRF protections.

## Build outputs

Each of `apps/gallery`, `apps/science`, and `apps/geo` produces its own browser bundle and
Cloudflare static deployment output.

Workspace libraries produce ESM declarations/build artifacts for boundary verification, but are not published.

Every package should support:

```text
check
build
test
typecheck
lint
```

Root tasks use Turborepo and must be reproducible from a clean clone.

## Performance budgets

Initial budgets, enforced by tests where practical:

- first shell interaction within 1 second on a warm local development build;
- no application route chunk above 300 KB gzip without an explicit budget update;
- PureJsImage reader bundles loaded lazily by format or workflow;
- pan/zoom input-to-frame target below 50 ms, with 60 fps as the normal steady-state goal;
- no React commit required for every pointer move or tile upload;
- first useful tile before nonessential metadata panels finish;
- object table remains responsive at 100,000 rows through virtualization;
- agent tool payloads never include full tables or raw tiles;
- every remote workflow records bytes fetched and request count in test mode.
