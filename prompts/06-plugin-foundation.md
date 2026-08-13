# Codex prompt 06 — recipe and plugin foundation

```text
Continue in the repository after the agent exists.

Read AGENTS.md and docs/PLUGIN_SYSTEM.md. Inspect PureJsImage’s public extension contracts and current application operation tooling. Preserve changes. Do not commit, push, publish, deploy, or enable arbitrary code execution.

Build the safe foundation for browser-installable recipes and future code plugins.

## Scope

Implement fully:

- versioned plugin manifest;
- declarative analysis recipe format;
- local plugin/recipe store;
- install/validate/uninstall/export flow;
- capability declarations and policy display;
- recipe editor with live validation/dry-run;
- command-palette/analysis-catalog integration;
- agent proposal for recipe creation/modification.

Implement interfaces/tests only—not execution—for sandboxed arbitrary code plugins.

## Manifest and validation

In packages/plugin-sdk, implement the manifest described in docs/PLUGIN_SYSTEM.md with:

- bounded namespaced ID;
- semantic version string validation;
- title/description/author/license limits;
- entry kind;
- explicit capabilities;
- app and PureJsImage compatibility declarations;
- SHA-256 content integrity;
- deterministic normalization/canonical serialization;
- no unknown executable fields.

Default-deny unknown capabilities.

## Recipe format

A recipe is a JSON-safe graph template containing:

- manifest reference;
- required operation IDs/versions;
- named inputs/outputs;
- parameter declarations with defaults/bounds/help;
- graph template;
- optional required dataset characteristics;
- optional result presentation hints;
- test examples.

Use PureJsImage graph and operation descriptors. Do not invent a second analysis graph.

Validate operation availability/version and normalized parameters before installation and again before execution.

## Local store

Use IndexedDB through a PluginStore interface.

Store:

- normalized manifest;
- normalized recipe/source;
- integrity hash;
- granted capabilities;
- installation timestamp;
- test/validation status.

Do not store arbitrary executable modules in V1.

Projects record exact recipe/plugin identity when used.

## Editor and UI

Create a Plugins area accessible from settings/command palette:

- installed list;
- import/paste recipe;
- manifest/capability review;
- source editor for JSON recipe;
- live schema and graph errors;
- normalized graph preview;
- choose fixture/current dataset;
- dry-run;
- install/update/uninstall;
- diff installed versus proposed;
- export.

The AI may propose an edit, but it enters the same diff/validation/approval flow.

## Future sandbox protocol

Define versioned JSON-safe RPC contracts for a future sandbox:

- initialize plugin;
- capability grant;
- catalog operations;
- request analysis proposal/execution through host;
- emit bounded result/diagnostic;
- cancel/terminate.

Document that no executable plugin is safe merely because it runs in a normal Worker. Do not claim a sandbox implementation exists.

Production CSP must remain free of unsafe-eval.

## Tests

Add tests for:

- manifest normalization/hash;
- unknown/overbroad capability rejection;
- recipe operation/version validation;
- deterministic graph instantiation;
- parameter override bounds;
- project identity persistence;
- local store install/update/uninstall;
- hostile/deep/large JSON;
- AI proposed recipe diff and approval;
- no arbitrary code execution path;
- CSP/build contains no eval/new Function;
- future RPC messages are bounded and reject unknown kinds.

Add a built-in example recipe for calibrated precipitate counting using existing operations. Treat it as project data, not hard-coded custom algorithm logic.

## Documentation

Document:

- recipe authoring;
- capability meanings;
- trust tiers;
- project reproducibility;
- why arbitrary pasted code is not enabled yet;
- future sandbox acceptance criteria.

## Verification

Run plugin-sdk tests, browser install/edit/dry-run workflow, agent proposal test, CSP/static security check, build, and pnpm check.

Report:

- manifest/recipe contracts;
- capabilities;
- editor workflow;
- storage/provenance behavior;
- exact non-goals;
- test results;
- git diff --stat;
- remaining plugin limitation.

Do not commit or push.
```
