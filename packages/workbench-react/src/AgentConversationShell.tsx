import type {
  AgentModelSummary,
  AgentRuntime,
  OpenRouterTransport,
  OptionalPersistentOpenRouterCredentialStore,
} from '@pji-workbench/agent'
import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_RECOMMENDED_MODELS } from '@pji-workbench/agent'
import { Button, Icon, IconButton, RestrictedMarkdown } from '@pji-workbench/ui'
import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { agentReferenceCards, particlePlanFromTrace } from './agent-reference-cards.js'

export interface AgentStarterPrompt {
  readonly title: string
  readonly prompt: string
}

export interface AgentConversationCopy {
  readonly testId: string
  readonly classPrefix: string
  readonly assistantName: string
  readonly welcomeHeading: string
  readonly welcomeBody: string
  readonly composerPlaceholder: string
  readonly connectLabel: string
  readonly newConversationLabel: string
  readonly replayLabel: string
  readonly grantsHeading: string
}

export const SCIENCE_AGENT_COPY: AgentConversationCopy = {
  testId: 'science-agent-panel',
  classPrefix: 'science-agent',
  assistantName: 'Lab Assistant',
  welcomeHeading: 'What would you like to analyze?',
  welcomeBody:
    'Ask in plain language. I can inspect metadata, run approved analyses, check the viewport, and help tune the result.',
  composerPlaceholder: 'Ask about this image…',
  connectLabel: 'Connect OpenRouter',
  newConversationLabel: 'New chat',
  replayLabel: 'Replay approved actions',
  grantsHeading: 'Session grants',
}

export const ATLAS_AGENT_COPY: AgentConversationCopy = {
  testId: 'atlas-agent-panel',
  classPrefix: 'science-agent',
  assistantName: 'Atlas Assistant',
  welcomeHeading: 'What raster workflow should we run?',
  welcomeBody:
    'Search catalogs, inspect COG metadata, derive bounded layers, and explain telemetry after you approve network or expensive work.',
  composerPlaceholder: 'Ask about this raster or catalog…',
  connectLabel: 'Connect OpenRouter',
  newConversationLabel: 'New conversation',
  replayLabel: 'Replay approved actions',
  grantsHeading: 'Session grants',
}

export function AgentConversationShell({
  runtime,
  credentials,
  transport,
  copy,
  starters,
  modelPreferenceKey,
  approvalExtras,
  welcomeExtras,
  retainGrantsOnNewConversation = false,
}: {
  readonly runtime: AgentRuntime
  readonly credentials: OptionalPersistentOpenRouterCredentialStore
  readonly transport: OpenRouterTransport
  readonly copy: AgentConversationCopy
  readonly starters: readonly AgentStarterPrompt[]
  readonly modelPreferenceKey: string
  readonly approvalExtras?: ReactNode
  readonly welcomeExtras?: ReactNode
  readonly retainGrantsOnNewConversation?: boolean
}) {
  const prefix = copy.classPrefix
  const subscribe = useCallback((listener: () => void) => runtime.subscribe(listener), [runtime])
  const getSnapshot = useCallback(() => runtime.getSnapshot(), [runtime])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const initialModel = useRef(initialModelSelection(modelPreferenceKey))
  const [keyInput, setKeyInput] = useState('')
  const [keyPresent, setKeyPresent] = useState(() => credentials.has())
  const [rememberKey, setRememberKey] = useState(() => credentials.persistence === 'browser')
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
  const latestParticlePlan = particlePlanFromTrace(snapshot.trace)
  const submitLabel = snapshot.conversationTurnCount === 0 ? 'Start task' : 'Send follow-up'
  const canSubmit = !active && keyPresent && selectedModel.length > 0 && request.trim().length > 0
  const scrollSignal = `${snapshot.conversationTurnCount}:${snapshot.approval?.id ?? ''}:${pendingRequest?.request ?? ''}`
  const references = agentReferenceCards(snapshot)
  const persistenceLabel =
    credentials.persistence === 'browser' ? 'Remembered in this browser' : 'Session only'

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
      if (keyInput.trim().length > 0) credentials.set(keyInput, { persist: rememberKey })
      else if (rememberKey) credentials.persistMemory()
      else credentials.forgetPersistent()
      if (!credentials.has()) throw new Error('Paste an OpenRouter API key to continue.')
      if (selectedModel.length === 0) throw new Error('Choose an OpenRouter model to continue.')
      rememberModel(modelPreferenceKey, selectedModel)
      setKeyInput('')
      setKeyPresent(true)
      setRememberKey(credentials.persistence === 'browser')
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
      setRememberKey(false)
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
    <div className={`inspector-content ${prefix}`} data-testid={copy.testId}>
      <header className={`${prefix}__header`}>
        <div className={`${prefix}__identity`}>
          <span className={`${prefix}__mark`}>
            <Icon name="agent" size={17} />
          </span>
          <div>
            <h3>{copy.assistantName}</h3>
            <p>{keyPresent ? `${selectedModelName} · ${persistenceLabel}` : 'Not connected'}</p>
          </div>
        </div>
        <div className={`${prefix}__header-actions`}>
          {snapshot.conversationTurnCount === 0 ? null : (
            <Button
              disabled={active}
              onClick={() => {
                runtime.resetConversation({ retainGrants: retainGrantsOnNewConversation })
                setRequest('')
                setPendingRequest(undefined)
              }}
              variant="ghost"
            >
              {copy.newConversationLabel}
            </Button>
          )}
          <IconButton disabled={active} label="Agent settings" onClick={openSettings}>
            <Icon name="settings" size={16} />
          </IconButton>
        </div>
      </header>

      <section
        className={`${prefix}__chat`}
        aria-label={`${copy.assistantName} conversation`}
        ref={chatScroller}
      >
        {snapshot.conversation.length === 0 && pendingRequest === undefined ? (
          <section className={`${prefix}__welcome`} aria-labelledby={`${prefix}-welcome`}>
            <span className={`${prefix}__welcome-mark`}>
              <Icon name="agent" size={22} />
            </span>
            <h3 id={`${prefix}-welcome`}>{copy.welcomeHeading}</h3>
            <p>{copy.welcomeBody}</p>
            {welcomeExtras}
            <fieldset className={`${prefix}__starters`}>
              <legend className="visually-hidden">Example prompts</legend>
              {starters.map((starter) => (
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
                {copy.connectLabel}
              </Button>
            )}
          </section>
        ) : (
          <ol className={`${prefix}__conversation`}>
            {snapshot.conversation.map((turn) => (
              <li key={turn.id}>
                <div className={`${prefix}__message-row ${prefix}__message-row--user`}>
                  <span className={`${prefix}__message-label`}>You</span>
                  <p className="agent-message agent-message--user">{turn.request}</p>
                </div>
                <div className={`${prefix}__message-row`}>
                  <span className={`${prefix}__message-label`}>{copy.assistantName}</span>
                  <div className="agent-message">
                    <RestrictedMarkdown source={turn.answer} />
                  </div>
                </div>
              </li>
            ))}
            {pendingRequest === undefined ||
            snapshot.conversationTurnCount !== pendingRequest.turnCount ? null : (
              <li>
                <div className={`${prefix}__message-row ${prefix}__message-row--user`}>
                  <span className={`${prefix}__message-label`}>You</span>
                  <p className="agent-message agent-message--user">{pendingRequest.request}</p>
                </div>
              </li>
            )}
          </ol>
        )}

        {!active || snapshot.approval !== undefined ? null : (
          <div className={`${prefix}__thinking`} role="status">
            <span aria-hidden="true" className={`${prefix}__spinner`} />
            <span>{friendlyStatus(snapshot.status, keyPresent)}</span>
          </div>
        )}

        {snapshot.approval === undefined ? null : (
          <section
            aria-labelledby={`${prefix}-approval-heading`}
            className={`${prefix}__approval`}
            data-agent-action-id={snapshot.approval.call.actionId}
          >
            <div className={`${prefix}__approval-heading`}>
              <span>
                <Icon name="shield" size={17} />
              </span>
              <div>
                <p className="panel-kicker">Your approval is needed</p>
                <h3 id={`${prefix}-approval-heading`}>{snapshot.approval.title}</h3>
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
            latestParticlePlan === undefined
              ? null
              : (approvalExtras ?? (
                  <details>
                    <summary>Reviewed dry-run result</summary>
                    <pre>{JSON.stringify(latestParticlePlan.result, null, 2)}</pre>
                  </details>
                ))}
            {approvalExtras === undefined ||
            snapshot.approval.call.actionId === 'analysis.particle.execute'
              ? null
              : approvalExtras}
            <div className={`${prefix}__actions`}>
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
          <div className={`${prefix}__error`} role="alert">
            <strong>Something needs attention</strong>
            <span>{panelError ?? snapshot.error?.message}</span>
          </div>
        )}

        {references.length === 0 ? null : (
          <section aria-labelledby={`${prefix}-references-heading`} className={`${prefix}__cards`}>
            <h3 id={`${prefix}-references-heading`}>Referenced objects</h3>
            <ul>
              {references.map((card) => (
                <li key={`${card.kind}-${card.id}`}>
                  <strong>{card.kind}</strong>
                  <code>{card.id}</code>
                  {card.detail === undefined ? null : <span>{card.detail}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {snapshot.grants.length === 0 ? null : (
          <section aria-labelledby={`${prefix}-grants-heading`}>
            <h3 id={`${prefix}-grants-heading`}>{copy.grantsHeading}</h3>
            <ul className={`${prefix}__list`}>
              {snapshot.grants.map((grant) => (
                <li key={grant.id}>
                  <code>{grant.scope}</code>
                  <span>
                    {grant.permission} · used {grant.uses}
                  </span>
                  <Button disabled={active} onClick={() => runtime.revokeGrant(grant.scope)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
            <Button disabled={active} onClick={() => runtime.revokeAllGrants()}>
              Revoke all grants
            </Button>
          </section>
        )}

        {snapshot.plan === undefined &&
        snapshot.trace.length === 0 &&
        snapshot.artifacts.length === 0 ? null : (
          <details className={`${prefix}__details`}>
            <summary>Run details</summary>
            <div className={`${prefix}__details-content`}>
              {snapshot.plan === undefined ? null : (
                <section aria-labelledby={`${prefix}-plan-heading`}>
                  <h3 id={`${prefix}-plan-heading`}>Plan</h3>
                  <p>{snapshot.plan.goalSummary}</p>
                  <ol className={`${prefix}__list`}>
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
                <section aria-labelledby={`${prefix}-trace-heading`}>
                  <h3 id={`${prefix}-trace-heading`}>Action trace</h3>
                  <ol className={`${prefix}__list`}>
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
                <section aria-labelledby={`${prefix}-artifacts-heading`}>
                  <h3 id={`${prefix}-artifacts-heading`}>Shared previews</h3>
                  <div className={`${prefix}__artifacts`}>
                    {snapshot.artifacts.map((artifact) => (
                      <figure key={artifact.id}>
                        <img
                          alt="Bounded workbench preview shared with the model"
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
                  {copy.replayLabel}
                </Button>
              )}
            </div>
          </details>
        )}
      </section>

      <form
        className={`${prefix}__composer`}
        onSubmit={(event) => {
          event.preventDefault()
          run()
        }}
      >
        <label className="visually-hidden" htmlFor={`${prefix}-request`}>
          Request or follow-up
        </label>
        <textarea
          disabled={active}
          id={`${prefix}-request`}
          maxLength={16_384}
          onChange={(event) => setRequest(event.currentTarget.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder={
            keyPresent ? copy.composerPlaceholder : 'Connect OpenRouter to start chatting…'
          }
          ref={composer}
          rows={2}
          value={request}
        />
        <div className={`${prefix}__composer-footer`}>
          <p aria-live="polite" className={`${prefix}__status`}>
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
        className={`${prefix}-settings`}
        onCancel={(event) => {
          event.preventDefault()
          closeSettings()
        }}
        ref={settingsDialog}
      >
        <form onSubmit={saveSettings}>
          <header>
            <div>
              <p className="panel-kicker">{copy.assistantName}</p>
              <h2>{keyPresent ? 'Agent settings' : 'Connect OpenRouter'}</h2>
            </div>
            <IconButton label="Close agent settings" onClick={closeSettings}>
              <Icon name="close" size={17} />
            </IconButton>
          </header>
          <p className={`${prefix}-settings__intro`}>
            {keyPresent
              ? `The key is ${persistenceLabel.toLowerCase()}. Remembering it is optional.`
              : 'Paste a key for this session. Check “Remember on this browser” only if you want this browser profile to keep it.'}
          </p>

          <div className={`${prefix}-settings__status`}>
            <span aria-hidden="true" className={keyPresent ? 'is-connected' : undefined} />
            <strong>{keyPresent ? 'OpenRouter connected' : 'OpenRouter key required'}</strong>
            <span>{persistenceLabel}</span>
          </div>

          <label>
            OpenRouter API key
            <input
              aria-label="OpenRouter key"
              autoComplete="off"
              disabled={active}
              onChange={(event) => setKeyInput(event.currentTarget.value)}
              placeholder={keyPresent ? 'Paste a new key to replace the current key' : 'sk-or-…'}
              ref={keyInputElement}
              type="password"
              value={keyInput}
            />
          </label>
          <label className={`${prefix}-settings__remember`}>
            <input
              checked={rememberKey}
              disabled={active}
              onChange={(event) => setRememberKey(event.currentTarget.checked)}
              type="checkbox"
            />
            Remember on this browser
          </label>
          <p className={`${prefix}-settings__privacy`}>
            Browser localStorage is not a secret vault. Prefer a separate, low-limit OpenRouter key.
            The key is never included in projects, conversations, analysis tools, exports, logs, or
            reports. A session key is never moved to browser storage unless you check this box.
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
            <p className={`${prefix}-settings__error`} role="alert">
              {panelError}
            </p>
          )}

          <footer>
            <div>
              {keyPresent ? (
                <Button disabled={active} onClick={removeKey} type="button" variant="ghost">
                  Remove key
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

function initialModelSelection(storageKey: string): Readonly<{ choice: string; custom: string }> {
  try {
    const saved = window.localStorage.getItem(storageKey)?.trim()
    if (saved === undefined || saved.length === 0 || saved.length > 256)
      return { choice: DEFAULT_OPENROUTER_MODEL, custom: '' }
    if (OPENROUTER_RECOMMENDED_MODELS.some(({ id }) => id === saved))
      return { choice: saved, custom: '' }
    return { choice: 'custom', custom: saved }
  } catch {
    return { choice: DEFAULT_OPENROUTER_MODEL, custom: '' }
  }
}

function rememberModel(storageKey: string, model: string): void {
  try {
    window.localStorage.setItem(storageKey, model)
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
