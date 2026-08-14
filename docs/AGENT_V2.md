# AI assistant architecture V2

## Sequencing

Build the assistant after the analysis catalog, Script Studio, example library, and semantic action registry are stable. The assistant is a client of the product; it must not become a second hidden implementation of product behavior.

## Core architecture

```text
Agent panel
  → Agent controller/state machine
    → Context builder
    → OpenRouter client
    → Tool-call loop
    → Policy/approval engine
    → Semantic action host
      → workspace / source / dataset / ROI / analysis / results / scripts / viewport / UI
```

The model proposes tool calls. Application code validates, authorizes, executes, and returns bounded results.

## State machine

Suggested states:

```text
idle
building-context
requesting-model
awaiting-approval
executing-tool
awaiting-tool-result
summarizing
completed
cancelled
failed
```

Persist a normalized event log rather than serializing mutable controller internals.

## Tool surface

Tools should be semantic and JSON-safe:

### Workspace and source

- `workspace.get_summary`
- `source.list`
- `source.get_metadata`
- `dataset.list`
- `dataset.describe`

### Viewport and UI

- `viewport.get_state`
- `viewport.propose_state`
- `ui.propose_open_panel`
- `ui.propose_select_tab`
- `ui.propose_select_object`

The agent never clicks arbitrary CSS selectors or mutates the DOM.

### ROIs and analysis

- `roi.list`
- `roi.propose_create`
- `roi.propose_update`
- `analysis.catalog`
- `analysis.describe`
- `analysis.normalize`
- `analysis.dry_run`
- `analysis.request_execute`
- `analysis.cancel`
- `pipeline.get`

### Results

- `result.summarize`
- `result.get_page`
- `result.get_plot_summary`
- `result.propose_export`

### Scripts and plugins

- `script.list`
- `script.create_draft`
- `script.read`
- `script.apply_patch`
- `script.typecheck`
- `script.run_tests`
- `script.request_install`
- `script.request_execute`
- `plugin.list`

No unrestricted shell, JavaScript evaluation, file read, network fetch, or credential tool.

## Context management

Build bounded context from:

- product/system instructions;
- operation/action catalog summaries;
- active workspace summary and revision;
- source and dataset descriptors;
- calibration and units;
- active plane/view and selected ROI;
- relevant pipeline nodes;
- bounded result summaries;
- installed recipe/script manifests;
- recent conversation turns and compacted summaries.

Do not send raw full-resolution pixels by default. An explicit “share current viewport snapshot” action may provide a downsampled rendered image with the user’s approval and clear privacy text.

Use stable references (`dataset:...`, `roi:...`, `node:...`, `result:...`) so the model can refer to objects without repeating large payloads.

## Tool loop

- Start with sequential tool calls (`parallel_tool_calls: false`).
- Validate every tool argument against the action registry’s JSON Schema.
- Enforce max iterations, tool calls, elapsed time, input/output tokens, result bytes, and estimated cost.
- Append assistant tool-call messages and matching tool-result messages in correct order.
- Preserve any provider-required reasoning details during the active loop without exposing hidden reasoning in the UI.
- Retry only classified transient transport/provider errors.
- Never retry mutations blindly.
- Support user cancellation while waiting for model or tool execution.

## Approval policy

Suggested defaults:

- read-only summaries: automatic;
- proposal/dry-run: automatic;
- reversible ROI/graph/UI mutation: approval before apply;
- expensive compute: explicit plan/cost approval;
- script install/execute: source/permissions/test review plus approval;
- export, upload, or external network: approval every time.

The approval card shows exact command/tool, target object, normalized parameters, estimated memory/work, source ranges where known, and expected outputs.

## Credentials and local history

- Store the OpenRouter key only through `CredentialStore` in localStorage as requested.
- Store conversation/event history in IndexedDB because it can exceed localStorage capacity.
- Never store the API key in history, tools, projects, logs, error reports, URLs, telemetry, or eval traces.
- Add a clear “local browser storage is not an enterprise secret vault” warning.
- Add delete/export history actions; exports are secret-scanned.

## Initial model settings

Use a configurable model setting. The suggested default for development/evals is:

```text
model: openai/gpt-5.6-luna
reasoning effort: medium
parallel tool calls: false
```

Read supported parameters from model metadata where possible and fail clearly when the selected model cannot support required tools or schemas.

## Testing

Normal CI uses a deterministic fake OpenRouter transport that can produce:

- final text;
- one or multiple sequential tool calls;
- malformed arguments;
- unknown tools;
- repeated calls;
- approval waits;
- cancellation;
- provider errors;
- max-step loops.

No live key is ever required in CI.
