import {
  CATALOG_REGISTRY,
  type GeoWorkflowParameter,
  type GeoWorkflowRecipe,
  type GeoWorkflowRunRecord,
} from '@pji-workbench/domain-geo'
import type { GeoWorkflowRunner, GeoWorkflowRunnerSnapshot } from '@pji-workbench/geo-workbench'
import { Button, ErrorState } from '@pji-workbench/ui'
import { useMemo, useState } from 'react'

export function WorkflowBrowser({
  runner,
  snapshot,
  disabled,
  onCompleted,
}: {
  readonly runner: GeoWorkflowRunner
  readonly snapshot: GeoWorkflowRunnerSnapshot
  readonly disabled: boolean
  readonly onCompleted: (run: GeoWorkflowRunRecord) => void
}) {
  const recipes = runner.recipes()
  const [selectedId, setSelectedId] = useState(recipes[0]?.id ?? '')
  const [parameters, setParameters] = useState<Readonly<Record<string, string | boolean>>>({})
  const [choices, setChoices] = useState<readonly string[]>([])
  const selected = recipes.find(({ id }) => id === selectedId) ?? recipes[0]
  const availability = selected === undefined ? undefined : runner.availability(selected)
  const active = snapshot.run?.workflowId === selected?.id ? snapshot.run : undefined
  const running = snapshot.run?.status === 'running'
  const decision = selected?.steps.find((step) => step.kind === 'user-decision')
  const blocked = availability?.status.startsWith('blocked-') === true
  const effectiveParameters = useMemo(
    () =>
      Object.fromEntries(
        (selected?.inputParameters ?? []).map((parameter) => [
          parameter.id,
          parameters[parameter.id] ?? parameter.default,
        ]),
      ),
    [parameters, selected],
  )

  if (selected === undefined) return <p>No workflows are configured.</p>
  return (
    <div className="geo-inspector-body geo-workflows" data-testid="workflow-browser">
      <label>
        Workflow
        <select
          aria-label="Workflow"
          disabled={running}
          onChange={(event) => {
            setSelectedId(event.currentTarget.value)
            setParameters({})
            setChoices([])
          }}
          value={selected.id}
        >
          {recipes.map((recipe) => (
            <option key={recipe.id} value={recipe.id}>
              {recipe.title}
            </option>
          ))}
        </select>
      </label>
      <WorkflowSummary recipe={selected} />
      <p className={`geo-workflow-availability is-${availability?.status ?? 'blocked'}`}>
        <strong>{availabilityLabel(availability?.status)}</strong>
        {` · ${availability?.reason ?? 'Availability could not be determined.'}`}
      </p>
      {selected.inputParameters.map((parameter) =>
        parameter.type === 'boolean' ? (
          <label key={parameter.id} title={parameter.description}>
            <input
              checked={effectiveParameters[parameter.id] === true}
              onChange={(event) =>
                setParameters((current) => ({
                  ...current,
                  [parameter.id]: event.currentTarget.checked,
                }))
              }
              type="checkbox"
            />
            {parameter.title}
          </label>
        ) : (
          <label key={parameter.id} title={parameter.description}>
            {parameter.title}
            <select
              aria-label={parameter.title}
              onChange={(event) =>
                setParameters((current) => ({
                  ...current,
                  [parameter.id]: event.currentTarget.value,
                }))
              }
              value={String(effectiveParameters[parameter.id])}
            >
              {parameterOptions(parameter, snapshot, choices).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ),
      )}
      <div className="geo-inspector-toolbar">
        <Button
          disabled={disabled || blocked || running}
          onClick={() => {
            setChoices([])
            void runner.start(selected.id, effectiveParameters).catch(() => undefined)
          }}
          variant="primary"
        >
          Run workflow
        </Button>
        {active?.status === 'running' || active?.status === 'awaiting-decision' ? (
          <Button onClick={() => runner.cancel()}>Cancel</Button>
        ) : null}
        {active?.status === 'completed' ? (
          <Button onClick={() => void runner.replay(active).catch(() => undefined)}>Replay</Button>
        ) : null}
      </div>
      {active === undefined ? null : (
        <p data-testid="workflow-current-step">
          {`${statusLabel(active.status)} · ${stepTitle(selected, active.currentStepId)}`}
        </p>
      )}
      {active?.status === 'awaiting-decision' ? (
        <fieldset className="geo-workflow-options">
          <legend>{decision?.title ?? 'Choose workflow input'}</legend>
          {snapshot.decisionOptions.map((option) => (
            <label key={option.id}>
              <input
                checked={choices.includes(option.id)}
                name="workflow-option"
                onChange={(event) => {
                  const maximum = decision?.maximumSelections ?? 1
                  const checked = event.currentTarget.checked
                  setChoices((current) => {
                    if (!checked) return current.filter((id) => id !== option.id)
                    return maximum === 1 ? [option.id] : [...current, option.id].slice(-maximum)
                  })
                }}
                type={(decision?.maximumSelections ?? 1) === 1 ? 'radio' : 'checkbox'}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
          <Button
            disabled={
              choices.length < (decision?.minimumSelections ?? 1) ||
              choices.length > (decision?.maximumSelections ?? 1)
            }
            onClick={() =>
              void runner
                .choose(choices)
                .then(() => {
                  const completed = runner.getSnapshot().run
                  if (completed?.status === 'completed') onCompleted(completed)
                })
                .catch(() => undefined)
            }
            variant="primary"
          >
            Continue
          </Button>
        </fieldset>
      ) : null}
      {active?.status === 'failed' ? (
        <ErrorState message={active.error ?? active.availability.reason} title="Workflow stopped" />
      ) : null}
      {active?.status === 'completed' ? <CompletedRun run={active} /> : null}
    </div>
  )
}

function WorkflowSummary({ recipe }: { readonly recipe: GeoWorkflowRecipe }) {
  const catalogs = recipe.catalogDependencies.flatMap((dependency) => {
    const catalog = CATALOG_REGISTRY.find(({ id }) => id === dependency.catalogId)
    return catalog === undefined ? [] : [catalog]
  })
  const providers = catalogs.map(
    (catalog) => `${catalog.title}: ${catalog.attribution} (${catalog.license})`,
  )
  const providerNotes = catalogs.flatMap(({ browserNote }) =>
    browserNote === undefined ? [] : [browserNote],
  )
  return (
    <section aria-labelledby={`workflow-${recipe.id}`}>
      <h3 id={`workflow-${recipe.id}`}>{recipe.title}</h3>
      <p>{recipe.purpose}</p>
      <dl>
        <dt>Expected inputs</dt>
        <dd>
          {recipe.requiredAssets
            .map((asset) => `${asset.role}${asset.required ? '' : ' (optional)'}`)
            .join(', ')}
        </dd>
        <dt>Expected outputs</dt>
        <dd>{recipe.outputs.map(({ title }) => title).join(', ')}</dd>
        <dt>Provider attribution</dt>
        <dd>{providers.join(' · ')}</dd>
        {providerNotes.length === 0 ? null : (
          <>
            <dt>Provider access note</dt>
            <dd>{providerNotes.join(' · ')}</dd>
          </>
        )}
      </dl>
      <details>
        <summary>Ordered workflow plan</summary>
        <ol>
          {recipe.steps.map((step) => (
            <li key={step.id}>{step.title}</li>
          ))}
        </ol>
        <p>{recipe.fallbackExplanation}</p>
      </details>
    </section>
  )
}

function CompletedRun({ run }: { readonly run: GeoWorkflowRunRecord }) {
  return (
    <section data-testid="workflow-completed">
      <h3>Completed outputs</h3>
      <ul>
        {run.completedOutputs.map((output) => (
          <li
            key={output.id}
          >{`${output.title}${output.reference === undefined ? '' : ` · ${output.reference}`}`}</li>
        ))}
      </ul>
      <details>
        <summary>Provenance</summary>
        <p>
          {run.selectedAssets
            .map(
              (asset) =>
                `${asset.catalogId}/${asset.collectionId}/${asset.itemId}/${asset.assetKey}`,
            )
            .join(' · ')}
        </p>
        <p>{run.attribution.join(' · ')}</p>
        <ol>
          {run.actions.map((action) => (
            <li
              key={action.sequence}
            >{`${action.sequence}. ${action.stepId} · ${action.actionId}`}</li>
          ))}
        </ol>
      </details>
    </section>
  )
}

function stepTitle(recipe: GeoWorkflowRecipe, stepId: string | undefined): string {
  return recipe.steps.find(({ id }) => id === stepId)?.title ?? 'Preparing workflow'
}

function statusLabel(status: GeoWorkflowRunRecord['status']): string {
  return status
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}

function availabilityLabel(status: string | undefined): string {
  return status === undefined
    ? 'Unavailable'
    : status
        .split('-')
        .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
        .join(' ')
}

function parameterOptions(
  parameter: GeoWorkflowParameter,
  snapshot: GeoWorkflowRunnerSnapshot,
  choices: readonly string[],
): readonly Readonly<{ value: string; label: string }>[] {
  const options = parameter.options ?? []
  if (parameter.id !== 'displayPreset') return options
  const candidates =
    choices.length === 0
      ? snapshot.decisionOptions
      : snapshot.decisionOptions.filter(({ id }) => choices.includes(id))
  if (candidates.length === 0) return options.filter(({ value }) => value === parameter.default)
  return options.filter(({ value }) =>
    candidates.some((option) => option.supportedParameters?.[parameter.id]?.includes(value)),
  )
}
