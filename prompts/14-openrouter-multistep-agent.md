# Codex prompt 14 — openrouter multistep agent


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

Build the AI assistant as a first-class client of the completed semantic action surface. It must support robust multi-step OpenRouter tool calling, bounded context, approvals, state/history, UI proposals, analysis execution, and script authoring.

Integrate `docs/AGENT_V2.md`.

## Packages and boundaries

Implement the real `packages/agent` with:

- normalized message/event types;
- OpenRouter transport interface and fetch implementation;
- deterministic fake transport;
- agent controller/state machine;
- context builder/compactor;
- tool schema adapter from the action registry;
- policy/approval integration;
- usage/cost/budget tracking;
- local history repository interface;
- secret redaction.

The package must not import React, DOM state, or PureJsImage directly.

## Credentials and settings

Implement `CredentialStore`:

- OpenRouter key in localStorage as requested;
- never included in application state snapshots;
- clear warning about local browser storage;
- delete/reveal/copy protections;
- model, reasoning effort, limits, and provider preferences stored separately from the secret;
- default development selection `openai/gpt-5.6-luna` with medium reasoning, but configurable;
- capability check for tool calling/structured output before a run.

Conversation and event history belongs in IndexedDB, not localStorage.

## Tool loop

Implement a bounded sequential loop initially:

- `parallel_tool_calls: false`;
- append assistant tool-call message and matching tool result correctly;
- validate strict JSON arguments;
- unknown/invalid tool is returned as a structured tool error, not executed;
- policy and approval before mutation/compute/export/script execution;
- max iterations/tool calls/time/tokens/result bytes/cost;
- cancellation for model request and tool execution;
- transient retry classification;
- no blind mutation retry;
- final answer only after tool loop finishes;
- structured outputs where supported for internal planning/summary states.

## Context

Include only bounded relevant data:

- operation/action catalog summaries;
- workspace revision/summary;
- source/dataset/calibration metadata;
- active viewport/ROI/selection;
- graph/pipeline excerpt;
- bounded result summaries;
- installed recipe/script manifests;
- recent conversation plus compacted summary.

No raw full-resolution pixels by default. Add a separate user-approved viewport snapshot context action if justified.

## Tools

Expose semantic tools covering:

- workspace/source/dataset;
- ROI;
- analysis catalog/normalize/dry-run/execute/cancel;
- result summary/page;
- pipeline;
- viewport and UI proposals;
- examples;
- script draft/patch/typecheck/test/install/execute;
- project save/export proposal.

No arbitrary DOM selector, JavaScript eval, filesystem, URL fetch, credentials, or shell.

## Agent UI

Build a serious panel/surface showing:

- conversation;
- context/source indicators;
- proposed steps;
- approval cards with normalized arguments and estimates;
- live tool trace;
- cancel/stop;
- usage/cost/step budget;
- bounded result summaries with units;
- links selecting relevant datasets, ROIs, nodes, results, scripts, or panels;
- retry/edit-plan paths;
- history list and delete/export.

Do not show private chain of thought. Show concise rationale/assumptions and tool activity.

## Tests

Normal CI uses fake transport scenarios for:

- answer without tools;
- metadata/ROI/analysis multi-step chain;
- approval accept/reject;
- malformed/unknown tool;
- stale revision repair;
- validation repair;
- expensive compute approval;
- script draft/typecheck/fix/test/install request;
- UI/viewport proposal;
- cancellation/model error/retry/max steps;
- history reload;
- key never appears in logs/state/export/error/snapshot;
- accessibility and deterministic agent screenshots.

No live OpenRouter call in CI.
