import type {
  AnalysisDryRunResponse,
  AxisDescriptor,
  PlaneSelection,
} from '@pji-workbench/contracts'
import type { BatchRecipeRow } from '@pji-workbench/materials-analysis'
import { Button } from '@pji-workbench/ui'
import type { WorkspaceSnapshot } from '@pji-workbench/workspace'
import { useMemo, useRef, useState } from 'react'

export interface FftWorkspaceSettings {
  readonly roiId: string
  readonly spectrumDisplay: 'raw' | 'log1p'
  readonly radialBins: number
  readonly azimuthalBins: number
  readonly peakThreshold: number
  readonly minimumPeakDistance: number
  readonly maximumPeaks: number
  readonly maskKind: 'none' | 'bandpass' | 'notch'
  readonly minimumRadius: number
  readonly maximumRadius: number
  readonly notchX: number
  readonly notchY: number
  readonly notchRadius: number
}

export interface StackWorkspaceSettings {
  readonly stackAxis: string
  readonly startIndex: number
  readonly endIndex: number
  readonly mode: 'min' | 'max' | 'mean' | 'sum' | 'montage' | 'statistics' | 'align'
  readonly columns: number
  readonly referenceIndex: number
  readonly maximumShift: number
  readonly minimumPeakRatio: number
  readonly edgePolicy: 'pad' | 'crop-overlap'
  readonly fillValue: number
}

export interface SurfaceWorkspaceSettings {
  readonly roiId: string
  readonly correction: 'none' | 'subtract-mean' | 'first-order-plane' | 'row-median' | 'polynomial'
  readonly polynomialDegree: 0 | 1 | 2
  readonly histogramBins: number
  readonly profileX0: number
  readonly profileY0: number
  readonly profileX1: number
  readonly profileY1: number
  readonly profileSamples: number
  readonly grainMethod: 'manual' | 'otsu' | 'triangle' | 'yen' | 'li' | 'mean'
  readonly grainPolarity: 'light' | 'dark'
  readonly grainLower: number
  readonly grainUpper: number
}

export interface AdvancedPlanState {
  readonly kind: 'fft' | 'stack' | 'surface'
  readonly identity: string
  readonly dryRun: AnalysisDryRunResponse
}

type Roi = WorkspaceSnapshot['analysis']['roiSet']['rois'][number]

export const DEFAULT_FFT_WORKSPACE: FftWorkspaceSettings = {
  roiId: 'whole-plane',
  spectrumDisplay: 'log1p',
  radialBins: 128,
  azimuthalBins: 180,
  peakThreshold: 0,
  minimumPeakDistance: 4,
  maximumPeaks: 32,
  maskKind: 'none',
  minimumRadius: 0,
  maximumRadius: 0.5,
  notchX: 0.1,
  notchY: 0,
  notchRadius: 0.02,
}

export const DEFAULT_SURFACE_WORKSPACE: SurfaceWorkspaceSettings = {
  roiId: 'whole-plane',
  correction: 'first-order-plane',
  polynomialDegree: 1,
  histogramBins: 128,
  profileX0: 0,
  profileY0: 0,
  profileX1: 255,
  profileY1: 255,
  profileSamples: 256,
  grainMethod: 'otsu',
  grainPolarity: 'light',
  grainLower: 0,
  grainUpper: 1,
}

function defaultStack(axis: AxisDescriptor | undefined): StackWorkspaceSettings {
  return {
    stackAxis: axis?.id ?? '',
    startIndex: 0,
    endIndex: Math.max(0, (axis?.length ?? 1) - 1),
    mode: 'mean',
    columns: 4,
    referenceIndex: 0,
    maximumShift: 16,
    minimumPeakRatio: 1.2,
    edgePolicy: 'crop-overlap',
    fillValue: 0,
  }
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
        {...(options.min === undefined ? {} : { min: options.min })}
        {...(options.max === undefined ? {} : { max: options.max })}
        onChange={(event) => onChange(Number(event.target.value))}
        step={options.step ?? 'any'}
        type="number"
        value={value}
      />
    </label>
  )
}

function PlanSummary({ plan }: { readonly plan: AdvancedPlanState | undefined }) {
  if (plan === undefined) return <p>No reviewed plan yet.</p>
  const estimate = plan.dryRun.plan
  return (
    <div className="advanced-plan" role="status">
      <strong>{plan.dryRun.valid ? 'Plan admitted' : 'Plan refused'}</strong>
      <span>
        {plan.dryRun.warnings.length} warnings · identity {plan.identity.slice(0, 16)}
      </span>
      <code>{estimate === null ? 'No executable plan' : JSON.stringify(estimate)}</code>
    </div>
  )
}

export function AdvancedMaterialsWorkflows({
  axes,
  batchRows,
  busy,
  contextIdentity,
  message,
  onBatchFiles,
  onCancelBatchItem,
  onCancel,
  onPlanFft,
  onPlanStack,
  onPlanSurface,
  onRunFft,
  onRunStack,
  onRunSurface,
  plan,
  rois,
  selection,
}: Readonly<{
  axes: readonly AxisDescriptor[]
  batchRows: readonly BatchRecipeRow<unknown>[]
  busy: boolean
  contextIdentity: string
  message?: string
  onBatchFiles(files: readonly File[], concurrency: number): void
  onCancelBatchItem(itemId: string): void
  onCancel(): void
  onPlanFft(settings: FftWorkspaceSettings): void
  onPlanStack(settings: StackWorkspaceSettings): void
  onPlanSurface(settings: SurfaceWorkspaceSettings): void
  onRunFft(settings: FftWorkspaceSettings): void
  onRunStack(settings: StackWorkspaceSettings): void
  onRunSurface(settings: SurfaceWorkspaceSettings): void
  plan?: AdvancedPlanState
  rois: readonly Roi[]
  selection: PlaneSelection
}>) {
  const stackAxes = useMemo(
    () => axes.filter(({ id, length }) => !selection.displayAxes.includes(id) && length > 1),
    [axes, selection.displayAxes],
  )
  const [fft, setFft] = useState(DEFAULT_FFT_WORKSPACE)
  const [surface, setSurface] = useState(DEFAULT_SURFACE_WORKSPACE)
  const [stack, setStack] = useState(() => defaultStack(stackAxes[0]))
  const [batchConcurrency, setBatchConcurrency] = useState(2)
  const batchInput = useRef<HTMLInputElement>(null)
  const patchFft = <Key extends keyof FftWorkspaceSettings>(
    key: Key,
    value: FftWorkspaceSettings[Key],
  ): void => setFft((current) => ({ ...current, [key]: value }))
  const patchSurface = <Key extends keyof SurfaceWorkspaceSettings>(
    key: Key,
    value: SurfaceWorkspaceSettings[Key],
  ): void => setSurface((current) => ({ ...current, [key]: value }))
  const patchStack = <Key extends keyof StackWorkspaceSettings>(
    key: Key,
    value: StackWorkspaceSettings[Key],
  ): void => setStack((current) => ({ ...current, [key]: value }))
  const runnable = (kind: AdvancedPlanState['kind'], settings: unknown): boolean =>
    plan?.kind === kind &&
    plan.dryRun.valid &&
    plan.identity === JSON.stringify({ context: contextIdentity, settings })

  return (
    <section
      aria-label="Advanced materials workspaces"
      className="advanced-materials"
      data-testid="advanced-materials"
    >
      <div className="guided-workflow__heading">
        <div>
          <p className="eyebrow">Materials extension bundle</p>
          <h3>Frequency · stack · AFM · batch</h3>
        </div>
        <span className="analysis-cost-badge">Global · approval plan</span>
      </div>
      <p>
        Quantitative transforms stay in the imaging Worker. Raw/log spectrum display is
        presentation; source pixels, surface heights, and stack frames remain unchanged.
      </p>

      <details>
        <summary>FFT and diffraction workspace</summary>
        <div className="form-stack advanced-materials__body">
          <label>
            Source ROI
            <select onChange={(event) => patchFft('roiId', event.target.value)} value={fft.roiId}>
              <option value="whole-plane">Whole active plane</option>
              {rois.flatMap((roi) =>
                roi.geometry.kind === 'rectangle'
                  ? [
                      <option key={roi.id} value={roi.id}>
                        {roi.name ?? roi.id}
                      </option>,
                    ]
                  : [],
              )}
            </select>
          </label>
          <div className="two-column-fields">
            <label>
              Spectrum presentation
              <select
                onChange={(event) =>
                  patchFft('spectrumDisplay', event.target.value as 'raw' | 'log1p')
                }
                value={fft.spectrumDisplay}
              >
                <option value="raw">Raw magnitude</option>
                <option value="log1p">Log1p magnitude</option>
              </select>
            </label>
            {numeric('Radial bins', fft.radialBins, (value) => patchFft('radialBins', value), {
              min: 2,
              max: 4096,
              step: 1,
            })}
            {numeric(
              'Azimuthal bins',
              fft.azimuthalBins,
              (value) => patchFft('azimuthalBins', value),
              { min: 8, max: 1440, step: 1 },
            )}
            {numeric(
              'Peak threshold (0 auto)',
              fft.peakThreshold,
              (value) => patchFft('peakThreshold', value),
              { min: 0 },
            )}
            {numeric(
              'Peak separation',
              fft.minimumPeakDistance,
              (value) => patchFft('minimumPeakDistance', value),
              { min: 1 },
            )}
            {numeric(
              'Maximum peaks',
              fft.maximumPeaks,
              (value) => patchFft('maximumPeaks', value),
              { min: 1, max: 2048, step: 1 },
            )}
          </div>
          <fieldset>
            <legend>Frequency mask</legend>
            <label>
              Mask kind
              <select
                onChange={(event) =>
                  patchFft('maskKind', event.target.value as FftWorkspaceSettings['maskKind'])
                }
                value={fft.maskKind}
              >
                <option value="none">None</option>
                <option value="bandpass">Bandpass</option>
                <option value="notch">Symmetric notch</option>
              </select>
            </label>
            <div className="two-column-fields">
              {numeric(
                'Minimum radius',
                fft.minimumRadius,
                (value) => patchFft('minimumRadius', value),
                { min: 0, max: 1 },
              )}
              {numeric(
                'Maximum radius',
                fft.maximumRadius,
                (value) => patchFft('maximumRadius', value),
                { min: 0, max: 1 },
              )}
              {numeric('Notch X', fft.notchX, (value) => patchFft('notchX', value), {
                min: -0.5,
                max: 0.5,
              })}
              {numeric('Notch Y', fft.notchY, (value) => patchFft('notchY', value), {
                min: -0.5,
                max: 0.5,
              })}
              {numeric('Notch radius', fft.notchRadius, (value) => patchFft('notchRadius', value), {
                min: 0,
                max: 0.5,
              })}
            </div>
          </fieldset>
          <p className="advanced-materials__truth">
            Beam center is the centered DC sample. Local maxima use the visible absolute threshold.
            No crystallographic indexing or phase identification is claimed. Inverse FFT is not
            exposed because PureJsImage 0.10.0 has no public complex-dataset value contract.
          </p>
          <div className="button-row">
            <Button disabled={busy} onClick={() => onPlanFft(fft)}>
              Plan FFT workspace
            </Button>
            <Button
              disabled={busy || !runnable('fft', fft)}
              onClick={() => onRunFft(fft)}
              variant="primary"
            >
              Run FFT workspace
            </Button>
            <Button disabled={!busy} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </details>

      <details>
        <summary>Stack, volume, projection, and registration</summary>
        <div className="form-stack advanced-materials__body">
          {stackAxes.length === 0 ? (
            <p>This dataset has no non-display axis with multiple planes.</p>
          ) : (
            <>
              <label>
                Stack axis
                <select
                  onChange={(event) => {
                    const axis = stackAxes.find(({ id }) => id === event.target.value)
                    setStack(defaultStack(axis))
                  }}
                  value={stack.stackAxis || stackAxes[0]?.id}
                >
                  {stackAxes.map((axis) => (
                    <option key={axis.id} value={axis.id}>
                      {axis.name ?? axis.id} · {axis.length} planes
                    </option>
                  ))}
                </select>
              </label>
              <div className="two-column-fields">
                {numeric(
                  'First plane',
                  stack.startIndex,
                  (value) => patchStack('startIndex', value),
                  { min: 0, step: 1 },
                )}
                {numeric('Last plane', stack.endIndex, (value) => patchStack('endIndex', value), {
                  min: 0,
                  step: 1,
                })}
                <label>
                  Operation
                  <select
                    onChange={(event) =>
                      patchStack('mode', event.target.value as StackWorkspaceSettings['mode'])
                    }
                    value={stack.mode}
                  >
                    <option value="min">Minimum projection</option>
                    <option value="max">Maximum projection</option>
                    <option value="mean">Mean projection</option>
                    <option value="sum">Sum projection</option>
                    <option value="montage">Montage/contact sheet</option>
                    <option value="statistics">Stack statistics</option>
                    <option value="align">Phase-correlation alignment</option>
                  </select>
                </label>
                {numeric(
                  'Montage columns',
                  stack.columns,
                  (value) => patchStack('columns', value),
                  { min: 1, step: 1 },
                )}
                {numeric(
                  'Reference plane',
                  stack.referenceIndex,
                  (value) => patchStack('referenceIndex', value),
                  { min: 0, step: 1 },
                )}
                {numeric(
                  'Maximum integer shift',
                  stack.maximumShift,
                  (value) => patchStack('maximumShift', value),
                  { min: 0, step: 1 },
                )}
                {numeric(
                  'Minimum peak ratio',
                  stack.minimumPeakRatio,
                  (value) => patchStack('minimumPeakRatio', value),
                  { min: 1 },
                )}
                <label>
                  Registration edge policy
                  <select
                    onChange={(event) =>
                      patchStack(
                        'edgePolicy',
                        event.target.value as StackWorkspaceSettings['edgePolicy'],
                      )
                    }
                    value={stack.edgePolicy}
                  >
                    <option value="crop-overlap">Deterministic tolerance crop</option>
                    <option value="pad">Pad with explicit value</option>
                  </select>
                </label>
                {numeric('Pad value', stack.fillValue, (value) => patchStack('fillValue', value))}
              </div>
              <p>
                Arbitrary-axis navigation remains in the plane selector. Min/max/mean use
                PureJsImage built-ins; sum, montage, drift, and alignment use the bounded materials
                provider.
              </p>
              <div className="button-row">
                <Button disabled={busy} onClick={() => onPlanStack(stack)}>
                  Plan stack operation
                </Button>
                <Button
                  disabled={busy || !runnable('stack', stack)}
                  onClick={() => onRunStack(stack)}
                  variant="primary"
                >
                  Run stack operation
                </Button>
                <Button disabled={!busy} onClick={onCancel}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </details>

      <details>
        <summary>AFM/SPM surface workspace</summary>
        <div className="form-stack advanced-materials__body">
          <label>
            Included area / exclusion boundary
            <select
              onChange={(event) => patchSurface('roiId', event.target.value)}
              value={surface.roiId}
            >
              <option value="whole-plane">Whole active plane</option>
              {rois.flatMap((roi) =>
                roi.geometry.kind === 'rectangle' ||
                roi.geometry.kind === 'ellipse' ||
                roi.geometry.kind === 'polygon'
                  ? [
                      <option key={roi.id} value={roi.id}>
                        {roi.name ?? roi.id}
                      </option>,
                    ]
                  : [],
              )}
            </select>
          </label>
          <div className="two-column-fields">
            <label>
              Correction
              <select
                onChange={(event) =>
                  patchSurface(
                    'correction',
                    event.target.value as SurfaceWorkspaceSettings['correction'],
                  )
                }
                value={surface.correction}
              >
                <option value="none">None</option>
                <option value="subtract-mean">Subtract mean</option>
                <option value="first-order-plane">First-order plane leveling</option>
                <option value="row-median">Row/line median correction</option>
                <option value="polynomial">Polynomial background</option>
              </select>
            </label>
            <label>
              Polynomial degree
              <select
                onChange={(event) =>
                  patchSurface('polynomialDegree', Number(event.target.value) as 0 | 1 | 2)
                }
                value={surface.polynomialDegree}
              >
                <option value={0}>0 · mean</option>
                <option value={1}>1 · plane</option>
                <option value={2}>2 · quadratic maximum</option>
              </select>
            </label>
            {numeric(
              'Height histogram bins',
              surface.histogramBins,
              (value) => patchSurface('histogramBins', value),
              { min: 2, max: 4096, step: 1 },
            )}
            {numeric(
              'Profile samples',
              surface.profileSamples,
              (value) => patchSurface('profileSamples', value),
              { min: 2, max: 65536, step: 1 },
            )}
            {numeric('Profile X0', surface.profileX0, (value) => patchSurface('profileX0', value), {
              min: 0,
            })}
            {numeric('Profile Y0', surface.profileY0, (value) => patchSurface('profileY0', value), {
              min: 0,
            })}
            {numeric('Profile X1', surface.profileX1, (value) => patchSurface('profileX1', value), {
              min: 0,
            })}
            {numeric('Profile Y1', surface.profileY1, (value) => patchSurface('profileY1', value), {
              min: 0,
            })}
            <label>
              Grain threshold
              <select
                onChange={(event) =>
                  patchSurface(
                    'grainMethod',
                    event.target.value as SurfaceWorkspaceSettings['grainMethod'],
                  )
                }
                value={surface.grainMethod}
              >
                {['manual', 'otsu', 'triangle', 'yen', 'li', 'mean'].map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Grain polarity
              <select
                onChange={(event) =>
                  patchSurface('grainPolarity', event.target.value as 'light' | 'dark')
                }
                value={surface.grainPolarity}
              >
                <option value="light">High grains</option>
                <option value="dark">Low grains</option>
              </select>
            </label>
            {numeric('Manual grain lower', surface.grainLower, (value) =>
              patchSurface('grainLower', value),
            )}
            {numeric('Manual grain upper', surface.grainUpper, (value) =>
              patchSurface('grainUpper', value),
            )}
          </div>
          <p>
            Ra is mean absolute deviation, Rq is RMS deviation, and Rz is maximum minus minimum over
            the admitted area. X/Y and Z units are reported independently.
          </p>
          <div className="button-row">
            <Button disabled={busy} onClick={() => onPlanSurface(surface)}>
              Plan AFM surface
            </Button>
            <Button
              disabled={busy || !runnable('surface', surface)}
              onClick={() => onRunSurface(surface)}
              variant="primary"
            >
              Run AFM surface
            </Button>
            <Button disabled={!busy} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </details>

      <details>
        <summary>Local-first batch recipes</summary>
        <div className="form-stack advanced-materials__body">
          <p>
            Select local files to apply the currently committed validated recipe in isolated imaging
            Workers. Each row records source identity, recipe hash, deterministic output name, and
            independent status. No file is uploaded.
          </p>
          {numeric('Bounded concurrency', batchConcurrency, setBatchConcurrency, {
            min: 1,
            max: 4,
            step: 1,
          })}
          <input
            aria-label="Choose local files for batch recipe"
            className="visually-hidden"
            multiple
            onChange={(event) => onBatchFiles([...(event.target.files ?? [])], batchConcurrency)}
            ref={batchInput}
            type="file"
          />
          <div className="button-row">
            <Button disabled={busy} onClick={() => batchInput.current?.click()} variant="primary">
              Choose batch files
            </Button>
            <Button disabled={!busy} onClick={onCancel}>
              Cancel active work
            </Button>
          </div>
          <section className="batch-table" aria-label="Batch recipe results">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Status</th>
                  <th>Output</th>
                  <th>Source identity</th>
                  <th>Recipe hash</th>
                  <th>Error</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {batchRows.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No batch run yet.</td>
                  </tr>
                ) : null}
                {batchRows.map((row) => (
                  <tr key={row.itemId}>
                    <td>{row.sourceName}</td>
                    <td>{row.status}</td>
                    <td>{row.outputName}</td>
                    <td>
                      <code>{row.sourceIdentity}</code>
                    </td>
                    <td>
                      <code>{row.recipeHash}</code>
                    </td>
                    <td>{row.error ?? '—'}</td>
                    <td>
                      <Button
                        disabled={row.status !== 'queued' && row.status !== 'running'}
                        onClick={() => onCancelBatchItem(row.itemId)}
                      >
                        Cancel item
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </details>
      <PlanSummary plan={plan} />
      {message === undefined ? null : (
        <p aria-live="polite" className="analysis-message">
          {message}
        </p>
      )}
    </section>
  )
}
