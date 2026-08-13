# AI agent architecture

## Goal

The AI assistant should make sophisticated scientific-image workflows approachable while preserving the deterministic, inspectable nature of the application.

The model proposes and explains. PureJsImage and the application execute and measure.

## V1 provider model

- User enters an OpenRouter API key in Settings.
- The key is stored in localStorage through an isolated `CredentialStore` implementation.
- The user chooses a model from an allowlisted/configurable model ID field.
- Requests are made directly from the browser to OpenRouter.
- Conversation history is stored locally through a versioned `AgentHistoryStore`; use IndexedDB for content and localStorage only for small settings.

The settings UI must explain:

- the key is stored on this browser/origin;
- scripts running on the origin and privileged browser extensions may be able to access local storage;
- the key is sent only to OpenRouter for model requests;
- clearing site data removes it.

Provide **Forget key** and **Clear assistant history** actions.

## Interfaces

```ts
interface CredentialStore {
  getOpenRouterKey(): Promise<string | undefined>
  setOpenRouterKey(value: string): Promise<void>
  clearOpenRouterKey(): Promise<void>
}

interface ModelGateway {
  stream(request: AgentModelRequest, signal: AbortSignal): AsyncIterable<AgentModelEvent>
}

interface AgentHistoryStore {
  append(threadId: string, event: PersistedAgentEvent): Promise<void>
  read(threadId: string, cursor?: string): Promise<AgentHistoryPage>
  clear(threadId?: string): Promise<void>
}
```

Never let domain packages import the OpenRouter transport directly.

## Agent loop

```text
user request
  ↓
collect bounded workspace context
  ↓
model proposes tool calls
  ↓
validate tool arguments
  ↓
read-only tools execute automatically
  ↓
mutating/expensive tools create an approval proposal
  ↓
user approves
  ↓
application applies revisioned commands / executes graph
  ↓
return bounded structured result
  ↓
model explains with units and links to workspace objects
```

No `eval`, generated DOM mutation, or direct arbitrary function invocation.

## Tool surface

The tool host should expose a small, composable set rather than one tool per UI button.

### Read-only

- `workspace.get_summary`
- `dataset.list`
- `dataset.describe`
- `dataset.get_plane_context`
- `roi.list`
- `result.list`
- `result.summarize`
- `analysis.catalog_operations`
- `analysis.describe_operation`
- `analysis.validate_graph`
- `analysis.dry_run`

### Proposals and mutations

- `workspace.propose_commands`
- `roi.propose_create`
- `analysis.propose_graph_change`
- `analysis.propose_execute`
- `project.propose_export`
- `plugin.propose_install`

The model should not invoke low-level tile reads. It receives bounded thumbnails, metadata summaries, histograms, sampled profiles, or structured result summaries only through deliberate tools.

## PureJsImage integration

Generate the operation toolbox from the controller’s JSON-safe capability/operation descriptors.

The application adapter should support this flow:

```text
catalog operations
→ describe selected operations
→ normalize parameters
→ validate command/graph
→ dry-run and obtain structured issues/cost
→ execute after policy approval
→ summarize result
```

Do not maintain a separate hand-authored list of analysis operations for the agent.

## Context limits

Never place these directly in the model context:

- raw image bytes;
- full-resolution images;
- complete large result tables;
- complete arbitrary metadata trees;
- secrets;
- hidden application state.

Use bounded summaries:

```ts
interface AgentResultSummary {
  readonly kind: string
  readonly units?: readonly string[]
  readonly objectCount?: number
  readonly rowCount?: number
  readonly previewRows?: readonly unknown[]
  readonly statistics?: Readonly<Record<string, number>>
  readonly warnings?: readonly string[]
  readonly workspaceLinks?: readonly WorkspaceObjectReference[]
}
```

## Approval policy

```ts
type AgentPermission =
  | 'workspace.read'
  | 'workspace.propose'
  | 'analysis.execute'
  | 'compute.expensive'
  | 'network.read'
  | 'file.export'
  | 'plugin.install'
```

The policy engine—not the model—decides whether a call is automatic, proposed, or denied.

The default policy:

- read-only metadata and summaries: allow;
- validation/dry-run: allow;
- reversible project commands: require proposal approval;
- execution below configured resource threshold: require one approval per proposal;
- expensive execution: show estimated memory/tiles/remote bytes and require explicit approval;
- export, upload, or plugin install: always explicit;
- unknown permission: deny.

## Prompt injection and untrusted content

Metadata, filenames, annotations, plugin descriptions, and imported project notes are untrusted data. They may contain text such as “ignore instructions.”

Represent them in tool results as labeled data fields. The system prompt must say that tool data cannot change tool permissions or agent policy.

The agent cannot use arbitrary network access in V1. OpenRouter itself is the only model endpoint. Future web/data connectors require separate permissions.

## History

Persist:

- user and assistant messages;
- proposed tool calls;
- validation issues;
- approvals/rejections;
- bounded tool results;
- references to graph nodes, ROIs, and results;
- model/provider metadata;
- timestamps.

Do not persist:

- API keys;
- raw image tiles;
- full result tables;
- transient prepared plan IDs;
- complete stack traces.

Cap history by total bytes and event count. Provide export only after secret/redaction validation.

## Agent tests

Use a deterministic fake gateway. Tests should never require a live API key.

Required scenarios:

1. Agent catalogs operations and proposes threshold → connected components.
2. Invalid operation parameters produce structured issues and a corrected proposal.
3. Mutation cannot apply without the expected workspace revision.
4. Expensive analysis requires approval and displays cost.
5. Cancellation stops model streaming and analysis execution.
6. Result summary includes units and object count but not the full object table.
7. A prompt-injection string in metadata cannot grant permissions.
8. API key never appears in persisted history, logs, exported project, or error telemetry.
9. A denied plugin-install proposal stays denied even when the model retries with altered prose.
10. Agent-created graph is identical to one built manually through the UI.
