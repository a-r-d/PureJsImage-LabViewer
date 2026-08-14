# Codex prompt 06 — actions sandbox plugin foundation


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

Create the contract and security foundation that will let users and the later AI assistant author reusable recipes and arbitrary analysis scripts without executing untrusted code in the page, React realm, or imaging Worker.

This prompt builds a sandbox proof and the complete contracts. It does not yet build the full Script Studio.

## 1. Update project rules and docs

Integrate the important rules from `AGENTS_V2.md` and `docs/SCRIPTING_PLUGIN_V2.md` into the repository.

Correct the old blanket rule “the model may never execute arbitrary JavaScript” to the precise rule:

> User/AI-authored executable code may run only inside the dedicated sandbox Worker and QuickJS-WASM runtime through a default-deny capability host. It never runs in the page, React realm, imaging Worker, or unrestricted module Worker.

## 2. Expand plugin SDK contracts

Extend `packages/plugin-sdk` with bounded validators/normalizers for:

- `RecipeDocumentV1`;
- `AnalysisScriptDocumentV1`;
- script/plugin manifest;
- capabilities and permission grants;
- integrity/content hash;
- compatibility ranges;
- local installation record;
- script test case/result;
- sandbox RPC messages;
- provenance references.

Keep contracts JSON-safe. Bound source length, manifest fields, test count, message size, and capability count.

## 3. Sandbox runtime package

Create `packages/scripts` or the cleanest equivalent.

Architecture:

```text
main/app realm
  → script-host client
    → dedicated browser Worker
      → QuickJS-WASM runtime/context
        → generated @lab/api module
          → bounded capability RPC back to host
```

Use `quickjs-emscripten` or a carefully justified equivalent. Load it lazily only when scripts are used.

Security requirements:

- no DOM/window/document;
- no localStorage, IndexedDB, cookies, clipboard, credentials, or browser APIs;
- no ambient fetch/WebSocket/EventSource;
- no unrestricted dynamic import/module loader;
- only generated `@lab/api` and script-local approved modules;
- memory and stack limits;
- deadline/interrupt handler;
- maximum source bytes, output bytes, messages, message bytes, API calls, and console lines;
- cancellation that disposes the context/runtime and can terminate/recreate the Worker;
- explicit serialization; no host prototypes/functions passed through;
- no SharedArrayBuffer initially;
- deterministic mode with no Date/random/network unless explicitly supplied as recorded capabilities.

Use the debug QuickJS variant in a leak-detection test suite and the release variant for production/performance tests.

Do not claim independent security audit.

## 4. Generated script API

Generate a versioned TypeScript declaration and runtime catalog from the semantic action registry.

Initial sandbox API should support a useful but narrow read/proposal flow against generated fixtures:

- workspace summary;
- source/dataset list and descriptors;
- ROI list/proposal;
- analysis catalog/describe/normalize/dry-run/request-execute;
- result summary/page;
- viewport/UI proposals;
- bounded log output.

Every call routes through the same validator, availability, policy, revision, dry-run, cost, and cancellation paths as normal UI actions.

No raw tile/source bytes enter the sandbox.

## 5. Sandbox proof UI

Add a developer-only or Scripts placeholder surface capable of:

- loading a built-in script fixture;
- showing manifest/capabilities/source;
- running parse/type-contract validation;
- executing it in the sandbox against the generated sample;
- showing bounded logs and proposed actions;
- cancelling/terminating it.

Do not build the full editor/store/import/export yet.

## Security and correctness tests

Prove:

- DOM/window/storage/network are absent;
- attempts to access them fail;
- infinite loops terminate;
- memory/stack/message/tool-call limits work;
- cancellation terminates execution;
- malformed RPC and oversized values are rejected;
- ungranted actions are denied;
- a script cannot obtain OpenRouter credentials;
- host action validation cannot be bypassed;
- script crash cannot corrupt workspace or imaging Worker;
- source hash, manifest, permissions, action/tool trace, and result summary appear in provenance;
- all QuickJS handles/runtimes are disposed without debug leak reports.

## Verification

Run all normal gates plus dedicated sandbox release/debug suites and a browser E2E proof. Report dependency/bundle impact and confirm QuickJS is code-split from normal startup.
