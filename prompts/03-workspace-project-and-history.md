# Codex prompt 03 — workspace, commands, persistence, and replay

```text
Continue in the repository after the real scientific viewer exists.

Read AGENTS.md, docs/ARCHITECTURE.md, and the installed PureJsImage project/analysis declarations. Inspect existing state and preserve changes. Do not commit, push, publish, or deploy.

Build the semantic workspace layer, immutable command history, and local project persistence.

## Workspace model

In packages/workspace, define a JSON-safe normalized workspace snapshot containing references to:

- project metadata;
- source locators and semantic source identities;
- open dataset descriptors/references;
- active plane/component/resolution selection;
- layers and display settings;
- ROI set;
- analysis graph and bindings;
- pinned result summaries/references;
- notes;
- panel/workflow selection that belongs in the project.

Do not store:

- API keys;
- live Worker/document/dataset/result/tile IDs;
- raw image bytes;
- complete large result tables;
- GPU handles;
- transient pointer/hover state.

Use PureJsImage’s public analysis project/graph/ROI contracts wherever they are intended for persistence. Do not create a competing graph schema.

## Commands and revisions

All semantic mutations use immutable versioned commands with expected revision.

Implement:

- validate command;
- apply one command;
- apply atomic command batch;
- undo/redo;
- command description for UI/history;
- deterministic serialization;
- bounded history;
- migration/version entry point.

Commands initially cover:

- add/remove/rebind source;
- select dataset/plane/component/level;
- add/update/remove/select ROI;
- set display layer state;
- add/update/remove analysis node/edge/binding/output;
- pin/unpin result;
- set notes/title;
- apply an agent proposal batch.

A failed command or batch leaves the snapshot unchanged.

## Runtime orchestration

Create an application service that reconciles a workspace snapshot with the imaging Worker.

Rules:

- semantic state is authoritative;
- Worker handles are caches/materializations and may be recreated;
- reopening/rebinding a source validates identity before analysis replay;
- a source mismatch produces a user-visible choice and does not silently execute;
- undoing a graph change cancels/releases obsolete runtime work;
- runtime failure does not corrupt project history.

## Persistence

Implement interfaces and initial adapters:

- IndexedDB ProjectStore;
- IndexedDB result/blob store for bounded project-associated artifacts;
- localStorage PreferenceStore for small preferences only;
- JSON project export/import;
- source-rebind workflow.

Validate imported JSON before writing to IndexedDB or applying it.

Set explicit limits for:

- project bytes;
- commands/history;
- notes/string lengths;
- ROIs;
- graph nodes/edges;
- pinned summaries;
- stored result/artifact bytes.

Project export must prove that credentials and live IDs are absent.

## UI

Wire:

- project title/save indicator;
- undo/redo;
- pipeline/history bottom panel;
- new/open/save-as/export/import;
- source rebind dialog;
- identity mismatch warning;
- recent projects;
- recovery after Worker restart.

Display history in scientist-readable terms, not raw JSON.

## Tests

Add tests for:

- every command and inverse;
- atomic batch rollback;
- stale revision rejection;
- deterministic serialization;
- import bounds/hostile JSON;
- migration fixture;
- project save/load;
- large result stored outside project JSON;
- credential and runtime-ID exclusion;
- identity match/mismatch/rebind;
- Worker recreation from snapshot;
- undo cancellation/release;
- browser reload and project replay.

Use fake services for unit tests and public PureJsImage project validation for integration tests.

## Verification

Run workspace/storage tests, public-package integration, browser project replay, accessibility, build, and pnpm check.

Report:

- project schema boundaries;
- command inventory;
- storage limits;
- identity/rebind behavior;
- migration strategy;
- test results;
- git diff --stat;
- remaining persistence limitation.

Do not commit or push.
```
