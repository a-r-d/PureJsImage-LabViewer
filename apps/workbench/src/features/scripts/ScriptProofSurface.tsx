import type { ActionCapabilityManifestV1 } from '@pji-workbench/actions'
import {
  type RecipeDocumentV1,
  validateAnalysisScriptDocument,
  validateRecipeDocument,
} from '@pji-workbench/plugin-sdk'
import {
  createBuiltInScriptFixture,
  generateScriptApi,
  type ScriptActionInvoker,
  ScriptHostClient,
  type ScriptRunOutcome,
} from '@pji-workbench/scripts'
import { Button, Icon, IconButton, Panel } from '@pji-workbench/ui'
import { useEffect, useMemo, useRef, useState } from 'react'

export function ScriptProofSurface({
  actionManifest,
  invoker,
  onClose,
  recipe,
}: {
  readonly actionManifest: ActionCapabilityManifestV1
  readonly invoker: ScriptActionInvoker
  readonly onClose: () => void
  readonly recipe?: RecipeDocumentV1 | undefined
}) {
  const api = useMemo(() => generateScriptApi(actionManifest), [actionManifest])
  const client = useMemo(() => new ScriptHostClient({ api, invoker }), [api, invoker])
  const fixture = useRef<Awaited<ReturnType<typeof createBuiltInScriptFixture>> | undefined>(
    undefined,
  )
  const [loading, setLoading] = useState(true)
  const [validation, setValidation] = useState<readonly string[]>([])
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<ScriptRunOutcome>()
  const [source, setSource] = useState('')
  const [capabilities, setCapabilities] = useState<readonly string[]>([])
  const [integrity, setIntegrity] = useState('')
  const displayedCapabilities = recipe?.requestedCapabilities ?? capabilities
  const displayedIntegrity = recipe?.integrity.digest ?? integrity

  useEffect(() => {
    let alive = true
    void createBuiltInScriptFixture().then((value) => {
      if (!alive) return
      fixture.current = value
      setSource(value.document.source)
      setCapabilities(value.document.manifest.requestedCapabilities)
      setIntegrity(value.document.integrity.digest)
      setValidation([])
      setLoading(false)
    })
    return () => {
      alive = false
      client.dispose()
    }
  }, [client])

  const validate = (): boolean => {
    if (recipe !== undefined) {
      const result = validateRecipeDocument(recipe)
      setValidation(result.issues.map(({ path, message }) => `${path || '/'} · ${message}`))
      return result.ok
    }
    const value = fixture.current
    if (value === undefined) return false
    const result = validateAnalysisScriptDocument(value.document)
    const issues = result.issues.map(({ path, message }) => `${path || '/'} · ${message}`)
    setValidation(issues)
    return result.ok
  }

  const run = (): void => {
    const value = fixture.current
    if (value === undefined || !validate()) return
    setOutcome(undefined)
    setRunning(true)
    void client
      .run({ document: value.document, permissionGrant: value.permissionGrant })
      .then(setOutcome)
      .catch((error: unknown) =>
        setOutcome({
          status: 'failed',
          error: error instanceof Error ? error.message : 'Sandbox failed.',
          logs: [],
          proposals: [],
          provenance: {
            schemaVersion: 1,
            scriptId: value.document.id,
            sourceHash: value.document.integrity,
            manifest: value.document.manifest,
            permissions: value.permissionGrant,
            actionTrace: [],
            references: [],
          },
        }),
      )
      .finally(() => setRunning(false))
  }

  const stop = (): void => {
    client.cancel()
    setRunning(false)
  }

  return (
    <div className="script-proof-backdrop">
      <section aria-label="Sandbox script proof" className="script-proof" role="dialog">
        <header className="script-proof__header">
          <div>
            <p>Developer proof · restricted execution</p>
            <h2>
              {recipe === undefined ? 'Scripts sandbox foundation' : 'Declarative recipe review'}
            </h2>
          </div>
          <IconButton label="Close Scripts sandbox" onClick={onClose}>
            <Icon name="close" />
          </IconButton>
        </header>

        <div className="script-proof__notice" role="note">
          <Icon name="shield" />
          <span>
            Dedicated Worker + QuickJS-WASM. No page, DOM, storage, network, credentials, source
            bytes, or imaging Worker access. This restricted environment has not been independently
            security audited.
          </span>
        </div>

        <div className="script-proof__grid">
          <Panel className="script-proof__manifest" label="Script manifest">
            <h3>{recipe === undefined ? 'Threshold and ROI proposal' : recipe.title}</h3>
            <dl>
              <dt>API</dt>
              <dd>Script API v1 · deterministic</dd>
              <dt>Runtime</dt>
              <dd>QuickJS release · lazy Worker chunk</dd>
              <dt>Integrity</dt>
              <dd className="script-proof__hash">sha256:{displayedIntegrity || 'loading'}</dd>
            </dl>
            <h4>Requested capabilities</h4>
            <ul>
              {displayedCapabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
            <h4>Generated API</h4>
            <p>{api.endpoints.length} registry-backed endpoints · no raw tiles or tables</p>
          </Panel>

          <Panel
            className="script-proof__source"
            label={recipe === undefined ? 'Built-in sandbox source' : 'Particle analysis recipe'}
          >
            <div className="script-proof__panel-heading">
              <h3>{recipe === undefined ? 'builtin.threshold-proposal.mjs' : recipe.title}</h3>
              <span>
                {recipe === undefined ? 'Read-only fixture' : 'Declarative · inspect-only'}
              </span>
            </div>
            <pre>
              {recipe === undefined
                ? loading
                  ? 'Loading built-in fixture…'
                  : source
                : JSON.stringify(recipe, null, 2)}
            </pre>
          </Panel>

          <Panel className="script-proof__output" label="Sandbox output and provenance">
            <div className="script-proof__panel-heading">
              <h3>Bounded output</h3>
              <span aria-live="polite">{running ? 'Running' : (outcome?.status ?? 'Idle')}</span>
            </div>
            {validation.length > 0 ? (
              <ul className="script-proof__issues">
                {validation.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            ) : (
              <p className="script-proof__valid">Contract validation ready.</p>
            )}
            {outcome?.error === undefined ? null : <p role="alert">{outcome.error}</p>}
            {outcome?.output === undefined ? null : (
              <pre>{JSON.stringify(outcome.output, null, 2)}</pre>
            )}
            {outcome === undefined ? null : (
              <>
                <h4>Action trace</h4>
                <ol>
                  {outcome.provenance.actionTrace.map((entry) => (
                    <li key={`${entry.sequence}-${entry.api}`}>
                      {entry.sequence}. {entry.api} → {entry.actionId}@{entry.actionVersion} ·{' '}
                      {entry.outcome}
                    </li>
                  ))}
                </ol>
                <h4>Proposals</h4>
                <pre>{JSON.stringify(outcome.proposals, null, 2)}</pre>
              </>
            )}
          </Panel>
        </div>

        <footer className="script-proof__actions">
          <Button disabled={loading || running} onClick={validate}>
            Validate contract
          </Button>
          <Button
            disabled={recipe !== undefined || loading || running}
            onClick={run}
            variant="primary"
          >
            Run in sandbox
          </Button>
          <Button disabled={!running} onClick={stop}>
            Cancel and terminate Worker
          </Button>
        </footer>
      </section>
    </div>
  )
}
