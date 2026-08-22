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
- `script.execute`
- `script.request_install`
- `script.request_execute`
- `plugin.list`

No unrestricted shell, JavaScript evaluation, file read, network fetch, or credential tool.

When direct semantic actions are not expressive enough, the Agent may write a complete local
TypeScript analysis, typecheck it, and call `script.execute` without interrupting the user. The
execution still occurs in the dedicated QuickJS Worker with bounded local capabilities, content
identity, quotas, cancellation, and provenance. Installation, export, network access, arbitrary file
access, and trusted extension loading are not part of this automatic path.

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
- recent conversation turns and a deterministic retained ledger when budgets are exceeded.

Do not invent a conversation summary through an unreviewed model call. Compaction removes old raw
turns, retains bounded facts (goals, decisions, source/result IDs, grants), and records that
compaction occurred. Science and Atlas share `AgentConversationShell` with restricted Markdown
answers. Intermediate actions sit between the user message and the answer in a collapsed work
trail (one current step while running). Session grants and run diagnostics stay behind
disclosures. Large Markdown tables fold until the user opens them. The OpenRouter key is
remembered in this browser unless the user unchecks that option.

Use stable references (`dataset:...`, `roi:...`, `node:...`, `result:...`) so the model can refer to objects without repeating large payloads.

## Tool loop

- Request sequential tool calling (`parallel_tool_calls: false`), but accept a bounded ordered batch
  when a provider still returns multiple calls in one assistant message. Execute the calls in order
  and append one matching tool result for every call. After a failure or project-revision change,
  mark the remaining calls not executed so the model can reassess against current state.
- Treat absent or null tool-call arrays as empty, accept JSON arguments encoded as either the
  standard string or an already-decoded object, and reject duplicate call IDs. A successful
  mutation ends the current batch even if a buggy handler does not advance the project revision.
- Validate every tool argument against the action registry’s JSON Schema.
- Enforce max iterations, tool calls, elapsed time, input/output tokens, result bytes, and estimated cost.
- Append assistant tool-call messages and matching tool-result messages in correct order.
- Do not rewrite already-sent live-loop messages; prefix edits bust provider prompt cache.
- Preserve any provider-required reasoning details during the active loop without exposing hidden reasoning in the UI.
- Retry only classified transient transport/provider errors.
- Never retry mutations blindly.
- Support user cancellation while waiting for model or tool execution.

## Product policy profiles

Science is a no-friction, local-machine profile. Once the user connects the Agent and opens a
specimen, bounded local reads, proposals, analysis execution, viewport previews, Script Studio
authoring, typechecking, tests, execution, and exact-snapshot local installation run automatically.
They never stop on an approval or capability dialog. The host still validates schemas, revisions,
availability, resource limits, content identity, cancellation, sandbox quotas, and provenance.

Science does not expose external network, export, arbitrary-file, credential, trusted-plugin, or
browser-screen capture capabilities through this automatic path. Those actions are unavailable,
not converted into repeated permission prompts. The specimen viewport preview remains bounded and
automatic.

Atlas retains its own explicit approval policy for remote catalog/network work, model-visible geo
previews, export, and external side effects. The shared runtime therefore still supports an
`awaiting-approval` state, but the normal Science local-analysis policy never emits it. See
`docs/adr/0002-no-friction-local-science-agent.md`.

## Credentials and local history

- Science and Atlas both default “Remember on this browser” on. Unchecking it keeps the key
  in this tab only and warns that a refresh will lose it. Session keys are never copied to
  localStorage without that checkbox.
- Display whether the current persistence is session or browser, and always offer remove/revoke.
- Keep usage telemetry compact: show the latest request's prompt tokens against the provider's
  advertised context window and the cumulative provider-reported USD cost for the current
  conversation. Never estimate price from a local model table; show unavailable or partial cost
  explicitly when OpenRouter omits accounting for any call.
- The provider-independent agent core never owns storage.
- Store conversation/event history in IndexedDB because it can exceed localStorage capacity.
- Never store the API key in history, tools, projects, logs, error reports, URLs, telemetry, or eval traces.
- Add a clear “local browser storage is not an enterprise secret vault” warning and recommend a
  separate low-limit OpenRouter key.
- Add delete/export history actions; exports are secret-scanned.
- Remembered approval scopes are listed, revocable, audited, and cleared when the runtime is disposed.

## Initial model settings

Use a configurable model setting. The suggested default for development/evals is:

```text
model: openai/gpt-5.6-luna
reasoning effort: high for the Science live-eval configuration
parallel tool calls: false
```

Read supported parameters from model metadata where possible and fail clearly when the selected model cannot support required tools or schemas.
Atlas and the Materials Workbench also recommend `google/gemini-3.7-flash` and permit a custom
OpenRouter model ID after the same live tool-capability validation. Image previews additionally
require advertised image input.

## Testing

Normal CI uses a deterministic fake OpenRouter transport that can produce:

- final text;
- one or multiple sequential tool calls;
- malformed arguments, which the host returns as a bounded tool error when they fail schema
  validation so the model can correct the call;
- unknown tools;
- repeated calls;
- approval waits;
- cancellation;
- provider errors;
- max-step loops.

No live key is ever required in CI.
