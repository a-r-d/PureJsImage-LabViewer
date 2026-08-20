import type {
  DerivedRasterRecipeV1,
  RasterLengthUnitV1,
  RasterSampleType,
} from '@pji-workbench/contracts'
import {
  CATALOG_REGISTRY,
  type CatalogSearchItem,
  type CatalogSearchPage,
  type CatalogSourceCandidate,
  crsKey,
  displayPresetsForCandidate,
  GEO_WORKFLOW_RECIPES,
  type GeoActionId,
  type GeoLayerId,
  type GeoRasterSource,
  type GeoWorkflowActionRecord,
  type GeoWorkflowAvailability,
  type GeoWorkflowDecisionOption,
  type GeoWorkflowRecipe,
  type GeoWorkflowRunRecord,
  geoWorkflowById,
  scalarNodata,
  workflowAssetIdentity,
  workflowAvailability,
} from '@pji-workbench/domain-geo'

import {
  GeoControllerError,
  type GeoRuntimeBinding,
  type GeoWorkbenchController,
} from './controller.js'

export interface GeoWorkflowRunnerSnapshot {
  readonly run?: GeoWorkflowRunRecord
  readonly decisionOptions: readonly GeoWorkflowDecisionOption[]
}

interface WorkflowSession {
  readonly workflow: GeoWorkflowRecipe
  readonly abort: AbortController
  readonly candidatesByOption: ReadonlyMap<string, readonly CatalogSourceCandidate[]>
}

type Listener = (snapshot: GeoWorkflowRunnerSnapshot) => void

/** Shared headless workflow executor. Every effect is delegated to a semantic controller action. */
export class GeoWorkflowRunner {
  readonly #controller: GeoWorkbenchController
  readonly #listeners = new Set<Listener>()
  #snapshot: GeoWorkflowRunnerSnapshot = { decisionOptions: [] }
  #session: WorkflowSession | undefined
  #nextRun = 1

  constructor(controller: GeoWorkbenchController) {
    this.#controller = controller
  }

  getSnapshot(): GeoWorkflowRunnerSnapshot {
    return this.#snapshot
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  recipes(): readonly GeoWorkflowRecipe[] {
    return GEO_WORKFLOW_RECIPES
  }

  availability(workflow: GeoWorkflowRecipe): GeoWorkflowAvailability {
    return workflowAvailability(workflow, {
      catalogs: CATALOG_REGISTRY,
      availableActions: new Set(
        workflow.requiredOperations.filter(
          (id) => this.#controller.actionAvailability(id).available || this.#isContextualAction(id),
        ),
      ),
    })
  }

  async start(
    workflowId: string,
    parameterInput: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    this.cancel()
    const workflow = geoWorkflowById(workflowId)
    if (workflow === undefined)
      throw new GeoControllerError('INVALID_ACTION_INPUT', `Workflow ${workflowId} does not exist.`)
    const parameters = normalizeParameters(workflow, parameterInput)
    const selector = selectSelector(workflow, parameters)
    const abort = new AbortController()
    let run = createRun(workflow, parameters, `geo-workflow-${this.#nextRun++}`)
    const session: WorkflowSession = { workflow, abort, candidatesByOption: new Map() }
    this.#session = session
    this.#publish({ run, decisionOptions: [] })
    try {
      const catalog = CATALOG_REGISTRY.find(({ id }) => id === selector.catalogId)
      if (catalog === undefined)
        throw new GeoControllerError(
          'CATALOG_NOT_FOUND',
          `Catalog ${selector.catalogId} is unavailable.`,
        )
      const collections = catalog.collectionGroups[selector.collectionGroup]
      if (collections === undefined || collections.length === 0)
        throw new GeoControllerError(
          'CATALOG_NOT_FOUND',
          `Collection group ${selector.collectionGroup} is unavailable.`,
        )
      const input = {
        catalogId: catalog.id,
        request: {
          bbox: selector.bbox,
          collections,
          limit: selector.limit,
          ...(selector.datetime === undefined ? {} : { datetime: selector.datetime }),
          ...(selector.sortby === undefined ? {} : { sortby: selector.sortby }),
        },
      }
      const page = (await this.#recordAction(
        run,
        'discover',
        'geo.catalog.search',
        input,
        abort.signal,
      )) as unknown as CatalogSearchPage
      abort.signal.throwIfAborted()
      const built = decisionOptions(workflow, page.items)
      if (built.options.length === 0)
        throw new GeoControllerError(
          'UNAVAILABLE',
          'No workflow-compatible candidates were returned.',
        )
      run = {
        ...currentRun(this.#snapshot),
        status: 'awaiting-decision',
        currentStepId: 'choose',
        availability: { status: 'available', reason: 'Compatible candidates are ready to choose.' },
      }
      if (this.#session !== session) abort.signal.throwIfAborted()
      this.#session = { workflow, abort, candidatesByOption: built.candidatesByOption }
      this.#publish({ run, decisionOptions: built.options })
    } catch (error) {
      if (this.#session === session) await this.#finishFailure(error)
      throw error
    }
  }

  async choose(optionIds: readonly string[]): Promise<void> {
    const session = this.#requireSession()
    const run = currentRun(this.#snapshot)
    if (run.status !== 'awaiting-decision')
      throw new GeoControllerError('UNAVAILABLE', 'The workflow is not awaiting a decision.')
    const decision = session.workflow.steps.find((step) => step.kind === 'user-decision')
    if (decision === undefined)
      throw new GeoControllerError('PROJECT_INVALID', 'Missing decision step.')
    if (
      optionIds.length < decision.minimumSelections ||
      optionIds.length > decision.maximumSelections
    )
      throw new GeoControllerError(
        'INVALID_ACTION_INPUT',
        `Choose ${decision.minimumSelections === decision.maximumSelections ? decision.minimumSelections : `${decision.minimumSelections}-${decision.maximumSelections}`} option(s).`,
      )
    const unique = [...new Set(optionIds)]
    if (unique.length !== optionIds.length)
      throw new GeoControllerError('INVALID_ACTION_INPUT', 'Workflow choices must be distinct.')
    const candidates = unique.flatMap((id) => session.candidatesByOption.get(id) ?? [])
    if (candidates.length === 0 || unique.some((id) => !session.candidatesByOption.has(id)))
      throw new GeoControllerError('INVALID_ACTION_INPUT', 'A selected workflow option is stale.')
    this.#publish({
      run: {
        ...run,
        status: 'running',
        currentStepId: 'verify',
        decisions: { ...run.decisions, choose: unique },
        selectedAssets: candidates.map(workflowAssetIdentity),
      },
      decisionOptions: this.#snapshot.decisionOptions,
    })
    try {
      await this.#executeSelected(session.workflow, candidates, session.abort.signal)
    } catch (error) {
      if (this.#session === session) await this.#finishFailure(error)
      throw error
    }
  }

  cancel(): void {
    const session = this.#session
    session?.abort.abort()
    const run = this.#snapshot.run
    if (session !== undefined && run?.status === 'awaiting-decision') {
      this.#publish({
        run: {
          ...run,
          status: 'cancelled',
          completedAt: new Date().toISOString(),
          availability: {
            status: 'available-after-source-selection',
            reason: 'Workflow cancelled before opening sources.',
          },
        },
        decisionOptions: [],
      })
    }
  }

  async replay(record: GeoWorkflowRunRecord): Promise<void> {
    this.cancel()
    const workflow = geoWorkflowById(record.workflowId)
    if (workflow === undefined || record.workflowVersion !== workflow.version)
      throw new GeoControllerError('INVALID_ACTION_INPUT', 'The workflow version is unavailable.')
    const abort = new AbortController()
    let run = createRun(workflow, record.parameters, `geo-workflow-${this.#nextRun++}`)
    const session: WorkflowSession = { workflow, abort, candidatesByOption: new Map() }
    this.#session = session
    this.#publish({ run, decisionOptions: [] })
    try {
      const candidates: CatalogSourceCandidate[] = []
      for (const identity of record.selectedAssets) {
        const result = await this.#recordAction(
          run,
          'resolve',
          'geo.catalog.inspect_asset',
          { catalogId: identity.catalogId, identity },
          abort.signal,
        )
        if (result === null || typeof result !== 'object')
          throw new GeoControllerError(
            'UNAVAILABLE',
            `Asset ${identity.assetKey} is no longer resolvable.`,
          )
        candidates.push(result as unknown as CatalogSourceCandidate)
        run = currentRun(this.#snapshot)
      }
      this.#publish({
        run: {
          ...currentRun(this.#snapshot),
          status: 'running',
          currentStepId: 'verify',
          decisions: record.decisions,
          selectedAssets: record.selectedAssets,
        },
        decisionOptions: [],
      })
      await this.#executeSelected(workflow, candidates, abort.signal)
    } catch (error) {
      if (this.#session === session) await this.#finishFailure(error)
      throw error
    }
  }

  async #executeSelected(
    workflow: GeoWorkflowRecipe,
    selected: readonly CatalogSourceCandidate[],
    signal: AbortSignal,
  ): Promise<void> {
    validateSelection(workflow, selected, currentRun(this.#snapshot).parameters)
    const before = this.#controller.getSnapshot().project
    const sourceIds: string[] = []
    const outputLayerIds: string[] = []
    try {
      const candidates = candidatesToOpen(workflow, selected)
      for (const candidate of candidates) {
        signal.throwIfAborted()
        const presets = displayPresetsForCandidate(candidate)
        const result = (await this.#recordAction(
          currentRun(this.#snapshot),
          'open',
          'geo.source.open_catalog_asset',
          { candidate, presets },
          signal,
        )) as { readonly sourceId?: string }
        if (typeof result.sourceId !== 'string')
          throw new GeoControllerError(
            'PROJECT_INVALID',
            'Source action returned no source identity.',
          )
        sourceIds.push(result.sourceId)
      }
      validateOpenedCompatibility(workflow, selected, this.#controller, sourceIds)
      const layers = sourceIds.map((sourceId) => layerForSource(this.#controller, sourceId))
      if (workflow.id === 'cog-anatomy') {
        await this.#recordAction(
          currentRun(this.#snapshot),
          'inspect',
          'geo.source.describe',
          { sourceId: required(sourceIds[0], 'source') },
          signal,
        )
        if (this.#controller.actionAvailability('geo.viewport.fit_source').available) {
          await this.#recordAction(
            currentRun(this.#snapshot),
            'fit',
            'geo.viewport.fit_source',
            { sourceId: required(sourceIds[0], 'source') },
            signal,
          )
        }
      } else if (workflow.id === 'kentucky-through-time') {
        const mode = currentRun(this.#snapshot).parameters['comparisonMode']
        const left = required(layers[0], 'left layer')
        const right = required(layers[1], 'right layer')
        if (mode === 'blink') {
          await this.#recordAction(
            currentRun(this.#snapshot),
            'compare',
            'geo.comparison.set_blink',
            {
              firstLayerId: left,
              secondLayerId: right,
              intervalMilliseconds: 750,
            },
            signal,
          )
        } else {
          await this.#recordAction(
            currentRun(this.#snapshot),
            'compare',
            'geo.comparison.set_swipe',
            {
              leftLayerId: left,
              rightLayerId: right,
              swipePosition: 0.5,
            },
            signal,
          )
        }
      } else if (workflow.id === 'natural-color-cir' || workflow.id === 'noaa-raster-inspection') {
        const candidate = required(selected[0], 'candidate')
        const presets = displayPresetsForCandidate(candidate)
        const requested = currentRun(this.#snapshot).parameters['displayPreset']
        const requestedPreset = requested === 'cir' ? 'color-infrared' : requested
        const preset =
          presets.find(({ id }) => id === requestedPreset) ??
          presets.find(({ id }) => id === 'natural-color')
        if (preset !== undefined) {
          await this.#recordAction(
            currentRun(this.#snapshot),
            'display',
            'geo.layer.set_style',
            {
              layerId: required(layers[0], 'layer'),
              style: preset.style,
            },
            signal,
          )
        }
      } else if (workflow.id === 'terrain-lab') {
        const layerId = required(layers[0], 'terrain layer')
        const sourceId = required(sourceIds[0], 'terrain source')
        const hillshade = await this.#createTerrain('hillshade', layerId, sourceId, signal)
        outputLayerIds.push(hillshade)
        const slope = await this.#createTerrain('slope', layerId, sourceId, signal)
        outputLayerIds.push(slope)
        const source = sourceForId(this.#controller, sourceId)
        const binding = required(this.#controller.bindingForSource(sourceId), 'runtime binding')
        const elevationRecipe = baseRecipe(
          source,
          binding,
          [
            recipeInput(
              'elevation',
              layerId,
              source.bands[0],
              currentRun(this.#snapshot).parameters,
            ),
          ],
          { kind: 'virtual-band-stack', bands: ['elevation'] },
        )
        await this.#recordAction(
          currentRun(this.#snapshot),
          'profile',
          'geo.analysis.line_profile',
          {
            recipe: elevationRecipe,
            start: { x: 0, y: 0 },
            end: { x: source.width - 1, y: source.height - 1 },
            sampleCount: Math.min(256, Math.max(2, Math.min(source.width, source.height))),
            component: 0,
            resampling: 'bilinear',
          },
          signal,
        )
        await this.#recordAction(
          currentRun(this.#snapshot),
          'summary',
          'geo.analysis.region_statistics',
          {
            recipe: elevationRecipe,
            region: { x: 0, y: 0, width: source.width, height: source.height },
            component: 0,
          },
          signal,
        )
      } else if (workflow.id === 'usgs-landsat-cincinnati') {
        const byRole = roleLayers(workflow, selected, sourceIds, layers)
        const natural = await this.#createStack(
          ['red', 'green', 'blue'],
          byRole,
          signal,
          'Landsat natural color',
        )
        outputLayerIds.push(natural)
        const cir = await this.#createStack(
          ['nir', 'red', 'green'],
          byRole,
          signal,
          'Landsat color infrared',
        )
        outputLayerIds.push(cir)
        if (currentRun(this.#snapshot).parameters['includeNdvi'] !== false) {
          const ndvi = await this.#createNdvi(byRole, signal)
          outputLayerIds.push(ndvi)
        }
      }
      const run = currentRun(this.#snapshot)
      const workflowLayerIds =
        outputLayerIds.length > 0
          ? outputLayerIds
          : workflow.id === 'natural-color-cir' || workflow.id === 'noaa-raster-inspection'
            ? layers.slice(0, 1)
            : []
      const completedAt = new Date().toISOString()
      const completed = {
        ...run,
        sourceIds: sourceIds as unknown as GeoWorkflowRunRecord['sourceIds'],
        outputLayerIds: workflowLayerIds as GeoLayerId[],
        completedOutputs: completedOutputs(workflow, workflowLayerIds),
        attribution: attributionFor(selected),
        completedAt,
      }
      await this.#recordAction(
        run,
        'provenance',
        'geo.workflow.record',
        {
          record: {
            schemaVersion: 1,
            id: completed.id,
            workflowId: completed.workflowId,
            workflowVersion: completed.workflowVersion,
            parameters: completed.parameters,
            decisions: completed.decisions,
            selectedAssets: completed.selectedAssets,
            actions: completed.actions,
            sourceIds: completed.sourceIds,
            outputLayerIds: completed.outputLayerIds,
            completedOutputs: completed.completedOutputs,
            attribution: completed.attribution,
            startedAt: completed.startedAt,
            completedAt,
          },
        },
        signal,
      )
      this.#publish({
        run: {
          ...completed,
          actions: currentRun(this.#snapshot).actions,
          status: 'completed',
          currentStepId: 'provenance',
          availability: { status: 'available', reason: 'Workflow completed.' },
        },
        decisionOptions: [],
      })
    } catch (error) {
      await rollback(
        this.#controller,
        before.sources.map(({ id }) => id),
        before.layers.map(({ id }) => id),
      )
      throw error
    }
  }

  async #createTerrain(
    operation: 'hillshade' | 'slope',
    layerId: string,
    sourceId: string,
    signal: AbortSignal,
  ): Promise<string> {
    const source = sourceForId(this.#controller, sourceId)
    const binding = required(this.#controller.bindingForSource(sourceId), 'runtime binding')
    const affine = required(source.spatialReference.pixelToModel, 'pixel grid')
    const xSpacing = Math.hypot(affine[0], affine[3])
    const ySpacing = Math.hypot(affine[1], affine[4])
    const unit = lengthUnit(source.bands[0]?.unit)
    const recipe = baseRecipe(
      source,
      binding,
      [recipeInput('elevation', layerId, source.bands[0], currentRun(this.#snapshot).parameters)],
      {
        kind: 'terrain',
        operation,
        input: 'elevation',
        xSpacing,
        ySpacing,
        xUnit: unit,
        yUnit: unit,
        verticalUnit: unit,
        rowDirection: affine[4] < 0 ? 'north' : 'south',
        edge: 'nodata',
        slopeUnit: 'degrees',
        azimuthDegrees: 315,
        altitudeDegrees: 45,
      },
    )
    const result = (await this.#recordAction(
      currentRun(this.#snapshot),
      operation,
      operation === 'hillshade' ? 'geo.analysis.hillshade' : 'geo.analysis.slope',
      {
        recipe,
        label: operation === 'hillshade' ? 'Terrain hillshade' : 'Terrain slope (degrees)',
      },
      signal,
    )) as { readonly layerId?: string }
    return required(result.layerId, `${operation} output`)
  }

  async #createStack(
    roles: readonly string[],
    byRole: ReadonlyMap<
      string,
      Readonly<{ layerId: string; sourceId: string; candidate: CatalogSourceCandidate }>
    >,
    signal: AbortSignal,
    label: string,
  ): Promise<string> {
    const first = required(byRole.get(roles[0] ?? ''), 'stack input')
    const source = sourceForId(this.#controller, first.sourceId)
    const binding = required(this.#controller.bindingForSource(first.sourceId), 'runtime binding')
    const parameters = currentRun(this.#snapshot).parameters
    const inputs = roles.map((role) => {
      const item = required(byRole.get(role), `${role} input`)
      return recipeInput(role, item.layerId, item.candidate.bands[0], parameters)
    })
    const recipe = baseRecipe(source, binding, inputs, { kind: 'virtual-band-stack', bands: roles })
    const result = (await this.#recordAction(
      currentRun(this.#snapshot),
      'stack',
      'geo.analysis.virtual_band_stack',
      { recipe, label },
      signal,
    )) as { readonly layerId?: string }
    return required(result.layerId, 'stack output')
  }

  async #createNdvi(
    byRole: ReadonlyMap<
      string,
      Readonly<{ layerId: string; sourceId: string; candidate: CatalogSourceCandidate }>
    >,
    signal: AbortSignal,
  ): Promise<string> {
    const nir = required(byRole.get('nir'), 'NIR input')
    const red = required(byRole.get('red'), 'red input')
    const source = sourceForId(this.#controller, nir.sourceId)
    const binding = required(this.#controller.bindingForSource(nir.sourceId), 'runtime binding')
    const parameters = currentRun(this.#snapshot).parameters
    const recipe = baseRecipe(
      source,
      binding,
      [
        recipeInput('nir', nir.layerId, nir.candidate.bands[0], parameters),
        recipeInput('red', red.layerId, red.candidate.bands[0], parameters),
      ],
      { kind: 'normalized-difference', left: 'nir', right: 'red' },
    )
    const result = (await this.#recordAction(
      currentRun(this.#snapshot),
      'ndvi',
      'geo.analysis.normalized_difference',
      { recipe, label: 'Landsat NDVI' },
      signal,
    )) as { readonly layerId?: string }
    return required(result.layerId, 'NDVI output')
  }

  async #recordAction(
    expectedRun: GeoWorkflowRunRecord,
    stepId: string,
    actionId: GeoActionId,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const result = await this.#controller.executeAction(actionId, input, signal)
    signal.throwIfAborted()
    const run = currentRun(this.#snapshot)
    if (run.id !== expectedRun.id) {
      throw new GeoControllerError('ABORTED', 'Workflow action belongs to a superseded run.')
    }
    const record: GeoWorkflowActionRecord = {
      sequence: run.actions.length + 1,
      stepId,
      actionId,
      input: jsonValue(input),
      result,
    }
    this.#publish({
      run: { ...run, currentStepId: stepId, actions: [...run.actions, record] },
      decisionOptions: this.#snapshot.decisionOptions,
    })
    return result
  }

  async #finishFailure(error: unknown): Promise<void> {
    const run = this.#snapshot.run
    if (run === undefined) return
    const cancelled = this.#session?.abort.signal.aborted === true
    this.#publish({
      run: {
        ...run,
        status: cancelled ? 'cancelled' : 'failed',
        availability: cancelled
          ? {
              status: 'available-after-source-selection',
              reason: 'Workflow cancelled and temporary resources removed.',
            }
          : availabilityForError(error),
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown workflow failure.',
      },
      decisionOptions: [],
    })
  }

  #isContextualAction(id: GeoActionId): boolean {
    return (
      id.startsWith('geo.comparison.') ||
      id.startsWith('geo.viewport.') ||
      id.startsWith('geo.analysis.') ||
      id === 'geo.layer.set_style' ||
      id === 'geo.source.open_catalog_asset'
    )
  }

  #requireSession(): WorkflowSession {
    if (this.#session === undefined)
      throw new GeoControllerError('UNAVAILABLE', 'No workflow is active.')
    return this.#session
  }

  #publish(snapshot: GeoWorkflowRunnerSnapshot): void {
    this.#snapshot = snapshot
    for (const listener of this.#listeners) listener(snapshot)
  }
}

function normalizeParameters(
  workflow: GeoWorkflowRecipe,
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | boolean>> {
  const output: Record<string, string | boolean> = {}
  for (const parameter of workflow.inputParameters) {
    const value = input[parameter.id] ?? parameter.default
    if (parameter.type === 'boolean') {
      if (typeof value !== 'boolean')
        throw new GeoControllerError(
          'INVALID_ACTION_INPUT',
          `${parameter.title} must be true or false.`,
        )
      output[parameter.id] = value
    } else {
      if (typeof value !== 'string' || !parameter.options?.some((option) => option.value === value))
        throw new GeoControllerError('INVALID_ACTION_INPUT', `${parameter.title} is invalid.`)
      output[parameter.id] = value
    }
  }
  return output
}

function selectSelector(
  workflow: GeoWorkflowRecipe,
  parameters: Readonly<Record<string, string | boolean>>,
) {
  const selector = workflow.selectors.find((candidate) => {
    const condition = candidate.parameterWhen
    return condition === undefined || parameters[condition.parameterId] === condition.equals
  })
  return required(selector, 'workflow selector')
}

function createRun(
  workflow: GeoWorkflowRecipe,
  parameters: Readonly<Record<string, unknown>>,
  id: string,
): GeoWorkflowRunRecord {
  return {
    schemaVersion: 1,
    id,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    status: 'running',
    currentStepId: 'discover',
    parameters: jsonValue(parameters) as Readonly<Record<string, string | boolean>>,
    decisions: {},
    selectedAssets: [],
    actions: [],
    sourceIds: [],
    outputLayerIds: [],
    completedOutputs: [],
    attribution: [],
    availability: {
      status: 'available-after-source-selection',
      reason: 'Searching configured catalogs.',
    },
    startedAt: new Date().toISOString(),
  }
}

function decisionOptions(workflow: GeoWorkflowRecipe, items: readonly CatalogSearchItem[]) {
  const options: GeoWorkflowDecisionOption[] = []
  const candidatesByOption = new Map<string, readonly CatalogSourceCandidate[]>()
  for (const item of items) {
    const groups =
      workflow.id === 'usgs-landsat-cincinnati'
        ? [item.candidates]
        : item.candidates.map((candidate) => [candidate])
    for (const [index, candidates] of groups.entries()) {
      const first = candidates[0]
      if (first === undefined) continue
      const id = `${item.collectionId}:${item.id}:${workflow.id === 'usgs-landsat-cincinnati' ? 'scene' : first.assetKey}:${index}`
      options.push({
        id,
        label:
          item.datetime === undefined
            ? (item.title ?? item.id)
            : `${item.title ?? item.id} · ${item.datetime.slice(0, 10)}`,
        description: `${item.collectionId} · ${first.provider ?? first.catalogTitle} · ${candidates.length} raster asset${candidates.length === 1 ? '' : 's'}`,
        candidateIdentities: candidates.map(workflowAssetIdentity),
        attribution: attributionFor(candidates),
        ...(workflow.id === 'natural-color-cir'
          ? {
              supportedParameters: {
                displayPreset: displayPresetsForCandidate(first).map(({ id }) =>
                  id === 'color-infrared' ? 'cir' : id,
                ),
              },
            }
          : {}),
      })
      candidatesByOption.set(id, candidates)
    }
  }
  return { options, candidatesByOption }
}

function candidatesToOpen(
  workflow: GeoWorkflowRecipe,
  selected: readonly CatalogSourceCandidate[],
) {
  if (workflow.id !== 'usgs-landsat-cincinnati') return selected
  const used = new Set<string>()
  return workflow.requiredAssets
    .filter(({ required: isRequired }) => isRequired)
    .map((requirement) => {
      const keys = requirement.assetKeys ?? []
      const candidate =
        selected.find(({ assetKey }) => keys.includes(assetKey)) ??
        selected.find((value) => matchesRequirement(value, requirement.commonNames, keys))
      const resolved = required(candidate, `${requirement.role} asset`)
      const identity = `${resolved.catalogId}/${resolved.collectionId}/${resolved.itemId}/${resolved.assetKey}`
      if (used.has(identity)) {
        throw new GeoControllerError(
          'UNAVAILABLE',
          `Required Landsat role ${requirement.role} does not resolve to a separate asset.`,
        )
      }
      used.add(identity)
      return resolved
    })
}

function matchesRequirement(
  candidate: CatalogSourceCandidate,
  names: readonly string[],
  keys: readonly string[],
): boolean {
  const accepted = new Set(names.map((name) => name.toLowerCase()))
  return (
    keys.includes(candidate.assetKey) ||
    candidate.bands.some((band) =>
      [band.commonName, band.name, band.description].some(
        (value) => value !== undefined && accepted.has(value.toLowerCase()),
      ),
    )
  )
}

function validateSelection(
  workflow: GeoWorkflowRecipe,
  selected: readonly CatalogSourceCandidate[],
  parameters: Readonly<Record<string, unknown>>,
): void {
  if (workflow.id === 'kentucky-through-time') {
    if (selected.length !== 2 || selected[0]?.datetime === selected[1]?.datetime)
      throw new GeoControllerError(
        'INVALID_ACTION_INPUT',
        'Through Time requires two distinct acquisition dates.',
      )
    if (!meaningfulOverlap(selected[0]?.bbox, selected[1]?.bbox))
      throw new GeoControllerError(
        'CRS_INCOMPATIBLE',
        'The selected acquisitions do not meaningfully overlap.',
      )
  }
  if (
    workflow.id === 'natural-color-cir' &&
    parameters['displayPreset'] === 'cir' &&
    !selected.some((candidate) =>
      displayPresetsForCandidate(candidate).some(({ id }) => id === 'color-infrared'),
    )
  ) {
    throw new GeoControllerError(
      'UNAVAILABLE',
      'CIR requires explicitly identified NIR, red, and green bands.',
    )
  }
  for (const requirement of workflow.requiredAssets.filter(
    ({ required: isRequired }) => isRequired,
  )) {
    if (requirement.commonNames.length === 0) continue
    const found = selected.some((candidate) =>
      matchesRequirement(candidate, requirement.commonNames, requirement.assetKeys ?? []),
    )
    if (!found)
      throw new GeoControllerError(
        'UNAVAILABLE',
        `Required ${requirement.role} metadata is missing.`,
      )
  }
}

function meaningfulOverlap(
  left: readonly number[] | undefined,
  right: readonly number[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return false
  const width = Math.max(
    0,
    Math.min(left[2] ?? 0, right[2] ?? 0) - Math.max(left[0] ?? 0, right[0] ?? 0),
  )
  const height = Math.max(
    0,
    Math.min(left[3] ?? 0, right[3] ?? 0) - Math.max(left[1] ?? 0, right[1] ?? 0),
  )
  return width * height > 0
}

function validateOpenedCompatibility(
  workflow: GeoWorkflowRecipe,
  selected: readonly CatalogSourceCandidate[],
  controller: GeoWorkbenchController,
  sourceIds: readonly string[],
): void {
  if (workflow.alignment.kind !== 'same-crs-overlap') return
  const sources = sourceIds.map((id) => sourceForId(controller, id))
  if (
    sources.length !== 2 ||
    crsKey(sources[0]?.spatialReference.crs ?? { kind: 'unknown' }) !==
      crsKey(sources[1]?.spatialReference.crs ?? { kind: 'unknown' })
  )
    throw new GeoControllerError(
      'CRS_INCOMPATIBLE',
      'The selected sources do not share the same identified CRS.',
    )
  if (!meaningfulOverlap(selected[0]?.bbox, selected[1]?.bbox))
    throw new GeoControllerError(
      'CRS_INCOMPATIBLE',
      'The selected sources do not meaningfully overlap.',
    )
}

function roleLayers(
  workflow: GeoWorkflowRecipe,
  candidates: readonly CatalogSourceCandidate[],
  sourceIds: readonly string[],
  layers: readonly string[],
) {
  const result = new Map<
    string,
    Readonly<{ layerId: string; sourceId: string; candidate: CatalogSourceCandidate }>
  >()
  const opened = candidatesToOpen(workflow, candidates)
  for (const requirement of workflow.requiredAssets) {
    const index = opened.findIndex((candidate) =>
      matchesRequirement(candidate, requirement.commonNames, requirement.assetKeys ?? []),
    )
    if (index >= 0)
      result.set(requirement.role, {
        layerId: required(layers[index], 'role layer'),
        sourceId: required(sourceIds[index], 'role source'),
        candidate: required(opened[index], 'role candidate'),
      })
  }
  return result
}

function layerForSource(controller: GeoWorkbenchController, sourceId: string): string {
  return required(
    controller
      .getSnapshot()
      .project.layers.find((layer) => layer.kind === 'raster' && layer.sourceId === sourceId)?.id,
    'source layer',
  )
}

function sourceForId(controller: GeoWorkbenchController, sourceId: string): GeoRasterSource {
  return required(
    controller.getSnapshot().project.sources.find(({ id }) => id === sourceId),
    'source',
  )
}

function recipeInput(
  name: string,
  layerId: string,
  band: CatalogSourceCandidate['bands'][number] | undefined,
  parameters: Readonly<Record<string, unknown>>,
): DerivedRasterRecipeV1['inputs'][number] {
  const scaled = parameters['valueMode'] !== 'raw'
  return {
    name,
    layerId,
    component: band?.index ?? 0,
    valueMode: scaled ? 'scaled' : 'raw',
    scale: scaled ? (band?.scale ?? 1) : 1,
    offset: scaled ? (band?.offset ?? 0) : 0,
    noData: band?.nodata === undefined ? { kind: 'none' } : { kind: 'value', value: band.nodata },
  }
}

function baseRecipe(
  source: GeoRasterSource,
  binding: GeoRuntimeBinding,
  inputs: DerivedRasterRecipeV1['inputs'],
  operation: DerivedRasterRecipeV1['operation'],
): DerivedRasterRecipeV1 {
  const affine = required(source.spatialReference.pixelToModel, 'pixel grid')
  const crs = required(crsKey(source.spatialReference.crs), 'identified CRS')
  const corners = [
    [0, 0],
    [source.width, 0],
    [source.width, source.height],
    [0, source.height],
  ].map(([x = 0, y = 0]) => ({
    x: affine[0] * x + affine[1] * y + affine[2],
    y: affine[3] * x + affine[4] * y + affine[5],
  }))
  const nodata = scalarNodata(source.spatialReference)
  return {
    schemaVersion: 1,
    operationVersion: 1,
    operation,
    inputs,
    targetGrid: {
      schemaVersion: 1,
      crs,
      width: source.width,
      height: source.height,
      affine,
      pixelInterpretation:
        source.spatialReference.pixelInterpretation === 'pixel-is-point' ? 'point' : 'area',
      extent: [
        Math.min(...corners.map(({ x }) => x)),
        Math.min(...corners.map(({ y }) => y)),
        Math.max(...corners.map(({ x }) => x)),
        Math.max(...corners.map(({ y }) => y)),
      ],
      sampleType: rasterSampleType(binding.dataset.dataset.sampleType),
      noData: nodata === undefined ? { kind: 'none' } : { kind: 'value', value: nodata },
      resampling: 'nearest',
    },
    alignment: 'exact',
    outputNoData: { kind: 'nan' },
    minimumValidWeight: 0.5,
    limits: {
      maxTilePixels: 65_536,
      maxOutputBytes: 256 * 1024 * 1024,
      maxWorkingBytes: 512 * 1024 * 1024,
    },
  }
}

function rasterSampleType(value: string): RasterSampleType {
  const values: readonly RasterSampleType[] = [
    'uint8',
    'uint16',
    'uint32',
    'uint64',
    'int8',
    'int16',
    'int32',
    'float32',
    'float64',
  ]
  if (!values.includes(value as RasterSampleType))
    throw new GeoControllerError('INVALID_ACTION_INPUT', `Unsupported sample type ${value}.`)
  return value as RasterSampleType
}

function lengthUnit(unit: string | undefined): RasterLengthUnitV1 {
  const normalized = unit?.trim().toLowerCase()
  if (normalized === 'ft' || normalized === 'foot' || normalized === 'feet')
    return { kind: 'international-foot' }
  if (normalized === 'us survey foot' || normalized === 'us-ft') return { kind: 'us-survey-foot' }
  return { kind: 'metre' }
}

function attributionFor(candidates: readonly CatalogSourceCandidate[]): readonly string[] {
  return [
    ...new Set(
      candidates.flatMap((candidate) =>
        [candidate.attribution, candidate.provider, candidate.license].filter(
          (value): value is string => value !== undefined && value.length > 0,
        ),
      ),
    ),
  ]
}

function completedOutputs(
  workflow: GeoWorkflowRecipe,
  layerIds: readonly string[],
): GeoWorkflowRunRecord['completedOutputs'] {
  let index = 0
  const completed: Array<GeoWorkflowRunRecord['completedOutputs'][number]> = []
  for (const output of workflow.outputs) {
    if (output.kind !== 'layer') {
      completed.push({ id: output.id, title: output.title, kind: output.kind })
      continue
    }
    const reference = layerIds[index++]
    if (reference === undefined) {
      if (output.optional === true) continue
      throw new GeoControllerError(
        'PROJECT_INVALID',
        `Required workflow output ${output.id} was not produced.`,
      )
    }
    completed.push({ id: output.id, title: output.title, kind: output.kind, reference })
  }
  return completed
}

async function rollback(
  controller: GeoWorkbenchController,
  sourceIds: readonly string[],
  layerIds: readonly string[],
): Promise<void> {
  const oldSources = new Set(sourceIds)
  const oldLayers = new Set(layerIds)
  for (const layer of [...controller.getSnapshot().project.layers].reverse()) {
    if (!oldLayers.has(layer.id) && layer.kind === 'derived')
      await controller
        .executeAction('geo.derived_layer.remove', { layerId: layer.id })
        .catch(() => undefined)
  }
  for (const source of [...controller.getSnapshot().project.sources].reverse()) {
    if (!oldSources.has(source.id))
      await controller
        .executeAction('geo.source.close', { sourceId: source.id, dependentLayers: 'remove' })
        .catch(() => undefined)
  }
}

function availabilityForError(error: unknown): GeoWorkflowAvailability {
  const message = error instanceof Error ? error.message : 'Unknown workflow failure.'
  const lower = message.toLowerCase()
  if (lower.includes('cors')) return { status: 'blocked-browser-cors', reason: message }
  if (lower.includes('range')) return { status: 'blocked-missing-range', reason: message }
  if (lower.includes('decoder') || lower.includes('tiff'))
    return { status: 'blocked-unsupported-decoder', reason: message }
  if (lower.includes('band') || lower.includes('nir'))
    return { status: 'blocked-missing-bands', reason: message }
  if (lower.includes('crs') || lower.includes('overlap'))
    return { status: 'blocked-incompatible-crs', reason: message }
  if (lower.includes('relay')) return { status: 'blocked-unavailable-relay', reason: message }
  return { status: 'blocked-missing-operation', reason: message }
}

function currentRun(snapshot: GeoWorkflowRunnerSnapshot): GeoWorkflowRunRecord {
  return required(snapshot.run, 'workflow run')
}

function jsonValue(value: unknown): import('@pji-workbench/actions').JsonValue {
  return JSON.parse(JSON.stringify(value)) as import('@pji-workbench/actions').JsonValue
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new GeoControllerError('PROJECT_INVALID', `Missing ${label}.`)
  return value
}
