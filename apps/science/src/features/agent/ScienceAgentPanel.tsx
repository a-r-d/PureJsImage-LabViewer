import type {
  AgentModelSummary,
  AgentRuntime,
  MemoryOpenRouterCredentialStore,
  OpenRouterTransport,
} from '@pji-workbench/agent'
import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_RECOMMENDED_MODELS } from '@pji-workbench/agent'
import { Button } from '@pji-workbench/ui'
import { useCallback, useState, useSyncExternalStore } from 'react'

export function ScienceAgentPanel({
  runtime,
  credentials,
  transport,
}: {
  readonly runtime: AgentRuntime
  readonly credentials: MemoryOpenRouterCredentialStore
  readonly transport: OpenRouterTransport
}) {
  const subscribe = useCallback((listener: () => void) => runtime.subscribe(listener), [runtime])
  const getSnapshot = useCallback(() => runtime.getSnapshot(), [runtime])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [keyInput, setKeyInput] = useState('')
  const [keyPresent, setKeyPresent] = useState(() => credentials.has())
  const [models, setModels] = useState<readonly AgentModelSummary[]>([])
  const [modelChoice, setModelChoice] = useState(DEFAULT_OPENROUTER_MODEL)
  const [customModel, setCustomModel] = useState('')
  const [request, setRequest] = useState('')
  const [panelError, setPanelError] = useState<string>()
  const [loadingModels, setLoadingModels] = useState(false)
  const active = !['idle', 'completed', 'cancelled', 'failed'].includes(snapshot.status)
  const selectedModel = modelChoice === 'custom' ? customModel.trim() : modelChoice
  const latestParticlePlan = snapshot.trace.findLast(
    ({ actionId }) => actionId === 'analysis.particle.plan',
  )

  const saveKey = (): void => {
    try {
      credentials.set(keyInput)
      setKeyInput('')
      setKeyPresent(true)
      setPanelError(undefined)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error))
    }
  }

  const removeKey = (): void => {
    credentials.clear()
    setKeyInput('')
    setKeyPresent(false)
    setModels([])
    setPanelError(undefined)
  }

  const loadModels = async (): Promise<void> => {
    setLoadingModels(true)
    setPanelError(undefined)
    try {
      setModels(await transport.listModels())
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingModels(false)
    }
  }

  const run = (): void => {
    const submitted = request.trim()
    setPanelError(undefined)
    void runtime
      .start(submitted, selectedModel)
      .then(() => {
        setRequest('')
      })
      .catch((error: unknown) => {
        setPanelError(error instanceof Error ? error.message : String(error))
      })
  }

  const additionalModels = models.filter(
    (entry) => !OPENROUTER_RECOMMENDED_MODELS.some(({ id }) => id === entry.id),
  )

  return (
    <div className="inspector-content science-agent" data-testid="science-agent-panel">
      <section aria-labelledby="science-agent-key-heading">
        <p className="panel-kicker">Approval-gated semantic action client</p>
        <h3 id="science-agent-key-heading">OpenRouter session</h3>
        <p className="panel-note">
          The key stays in memory only and is cleared when this workbench session ends.
        </p>
        <label>
          OpenRouter key
          <input
            autoComplete="off"
            disabled={active}
            onChange={(event) => setKeyInput(event.currentTarget.value)}
            placeholder={keyPresent ? 'Key loaded for this session' : 'Paste key'}
            type="password"
            value={keyInput}
          />
        </label>
        <div className="science-agent__actions">
          <Button disabled={active || keyInput.trim().length === 0} onClick={saveKey}>
            Use for session
          </Button>
          <Button disabled={active || !keyPresent} onClick={removeKey}>
            Remove
          </Button>
        </div>
        <p aria-live="polite" className="panel-note">
          Key status: {keyPresent ? 'available in memory' : 'not set'}
        </p>
      </section>

      <section aria-labelledby="science-agent-task-heading">
        <h3 id="science-agent-task-heading">Scientific task</h3>
        <label>
          Tool-capable model
          <select
            disabled={active}
            onChange={(event) => setModelChoice(event.currentTarget.value)}
            value={modelChoice}
          >
            <optgroup label="Recommended">
              {OPENROUTER_RECOMMENDED_MODELS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {models.find(({ id }) => id === entry.id)?.name ?? entry.name}
                </option>
              ))}
            </optgroup>
            {additionalModels.length === 0 ? null : (
              <optgroup label="Loaded tool-capable models">
                {additionalModels.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="custom">Custom model ID…</option>
          </select>
        </label>
        <Button disabled={active || !keyPresent || loadingModels} onClick={() => void loadModels()}>
          {loadingModels ? 'Loading models…' : 'Load current models'}
        </Button>
        {modelChoice !== 'custom' ? null : (
          <label>
            Custom OpenRouter model ID
            <input
              autoComplete="off"
              disabled={active}
              maxLength={256}
              onChange={(event) => setCustomModel(event.currentTarget.value)}
              placeholder="provider/model"
              type="text"
              value={customModel}
            />
          </label>
        )}
        <p className="panel-note">
          Custom models must advertise tool calling. Viewport and screen inspection also require
          image input support.
        </p>
        <label>
          Request or follow-up
          <textarea
            disabled={active}
            maxLength={16_384}
            onChange={(event) => setRequest(event.currentTarget.value)}
            placeholder="Analyze these particles, inspect the result, and tune the parameters if needed."
            rows={6}
            value={request}
          />
        </label>
        <div className="science-agent__actions">
          <Button
            disabled={
              active || !keyPresent || selectedModel.length === 0 || request.trim().length === 0
            }
            onClick={run}
            variant="primary"
          >
            {snapshot.conversationTurnCount === 0 ? 'Start task' : 'Send follow-up'}
          </Button>
          <Button disabled={!active} onClick={() => runtime.cancel()}>
            Cancel
          </Button>
          <Button
            disabled={active || snapshot.conversationTurnCount === 0}
            onClick={() => {
              runtime.resetConversation()
            }}
          >
            New conversation
          </Button>
        </div>
        <p aria-live="polite" className="science-agent__status">
          {snapshot.status.replaceAll('-', ' ')} · {snapshot.conversationTurnCount} completed{' '}
          {snapshot.conversationTurnCount === 1 ? 'turn' : 'turns'}
        </p>
      </section>

      {snapshot.conversation.length === 0 ? null : (
        <section aria-labelledby="science-agent-conversation-heading">
          <h3 id="science-agent-conversation-heading">Conversation</h3>
          <ol className="science-agent__conversation">
            {snapshot.conversation.map((turn) => (
              <li key={turn.id}>
                <p className="agent-message agent-message--user">{turn.request}</p>
                <p className="agent-message">{turn.answer}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {snapshot.plan === undefined ? null : (
        <section aria-labelledby="science-agent-plan-heading">
          <h3 id="science-agent-plan-heading">Current plan</h3>
          <p>{snapshot.plan.goalSummary}</p>
          <ol className="science-agent__list">
            {snapshot.plan.actions.map((action) => (
              <li
                key={`${action.actionId}-${action.actionVersion}-${JSON.stringify(action.input)}`}
              >
                <code>
                  {action.actionId}@{action.actionVersion}
                </code>
                <span>{action.expectedOutput}</span>
              </li>
            ))}
          </ol>
          <p>
            <strong>Stop when:</strong> {snapshot.plan.stoppingCondition}
          </p>
        </section>
      )}

      {snapshot.approval === undefined ? null : (
        <section
          aria-labelledby="science-agent-approval-heading"
          className="science-agent__approval"
        >
          <h3 id="science-agent-approval-heading">Approval required</h3>
          <p>
            <strong>{snapshot.approval.title}</strong> — {snapshot.approval.reason}
          </p>
          <p className="panel-note">
            {snapshot.approval.mutability} · {snapshot.approval.cost} ·{' '}
            {snapshot.approval.permissions.join(', ') || 'no additional permission'}
          </p>
          <details>
            <summary>Requested parameters</summary>
            <pre>{JSON.stringify(snapshot.approval.call.input, null, 2)}</pre>
          </details>
          {snapshot.approval.call.actionId !== 'analysis.particle.execute' ||
          latestParticlePlan === undefined ? null : (
            <details open>
              <summary>Reviewed dry-run result</summary>
              <pre>{JSON.stringify(latestParticlePlan.result, null, 2)}</pre>
            </details>
          )}
          <div className="science-agent__actions">
            <Button onClick={() => runtime.approve(snapshot.approval?.id ?? '')} variant="primary">
              Approve
            </Button>
            <Button onClick={() => runtime.deny(snapshot.approval?.id ?? '')}>Deny</Button>
          </div>
        </section>
      )}

      {snapshot.trace.length === 0 ? null : (
        <section aria-labelledby="science-agent-trace-heading">
          <h3 id="science-agent-trace-heading">Action trace</h3>
          <ol className="science-agent__list">
            {snapshot.trace.map((entry) => (
              <li key={entry.callId}>
                <code>
                  {entry.actionId}@{entry.actionVersion}
                </code>
                <span>
                  revision {entry.projectRevisionBefore} → {entry.projectRevisionAfter} ·{' '}
                  {entry.approval}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {snapshot.artifacts.length === 0 ? null : (
        <section aria-labelledby="science-agent-artifacts-heading">
          <h3 id="science-agent-artifacts-heading">Model-visible previews</h3>
          <div className="science-agent__artifacts">
            {snapshot.artifacts.map((artifact) => (
              <figure key={artifact.id}>
                <img
                  alt="Bounded scientific workbench preview shared with the model"
                  src={artifact.dataUrl}
                />
                <figcaption>
                  {artifact.width} × {artifact.height} · {artifact.bytes} bytes · revision{' '}
                  {artifact.projectRevision}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {panelError === undefined && snapshot.error === undefined ? null : (
        <p className="science-agent__error" role="alert">
          {panelError ?? snapshot.error?.message}
        </p>
      )}
    </div>
  )
}
