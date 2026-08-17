import type { AnalysisDryRunResponse } from '@pji-workbench/contracts'
import { Button } from '@pji-workbench/ui'

import type { ParticleAnalysisGraphOptions } from './analysis-workflows.js'
import type { ViewportRoi } from './ScientificViewport.js'

export type ParticleOverlayView =
  | 'labels'
  | 'mask'
  | 'outline'
  | 'numbered'
  | 'centroids'
  | 'ellipses'

export interface ParticleWorkflowSettings
  extends Omit<ParticleAnalysisGraphOptions, 'selection' | 'component'> {
  readonly roiId?: string
  readonly component: number
  readonly overlayView: ParticleOverlayView
}

export const DEFAULT_PARTICLE_WORKFLOW: ParticleWorkflowSettings = Object.freeze({
  component: 0,
  thresholdMethod: 'otsu',
  polarity: 'light',
  lower: 128,
  upper: 255,
  histogramBins: 256,
  windowRadius: 15,
  sauvolaK: 0.2,
  dynamicRange: 128,
  noDataPolicy: 'background',
  backgroundRadius: 0,
  openRadius: 1,
  closeRadius: 0,
  fillHoles: true,
  clearBorder: false,
  minimumObjectPixels: 64,
  watershed: false,
  minimumPeakDistance: 3,
  connectivity: 8,
  edgePolicy: 'exclude',
  minimumArea: 0,
  maximumArea: 1_000_000_000,
  minimumCircularity: 0,
  maximumCircularity: 1,
  minimumAspectRatio: 1,
  maximumAspectRatio: 1_000_000,
  minimumSolidity: 0,
  maximumSolidity: 1,
  overlayView: 'labels',
})

function formatEstimate(value: unknown, kind: 'bytes' | 'ms'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unresolved'
  if (kind === 'bytes') {
    if (value >= 1_048_576) return `${(value / 1_048_576).toFixed(1)} MiB`
    if (value >= 1_024) return `${Math.round(value / 1_024)} KiB`
    return `${Math.round(value)} B`
  }
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} s`
  return `${Math.round(value)} ms`
}

function estimateValue(
  dryRun: AnalysisDryRunResponse | undefined,
  key: string,
  kind: 'bytes' | 'ms',
): string {
  const estimate = dryRun?.plan?.['totalEstimate']
  if (typeof estimate !== 'object' || estimate === null || Array.isArray(estimate)) {
    return 'plan required'
  }
  return formatEstimate((estimate as Readonly<Record<string, unknown>>)[key], kind)
}

function numeric(
  label: string,
  value: number,
  onChange: (value: number) => void,
  options: Readonly<{ min?: number; max?: number; step?: number }> = {},
) {
  return (
    <label>
      {label}
      <input
        {...options}
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        value={value}
      />
    </label>
  )
}

export function ParticleAnalysisWorkflow({
  settings,
  rois,
  componentCount,
  graphSteps,
  busy,
  dryRun,
  message,
  onChange,
  onPreview,
  onPlan,
  onRun,
  onCancel,
  onSaveRecipe,
  onOpenScripts,
}: {
  readonly settings: ParticleWorkflowSettings
  readonly rois: readonly ViewportRoi[]
  readonly componentCount: number
  readonly graphSteps: readonly string[]
  readonly busy: boolean
  readonly dryRun?: AnalysisDryRunResponse
  readonly message?: string
  readonly onChange: (settings: ParticleWorkflowSettings) => void
  readonly onPreview: () => void
  readonly onPlan: () => void
  readonly onRun: () => void
  readonly onCancel: () => void
  readonly onSaveRecipe: () => void
  readonly onOpenScripts: () => void
}) {
  const patch = <Key extends keyof ParticleWorkflowSettings>(
    key: Key,
    value: ParticleWorkflowSettings[Key],
  ): void => onChange({ ...settings, [key]: value })
  const areaRois = rois.filter(
    ({ geometry }) =>
      geometry.kind === 'rectangle' || geometry.kind === 'ellipse' || geometry.kind === 'polygon',
  )
  const components = Array.from({ length: componentCount }, (_value, component) => ({
    id: `component-${component}`,
    value: component,
  }))
  const stepCounts = new Map<string, number>()
  const keyedSteps = graphSteps.map((step) => {
    const ordinal = stepCounts.get(step) ?? 0
    stepCounts.set(step, ordinal + 1)
    return { id: `${step}:${ordinal}`, label: step }
  })
  return (
    <section className="particle-workflow" aria-labelledby="particle-workflow-title">
      <div className="particle-workflow__heading">
        <div>
          <p className="panel-kicker">Guided, inspectable recipe</p>
          <h3 id="particle-workflow-title">Particle analysis</h3>
        </div>
        <span>{graphSteps.length} steps</span>
      </div>

      <fieldset>
        <legend>1. Selection and foreground</legend>
        <label>
          Region
          <select
            onChange={(event) =>
              patch('roiId', event.target.value === '' ? undefined : event.target.value)
            }
            value={settings.roiId ?? ''}
          >
            <option value="">Whole active plane</option>
            {areaRois.map((roi) => (
              <option key={roi.id} value={roi.id}>
                {roi.name ?? roi.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Intensity component
          <select
            onChange={(event) => patch('component', Number(event.target.value))}
            value={settings.component}
          >
            {components.map(({ id, value }) => (
              <option key={id} value={value}>
                Component {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Foreground polarity
          <select
            onChange={(event) => patch('polarity', event.target.value as 'light' | 'dark')}
            value={settings.polarity}
          >
            <option value="light">Light objects</option>
            <option value="dark">Dark objects</option>
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>2. Correct and threshold</legend>
        {numeric(
          'Background radius (0 disables)',
          settings.backgroundRadius,
          (value) => patch('backgroundRadius', value),
          { min: 0, max: 64, step: 1 },
        )}
        <label>
          Threshold method
          <select
            onChange={(event) =>
              patch(
                'thresholdMethod',
                event.target.value as ParticleWorkflowSettings['thresholdMethod'],
              )
            }
            value={settings.thresholdMethod}
          >
            <option value="manual">Manual lower / upper</option>
            <option value="otsu">Otsu</option>
            <option value="triangle">Triangle</option>
            <option value="yen">Yen</option>
            <option value="li">Li</option>
            <option value="mean">Mean</option>
            <option value="sauvola">Adaptive Sauvola</option>
          </select>
        </label>
        {settings.thresholdMethod === 'manual' ? (
          <div className="two-column-fields">
            {numeric('Lower', settings.lower, (value) => patch('lower', value), { step: 0.1 })}
            {numeric('Upper', settings.upper, (value) => patch('upper', value), { step: 0.1 })}
          </div>
        ) : null}
        {settings.thresholdMethod === 'sauvola' ? (
          <div className="two-column-fields">
            {numeric(
              'Window radius',
              settings.windowRadius,
              (value) => patch('windowRadius', value),
              { min: 1, max: 128, step: 1 },
            )}
            {numeric('Sauvola k', settings.sauvolaK, (value) => patch('sauvolaK', value), {
              min: -1,
              max: 1,
              step: 0.01,
            })}
            {numeric(
              'Dynamic range',
              settings.dynamicRange,
              (value) => patch('dynamicRange', value),
              { min: 0.000001, step: 0.1 },
            )}
          </div>
        ) : null}
        <label>
          No-data samples
          <select
            onChange={(event) =>
              patch('noDataPolicy', event.target.value as ParticleWorkflowSettings['noDataPolicy'])
            }
            value={settings.noDataPolicy}
          >
            <option value="background">Treat as background</option>
            <option value="foreground">Treat as foreground</option>
            <option value="propagate">Propagate as NaN</option>
          </select>
        </label>
        <div className="button-row">
          <Button disabled={busy} onClick={onPreview}>
            Preview histogram and mask
          </Button>
          <Button onClick={onCancel}>Cancel preview</Button>
        </div>
      </fieldset>

      <fieldset>
        <legend>3. Binary cleanup and watershed</legend>
        <div className="two-column-fields">
          {numeric(
            'Open radius (0 disables)',
            settings.openRadius,
            (value) => patch('openRadius', value),
            { min: 0, max: 64, step: 1 },
          )}
          {numeric(
            'Close radius (0 disables)',
            settings.closeRadius,
            (value) => patch('closeRadius', value),
            { min: 0, max: 64, step: 1 },
          )}
          {numeric(
            'Remove below pixels',
            settings.minimumObjectPixels,
            (value) => patch('minimumObjectPixels', value),
            { min: 0, step: 1 },
          )}
          {numeric(
            'Watershed peak distance',
            settings.minimumPeakDistance,
            (value) => patch('minimumPeakDistance', value),
            { min: 1, step: 1 },
          )}
        </div>
        <div className="inline-check-grid">
          <label className="inline-check">
            <input
              checked={settings.fillHoles}
              onChange={(event) => patch('fillHoles', event.target.checked)}
              type="checkbox"
            />
            Fill holes
          </label>
          <label className="inline-check">
            <input
              checked={settings.clearBorder}
              onChange={(event) => patch('clearBorder', event.target.checked)}
              type="checkbox"
            />
            Clear border objects
          </label>
          <label className="inline-check">
            <input
              checked={settings.watershed}
              onChange={(event) => patch('watershed', event.target.checked)}
              type="checkbox"
            />
            Separate touching particles
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>4. Connected components and filters</legend>
        <label>
          Connectivity
          <select
            onChange={(event) => patch('connectivity', Number(event.target.value) as 4 | 8)}
            value={settings.connectivity}
          >
            <option value={4}>4-connected</option>
            <option value={8}>8-connected</option>
          </select>
        </label>
        <label>
          Edge objects
          <select
            onChange={(event) =>
              patch('edgePolicy', event.target.value as ParticleWorkflowSettings['edgePolicy'])
            }
            value={settings.edgePolicy}
          >
            <option value="exclude">Exclude</option>
            <option value="include">Include</option>
          </select>
        </label>
        <div className="two-column-fields">
          {numeric(
            'Minimum area (px²)',
            settings.minimumArea,
            (value) => patch('minimumArea', value),
            { min: 0 },
          )}
          {numeric(
            'Maximum area (px²)',
            settings.maximumArea,
            (value) => patch('maximumArea', value),
            { min: 0 },
          )}
          {numeric(
            'Minimum circularity',
            settings.minimumCircularity,
            (value) => patch('minimumCircularity', value),
            { min: 0, max: 1, step: 0.01 },
          )}
          {numeric(
            'Maximum circularity',
            settings.maximumCircularity,
            (value) => patch('maximumCircularity', value),
            { min: 0, max: 1, step: 0.01 },
          )}
          {numeric(
            'Minimum aspect ratio',
            settings.minimumAspectRatio,
            (value) => patch('minimumAspectRatio', value),
            { min: 1, step: 0.1 },
          )}
          {numeric(
            'Maximum aspect ratio',
            settings.maximumAspectRatio,
            (value) => patch('maximumAspectRatio', value),
            { min: 1, step: 0.1 },
          )}
          {numeric(
            'Minimum solidity',
            settings.minimumSolidity,
            (value) => patch('minimumSolidity', value),
            { min: 0, max: 1, step: 0.01 },
          )}
          {numeric(
            'Maximum solidity',
            settings.maximumSolidity,
            (value) => patch('maximumSolidity', value),
            { min: 0, max: 1, step: 0.01 },
          )}
        </div>
        <section className="estimate-grid" aria-label="Particle analysis resource estimate">
          <div>
            <span>Peak memory</span>
            <strong>{estimateValue(dryRun, 'peakWorkingBytes', 'bytes')}</strong>
          </div>
          <div>
            <span>Compute</span>
            <strong>{estimateValue(dryRun, 'computeMilliseconds', 'ms')}</strong>
          </div>
        </section>
        <div className="button-row">
          <Button disabled={busy} onClick={onPlan}>
            Dry-run full workflow
          </Button>
          <Button
            disabled={busy || dryRun?.valid !== true}
            onClick={onRun}
            title={
              dryRun?.valid === true
                ? 'Execute the planned particle workflow'
                : 'Plan the workflow first so memory and time are estimated'
            }
            variant="primary"
          >
            Run particle analysis
          </Button>
        </div>
        {dryRun?.valid === true ? null : (
          <p className="panel-note">
            Plan the workflow before running. This estimates memory and keeps accidental full-plane
            work visible.
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>5. Linked views and reusable method</legend>
        <label>
          Overlay view
          <select
            onChange={(event) => patch('overlayView', event.target.value as ParticleOverlayView)}
            value={settings.overlayView}
          >
            <option value="labels">Colored labels</option>
            <option value="mask">Binary mask</option>
            <option value="outline">Outlines</option>
            <option value="numbered">Numbered labels</option>
            <option value="centroids">Centroids</option>
            <option value="ellipses">Fitted ellipses</option>
          </select>
        </label>
        <ol className="particle-workflow__graph" aria-label="Visible particle operation graph">
          {keyedSteps.map(({ id, label }) => (
            <li key={id}>{label}</li>
          ))}
        </ol>
        <div className="button-row">
          <Button onClick={onSaveRecipe}>Save recipe JSON</Button>
          <Button onClick={onOpenScripts}>Open recipe in Scripts</Button>
        </div>
      </fieldset>
      {message === undefined ? null : (
        <p aria-live="polite" className="analysis-message">
          {message}
        </p>
      )}
    </section>
  )
}
