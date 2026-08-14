# Codex prompt 10 — script studio executable plugins


You are working in `a-r-d/PureJsImage-LabViewer` after prompts 00–04.

The baseline originally inspected for this revised roadmap was commit `3729a846a084e38ae830c429ff5b30d448537cb2`, but do not assume that is still HEAD.

Before editing:

1. Read `AGENTS.md` and every architecture/product document relevant to this prompt.
2. Report the current HEAD and `git status --short`.
3. Inspect the current implementation and tests instead of assuming filenames or APIs from this prompt are exact.
4. Preserve every user change.

Do not commit, push, merge, deploy, publish packages, modify remote metadata, weaken tests, or regenerate visual/numerical goldens merely to make a gate pass. Leave one complete inspectable working-tree diff.

The app is already deployed at `lab.purejsimage.com`; deployment work is out of scope.


## Goal

Turn the sandbox foundation into a first-class Script Studio where users can write, edit, test, install, run, import, and export declarative recipes and sandboxed analysis scripts. Prepare staged actions that the later AI assistant can use without integrating a model yet.

## Editor

Use a focused modular browser editor such as CodeMirror 6. Load editor/language/compiler/sandbox bundles lazily.

Provide:

- scripts/recipes list;
- source editor;
- generated `@lab/api` declarations;
- API search and examples;
- Problems panel;
- manifest/permissions panel;
- test cases and fixture selector;
- bounded console/output;
- graph/result links;
- diff/review view;
- Run, Dry Run, Test, Cancel, Install Locally, Export, Duplicate, Revert.

TypeScript may be transpiled/typechecked in a dedicated lazy language Worker. Do not put the TypeScript compiler into initial workbench startup.

## Local store

Store scripts, recipes, installation records, test results, and editor state in IndexedDB through a versioned repository interface.

- normalized content hash;
- no credentials;
- bounded source/test/log size;
- migration and corruption handling;
- export/import validation;
- exact installed version/content retained for project replay;
- missing/mismatched plugin warnings.

## Script API

Expose the complete stable action surface needed for existing analysis workflows. Generate runtime bindings and TypeScript declarations from the same source.

Scripts should be able to:

- inspect datasets/calibration/metadata;
- create/update ROIs through proposals;
- compose/dry-run/execute operations;
- read bounded result summaries/pages;
- run particle, FFT, AFM, stack, and batch workflows;
- propose viewport/UI selection for presentation;
- export only through explicit host approval.

## Built-in examples

Ship at least:

- particle count recipe;
- watershed particle script;
- FFT radial-profile script;
- AFM leveling/roughness script;
- batch measurement script.

Each has deterministic tests against generated scenarios.

## AI-ready staged actions

Register, but do not connect to a model:

```text
script.create_draft
script.read
script.apply_patch
script.typecheck
script.run_tests
script.diff
script.request_install
script.request_execute
```

They use the same action/policy host and produce bounded JSON-safe results.

## Security tests

Retain all prompt-06 sandbox tests. Add import/export attacks, malicious source, quota exhaustion, script-store corruption, permission changes, script identity mismatch, and project replay tests.

## UX tests

- keyboard-only create/edit/typecheck/test/run;
- API search and autocomplete;
- capability review;
- diff approval;
- cancellation;
- clear distinction among recipe, sandboxed script, and trusted extension;
- no misleading “safe” or “secure” claim beyond documented guarantees.
