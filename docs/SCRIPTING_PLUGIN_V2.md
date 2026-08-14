# Scripting and plugin system V2

## Product goal

A user who cannot install Fiji, Python, native dependencies, or institution-unapproved plugins should still be able to:

- open the Script Studio;
- write or paste a custom analysis;
- inspect the API and requested permissions;
- typecheck and test it against a known fixture;
- run it in a restricted environment;
- save it locally as a reusable tool;
- export/import the exact artifact;
- ask the AI assistant to draft or patch the same script;
- retain source, content hash, permissions, operation versions, and outputs in provenance.

This is not ImageJ macro compatibility. It is a modern asynchronous API over the workbench’s validated semantic actions.

## Extension tiers

### Tier 1: declarative recipes

JSON-safe operation graphs with parameter declarations, input requirements, output declarations, tests, metadata, and a content hash. No executable code.

### Tier 2: sandboxed analysis scripts

User- or AI-authored JavaScript/TypeScript compiled to an ES module and executed in a dedicated script Worker containing a separate QuickJS-WASM runtime.

Scripts receive only an explicit `lab` capability API. They receive no host objects, DOM, `window`, `document`, `fetch`, browser storage, credentials, Worker constructor, dynamic import, WebSocket, or arbitrary module loading.

### Tier 3: trusted build-time extensions

Normal TypeScript packages installed by developers and composed through PureJsImage’s extension/provider system. They execute with application trust and must never be described as sandboxed.

## Script artifact

```ts
interface AnalysisScriptDocumentV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly language: 'typescript' | 'javascript'
  readonly source: string
  readonly manifest: AnalysisScriptManifestV1
  readonly tests: readonly AnalysisScriptTestV1[]
  readonly integrity: {
    readonly algorithm: 'sha256'
    readonly digest: string
  }
}

interface AnalysisScriptManifestV1 {
  readonly scriptApiVersion: 1
  readonly requestedCapabilities: readonly ScriptCapability[]
  readonly pureJsImageCompatibility: string
  readonly workbenchCompatibility: string
  readonly entrypoint: 'main'
  readonly deterministic: boolean
}
```

Presentation timestamps and local editor state are stored separately and do not affect integrity.

## Capability API

The initial async API should be generated from the application action registry and exposed as namespaced functions:

```ts
lab.workspace.getSummary()
lab.sources.list()
lab.datasets.list()
lab.datasets.describe({ datasetId })
lab.rois.list()
lab.rois.create(...)
lab.rois.update(...)
lab.analysis.catalog()
lab.analysis.describe(...)
lab.analysis.normalize(...)
lab.analysis.dryRun(...)
lab.analysis.execute(...)
lab.analysis.cancel(...)
lab.results.summarize(...)
lab.results.getPage(...)
lab.pipeline.get()
lab.viewport.getState()
lab.viewport.proposeState(...)
lab.ui.proposeOpenPanel(...)
lab.export.proposeCsv(...)
```

The host validates every call exactly as if it came from the normal UI or future agent. Script APIs should return JSON-safe bounded values and opaque handles, never live datasets, tiles, DOM nodes, React stores, credentials, or unbounded result arrays.

## Permissions

Default deny. Suggested initial permissions:

```text
workspace.read
workspace.propose
source.read-metadata
dataset.read-descriptor
roi.read
roi.propose
analysis.catalog
analysis.dry-run
analysis.execute
result.read-summary
result.read-page
viewport.read
viewport.propose
ui.propose
file.export
network.explicit-hosts
```

Read-only actions may run automatically. Mutations, expensive compute, export, plugin installation, and external network actions follow host policy and user approval.

## Sandbox

Use defense in depth:

1. Dedicated browser Worker.
2. QuickJS-WASM runtime inside that Worker.
3. No ambient host APIs.
4. Explicit module loader that permits only the generated `@lab/api` module and approved script-local modules.
5. CPU deadline/interrupt handler.
6. memory and stack limits;
7. bounded source size, output size, message count, message bytes, tool calls, and recursion;
8. host cancellation terminates the QuickJS runtime and may terminate/recreate the Worker;
9. no `SharedArrayBuffer` initially;
10. debug QuickJS variant in leak-detection tests and release variant in production tests.

Do not claim this has been independently security audited. Describe it as a restricted execution environment with explicit limitations.

## Determinism and provenance

In deterministic mode:

- no wall-clock time;
- no random source unless a seed is explicitly supplied and recorded;
- no network;
- no locale-dependent formatting in semantic output;
- stable action and operation ordering;
- exact script hash, API version, permission grants, dataset identity, graph/invocation identity, provider identity, and result summaries are recorded.

## Script Studio

The Script Studio should include:

- file/tree pane for local scripts and recipes;
- CodeMirror editor with TypeScript language support loaded lazily;
- generated API declarations and documentation search;
- Problems panel with parse/type/schema errors;
- manifest and permissions panel;
- fixture/example selector;
- Run, Dry Run, Test, Cancel, Install Locally, Export, Duplicate, and Revert actions;
- diff view for AI- or user-proposed changes;
- bounded console/output panel;
- operation graph and result links;
- explicit badge showing recipe, sandboxed script, or trusted extension.

Scripts are stored in IndexedDB, not localStorage. Credentials never enter the sandbox or script document.

## AI authoring

The later agent does not receive an unrestricted “execute code” tool. It receives staged tools:

```text
script.create_draft
script.read
script.apply_patch
script.typecheck
script.run_tests
script.request_install
script.request_execute
```

The user can inspect source, diff, requested capabilities, tests, and dry-run plan before installation or execution.
