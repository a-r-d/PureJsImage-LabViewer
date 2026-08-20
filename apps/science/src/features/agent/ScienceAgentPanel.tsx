import type { AgentModelSummary, AgentRuntime, OpenRouterTransport } from '@pji-workbench/agent'
import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_RECOMMENDED_MODELS } from '@pji-workbench/agent'
import { Button, Icon, IconButton } from '@pji-workbench/ui'
import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import type { ScienceAgentCredentialStore } from './science-agent-credentials.js'

const MODEL_PREFERENCE_KEY = 'purejsimage-lab-agent-model-v1'

const STARTERS = [
  {
    title: 'Count particles',
    prompt:
      'Count and measure the particles in this image. Inspect the result and tell me whether the segmentation looks reliable.',
  },
  {
    title: 'Tune segmentation',
    prompt:
      'Run particle analysis, inspect the labels, and tune the parameters if particles look missed or merged.',
  },
  {
    title: 'Inspect this image',
    prompt:
      'Inspect the current image and its metadata, then suggest the most useful bounded analysis to run.',
  },
  {
    title: 'Explain my results',
    prompt:
      'Explain the current analysis result in plain language, including the calibration, units, assumptions, and limitations.',
  },
] as const

function initialModelSelection(): Readonly<{ choice: string; custom: string }> {
  try {
    const saved = window.localStorage.getItem(MODEL_PREFERENCE_KEY)?.trim()
    if (saved === undefined || saved.length === 0 || saved.length > 256)
      return { choice: DEFAULT_OPENROUTER_MODEL, custom: '' }
    if (OPENROUTER_RECOMMENDED_MODELS.some(({ id }) => id === saved))
      return { choice: saved, custom: '' }
    return { choice: 'custom', custom: saved }
  } catch {
    return { choice: DEFAULT_OPENROUTER_MODEL, custom: '' }
  }
}

function rememberModel(model: string): void {
  try {
    window.localStorage.setItem(MODEL_PREFERENCE_KEY, model)
  } catch {
    // Model selection is a convenience preference; a blocked write must not block the agent.
  }
}

function friendlyStatus(status: string, keyPresent: boolean): string {
  if (!keyPresent) return 'Connect OpenRouter to begin'
  const labels: Readonly<Record<string, string>> = {
    idle: 'Ready',
    'building-context': 'Reading the workspace…',
    'requesting-model': 'Thinking…',
    'awaiting-approval': 'Waiting for your approval',
    'executing-tool': 'Running an action…',
    'awaiting-tool-result': 'Checking the result…',
    summarizing: 'Writing a response…',
    completed: 'Ready',
    cancelled: 'Cancelled',
    failed: 'Needs attention',
  }
  return labels[status] ?? status.replaceAll('-', ' ')
}

export function ScienceAgentPanel({
  runtime,
  credentials,
  transport,
}: {
  readonly runtime: AgentRuntime
  readonly credentials: ScienceAgentCredentialStore
  readonly transport: OpenRouterTransport
}) {
  const subscribe = useCallback((listener: () => void) => runtime.subscribe(listener), [runtime])
  const getSnapshot = useCallback(() => runtime.getSnapshot(), [runtime])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const initialModel = useRef(initialModelSelection())
  const [keyInput, setKeyInput] = useState('')
  const [keyPresent, setKeyPresent] = useState(() => credentials.has())
  const [settingsOpen, setSettingsOpen] = useState(() => !credentials.has())
  const [models, setModels] = useState<readonly AgentModelSummary[]>([])
  const [modelChoice, setModelChoice] = useState(initialModel.current.choice)
  const [customModel, setCustomModel] = useState(initialModel.current.custom)
  const [request, setRequest] = useState('')
  const [pendingRequest, setPendingRequest] = useState<
    Readonly<{ request: string; turnCount: number }> | undefined
  >()
  const [panelError, setPanelError] = useState<string>()
  const [loadingModels, setLoadingModels] = useState(false)
  const settingsDialog = useRef<HTMLDialogElement>(null)
  const chatScroller = useRef<HTMLElement>(null)
  const keyInputElement = useRef<HTMLInputElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const settingsRestoreTarget = useRef<HTMLElement | null>(null)
  const active = !['idle', 'completed', 'cancelled', 'failed'].includes(snapshot.status)
  const selectedModel = modelChoice === 'custom' ? customModel.trim() : modelChoice
  const selectedModelName =
    models.find(({ id }) => id === selectedModel)?.name ??
    OPENROUTER_RECOMMENDED_MODELS.find(({ id }) => id === selectedModel)?.name ??
    selectedModel
  const latestParticlePlan = snapshot.trace.findLast(
    ({ actionId }) => actionId === 'analysis.particle.plan',
  )
  const submitLabel = snapshot.conversationTurnCount === 0 ? 'Start task' : 'Send follow-up'
  const canSubmit = !active && keyPresent && selectedModel.length > 0 && request.trim().length > 0
  const scrollSignal = `${snapshot.conversationTurnCount}:${snapshot.approval?.id ?? ''}:${pendingRequest?.request ?? ''}`

  const closeSettings = useCallback((): void => {
    setSettingsOpen(false)
    queueMicrotask(() => (settingsRestoreTarget.current ?? composer.current)?.focus())
  }, [])

  const openSettings = (event?: MouseEvent<HTMLElement>): void => {
    settingsRestoreTarget.current = event?.currentTarget ?? null
    setPanelError(undefined)
    setSettingsOpen(true)
  }

  useEffect(() => {
    const dialog = settingsDialog.current
    if (dialog === null) return
    if (settingsOpen) {
      if (!dialog.open) dialog.showModal()
      queueMicrotask(() => keyInputElement.current?.focus())
    } else if (dialog.open) dialog.close()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [settingsOpen])

  useEffect(() => {
    const scroller = chatScroller.current
    if (scroller === null || scrollSignal.length === 0) return
    queueMicrotask(() => {
      scroller.scrollTop = scroller.scrollHeight
    })
  }, [scrollSignal])

  const saveSettings = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    try {
      if (keyInput.trim().length > 0) credentials.set(keyInput)
      if (!credentials.has()) throw new Error('Paste an OpenRouter API key to continue.')
      if (selectedModel.length === 0) throw new Error('Choose an OpenRouter model to continue.')
      rememberModel(selectedModel)
      setKeyInput('')
      setKeyPresent(true)
      setPanelError(undefined)
      closeSettings()
      queueMicrotask(() => composer.current?.focus())
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error))
    }
  }

  const removeKey = (): void => {
    try {
      credentials.clear()
      setKeyInput('')
      setKeyPresent(false)
      setModels([])
      setPanelError(undefined)
      queueMicrotask(() => keyInputElement.current?.focus())
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error))
    }
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
    if (!canSubmit) return
    const submitted = request.trim()
    setPanelError(undefined)
    setRequest('')
    setPendingRequest({ request: submitted, turnCount: snapshot.conversationTurnCount })
    void runtime
      .start(submitted, selectedModel)
      .then(() => {
        setPendingRequest(undefined)
      })
      .catch((error: unknown) => {
        setPendingRequest(undefined)
        setRequest((current) => (current.length === 0 ? submitted : current))
        setPanelError(error instanceof Error ? error.message : String(error))
      })
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    run()
  }

  const additionalModels = models.filter(
    (entry) => !OPENROUTER_RECOMMENDED_MODELS.some(({ id }) => id === entry.id),
  )

  return (
    <div className="inspector-content science-agent" data-testid="science-agent-panel">
      <header className="science-agent__header">
        <div className="science-agent__identity">
          <span className="science-agent__mark">
            <Icon name="agent" size={17} />
          </span>
          <div>
            <h3>Lab Assistant</h3>
            <p>{keyPresent ? selectedModelName : 'Not connected'}</p>
          </div>
        </div>
        <div className="science-agent__header-actions">
          {snapshot.conversationTurnCount === 0 ? null : (
            <Button
              disabled={active}
              onClick={() => {
                runtime.resetConversation()
                setRequest('')
                setPendingRequest(undefined)
              }}
              variant="ghost"
            >
              New chat
            </Button>
          )}
          <IconButton disabled={active} label="Agent settings" onClick={openSettings}>
            <Icon name="settings" size={16} />
          </IconButton>
        </div>
      </header>

      <section
        className="science-agent__chat"
        aria-label="Lab Assistant conversation"
        ref={chatScroller}
      >
        {snapshot.conversation.length === 0 && pendingRequest === undefined ? (
          <section className="science-agent__welcome" aria-labelledby="science-agent-welcome">
            <span className="science-agent__welcome-mark">
              <Icon name="agent" size={22} />
            </span>
            <h3 id="science-agent-welcome">What would you like to analyze?</h3>
            <p>
              Ask in plain language. I can inspect metadata, run approved analyses, check the
              viewport, and help tune the result.
            </p>
            <fieldset className="science-agent__starters">
              <legend className="visually-hidden">Example prompts</legend>
              {STARTERS.map((starter) => (
                <button
                  disabled={active}
                  key={starter.title}
                  onClick={() => {
                    setRequest(starter.prompt)
                    queueMicrotask(() => composer.current?.focus())
                  }}
                  type="button"
                >
                  <strong>{starter.title}</strong>
                  <span>{starter.prompt}</span>
                </button>
              ))}
            </fieldset>
            {keyPresent ? null : (
              <Button onClick={openSettings} variant="primary">
                Connect OpenRouter
              </Button>
            )}
          </section>
        ) : (
          <ol className="science-agent__conversation">
            {snapshot.conversation.map((turn) => (
              <li key={turn.id}>
                <div className="science-agent__message-row science-agent__message-row--user">
                  <span className="science-agent__message-label">You</span>
                  <p className="agent-message agent-message--user">{turn.request}</p>
                </div>
                <div className="science-agent__message-row">
                  <span className="science-agent__message-label">Lab Assistant</span>
                  <p className="agent-message">{turn.answer}</p>
                </div>
              </li>
            ))}
            {pendingRequest === undefined ||
            snapshot.conversationTurnCount !== pendingRequest.turnCount ? null : (
              <li>
                <div className="science-agent__message-row science-agent__message-row--user">
                  <span className="science-agent__message-label">You</span>
                  <p className="agent-message agent-message--user">{pendingRequest.request}</p>
                </div>
              </li>
            )}
          </ol>
        )}

        {!active || snapshot.approval !== undefined ? null : (
          <div className="science-agent__thinking" role="status">
            <span aria-hidden="true" className="science-agent__spinner" />
            <span>{friendlyStatus(snapshot.status, keyPresent)}</span>
          </div>
        )}

        {snapshot.approval === undefined ? null : (
          <section
            aria-labelledby="science-agent-approval-heading"
            className="science-agent__approval"
            data-agent-action-id={snapshot.approval.call.actionId}
          >
            <div className="science-agent__approval-heading">
              <span>
                <Icon name="shield" size={17} />
              </span>
              <div>
                <p className="panel-kicker">Your approval is needed</p>
                <h3 id="science-agent-approval-heading">{snapshot.approval.title}</h3>
              </div>
            </div>
            <p>{snapshot.approval.reason}</p>
            <p className="panel-note">
              {snapshot.approval.cost} cost · {snapshot.approval.mutability}
            </p>
            <details>
              <summary>Review details</summary>
              <pre>{JSON.stringify(snapshot.approval.call.input, null, 2)}</pre>
            </details>
            {snapshot.approval.call.actionId !== 'analysis.particle.execute' ||
            latestParticlePlan === undefined ? null : (
              <details>
                <summary>Reviewed dry-run result</summary>
                <pre>{JSON.stringify(latestParticlePlan.result, null, 2)}</pre>
              </details>
            )}
            <div className="science-agent__actions">
              <Button
                onClick={() => runtime.approve(snapshot.approval?.id ?? '')}
                variant="primary"
              >
                Approve
              </Button>
              <Button onClick={() => runtime.deny(snapshot.approval?.id ?? '')}>Deny</Button>
            </div>
          </section>
        )}

        {settingsOpen || (panelError === undefined && snapshot.error === undefined) ? null : (
          <div className="science-agent__error" role="alert">
            <strong>Something needs attention</strong>
            <span>{panelError ?? snapshot.error?.message}</span>
          </div>
        )}

        {snapshot.plan === undefined &&
        snapshot.trace.length === 0 &&
        snapshot.artifacts.length === 0 ? null : (
          <details className="science-agent__details">
            <summary>Run details</summary>
            <div className="science-agent__details-content">
              {snapshot.plan === undefined ? null : (
                <section aria-labelledby="science-agent-plan-heading">
                  <h3 id="science-agent-plan-heading">Plan</h3>
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

              {snapshot.trace.length === 0 ? null : (
                <section aria-labelledby="science-agent-trace-heading">
                  <h3 id="science-agent-trace-heading">Action trace</h3>
                  <ol className="science-agent__list">
                    {snapshot.trace.map((entry) => (
                      <li data-agent-action-id={entry.actionId} key={entry.callId}>
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
                  <h3 id="science-agent-artifacts-heading">Shared previews</h3>
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
            </div>
          </details>
        )}
      </section>

      <form
        className="science-agent__composer"
        onSubmit={(event) => {
          event.preventDefault()
          run()
        }}
      >
        <label className="visually-hidden" htmlFor="science-agent-request">
          Request or follow-up
        </label>
        <textarea
          disabled={active}
          id="science-agent-request"
          maxLength={16_384}
          onChange={(event) => setRequest(event.currentTarget.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder={
            keyPresent ? 'Ask about this image…' : 'Connect OpenRouter to start chatting…'
          }
          ref={composer}
          rows={2}
          value={request}
        />
        <div className="science-agent__composer-footer">
          <p aria-live="polite" className="science-agent__status">
            <span className="visually-hidden">
              {snapshot.status.replaceAll('-', ' ')} · {snapshot.conversationTurnCount} completed{' '}
              {snapshot.conversationTurnCount === 1 ? 'turn' : 'turns'}
            </span>
            <span aria-hidden="true">{friendlyStatus(snapshot.status, keyPresent)}</span>
          </p>
          {active ? (
            <Button onClick={() => runtime.cancel()}>Cancel</Button>
          ) : (
            <IconButton
              disabled={!canSubmit}
              label={submitLabel}
              tooltip={submitLabel}
              type="submit"
            >
              <Icon name="send" size={16} />
            </IconButton>
          )}
        </div>
      </form>

      <dialog
        aria-label="Agent settings"
        className="science-agent-settings"
        onCancel={(event) => {
          event.preventDefault()
          closeSettings()
        }}
        ref={settingsDialog}
      >
        <form onSubmit={saveSettings}>
          <header>
            <div>
              <p className="panel-kicker">Lab Assistant</p>
              <h2>{keyPresent ? 'Agent settings' : 'Connect OpenRouter'}</h2>
            </div>
            <IconButton label="Close agent settings" onClick={closeSettings}>
              <Icon name="close" size={17} />
            </IconButton>
          </header>
          <p className="science-agent-settings__intro">
            {keyPresent
              ? 'Your assistant is ready. You can change the model or replace the saved key here.'
              : 'Paste your key once, choose a model, and start chatting. You will not need to set it up again after a refresh.'}
          </p>

          <div className="science-agent-settings__status">
            <span aria-hidden="true" className={keyPresent ? 'is-connected' : undefined} />
            <strong>{keyPresent ? 'OpenRouter connected' : 'OpenRouter key required'}</strong>
          </div>

          <label>
            OpenRouter API key
            <input
              aria-label="OpenRouter key"
              autoComplete="off"
              disabled={active}
              onChange={(event) => setKeyInput(event.currentTarget.value)}
              placeholder={keyPresent ? 'Paste a new key to replace the saved key' : 'sk-or-…'}
              ref={keyInputElement}
              type="password"
              value={keyInput}
            />
          </label>
          <p className="science-agent-settings__privacy">
            Saved only in this browser profile. It is never included in projects, conversations,
            analysis tools, exports, or reports. Browser storage is not an enterprise secret vault.
          </p>

          <label>
            Model
            <select
              aria-label="Tool-capable model"
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
                <optgroup label="Available models">
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
          {modelChoice !== 'custom' ? null : (
            <label>
              Custom model ID
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
          <div>
            <Button
              disabled={active || !keyPresent || loadingModels}
              onClick={() => void loadModels()}
              type="button"
              variant="ghost"
            >
              {loadingModels ? 'Loading models…' : 'Refresh model list'}
            </Button>
          </div>

          {panelError === undefined ? null : (
            <p className="science-agent-settings__error" role="alert">
              {panelError}
            </p>
          )}

          <footer>
            <div>
              {keyPresent ? (
                <Button disabled={active} onClick={removeKey} type="button" variant="ghost">
                  Remove saved key
                </Button>
              ) : null}
            </div>
            <div>
              <Button onClick={closeSettings} type="button">
                {keyPresent ? 'Cancel' : 'Not now'}
              </Button>
              <Button
                disabled={active || (!keyPresent && keyInput.trim().length === 0)}
                type="submit"
                variant="primary"
              >
                {keyPresent && keyInput.trim().length === 0 ? 'Done' : 'Save and continue'}
              </Button>
            </div>
          </footer>
        </form>
      </dialog>
    </div>
  )
}
