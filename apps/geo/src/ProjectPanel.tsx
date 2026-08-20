import type {
  GeoProjectRehydrationPlan,
  GeoStoredProjectSummary,
  GeoWorkbenchController,
} from '@pji-workbench/geo-workbench'
import { Button } from '@pji-workbench/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

export function ProjectPanel({
  controller,
  projectId,
  projectTitle,
}: {
  readonly controller: GeoWorkbenchController
  readonly projectId: string
  readonly projectTitle: string
}) {
  const importRef = useRef<HTMLInputElement>(null)
  const [saved, setSaved] = useState<readonly GeoStoredProjectSummary[]>([])
  const [plan, setPlan] = useState<GeoProjectRehydrationPlan>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    const value = await controller.executeAction('geo.project.list', {})
    if (!Array.isArray(value)) throw new Error('Saved project list is invalid.')
    setSaved(value.map(storedProjectSummary))
  }, [controller])

  useEffect(() => {
    void refresh().catch((reason: unknown) => setError(errorMessage(reason)))
  }, [refresh])

  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await operation()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }, [])

  const openResult = (value: unknown): void => {
    const record = jsonRecord(value)
    if (record['committed'] === true) setPlan(undefined)
    else if (record['plan'] !== undefined) setPlan(projectPlan(record['plan']))
  }

  return (
    <div className="geo-inspector-body" data-testid="project-panel">
      <section aria-labelledby="atlas-current-project">
        <div className="geo-inspector-toolbar">
          <strong id="atlas-current-project">Current project</strong>
          <span>{projectTitle}</span>
        </div>
        <div className="geo-inspector-toolbar">
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await controller.executeAction('geo.project.save', {})
                await refresh()
              })
            }
          >
            Save
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const value = jsonRecord(await controller.executeAction('geo.project.export', {}))
                if (typeof value['text'] !== 'string') throw new Error('Project export was empty.')
                downloadProject(value['text'], `${safeFileName(projectTitle)}.atlas.json`)
              })
            }
          >
            Export JSON
          </Button>
          <Button disabled={busy} onClick={() => importRef.current?.click()}>
            Import JSON
          </Button>
          <input
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file === undefined) return
              void run(async () => {
                const value = jsonRecord(
                  await controller.executeAction('geo.project.import', {
                    document: await file.text(),
                  }),
                )
                setPlan(projectPlan(value['plan']))
              })
            }}
            ref={importRef}
            type="file"
          />
        </div>
      </section>

      {plan === undefined ? null : (
        <section aria-labelledby="atlas-rehydration-plan">
          <div className="geo-inspector-toolbar">
            <strong id="atlas-rehydration-plan">Source review</strong>
            <span>{plan.readyToCommit ? 'Ready' : 'Needs attention'}</span>
          </div>
          <ol className="geo-source-list">
            {plan.entries.map((entry) => (
              <li key={entry.sourceId}>
                <div>
                  <strong>{entry.label}</strong>
                  <div>{entry.status}</div>
                  {entry.differences.length === 0 ? null : (
                    <small>{entry.differences.join(', ')}</small>
                  )}
                </div>
                {entry.status === 'rebind-required' || entry.locatorKind === 'local-file' ? (
                  <label>
                    Rebind files
                    <input
                      accept=".tif,.tiff,.tfw,.xml,.json"
                      disabled={busy}
                      multiple
                      onChange={(event) => {
                        const files = [...(event.currentTarget.files ?? [])]
                        event.currentTarget.value = ''
                        const primary =
                          files.find(({ name }) => name === entry.expectedFileName) ?? files[0]
                        if (primary === undefined) return
                        void run(async () => {
                          const resourceId = controller.registerLocalResource(files, primary)
                          const value = await controller.executeAction(
                            'geo.project.rebind_source',
                            {
                              sourceId: entry.sourceId,
                              resourceId,
                            },
                          )
                          setPlan(projectPlan(value))
                        })
                      }}
                      type="file"
                    />
                  </label>
                ) : entry.status === 'missing' || entry.status === 'unavailable' ? (
                  <Button
                    disabled={busy || entry.locatorKind === 'remote-url'}
                    onClick={() =>
                      void run(async () => {
                        const value = await controller.executeAction(
                          'geo.project.resolve_catalog_source',
                          { sourceId: entry.sourceId },
                        )
                        setPlan(projectPlan(value))
                      })
                    }
                  >
                    Resolve again
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
          {plan.invalidatedDerivedLayerIds.length === 0 ? null : (
            <p>
              Changed inputs invalidate derived caches for{' '}
              {plan.invalidatedDerivedLayerIds.join(', ')}. Recipes remain available for replay.
            </p>
          )}
          <Button
            disabled={busy || !plan.readyToCommit}
            onClick={() =>
              void run(async () => {
                openResult(
                  await controller.executeAction('geo.project.open', {
                    confirmChanged: plan.requiresConfirmation,
                  }),
                )
              })
            }
            variant="primary"
          >
            {plan.requiresConfirmation ? 'Confirm changes and open' : 'Open project'}
          </Button>
        </section>
      )}

      <section aria-labelledby="atlas-saved-projects">
        <div className="geo-inspector-toolbar">
          <strong id="atlas-saved-projects">Saved projects</strong>
          <span>{saved.length} / 64</span>
        </div>
        {saved.length === 0 ? (
          <p>No projects saved in this browser.</p>
        ) : (
          <ol className="geo-source-list">
            {saved.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <div>{Math.ceil(item.bytes / 1024)} KiB</div>
                </div>
                <Button
                  disabled={busy || item.id === projectId}
                  onClick={() =>
                    void run(async () => {
                      openResult(
                        await controller.executeAction('geo.project.open', {
                          projectId: item.id,
                        }),
                      )
                    })
                  }
                >
                  Open
                </Button>
                <Button
                  aria-label={`Delete ${item.title}`}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await controller.executeAction('geo.project.delete', { projectId: item.id })
                      await refresh()
                    })
                  }
                >
                  Delete
                </Button>
              </li>
            ))}
          </ol>
        )}
      </section>
      {error === undefined ? null : <p role="alert">{error}</p>}
    </div>
  )
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}
}

function projectPlan(value: unknown): GeoProjectRehydrationPlan {
  const record = jsonRecord(value)
  if (
    typeof record['projectId'] !== 'string' ||
    !Array.isArray(record['entries']) ||
    !Array.isArray(record['invalidatedDerivedLayerIds']) ||
    typeof record['readyToCommit'] !== 'boolean' ||
    typeof record['requiresConfirmation'] !== 'boolean'
  )
    throw new Error('Project rehydration plan is invalid.')
  return value as GeoProjectRehydrationPlan
}

function storedProjectSummary(value: unknown): GeoStoredProjectSummary {
  const record = jsonRecord(value)
  if (
    typeof record['id'] !== 'string' ||
    typeof record['title'] !== 'string' ||
    typeof record['updatedAt'] !== 'string' ||
    typeof record['bytes'] !== 'number' ||
    record['schemaVersion'] !== 2
  )
    throw new Error('Saved project summary is invalid.')
  return value as GeoStoredProjectSummary
}

function downloadProject(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function safeFileName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-z0-9._-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
  return normalized.length === 0 ? 'atlas-project' : normalized.slice(0, 128)
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : 'The project action could not be completed.'
}
