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

The Science host grants the bounded local set above automatically for Script Studio and Agent-made
scripts. Local analysis mutations and expensive compute run immediately through the same semantic
action host. Export, arbitrary files, external network, credentials, and trusted plugin loading are
not available to these scripts.

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

The Worker has a separate bounded startup watchdog. The configured script execution deadline begins
only after QuickJS loading, context hardening, and host bridge installation, at the explicit
`sandbox.executing` transition. This keeps slow platform bootstrap from consuming guest CPU time
without weakening the interrupt deadline applied to untrusted execution.

### Prompt 10 implementation status

The Scripts rail now opens the first-class, local-first Script Studio. It provides a CodeMirror 6
editor, generated API search and completion, TypeScript/JavaScript checking in a dedicated language
Worker, Problems, an advanced capability manifest, deterministic fixture tests, bounded output and
provenance, saved-snapshot diff, import/export, duplication, revert, cancellation, one-click local
execution, and one-click local installation. The editor, TypeScript compiler Worker, sandbox Worker,
and QuickJS-WASM runtime remain separate lazy assets and are not requested during normal startup.

`ScriptStudioRepository` is the versioned storage boundary. The browser implementation stores at
most 256 validated records in IndexedDB database `purejsimage-lab-script-studio-v1`; records include
the current and saved documents, bounded editor state, bounded test results, and an optional
exact installation snapshot. Import/export is capped at 768 KiB and rechecks document, saved,
and installation identities and hashes. Corrupt records are skipped with a user-visible warning.
Credentials and arbitrary unknown export fields are not part of the normalized record.

Five built-ins cover a particle-count recipe and sandboxed watershed, FFT radial-profile, AFM
leveling/roughness, and bounded batch-measurement scripts. Their tests use the generated calibrated
materials fixture. The action registry also exposes the staged `script.create_draft`, `script.read`,
`script.apply_patch`, `script.typecheck`, `script.run_tests`, `script.diff`,
`script.execute`, `script.request_install`, and legacy `script.request_execute` actions. The Agent
can create complete source, typecheck it, invoke `script.execute`, and install an exact local
snapshot without a user-facing approval step. The legacy request-execute action invokes the same
restricted runtime. The host still enforces exact content identity, local-only capabilities,
schemas, quotas, cancellation, and provenance.

Known limits are explicit: the language Worker uses a browser-bundled TypeScript 6 compiler alias
and a small generated declaration prelude, not the complete DOM/Node library surface. Recipe dry
runs remain proposal-only; Run invokes each declared operation through the same semantic action
host. Network capability remains unavailable, and trusted extensions remain developer-installed
build-time code. This is a restricted environment, not an independent security audit or a claim
that arbitrary code is safe.

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
- compact local-capability summary;
- fixture/example selector;
- Run, Dry Run, Test, Cancel, Install Locally, Export, Duplicate, and Revert actions;
- diff view for AI- or user-proposed changes;
- bounded console/output panel;
- operation graph and result links;
- explicit badge showing recipe, sandboxed script, or trusted extension.

Scripts are stored in IndexedDB, not localStorage. Credentials never enter the sandbox or script document.

## AI authoring

The Agent receives a simple local-analysis path backed by the restricted runtime:

```text
script.create_draft
script.read
script.apply_patch
script.typecheck
script.run_tests
script.execute
script.request_install
script.request_execute
```

For custom local analysis, the normal flow is ask, create complete source, typecheck, execute, and
report the bounded output. Creation, checking, tests, execution, and exact-snapshot local
installation are automatic. The user can open Script Studio afterward to inspect the source, diff,
output, and provenance. Export, network access, arbitrary file access, credentials, and trusted
extensions remain unavailable to this path.
