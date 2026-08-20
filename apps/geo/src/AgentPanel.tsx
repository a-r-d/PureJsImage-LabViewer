import type {
  AgentModelSummary,
  AgentRuntime,
  MemoryOpenRouterCredentialStore,
  OpenRouterTransport,
} from '@pji-workbench/agent'
import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_RECOMMENDED_MODELS } from '@pji-workbench/agent'
import { Button } from '@pji-workbench/ui'
import { useCallback, useState, useSyncExternalStore } from 'react'

export function AgentPanel({
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
      const available = await transport.listModels()
      setModels(available)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingModels(false)
    }
  }

  const run = (): void => {
    setPanelError(undefined)
    const selectedModel = modelChoice === 'custom' ? customModel.trim() : modelChoice
    void runtime.start(request, selectedModel).catch((error: unknown) => {
      setPanelError(error instanceof Error ? error.message : String(error))
    })
  }

  const selectedModel = modelChoice === 'custom' ? customModel.trim() : modelChoice
  const additionalModels = models.filter(
    (entry) => !OPENROUTER_RECOMMENDED_MODELS.some(({ id }) => id === entry.id),
  )

  return (
    <div className="geo-inspector-body geo-agent" data-testid="atlas-agent-panel">
      <section aria-labelledby="atlas-agent-key-heading">
        <h2 id="atlas-agent-key-heading">OpenRouter session</h2>
        <p className="geo-help">
          The key stays in memory only and is cleared when this Atlas session ends.
        </p>
        <div className="geo-agent-key-row">
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
          <Button disabled={active || keyInput.trim().length === 0} onClick={saveKey}>
            Use for session
          </Button>
          <Button disabled={active || !keyPresent} onClick={removeKey}>
            Remove
          </Button>
        </div>
        <p aria-live="polite" className="geo-agent-status">
          Key status: {keyPresent ? 'available in memory' : 'not set'}
        </p>
      </section>

      <section aria-labelledby="atlas-agent-task-heading">
        <h2 id="atlas-agent-task-heading">Agent task</h2>
        <div className="geo-agent-model-row">
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
          <Button
            disabled={active || !keyPresent || loadingModels}
            onClick={() => void loadModels()}
          >
            {loadingModels ? 'Loading…' : 'Load models'}
          </Button>
        </div>
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
        <p className="geo-help">
          Any custom model must currently advertise tool calling. Screen previews also require image
          input support.
        </p>
        <label>
          Request
          <textarea
            disabled={active}
            maxLength={16_384}
            onChange={(event) => setRequest(event.currentTarget.value)}
            placeholder="Describe an Atlas analysis goal"
            rows={5}
            value={request}
          />
        </label>
        <div className="geo-agent-actions">
          <Button
            disabled={
              active || !keyPresent || selectedModel.length === 0 || request.trim().length === 0
            }
            onClick={run}
            variant="primary"
          >
            Propose and run
          </Button>
          <Button disabled={!active} onClick={() => runtime.cancel()}>
            Cancel
          </Button>
          <Button
            disabled={active || snapshot.conversationTurnCount === 0}
            onClick={() => runtime.resetConversation()}
          >
            New conversation
          </Button>
        </div>
        <p aria-live="polite" className="geo-agent-status">
          Status: {snapshot.status.replaceAll('-', ' ')} · {snapshot.conversationTurnCount}{' '}
          completed {snapshot.conversationTurnCount === 1 ? 'turn' : 'turns'}
        </p>
      </section>

      {snapshot.plan === undefined ? null : (
        <section aria-labelledby="atlas-agent-plan-heading">
          <h2 id="atlas-agent-plan-heading">Current plan</h2>
          <p>{snapshot.plan.goalSummary}</p>
          <ol className="geo-agent-list">
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
        <section aria-labelledby="atlas-agent-approval-heading" className="geo-agent-approval">
          <h2 id="atlas-agent-approval-heading">Approval required</h2>
          <p>
            <strong>{snapshot.approval.title}</strong> — {snapshot.approval.reason}
          </p>
          <p>
            {snapshot.approval.mutability} · {snapshot.approval.cost} ·{' '}
            {snapshot.approval.permissions.join(', ') || 'no additional permission'}
          </p>
          <div className="geo-agent-actions">
            <Button onClick={() => runtime.approve(snapshot.approval?.id ?? '')} variant="primary">
              Approve
            </Button>
            <Button onClick={() => runtime.deny(snapshot.approval?.id ?? '')}>Deny</Button>
          </div>
        </section>
      )}

      {snapshot.trace.length === 0 ? null : (
        <section aria-labelledby="atlas-agent-trace-heading">
          <h2 id="atlas-agent-trace-heading">Action trace</h2>
          <ol className="geo-agent-list">
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
        <section aria-labelledby="atlas-agent-artifacts-heading">
          <h2 id="atlas-agent-artifacts-heading">Generated artifacts</h2>
          <div className="geo-agent-artifacts">
            {snapshot.artifacts.map((artifact) => (
              <figure key={artifact.id}>
                <img alt="Bounded Atlas preview generated for the model" src={artifact.dataUrl} />
                <figcaption>
                  {artifact.width} × {artifact.height} · {artifact.bytes} bytes · revision{' '}
                  {artifact.projectRevision}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {snapshot.finalText === undefined ? null : (
        <section aria-labelledby="atlas-agent-result-heading">
          <h2 id="atlas-agent-result-heading">Result</h2>
          <p className="geo-agent-result">{snapshot.finalText}</p>
          {snapshot.audit === undefined ? null : (
            <Button
              disabled={active}
              onClick={() => {
                const audit = snapshot.audit
                if (audit === undefined) return
                void runtime.replay(audit).catch((error: unknown) => {
                  setPanelError(error instanceof Error ? error.message : String(error))
                })
              }}
            >
              Replay approved actions
            </Button>
          )}
        </section>
      )}

      {panelError === undefined && snapshot.error === undefined ? null : (
        <p className="geo-agent-error" role="alert">
          {panelError ?? snapshot.error?.message}
        </p>
      )}
    </div>
  )
}
