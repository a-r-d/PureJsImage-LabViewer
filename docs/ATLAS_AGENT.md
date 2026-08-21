# Atlas agent runtime

## Boundary

The Atlas agent is a client of the existing semantic action surface. Its capability manifest is
generated from the current `GeoWorkbenchController` action registry and live availability; there is
no second model-only tool catalog. Every proposed call carries an action ID, action version, and
expected project revision, is planned and validated locally, passes Atlas policy, and executes
through the controller's `ActionHost`.

Model context contains only bounded JSON summaries of project identity, CRS, normalized source
identity, band metadata, layer recipes, ROIs, and selection. It does not contain files, blobs, source
pixels, native tiles, dataset handles, Workers, stores, credentials, signed catalog URLs, or browser
storage access. Tool results are depth- and byte-bounded and arrays are paginated. Approved preview
bytes are held only in memory, attached to the immediately following multimodal model request, and
replaced by a text-only artifact reference in retained conversation history.

## Runtime and policy

`packages/agent` owns the provider-independent state machine, bounded cross-turn conversation,
limits, audit record, approval waits, cancellation, compact results, and deterministic replay.
Only completed turns enter retained in-memory history; failed turns do not. A new-conversation
control clears history, and a deterministic retained ledger replaces oldest-turn deletion when
message or byte budgets are met.
`packages/geo-workbench` adapts the live
controller into the narrow gateway and owns Atlas policy:

- bounded catalog metadata reads may run automatically;
- network source opens and catalog resolution require approval;
- project mutations and viewport proposals require approval by default;
- expensive raster work, exports, model-visible previews, and relay use require approval;
- local policy is authoritative; model text cannot waive it.

The audit record includes the request, provider/model, plan, approvals, versioned trace, normalized
inputs/results, source/project context, artifact IDs, failures, retries, and timestamps. Replay invokes
the saved approved action inputs against the same initial project revision without a model request.

`geo.preview.create` is an approval-gated action. The first viewport preview in a runtime session
grants the bounded viewport-preview scope, so later viewport previews remain audited without
repeated prompts. Screen sharing has a separate one-time session scope and still invokes the native
display picker. The action accepts a layer, viewport, or user-selected
browser screen, 64–1024
pixel dimensions under a 786,432-pixel total, current Atlas styling, and optional overlays. The
viewport renderer enforces a 2 MiB result budget and returns attribution and project revision.
Screen scope invokes the browser's native display-share picker after Atlas approval; Atlas cannot
silently choose or capture a display. Capture tracks are stopped after one bounded PNG frame.

## OpenRouter transport

The transport uses OpenRouter Chat Completions with sequential tool calling
(`parallel_tool_calls: false`) and appends assistant tool calls plus matching `tool_call_id` results.
The model picker reads the Models API with `supported_parameters=tools` and rejects a selection that
does not advertise tool support. It defaults to `openai/gpt-5.6-luna`, offers
`google/gemini-3.7-flash`, lists other returned tool-capable models, and accepts a custom OpenRouter
model ID. Custom IDs receive the same live metadata validation. A model must also advertise image
input before an approved preview is captured. Provider errors are normalized from documented error metadata and
only classified transient failures receive bounded retries.

Implementation references inspected on 2026-08-20:

- [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling)
- [Chat Completions API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion)
- [Models API](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
- [Errors and debugging](https://openrouter.ai/docs/api_reference/errors-and-debugging)

The user key is held by `OptionalPersistentOpenRouterCredentialStore`. The connect dialog defaults
to remembering it in this browser. Unchecking that option keeps the key in this tab only and warns
that a refresh will lose it. The store never copies a session key to localStorage without that
checkbox. The key is never serialized into projects or tool results. Unmounting Atlas disposes the
runtime and its session grants; it does not revoke a remembered browser key. The model-independent
transport interface permits a future server relay without coupling the runtime to OpenRouter.

## Evaluation

Required CI uses `DeterministicAgentTransport`. The Atlas suite covers the 13 requested catalog,
display, derived-raster, comparison, ROI, save, and rehydration tasks against the current geo action
registry. Runtime failure tests cover malformed input that fails schema validation as a recoverable
tool error, unavailable actions, provider exhaustion, step limits, timeout, cancellation, stale
revision, approval denial, oversized results, and unsupported models; fixture registrations include
unsupported-decoder and unavailable-relay failures. Live OpenRouter evaluation remains opt-in and is
never part of normal CI.
