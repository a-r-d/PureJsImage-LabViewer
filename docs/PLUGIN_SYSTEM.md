# Plugin and recipe system

## Vision

A corporate user may be able to open a browser but not install Fiji, Python, native dependencies, or institution-unapproved plugins. The browser workbench can make extensions portable and inspectable:

- paste a recipe or plugin package;
- inspect its manifest and source;
- see requested capabilities;
- validate it before installation;
- edit it in the browser;
- let the AI propose a modification;
- execute it in a restricted environment;
- record its exact version/hash in the project.

This is a major differentiator, but only if the trust model is honest.

## Extension tiers

### Tier 1: analysis recipes

Declarative JSON documents describing:

- required operation IDs/versions;
- graph template;
- parameter definitions;
- input/output requirements;
- optional UI metadata;
- semantic version and content hash.

Recipes contain no executable code and are the first supported plugin type.

Examples:

- precipitate counting;
- nanofiber diameter workflow;
- FFT radial-profile workflow;
- porosity measurement;
- standardized facility QA procedure.

### Tier 2: trusted application modules

Normal TypeScript/JavaScript modules installed at build time or through a developer-only local mechanism. These may contribute operations/providers through PureJsImage’s extension system.

They execute with application trust and are never described as sandboxed.

### Tier 3: sandboxed code plugins

User- and AI-authored analysis scripts execute in a dedicated browser Worker containing a separate
QuickJS-WASM runtime. They receive only the generated, versioned `@lab/api` capability surface.
They never execute in the page, React realm, imaging Worker, or an unrestricted module Worker and
receive no DOM, storage, credentials, source bytes, or ambient network APIs.

## Manifest

```ts
interface PluginManifestV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly version: string
  readonly title: string
  readonly description: string
  readonly author?: string
  readonly license?: string
  readonly entryKind: 'recipe' | 'trusted-module' | 'sandboxed-module'
  readonly requestedCapabilities: readonly ScriptCapability[]
  readonly compatibility: {
    readonly pureJsImage: string
    readonly workbench: string
  }
  readonly integrity?: {
    readonly algorithm: 'sha256'
    readonly digest: string
  }
}
```

Initial capabilities:

```text
analysis.catalog
analysis.propose
analysis.execute
workspace.read
workspace.propose
result.read-summary
result.emit
ui.panel
network.fetch-explicit-hosts
storage.plugin-scope
```

Default deny.

## Plugin SDK responsibilities

`packages/plugin-sdk` owns:

- manifest validation and normalization;
- recipe validation;
- capability types;
- installation records;
- content hashing;
- compatibility checks;
- bounded RPC messages for the script sandbox;
- deterministic fixtures and conformance tests.

It does not execute code; `packages/scripts` owns the isolated runtime and Worker lifecycle.

## In-browser editor

The first editor can support recipes and manifests:

- code editor with JSON/TypeScript syntax highlighting;
- live schema errors;
- normalized preview;
- graph visualization;
- test fixture selection;
- dry-run;
- diff against installed version;
- save locally;
- export package.

AI editing workflow:

```text
user asks for a custom workflow
→ agent proposes a recipe change
→ editor shows diff
→ schema and graph validation run
→ user approves installation into local plugin store
→ recipe executes through normal analysis tools
```

AI-authored executable code remains disabled until the sandbox is implemented and audited.

## Reproducibility

Projects store:

- plugin ID and version;
- normalized manifest;
- content hash;
- operation/provider versions contributed;
- relevant recipe graph;
- permission grants.

A project must warn if the exact plugin content is unavailable or mismatched.

## Security tests

Before enabling executable plugins, prove:

- no DOM/window access;
- no credential access;
- no arbitrary network access;
- memory and CPU quotas;
- termination on timeout/cancel;
- bounded messages;
- no SharedArrayBuffer unless deliberately isolated and permitted;
- capability enforcement independent of model/plugin text;
- immutable source/result inputs unless the contract explicitly grants an output buffer;
- plugin crash cannot corrupt the project or imaging worker;
- exact source/version/hash appears in provenance.
