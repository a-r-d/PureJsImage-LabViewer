import type { GeoActionId, GeoMapRoi, GeoProject } from '@pji-workbench/domain-geo'
import { crsKey } from '@pji-workbench/domain-geo'
import type { GeoWorkbenchController } from '@pji-workbench/geo-workbench'
import { Button } from '@pji-workbench/ui'
import { useRef, useState } from 'react'

export type GeoDrawingTool = 'pan' | 'point' | 'line' | 'rectangle' | 'polygon'
type ActionValue = Awaited<ReturnType<GeoWorkbenchController['executeAction']>>

export function VectorAnalysisPanel({
  project,
  selectedRoiId,
  tool,
  disabled,
  onTool,
  execute,
}: {
  readonly project: GeoProject
  readonly selectedRoiId: string | undefined
  readonly tool: GeoDrawingTool
  readonly disabled: boolean
  readonly onTool: (tool: GeoDrawingTool) => void
  readonly execute: (id: GeoActionId, input: unknown, signal?: AbortSignal) => Promise<ActionValue>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const analysisAbortRef = useRef<AbortController | null>(null)
  const [message, setMessage] = useState('Choose a draw tool or import bounded GeoJSON.')
  const [legacyDocument, setLegacyDocument] = useState<string | undefined>()
  const [plan, setPlan] = useState<ActionValue | undefined>()
  const [result, setResult] = useState<ActionValue | undefined>()
  const selected = project.rois.find(({ id }) => id === selectedRoiId)
  const canSamplePoints =
    selected?.geometry.kind === 'point' || selected?.geometry.kind === 'multi-point'
  const canProfile = selected?.geometry.kind === 'line' || selected?.geometry.kind === 'multi-line'
  const canAnalyzeZone =
    selected?.geometry.kind === 'polygon' ||
    selected?.geometry.kind === 'multi-polygon' ||
    selected?.geometry.kind === 'rectangle'

  const run = async (id: GeoActionId, input: unknown): Promise<ActionValue | undefined> => {
    try {
      const output = await execute(id, input)
      setResult(output)
      setMessage(`${id} completed.`)
      return output
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${id} failed.`)
      return undefined
    }
  }

  const importDocument = async (document: string, legacyCrsConfirmed = false): Promise<void> => {
    const output = await run('geo.roi.import_geojson', {
      document,
      sourceName: 'Imported GeoJSON',
      ...(legacyCrsConfirmed ? { legacyCrsConfirmed: true, legacyCrs: project.crs } : {}),
    })
    if (isRecord(output) && output['requiresConfirmation'] === true) {
      setLegacyDocument(document)
      setMessage('This document has a legacy crs member. Confirm its interpretation explicitly.')
    } else setLegacyDocument(undefined)
  }

  const planStatistics = async (): Promise<void> => {
    if (selected === undefined) return
    const output = await run('geo.analysis.zonal_statistics', {
      roiId: selected.id,
      dryRun: true,
      valuePolicy: 'raw',
    })
    if (output !== undefined) setPlan(output)
  }

  const executeStatistics = async (): Promise<void> => {
    if (selected === undefined) return
    analysisAbortRef.current?.abort()
    const abort = new AbortController()
    analysisAbortRef.current = abort
    try {
      const output = await execute(
        'geo.analysis.zonal_statistics',
        { roiId: selected.id, valuePolicy: 'raw' },
        abort.signal,
      )
      setResult(output)
      setMessage('Zonal statistics completed. Nodata and non-finite samples were excluded.')
    } catch (error) {
      setMessage(abort.signal.aborted ? 'Zonal statistics cancelled.' : errorMessage(error))
    } finally {
      if (analysisAbortRef.current === abort) analysisAbortRef.current = null
    }
  }

  return (
    <div className="geo-inspector-body geo-vector-panel" data-testid="vector-analysis-panel">
      <section aria-labelledby="geo-draw-heading">
        <strong id="geo-draw-heading">Draw map-coordinate ROI</strong>
        <div className="geo-inspector-toolbar" role="toolbar" aria-label="ROI drawing tools">
          {(['pan', 'point', 'line', 'rectangle', 'polygon'] as const).map((candidate) => (
            <Button
              aria-pressed={tool === candidate}
              disabled={disabled}
              key={candidate}
              onClick={() => onTool(candidate)}
            >
              {candidate[0]?.toUpperCase()}
              {candidate.slice(1)}
            </Button>
          ))}
        </div>
        <p className="geo-help">
          Line and polygon: click vertices, then press Enter or double-click to finish. Escape
          cancels.
        </p>
      </section>

      <section aria-labelledby="geo-import-heading">
        <strong id="geo-import-heading">GeoJSON</strong>
        <input
          accept="application/geo+json,application/json,.geojson,.json"
          className="visually-hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file === undefined) return
            if (file.size > 4 * 1_024 * 1_024) {
              setMessage('GeoJSON exceeds the 4 MiB document limit.')
              return
            }
            void file.text().then((document) => importDocument(document))
          }}
          ref={inputRef}
          type="file"
        />
        <div className="geo-inspector-toolbar">
          <Button disabled={disabled} onClick={() => inputRef.current?.click()}>
            Import GeoJSON
          </Button>
          <Button
            disabled={project.rois.length === 0}
            onClick={() => {
              void run('geo.roi.export_geojson', {}).then((output) =>
                downloadActionText(output, 'atlas-rois.geojson'),
              )
            }}
          >
            Export WGS84 GeoJSON
          </Button>
          <Button
            disabled={project.rois.length === 0}
            onClick={() => {
              void run('geo.roi.export_geojson', { nativeCrs: true }).then((output) =>
                downloadActionText(output, 'atlas-rois.native-crs.geojson'),
              )
            }}
          >
            Export native CRS
          </Button>
        </div>
        {legacyDocument === undefined ? null : (
          <div className="geo-compatibility-warning" role="alert">
            <p>
              Legacy <code>crs</code> is not RFC 7946. Atlas will not silently honor or ignore it.
            </p>
            <Button
              disabled={crsKey(project.crs) === undefined}
              onClick={() => void importDocument(legacyDocument, true)}
            >
              Interpret as {crsKey(project.crs) ?? 'unsupported project CRS'}
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="geo-roi-heading">
        <div className="geo-inspector-toolbar">
          <strong id="geo-roi-heading">ROIs</strong>
          <span>{project.rois.length} / 256</span>
        </div>
        {project.rois.length === 0 ? (
          <p>No ROIs yet.</p>
        ) : (
          <ol className="geo-roi-list">
            {project.rois.map((roi) => (
              <RoiRow
                execute={execute}
                key={roi.id}
                roi={roi}
                selected={roi.id === selectedRoiId}
              />
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="geo-measure-heading">
        <strong id="geo-measure-heading">Measure and analyze</strong>
        <div className="geo-inspector-toolbar">
          <Button
            disabled={selected === undefined}
            onClick={() => void run('geo.measure.distance', { roiId: selected?.id })}
          >
            Measure distance
          </Button>
          <Button
            disabled={selected === undefined}
            onClick={() => void run('geo.measure.area', { roiId: selected?.id })}
          >
            Measure area
          </Button>
          <Button
            disabled={!canSamplePoints || disabled}
            onClick={() => {
              if (selected !== undefined)
                void run('geo.raster.sample_points', {
                  points: roiPoints(selected),
                  crs: selected.crs,
                  valuePolicy: 'raw',
                })
            }}
          >
            Sample all bands
          </Button>
          <Button
            disabled={!canProfile || disabled}
            onClick={() => {
              if (selected !== undefined)
                void run('geo.analysis.line_profile', {
                  roiId: selected.id,
                  valuePolicy: 'raw',
                  resampling: 'nearest',
                })
            }}
          >
            Line profile
          </Button>
          <Button disabled={!canAnalyzeZone || disabled} onClick={() => void planStatistics()}>
            Plan zonal statistics
          </Button>
          <Button
            disabled={plan === undefined || disabled}
            onClick={() => void executeStatistics()}
          >
            Run planned statistics
          </Button>
          <Button
            disabled={analysisAbortRef.current === null}
            onClick={() => analysisAbortRef.current?.abort()}
          >
            Cancel analysis
          </Button>
        </div>
        {plan === undefined ? null : (
          <pre className="geo-result" data-testid="zonal-plan">
            {JSON.stringify(plan, null, 2)}
          </pre>
        )}
        {result === undefined ? null : (
          <pre className="geo-result" data-testid="vector-result">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </section>

      <section aria-labelledby="geo-render-export-heading">
        <strong id="geo-render-export-heading">Rendered image</strong>
        <div className="geo-inspector-toolbar">
          <Button
            disabled={disabled}
            onClick={() => {
              void run('geo.export.rendered_image', {
                width: 1920,
                height: 1080,
                includeRoiOverlay: true,
              }).then((output) => downloadRenderedImage(output))
            }}
          >
            Export selected viewport
          </Button>
        </div>
      </section>

      <p aria-live="polite" className="geo-help">
        {message}
      </p>
    </div>
  )
}

function RoiRow({
  roi,
  selected,
  execute,
}: {
  readonly roi: GeoMapRoi
  readonly selected: boolean
  readonly execute: (id: GeoActionId, input: unknown) => Promise<ActionValue>
}) {
  return (
    <li className={selected ? 'is-selected' : undefined}>
      <button onClick={() => void execute('geo.roi.select', { roiId: roi.id })} type="button">
        <span>{roi.name ?? roi.id}</span>
        <small>
          {roi.geometry.kind} · {crsKey(roi.crs) ?? roi.crs.name ?? roi.crs.kind}
        </small>
      </button>
      <Button
        aria-label={`Delete ${roi.name ?? roi.id}`}
        onClick={() => void execute('geo.roi.remove', { roiId: roi.id })}
      >
        Delete
      </Button>
    </li>
  )
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function downloadActionText(output: ActionValue | undefined, name: string): void {
  if (!isRecord(output) || typeof output['text'] !== 'string') return
  downloadUrl(
    URL.createObjectURL(new Blob([output['text']], { type: 'application/geo+json' })),
    name,
  )
}

function downloadRenderedImage(output: ActionValue | undefined): void {
  if (!isRecord(output) || typeof output['dataUrl'] !== 'string') return
  downloadUrl(output['dataUrl'], 'atlas-viewport.png', false)
}

function downloadUrl(url: string, name: string, revoke = true): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  if (revoke) URL.revokeObjectURL(url)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The action failed.'
}

function roiPoints(roi: GeoMapRoi): readonly Readonly<{ x: number; y: number }>[] {
  if (roi.geometry.kind === 'point') return [{ x: roi.geometry.x, y: roi.geometry.y }]
  return roi.geometry.kind === 'multi-point' ? roi.geometry.points : []
}
