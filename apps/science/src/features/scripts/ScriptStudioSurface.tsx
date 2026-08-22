import type { ActionCapabilityManifestV1 } from '@pji-workbench/actions'
import {
  importScriptStudioExport,
  normalizeStudioDocument,
  type RecipeDocumentV1,
  type ScriptStudioDocumentV1,
  type ScriptStudioRecordV1,
  type ScriptStudioRepository,
  serializeScriptStudioExport,
  validateRecipeDocument,
} from '@pji-workbench/plugin-sdk'
import {
  generateScriptApi,
  type ScriptActionInvoker,
  ScriptHostClient,
  type ScriptRunOutcome,
} from '@pji-workbench/scripts'
import {
  type BuiltInScriptStudioExampleV1,
  createBuiltInScriptStudioExamples,
} from '@pji-workbench/scripts/examples'
import { Button, Icon, IconButton } from '@pji-workbench/ui'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { ScriptLanguageClient, type ScriptLanguageProblem } from './language-client.js'
import { LOCAL_SCRIPT_CAPABILITIES, localInstallation } from './local-script-policy.js'
import {
  approvedExecutionApi,
  boundedLineDiff,
  compileScript,
  createStudioRecord,
  documentText,
  permissionGrant,
  runDocumentTests,
  runRecipe,
} from './studio-operations.js'

const CodeMirrorEditor = lazy(() =>
  import('./CodeMirrorEditor.js').then(({ CodeMirrorEditor: Editor }) => ({ default: Editor })),
)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Script Studio operation failed.'
}

function newId(): string {
  return `local.script-${crypto.randomUUID()}`
}

async function blankScript(): Promise<ScriptStudioRecordV1> {
  return createStudioRecord({
    schemaVersion: 1,
    kind: 'analysis-script',
    id: newId(),
    title: 'Untitled analysis script',
    description: 'Local draft created in Script Studio.',
    language: 'typescript',
    source: `import { lab } from '@lab/api'\n\nexport async function main() {\n  const workspace = await lab.workspace.getSummary()\n  return { workspace }\n}\n\nglobalThis.__scriptMain = main\n`,
    manifest: {
      scriptApiVersion: 1,
      requestedCapabilities: LOCAL_SCRIPT_CAPABILITIES,
      pureJsImageCompatibility: '^4.0.0',
      workbenchCompatibility: '^0.0.0',
      entrypoint: 'main',
      deterministic: true,
    },
    tests: [],
    integrity: { algorithm: 'sha256', digest: '0'.repeat(64) },
  })
}

function installedState(record: ScriptStudioRecordV1): 'changed' | 'installed' | 'not-installed' {
  if (record.installation === undefined) return 'not-installed'
  return record.installation.installation.contentDigest === record.document.integrity.digest
    ? 'installed'
    : 'changed'
}

function sourceFromEditor(record: ScriptStudioRecordV1, text: string): ScriptStudioDocumentV1 {
  if (record.document.kind === 'analysis-script') return { ...record.document, source: text }
  const parsed: unknown = JSON.parse(text)
  const validation = validateRecipeDocument(parsed)
  if (!validation.ok || validation.value === undefined)
    throw new Error(
      validation.issues.map(({ path, message }) => `${path || '/'}: ${message}`).join('\n'),
    )
  if (validation.value.id !== record.id) throw new Error('Recipe identity cannot change in-place.')
  return validation.value
}

export function ScriptStudioSurface({
  actionManifest,
  initialArtifactId,
  invoker,
  onClose,
  onOpenPanel,
  recipe,
  repository,
}: {
  readonly actionManifest: ActionCapabilityManifestV1
  readonly initialArtifactId?: string | undefined
  readonly invoker: ScriptActionInvoker
  readonly onClose: () => void
  readonly onOpenPanel: (panel: 'pipeline' | 'results') => void
  readonly recipe?: RecipeDocumentV1 | undefined
  readonly repository: ScriptStudioRepository
}) {
  const api = useMemo(() => generateScriptApi(actionManifest), [actionManifest])
  const apiNames = useMemo(() => api.endpoints.map(({ api: name }) => name), [api])
  const language = useMemo(() => new ScriptLanguageClient(), [])
  const runClient = useRef<ScriptHostClient | undefined>(undefined)
  const cancelled = useRef(false)
  const examples = useRef<readonly BuiltInScriptStudioExampleV1[]>([])
  const [records, setRecords] = useState<readonly ScriptStudioRecordV1[]>([])
  const [selectedId, setSelectedId] = useState('')
  const selected = records.find(({ id }) => id === selectedId)
  const selectedFixtureIds =
    examples.current.find(({ id }) => id === selectedId)?.tests.map(({ fixtureId }) => fixtureId) ??
    []
  const [text, setText] = useState('')
  const [problems, setProblems] = useState<readonly ScriptLanguageProblem[]>([])
  const [outcome, setOutcome] = useState<ScriptRunOutcome | readonly unknown[]>()
  const [notice, setNotice] = useState('Loading local Script Studio…')
  const [running, setRunning] = useState(false)
  const [editorVersion, setEditorVersion] = useState(0)
  const [apiSearch, setApiSearch] = useState('')
  const importInput = useRef<HTMLInputElement>(null)
  const loadedId = useRef('')
  const editorState = useRef({ selectionAnchor: 0, selectionHead: 0, scrollTop: 0 })

  useEffect(() => {
    let alive = true
    void (async () => {
      const builtIns = await createBuiltInScriptStudioExamples()
      examples.current = builtIns
      const existing = await repository.list()
      const byId = new Map(existing.map((record) => [record.id, record]))
      let requestedRecipeId = recipe?.id ?? initialArtifactId
      let recipeConflictWarning = ''
      for (const example of builtIns) {
        if (!byId.has(example.id)) {
          const record = await createStudioRecord(example.artifact)
          await repository.put(record)
          byId.set(record.id, record)
        }
      }
      if (recipe !== undefined) {
        const prior = byId.get(recipe.id)
        if (prior === undefined) {
          const record = await createStudioRecord(recipe)
          await repository.put(record)
          byId.set(record.id, record)
        } else if (prior.document.integrity.digest !== recipe.integrity.digest) {
          const incoming = await normalizeStudioDocument({
            ...recipe,
            id: `${recipe.id}-${recipe.integrity.digest.slice(0, 8)}`,
            title: `${recipe.title} incoming`,
          })
          const record = await createStudioRecord(incoming)
          await repository.put(record)
          byId.set(record.id, record)
          requestedRecipeId = record.id
          recipeConflictWarning =
            'The incoming recipe differed from an existing local artifact, so both versions were preserved.'
        }
      }
      if (!alive) return
      const next = [...byId.values()].sort((left, right) =>
        left.document.title.localeCompare(right.document.title),
      )
      setRecords(next)
      setSelectedId(requestedRecipeId ?? next[0]?.id ?? '')
      setNotice(
        recipeConflictWarning !== ''
          ? recipeConflictWarning
          : repository.warnings().length === 0
            ? 'Local drafts ready.'
            : repository.warnings().join(' '),
      )
    })().catch((error: unknown) => alive && setNotice(errorMessage(error)))
    return () => {
      alive = false
      language.dispose()
      runClient.current?.dispose()
    }
  }, [initialArtifactId, language, recipe, repository])

  useEffect(() => {
    if (selected !== undefined && loadedId.current !== selected.id) {
      loadedId.current = selected.id
      editorState.current = selected.editor
      setText(documentText(selected.document))
      setProblems([])
      setOutcome(undefined)
    }
  }, [selected])

  const refreshRecord = (record: ScriptStudioRecordV1): void => {
    setRecords((current) =>
      current
        .map((candidate) => (candidate.id === record.id ? record : candidate))
        .sort((left, right) => left.document.title.localeCompare(right.document.title)),
    )
  }

  const saveDraft = async (): Promise<ScriptStudioRecordV1> => {
    if (selected === undefined) throw new Error('Select a script or recipe first.')
    const document = await normalizeStudioDocument(sourceFromEditor(selected, text))
    const record = {
      ...selected,
      document,
      editor: { ...selected.editor, ...editorState.current },
      testResults:
        document.integrity.digest === selected.document.integrity.digest
          ? selected.testResults
          : [],
    }
    await repository.put(record)
    refreshRecord(record)
    setNotice('Draft saved locally. Content identity was checked.')
    return record
  }

  const createDraft = (): void => {
    void blankScript()
      .then(async (record) => {
        await repository.put(record)
        setRecords((current) => [...current, record])
        setSelectedId(record.id)
        setNotice('Created a local TypeScript draft.')
      })
      .catch((error: unknown) => setNotice(errorMessage(error)))
  }

  const duplicate = (): void => {
    if (selected === undefined) return
    void (async () => {
      const id = newId()
      const document = await normalizeStudioDocument({
        ...selected.document,
        id,
        title: `${selected.document.title} copy`,
        ...(selected.document.kind === 'recipe' ? { version: '0.1.0' } : {}),
      })
      const record = await createStudioRecord(document)
      await repository.put(record)
      setRecords((current) => [...current, record])
      setSelectedId(record.id)
      setNotice('Duplicated as an independent local artifact.')
    })().catch((error: unknown) => setNotice(errorMessage(error)))
  }

  const typecheck = (): void => {
    void saveDraft()
      .then(async (record) => {
        if (record.document.kind === 'recipe') {
          setProblems([])
          setNotice('Recipe schema and integrity are valid.')
          return
        }
        const result = await language.check(record.document.source, record.document.language, api)
        setProblems(result.problems)
        setNotice(
          result.problems.some(({ severity }) => severity === 'error')
            ? 'Typecheck found blocking problems.'
            : 'Typecheck completed without blocking problems.',
        )
      })
      .catch((error: unknown) => setNotice(errorMessage(error)))
  }

  const test = (): void => {
    setRunning(true)
    void saveDraft()
      .then(async (record) => {
        const example = examples.current.find(({ id }) => id === record.id)
        const results = await runDocumentTests({
          document: record.document,
          ...(example === undefined ? {} : { recipeTests: example.tests }),
          language,
          api,
          invoker,
        })
        const updated = { ...record, testResults: results }
        await repository.put(updated)
        refreshRecord(updated)
        setNotice(
          results.every(({ status }) => status === 'passed')
            ? `${results.length} deterministic test(s) passed.`
            : 'One or more deterministic tests failed.',
        )
      })
      .catch((error: unknown) => setNotice(errorMessage(error)))
      .finally(() => setRunning(false))
  }

  const execute = (mode: 'dry-run' | 'execute'): void => {
    const dryRun = mode === 'dry-run'
    cancelled.current = false
    setRunning(true)
    setOutcome(undefined)
    void saveDraft()
      .then(async (record) => {
        if (record.document.kind === 'recipe') {
          setOutcome(await runRecipe(record.document, invoker, dryRun ? 'dry-run' : 'execute'))
          setNotice(
            dryRun
              ? 'Recipe dry run produced bounded action plans; no mutation was committed.'
              : 'Recipe actions completed through the semantic action host.',
          )
          return
        }
        const compiled = await compileScript(record.document, language, api)
        setProblems(compiled.problems)
        if (compiled.document === undefined)
          throw new Error('Fix typecheck problems before running.')
        const runtimeApi = dryRun ? api : approvedExecutionApi(api)
        const client = new ScriptHostClient({ api: runtimeApi, invoker })
        runClient.current = client
        const result = await client.run({
          document: compiled.document,
          permissionGrant: permissionGrant(compiled.document),
        })
        if (cancelled.current) return
        setOutcome(result)
        setNotice(
          `${dryRun ? 'Sandbox dry run' : 'Sandbox run'} ${result.status}. ${result.proposals.length} proposal(s) returned.`,
        )
      })
      .catch((error: unknown) => {
        if (!cancelled.current) setNotice(errorMessage(error))
      })
      .finally(() => {
        runClient.current = undefined
        setRunning(false)
        cancelled.current = false
      })
  }

  const install = (): void => {
    void saveDraft()
      .then(async (record) => {
        const installation = localInstallation(record)
        const updated = { ...record, savedDocument: record.document, installation }
        await repository.put(updated)
        refreshRecord(updated)
        setNotice('Installed this exact local content snapshot. Later edits remain local drafts.')
      })
      .catch((error: unknown) => setNotice(errorMessage(error)))
  }

  const exportRecord = (): void => {
    void saveDraft()
      .then(serializeScriptStudioExport)
      .then((json) => {
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${selectedId}.pji-script.json`
        anchor.click()
        URL.revokeObjectURL(url)
        setNotice('Exported a bounded, integrity-checked Studio record.')
      })
      .catch((error: unknown) => setNotice(errorMessage(error)))
  }

  const importRecord = (file: File): void => {
    void file
      .text()
      .then(importScriptStudioExport)
      .then(async (record) => {
        const existing = await repository.get(record.id)
        if (
          existing !== undefined &&
          existing.document.integrity.digest !== record.document.integrity.digest
        )
          throw new Error(
            'A different local artifact already uses this identity. Duplicate or rename it before importing.',
          )
        await repository.put(record)
        setRecords((current) => [...current.filter(({ id }) => id !== record.id), record])
        setSelectedId(record.id)
        setNotice('Imported after schema, bounds, and content-identity validation.')
      })
      .catch((error: unknown) => setNotice(errorMessage(error)))
  }

  const filteredApi = api.endpoints.filter(
    ({ api: name, description }) =>
      apiSearch === '' || `${name} ${description}`.toLowerCase().includes(apiSearch.toLowerCase()),
  )
  const diff =
    selected === undefined
      ? []
      : boundedLineDiff(documentText(selected.savedDocument), documentText(selected.document))

  return (
    <div className="script-studio-backdrop">
      <section aria-label="Script Studio" className="script-studio" role="dialog">
        <header className="script-studio__header">
          <div>
            <p>Local-first authoring · restricted execution</p>
            <h2>Script Studio</h2>
          </div>
          <IconButton label="Close Script Studio" onClick={onClose}>
            <Icon name="close" />
          </IconButton>
        </header>
        <div className="script-studio__notice" role="note">
          <Icon name="shield" />
          <span>
            Local scripts run privately in a dedicated Worker and QuickJS runtime. Analysis APIs are
            ready automatically—write the analysis and press Run. Recipes are declarative.
          </span>
        </div>
        <div className="script-studio__toolbar">
          <Button onClick={createDraft}>New</Button>
          <Button disabled={selected === undefined} onClick={duplicate}>
            Duplicate
          </Button>
          <Button onClick={() => importInput.current?.click()}>Import</Button>
          <Button disabled={selected === undefined} onClick={exportRecord}>
            Export
          </Button>
          <Button disabled={selected === undefined} onClick={typecheck}>
            Typecheck
          </Button>
          <Button disabled={selected === undefined || running} onClick={test}>
            Test
          </Button>
          <Button disabled={selected === undefined || running} onClick={() => execute('dry-run')}>
            Dry Run
          </Button>
          <Button disabled={selected === undefined || running} onClick={() => execute('execute')}>
            Run
          </Button>
          <Button
            disabled={!running}
            onClick={() => {
              cancelled.current = true
              language.cancel()
              runClient.current?.cancel()
              setRunning(false)
              setNotice('Cancelled active language and sandbox Workers.')
            }}
          >
            Cancel
          </Button>
          <Button disabled={selected === undefined} onClick={install}>
            Install locally
          </Button>
          <Button
            disabled={selected === undefined}
            onClick={() => {
              if (selected === undefined) return
              setText(documentText(selected.savedDocument))
              setEditorVersion((version) => version + 1)
              setNotice('Restored the last saved snapshot in the editor; save to apply.')
            }}
          >
            Revert
          </Button>
          <input
            accept="application/json,.json"
            aria-label="Import Script Studio JSON"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file !== undefined) importRecord(file)
              event.target.value = ''
            }}
            ref={importInput}
            type="file"
          />
        </div>
        <div className="script-studio__layout">
          <aside aria-label="Local scripts and recipes" className="script-studio__library">
            <h3>Library</h3>
            {records.map((record) => (
              <button
                aria-pressed={record.id === selectedId}
                className="script-studio__artifact"
                key={record.id}
                onClick={() => setSelectedId(record.id)}
                type="button"
              >
                <strong>{record.document.title}</strong>
                <span>
                  {record.kind === 'recipe' ? 'Recipe' : 'Sandboxed script'} ·{' '}
                  {installedState(record)}
                </span>
              </button>
            ))}
          </aside>
          <main className="script-studio__main">
            <div className="script-studio__editor-heading">
              <div>
                <h3>{selected?.document.title ?? 'Select an artifact'}</h3>
                <span>
                  {selected?.kind === 'recipe' ? 'JSON recipe' : 'TypeScript / JavaScript'}
                </span>
              </div>
              <Button
                disabled={selected === undefined}
                onClick={() => void saveDraft().catch((error) => setNotice(errorMessage(error)))}
              >
                Save draft
              </Button>
            </div>
            {selected === undefined ? null : (
              <Suspense fallback={<p role="status">Loading editor language tools…</p>}>
                <CodeMirrorEditor
                  apiNames={apiNames}
                  initialValue={
                    loadedId.current === selected.id ? text : documentText(selected.document)
                  }
                  key={`${selected.id}:${editorVersion}`}
                  language={
                    selected.document.kind === 'recipe' ? 'json' : selected.document.language
                  }
                  onChange={setText}
                  onEditorState={(state) => {
                    editorState.current = state
                  }}
                />
              </Suspense>
            )}
          </main>
          <aside className="script-studio__inspector">
            <section aria-label="API explorer">
              <h3>API & examples</h3>
              <input
                aria-label="Search script API"
                onChange={(event) => setApiSearch(event.target.value)}
                placeholder="Search @lab/api"
                type="search"
                value={apiSearch}
              />
              <ul className="script-studio__api-list">
                {filteredApi.slice(0, 24).map((endpoint) => (
                  <li key={endpoint.api}>
                    <code>lab.{endpoint.api}</code>
                    <span>{endpoint.description}</span>
                  </li>
                ))}
              </ul>
              <details>
                <summary>Generated @lab/api declarations</summary>
                <pre>{api.declaration}</pre>
              </details>
            </section>
            <section aria-label="Problems">
              <h3>Problems</h3>
              {problems.length === 0 ? (
                <p>No reported problems.</p>
              ) : (
                <ul>
                  {problems.map((problem) => (
                    <li
                      key={`${problem.line}-${problem.column}-${problem.severity}-${problem.message}`}
                    >
                      {problem.severity} {problem.line}:{problem.column} · {problem.message}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Tests and fixtures">
              <h3>Tests · {selectedFixtureIds[0] ?? 'no deterministic fixture'}</h3>
              <label>
                Fixture
                <select aria-label="Test fixture" disabled value={selectedFixtureIds[0] ?? ''}>
                  {selectedFixtureIds.length === 0 ? <option value="">No fixture</option> : null}
                  {selectedFixtureIds.map((fixtureId) => (
                    <option key={fixtureId} value={fixtureId}>
                      {fixtureId}
                    </option>
                  ))}
                </select>
              </label>
              {selected?.testResults.length === 0 ? (
                <p>No persisted test result.</p>
              ) : (
                <ul>
                  {selected?.testResults.map((result) => (
                    <li key={result.testId}>
                      {result.testId} · {result.status}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Saved changes">
              <h3>Diff from saved snapshot</h3>
              <pre>{diff.join('\n')}</pre>
            </section>
            <section aria-label="Bounded console and results">
              <h3>Console · output · graph/results links</h3>
              <pre>
                {outcome === undefined
                  ? 'No run output.'
                  : JSON.stringify(outcome, null, 2).slice(0, 16_384)}
              </pre>
              {outcome !== undefined && 'status' in outcome ? (
                <>
                  <ul>
                    {outcome.provenance.actionTrace.map((entry) => (
                      <li key={entry.sequence}>
                        Action {entry.actionId}@{entry.actionVersion}
                      </li>
                    ))}
                  </ul>
                  <Button
                    onClick={() => {
                      onOpenPanel('pipeline')
                      onClose()
                    }}
                  >
                    Open operation graph
                  </Button>
                  <Button
                    onClick={() => {
                      onOpenPanel('results')
                      onClose()
                    }}
                  >
                    Open analysis results
                  </Button>
                </>
              ) : null}
            </section>
          </aside>
        </div>
        <footer aria-live="polite" className="script-studio__status">
          {running ? 'Working… ' : ''}
          {notice}
        </footer>
      </section>
    </div>
  )
}
