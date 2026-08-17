import type {
  AnalysisCatalog,
  AnalysisDryRunResponse,
  AnalysisExecutionResponse,
  AnalysisSeriesExport,
  AnalysisTablePage,
  OpenedDatasetDescriptor,
  RpcJsonObject,
  RpcJsonValue,
} from '@pji-workbench/contracts'
import { convertCalibration } from '@pji-workbench/materials-analysis'
import { Button } from '@pji-workbench/ui'
import type { CalibrationOverride, WorkspaceSnapshot } from '@pji-workbench/workspace'
import { useEffect, useMemo, useState } from 'react'

import type { RoiTool, ViewportRoi } from './ScientificViewport.js'

export interface MaterialsPanelState {
  readonly busy: boolean
  readonly message?: string
  readonly dryRun?: AnalysisDryRunResponse
  readonly execution?: AnalysisExecutionResponse
  readonly table?: AnalysisTablePage
  readonly tableOutput?: string
  readonly distribution?: AnalysisSeriesExport
  readonly seriesExports?: readonly Readonly<{
    name: string
    data: AnalysisSeriesExport
  }>[]
  readonly tableOffset: number
  readonly selectedLabel?: number | undefined
}

const FAVORITE_OPERATIONS_KEY = 'pji-workbench.analysis.favorite-operations.v1'
const RECENT_OPERATIONS_KEY = 'pji-workbench.analysis.recent-operations.v1'

interface BrowserOperation {
  readonly id: string
  readonly version: number
  readonly title: string
  readonly description: string
  readonly category: string
  readonly tags: readonly string[]
  readonly inputs: readonly RpcJsonObject[]
  readonly outputs: readonly RpcJsonObject[]
  readonly parameters: RpcJsonObject
}

function asRecord(value: unknown): RpcJsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RpcJsonObject)
    : undefined
}

function operationFrom(value: unknown): BrowserOperation | undefined {
  const record = asRecord(value)
  if (record === undefined || typeof record['id'] !== 'string') return undefined
  const title = typeof record['title'] === 'string' ? record['title'] : record['id']
  return {
    id: record['id'],
    version: typeof record['version'] === 'number' ? record['version'] : 1,
    title,
    description: typeof record['description'] === 'string' ? record['description'] : '',
    category: typeof record['category'] === 'string' ? record['category'] : 'other',
    tags: Array.isArray(record['tags'])
      ? record['tags'].filter((tag): tag is string => typeof tag === 'string')
      : [],
    inputs: Array.isArray(record['inputs'])
      ? record['inputs'].flatMap((input) => {
          const candidate = asRecord(input)
          return candidate === undefined ? [] : [candidate]
        })
      : [],
    outputs: Array.isArray(record['outputs'])
      ? record['outputs'].flatMap((output) => {
          const candidate = asRecord(output)
          return candidate === undefined ? [] : [candidate]
        })
      : [],
    parameters: asRecord(record['parameters']) ?? {},
  }
}

function readOperationIds(key: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 12)
      : []
  } catch {
    return []
  }
}

function defaultParameters(schema: RpcJsonObject): RpcJsonObject {
  const properties = asRecord(schema['properties'])
  if (properties === undefined) return {}
  return Object.fromEntries(
    Object.entries(properties).flatMap(([name, property]) => {
      if (name === 'displayAxes' || name === 'fixedIndices') return []
      const item = asRecord(property)
      if (item === undefined || item['default'] === undefined) return []
      return [[name, item['default']]]
    }),
  )
}

function ParameterControl({
  name,
  schema,
  value,
  onChange,
}: {
  readonly name: string
  readonly schema: RpcJsonObject
  readonly value: RpcJsonValue | undefined
  readonly onChange: (value: RpcJsonValue) => void
}) {
  const title = typeof schema['title'] === 'string' ? schema['title'] : name
  const type = schema['type']
  const enumValues = Array.isArray(schema['values']) ? schema['values'] : undefined
  if (type === 'boolean')
    return (
      <label className="inline-check">
        <input
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        {title}
      </label>
    )
  if (type === 'enum' && enumValues !== undefined)
    return (
      <label>
        {title}
        <select
          onChange={(event) => {
            const selected = enumValues[event.target.selectedIndex]
            if (selected !== undefined) onChange(selected)
          }}
          value={String(value ?? '')}
        >
          {enumValues.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      </label>
    )
  if (type === 'number' || type === 'integer')
    return (
      <label>
        {title}
        <input
          max={typeof schema['maximum'] === 'number' ? schema['maximum'] : undefined}
          min={typeof schema['minimum'] === 'number' ? schema['minimum'] : undefined}
          onChange={(event) => onChange(Number(event.target.value))}
          step={type === 'integer' ? 1 : 'any'}
          type="number"
          value={typeof value === 'number' ? value : ''}
        />
      </label>
    )
  if (type === 'array')
    return (
      <label>
        {title}
        <textarea
          aria-describedby={`${name}-array-help`}
          onChange={(event) => {
            const next = event.target.value
              .split(/[\s,]+/u)
              .filter(Boolean)
              .map(Number)
            if (next.every(Number.isFinite)) onChange(next)
          }}
          rows={3}
          value={Array.isArray(value) ? value.join(', ') : ''}
        />
        <small id={`${name}-array-help`}>Comma-separated bounded coefficients.</small>
      </label>
    )
  return null
}

interface RoiMetric {
  readonly label: string
  readonly pixel: string
  readonly physical?: string
}

function roiMeasurement(roi: ViewportRoi, opened: OpenedDatasetDescriptor): readonly RoiMetric[] {
  const points =
    roi.geometry.kind === 'point'
      ? [roi.geometry.point]
      : roi.geometry.kind === 'line-segment'
        ? [roi.geometry.start, roi.geometry.end]
        : roi.geometry.kind === 'polyline' || roi.geometry.kind === 'polygon'
          ? roi.geometry.points
          : []
  const lineLength = points.slice(1).reduce((total, point, index) => {
    const previous = points[index]
    return previous === undefined
      ? total
      : total + Math.hypot(point.x - previous.x, point.y - previous.y)
  }, 0)
  const pixelArea =
    roi.geometry.kind === 'rectangle'
      ? roi.geometry.width * roi.geometry.height
      : roi.geometry.kind === 'ellipse'
        ? Math.PI * roi.geometry.radiusX * roi.geometry.radiusY
        : roi.geometry.kind === 'polygon'
          ? Math.abs(
              roi.geometry.points.reduce((sum, point, index, polygon) => {
                const next = polygon[(index + 1) % polygon.length]
                return next === undefined ? sum : sum + point.x * next.y - next.x * point.y
              }, 0) / 2,
            )
          : undefined
  const polygonPerimeter = (polygon: readonly { readonly x: number; readonly y: number }[]) =>
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return next === undefined ? sum : sum + Math.hypot(next.x - point.x, next.y - point.y)
    }, 0)
  const pixelPerimeter =
    roi.geometry.kind === 'rectangle'
      ? 2 * (roi.geometry.width + roi.geometry.height)
      : roi.geometry.kind === 'ellipse'
        ? Math.PI *
          (3 * (roi.geometry.radiusX + roi.geometry.radiusY) -
            Math.sqrt(
              (3 * roi.geometry.radiusX + roi.geometry.radiusY) *
                (roi.geometry.radiusX + 3 * roi.geometry.radiusY),
            ))
        : roi.geometry.kind === 'polygon'
          ? polygonPerimeter(roi.geometry.points)
          : undefined
  const pixelCentroid =
    roi.geometry.kind === 'rectangle'
      ? { x: roi.geometry.x + roi.geometry.width / 2, y: roi.geometry.y + roi.geometry.height / 2 }
      : roi.geometry.kind === 'ellipse'
        ? roi.geometry.center
        : roi.geometry.kind === 'polygon' && pixelArea !== undefined && pixelArea > 0
          ? {
              x:
                roi.geometry.points.reduce((sum, point, index, polygon) => {
                  const next = polygon[(index + 1) % polygon.length]
                  return next === undefined
                    ? sum
                    : sum + (point.x + next.x) * (point.x * next.y - next.x * point.y)
                }, 0) /
                ((6 *
                  roi.geometry.points.reduce((sum, point, index, polygon) => {
                    const next = polygon[(index + 1) % polygon.length]
                    return next === undefined ? sum : sum + point.x * next.y - next.x * point.y
                  }, 0)) /
                  2),
              y:
                roi.geometry.points.reduce((sum, point, index, polygon) => {
                  const next = polygon[(index + 1) % polygon.length]
                  return next === undefined
                    ? sum
                    : sum + (point.y + next.y) * (point.x * next.y - next.x * point.y)
                }, 0) /
                ((6 *
                  roi.geometry.points.reduce((sum, point, index, polygon) => {
                    const next = polygon[(index + 1) % polygon.length]
                    return next === undefined ? sum : sum + point.x * next.y - next.x * point.y
                  }, 0)) /
                  2),
            }
          : undefined
  const horizontal = opened.dataset.axes.find(({ id }) => id === roi.axisIds[0])
  const vertical = opened.dataset.axes.find(({ id }) => id === roi.axisIds[1])
  const calibrated =
    horizontal?.coordinates.type === 'linear' &&
    vertical?.coordinates.type === 'linear' &&
    horizontal.unit !== undefined &&
    horizontal.unit === vertical.unit
  const scaleX = calibrated ? Math.abs(horizontal.coordinates.step) : undefined
  const scaleY = calibrated ? Math.abs(vertical.coordinates.step) : undefined
  const unit = calibrated ? horizontal.unit : undefined
  const metrics: RoiMetric[] = []
  const addMetric = (label: string, pixel: string, physical?: string): void => {
    metrics.push(physical === undefined ? { label, pixel } : { label, pixel, physical })
  }
  if (pixelArea !== undefined) {
    addMetric(
      'Area',
      `${pixelArea.toFixed(1)} px²`,
      scaleX === undefined || scaleY === undefined || unit === undefined
        ? undefined
        : `${(pixelArea * scaleX * scaleY).toFixed(2)} ${unit}²`,
    )
  }
  if (pixelPerimeter !== undefined) {
    const physicalPerimeter =
      scaleX === undefined || scaleY === undefined || unit === undefined
        ? undefined
        : roi.geometry.kind === 'rectangle'
          ? 2 * (roi.geometry.width * scaleX + roi.geometry.height * scaleY)
          : roi.geometry.kind === 'ellipse'
            ? Math.PI *
              (3 * (roi.geometry.radiusX * scaleX + roi.geometry.radiusY * scaleY) -
                Math.sqrt(
                  (3 * roi.geometry.radiusX * scaleX + roi.geometry.radiusY * scaleY) *
                    (roi.geometry.radiusX * scaleX + 3 * roi.geometry.radiusY * scaleY),
                ))
            : roi.geometry.kind === 'polygon'
              ? polygonPerimeter(
                  roi.geometry.points.map((point) => ({
                    x: point.x * (scaleX ?? 1),
                    y: point.y * (scaleY ?? 1),
                  })),
                )
              : undefined
    addMetric(
      'Perimeter',
      `${pixelPerimeter.toFixed(1)} px`,
      physicalPerimeter === undefined || unit === undefined
        ? undefined
        : `${physicalPerimeter.toFixed(2)} ${unit}`,
    )
  }
  if (lineLength > 0 && pixelArea === undefined) {
    const physicalLength =
      scaleX === undefined || scaleY === undefined
        ? undefined
        : points.slice(1).reduce((total, point, index) => {
            const previous = points[index]
            return previous === undefined
              ? total
              : total + Math.hypot((point.x - previous.x) * scaleX, (point.y - previous.y) * scaleY)
          }, 0)
    addMetric(
      'Length',
      `${lineLength.toFixed(1)} px`,
      physicalLength === undefined || unit === undefined
        ? undefined
        : `${physicalLength.toFixed(2)} ${unit}`,
    )
  }
  if (pixelCentroid !== undefined) {
    addMetric(
      'Centroid',
      `${pixelCentroid.x.toFixed(1)}, ${pixelCentroid.y.toFixed(1)} px`,
      !calibrated || unit === undefined
        ? undefined
        : `${(horizontal.coordinates.origin + pixelCentroid.x * horizontal.coordinates.step).toFixed(2)}, ${(vertical.coordinates.origin + pixelCentroid.y * vertical.coordinates.step).toFixed(2)} ${unit}`,
    )
  } else if (points[0] !== undefined && pixelArea === undefined && lineLength === 0) {
    const point = points[0]
    addMetric(
      'Point',
      `${point.x.toFixed(1)}, ${point.y.toFixed(1)} px`,
      !calibrated || unit === undefined
        ? undefined
        : `${(horizontal.coordinates.origin + point.x * horizontal.coordinates.step).toFixed(2)}, ${(vertical.coordinates.origin + point.y * vertical.coordinates.step).toFixed(2)} ${unit}`,
    )
  }
  if (metrics.length === 0) {
    addMetric(
      'Geometry',
      'pixel coordinates',
      calibrated ? undefined : 'physical calibration unavailable',
    )
  }
  return metrics
}

export function RoiInspector({
  rois,
  selectedRoiId,
  tool,
  onTool,
  onSelect,
  onRename,
  onVisibility,
  onDelete,
  onMeasure,
  calibration,
  onCalibration,
  opened,
}: {
  readonly rois: readonly ViewportRoi[]
  readonly selectedRoiId?: string | undefined
  readonly tool: RoiTool
  readonly onTool: (tool: RoiTool) => void
  readonly onSelect: (id?: string) => void
  readonly onRename: (roi: ViewportRoi, name: string) => void
  readonly onVisibility: (roi: ViewportRoi, visible: boolean) => void
  readonly onDelete: (id: string) => void
  readonly onMeasure: (kind: 'statistics' | 'histogram' | 'profile') => void
  readonly calibration?: CalibrationOverride | undefined
  readonly onCalibration: (calibration?: Omit<CalibrationOverride, 'datasetReferenceId'>) => void
  readonly opened: OpenedDatasetDescriptor
}) {
  const tools: readonly (readonly [RoiTool, string])[] = [
    ['select', 'Select'],
    ['point', 'Point'],
    ['line', 'Line'],
    ['polyline', 'Polyline'],
    ['rectangle', 'Rectangle'],
    ['ellipse', 'Ellipse'],
    ['polygon', 'Polygon'],
  ]
  const selected = rois.find(({ id }) => id === selectedRoiId)
  const horizontal = opened.dataset.axes.find(({ id }) => id === opened.selection.displayAxes[0])
  const vertical = opened.dataset.axes.find(({ id }) => id === opened.selection.displayAxes[1])
  const fileX =
    horizontal?.coordinates.type === 'linear' ? Math.abs(horizontal.coordinates.step) : 1
  const fileY = vertical?.coordinates.type === 'linear' ? Math.abs(vertical.coordinates.step) : 1
  const [scaleX, setScaleX] = useState(calibration?.unitsPerPixel[0] ?? fileX)
  const [scaleY, setScaleY] = useState(calibration?.unitsPerPixel[1] ?? fileY)
  const [scaleUnit, setScaleUnit] = useState(calibration?.unit ?? horizontal?.unit ?? 'px')
  const [knownDistance, setKnownDistance] = useState(calibration?.knownDistance ?? 1)
  const [conversionUnit, setConversionUnit] = useState('µm')
  const linePixels =
    selected?.geometry.kind === 'line-segment'
      ? Math.hypot(
          selected.geometry.end.x - selected.geometry.start.x,
          selected.geometry.end.y - selected.geometry.start.y,
        )
      : undefined
  return (
    <div className="inspector-content form-stack" data-testid="roi-inspector">
      <fieldset className="tool-grid">
        <legend>Viewport tool</legend>
        {tools.map(([candidate, label]) => (
          <Button
            aria-pressed={tool === candidate}
            key={candidate}
            onClick={() => onTool(candidate)}
            variant={tool === candidate ? 'primary' : 'secondary'}
          >
            {label}
          </Button>
        ))}
      </fieldset>
      <p className="panel-note">
        Drag to draw. Handles remain screen-sized while zooming. Escape cancels; Delete removes the
        selected ROI.
      </p>
      <div className="button-row">
        <Button disabled={selected === undefined} onClick={() => onMeasure('statistics')}>
          Statistics
        </Button>
        <Button disabled={selected === undefined} onClick={() => onMeasure('histogram')}>
          Histogram
        </Button>
        <Button
          disabled={
            selected === undefined ||
            (selected.geometry.kind !== 'line-segment' && selected.geometry.kind !== 'polyline')
          }
          onClick={() => onMeasure('profile')}
        >
          Line profile
        </Button>
      </div>
      <ul className="roi-list" aria-label="Regions of interest">
        {rois.length === 0 ? <li>No ROIs yet.</li> : null}
        {rois.map((roi) => {
          const style = roi.presentation?.style
          const visible = style?.['visible'] !== false
          return (
            <li data-selected={roi.id === selectedRoiId} key={roi.id}>
              <button type="button" onClick={() => onSelect(roi.id)}>
                {roi.name ?? roi.id}
              </button>
              <label>
                <span className="sr-only">Rename {roi.name ?? roi.id}</span>
                <input
                  aria-label={`Rename ${roi.name ?? roi.id}`}
                  onBlur={(event) => onRename(roi, event.target.value)}
                  defaultValue={roi.name ?? roi.id}
                />
              </label>
              <label className="inline-check">
                <input
                  checked={visible}
                  onChange={(event) => onVisibility(roi, event.target.checked)}
                  type="checkbox"
                />
                Visible
              </label>
              <dl className="roi-metrics">
                {roiMeasurement(roi, opened).map((metric) => (
                  <div key={metric.label}>
                    <dt>{metric.label}</dt>
                    <dd>
                      <span>{metric.pixel}</span>
                      {metric.physical === undefined ? null : <span>{metric.physical}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
              <Button onClick={() => onDelete(roi.id)}>Delete</Button>
            </li>
          )
        })}
      </ul>
      <fieldset className="calibration-editor">
        <legend>Calibration</legend>
        <p className="panel-note">
          File metadata remains preserved. A correction is stored as a revisioned project override.
        </p>
        <div className="calibration-grid">
          <label>
            X units / pixel
            <input
              min="0"
              onChange={(event) => setScaleX(Number(event.target.value))}
              step="any"
              type="number"
              value={scaleX}
            />
          </label>
          <label>
            Y units / pixel
            <input
              min="0"
              onChange={(event) => setScaleY(Number(event.target.value))}
              step="any"
              type="number"
              value={scaleY}
            />
          </label>
          <label>
            Unit
            <input
              maxLength={64}
              onChange={(event) => setScaleUnit(event.target.value)}
              value={scaleUnit}
            />
          </label>
        </div>
        <div className="button-row">
          <Button
            disabled={scaleX <= 0 || scaleY <= 0 || scaleUnit.trim() === ''}
            onClick={() =>
              onCalibration({
                axisIds: opened.selection.displayAxes,
                unitsPerPixel: [scaleX, scaleY],
                unit: scaleUnit.trim(),
                source: 'manual',
              })
            }
          >
            Set anisotropic scale
          </Button>
          <Button disabled={calibration === undefined} onClick={() => onCalibration(undefined)}>
            Restore file calibration
          </Button>
        </div>
        <div className="button-row">
          <label>
            Convert scale to
            <select
              onChange={(event) => setConversionUnit(event.target.value)}
              value={conversionUnit}
            >
              {['pm', 'nm', 'µm', 'mm', 'cm', 'm', 'Å'].map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </label>
          <Button
            onClick={() => {
              try {
                const converted = convertCalibration(
                  { x: scaleX, y: scaleY, unit: scaleUnit },
                  conversionUnit,
                )
                setScaleX(converted.x)
                setScaleY(converted.y)
                setScaleUnit(converted.unit)
              } catch {
                // Unsupported free-form source units remain unchanged until the user chooses a supported unit.
              }
            }}
          >
            Convert units
          </Button>
        </div>
        <label>
          Known line distance
          <input
            min="0"
            onChange={(event) => setKnownDistance(Number(event.target.value))}
            step="any"
            type="number"
            value={knownDistance}
          />
        </label>
        <Button
          disabled={
            linePixels === undefined ||
            linePixels <= 0 ||
            knownDistance <= 0 ||
            scaleUnit.trim() === ''
          }
          onClick={() => {
            if (linePixels === undefined || linePixels <= 0) return
            const scale = knownDistance / linePixels
            setScaleX(scale)
            setScaleY(scale)
            onCalibration({
              axisIds: opened.selection.displayAxes,
              unitsPerPixel: [scale, scale],
              unit: scaleUnit.trim(),
              source: 'known-line',
              knownDistance,
              measuredPixels: linePixels,
            })
          }}
        >
          Calibrate from selected line
        </Button>
      </fieldset>
    </div>
  )
}

export function AnalysisInspector({
  threshold,
  mode,
  connectivity,
  component,
  planeLabel,
  catalog,
  state,
  onThreshold,
  onMode,
  onConnectivity,
  onPreview,
  onCancelPreview,
  onApply,
  onRunObjects,
  onPlanObjects,
  onRunOperation,
  focusOperationId,
  sampleType,
  connectedPlanReady,
}: {
  readonly threshold: number
  readonly mode: 'greater-than' | 'greater-than-or-equal' | 'less-than' | 'less-than-or-equal'
  readonly connectivity: 4 | 8
  readonly component: number
  readonly planeLabel: string
  readonly catalog?: AnalysisCatalog | undefined
  readonly state: MaterialsPanelState
  readonly onThreshold: (value: number) => void
  readonly onMode: (value: typeof mode) => void
  readonly onConnectivity: (value: 4 | 8) => void
  readonly onPreview: () => void
  readonly onCancelPreview: () => void
  readonly onApply: () => void
  readonly onRunObjects: () => void
  readonly onPlanObjects: () => void
  readonly onRunOperation: (
    operation: Readonly<{
      id: string
      version: number
      title: string
      inputs: readonly RpcJsonObject[]
      outputs: readonly RpcJsonObject[]
      parameters: RpcJsonObject
    }>,
    parameters: RpcJsonObject,
    mode: 'preview' | 'apply',
  ) => void
  readonly focusOperationId?: string | undefined
  readonly sampleType?: string | undefined
  readonly connectedPlanReady: boolean
}) {
  const [operationQuery, setOperationQuery] = useState('')
  const [operationCategory, setOperationCategory] = useState('all')
  const [operationView, setOperationView] = useState<'all' | 'recent' | 'favorites'>('all')
  const [favoriteIds, setFavoriteIds] = useState(() => readOperationIds(FAVORITE_OPERATIONS_KEY))
  const [recentIds, setRecentIds] = useState(() => readOperationIds(RECENT_OPERATIONS_KEY))
  const descriptors = catalog?.capabilities['operationDescriptors']
  const operations = useMemo(
    () =>
      Array.isArray(descriptors) ? descriptors.flatMap((value) => operationFrom(value) ?? []) : [],
    [descriptors],
  )
  const categories = useMemo(
    () => [...new Set(operations.map(({ category }) => category))].sort(),
    [operations],
  )
  const filteredOperations = useMemo(
    () =>
      operations.filter((operation) => {
        if (operationCategory !== 'all' && operation.category !== operationCategory) return false
        if (operationView === 'recent' && !recentIds.includes(operation.id)) return false
        if (operationView === 'favorites' && !favoriteIds.includes(operation.id)) return false
        const query = operationQuery.trim().toLocaleLowerCase()
        return (
          query === '' ||
          [operation.title, operation.description, operation.id, ...operation.tags]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query)
        )
      }),
    [favoriteIds, operationCategory, operationQuery, operationView, operations, recentIds],
  )
  const [selectedOperationId, setSelectedOperationId] = useState<string>()
  const selectedOperation =
    operations.find(({ id }) => id === selectedOperationId) ?? filteredOperations[0]
  const [operationParameters, setOperationParameters] = useState<RpcJsonObject>({})
  useEffect(() => {
    if (selectedOperationId !== undefined || selectedOperation === undefined) return
    setSelectedOperationId(selectedOperation.id)
    setOperationParameters(defaultParameters(selectedOperation.parameters))
  }, [selectedOperation, selectedOperationId])
  const documentation = catalog?.documentation.find(
    (item) => item['operationId'] === selectedOperation?.id,
  )
  const presets =
    catalog?.presets.filter((preset) => preset['operationId'] === selectedOperation?.id) ?? []
  const parameterProperties = asRecord(selectedOperation?.parameters['properties'])
  const unavailableReason =
    selectedOperation === undefined
      ? 'Select an operation.'
      : selectedOperation.inputs.some((input) => {
            const valueType = asRecord(input['valueType'])
            return valueType?.['id'] === 'purejsimage.roi'
          })
        ? 'Select an ROI and run this measurement from the ROI inspector so its geometry is explicit.'
        : selectedOperation.inputs.length > 1
          ? 'This project currently has one bound dataset; bind a compatible second dataset to use the image calculator.'
          : sampleType === 'uint64' && selectedOperation.id.startsWith('pji-workbench.materials.')
            ? 'The reference materials provider refuses uint64 because conversion through JavaScript numbers would lose integer precision.'
            : selectedOperation.outputs.length === 0
              ? 'This operation has no publishable output.'
              : undefined
  const selectOperation = (operation: BrowserOperation): void => {
    setSelectedOperationId(operation.id)
    setOperationParameters(defaultParameters(operation.parameters))
  }
  useEffect(() => {
    if (focusOperationId === undefined) return
    const operation = operations.find(({ id }) => id === focusOperationId)
    if (operation !== undefined) {
      setSelectedOperationId(operation.id)
      setOperationParameters(defaultParameters(operation.parameters))
    }
  }, [focusOperationId, operations])
  const rememberOperation = (operation: BrowserOperation): void => {
    const next = [operation.id, ...recentIds.filter((id) => id !== operation.id)].slice(0, 12)
    setRecentIds(next)
    window.localStorage.setItem(RECENT_OPERATIONS_KEY, JSON.stringify(next))
  }
  const runOperation = (mode: 'preview' | 'apply'): void => {
    if (selectedOperation === undefined || unavailableReason !== undefined) return
    rememberOperation(selectedOperation)
    onRunOperation(selectedOperation, operationParameters, mode)
  }
  const estimate = state.dryRun?.plan?.['totalEstimate']
  const estimateRecord: Readonly<Record<string, unknown>> | null =
    typeof estimate === 'object' && estimate !== null && !Array.isArray(estimate)
      ? (estimate as Readonly<Record<string, unknown>>)
      : null
  return (
    <div className="inspector-content form-stack" data-testid="analysis-inspector">
      <p className="panel-kicker">PureJsImage operation catalog · {operations.length} operations</p>
      <section className="operation-browser" aria-label="Operation browser">
        <label>
          Search operations
          <input
            onChange={(event) => setOperationQuery(event.target.value)}
            placeholder="Filter, threshold, measure…"
            type="search"
            value={operationQuery}
          />
        </label>
        <div className="operation-browser__filters">
          <label>
            Category
            <select
              onChange={(event) => setOperationCategory(event.target.value)}
              value={operationCategory}
            >
              <option value="all">All</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <Button
            aria-pressed={operationView === 'recent'}
            onClick={() => setOperationView(operationView === 'recent' ? 'all' : 'recent')}
          >
            Recent
          </Button>
          <Button
            aria-pressed={operationView === 'favorites'}
            onClick={() => setOperationView(operationView === 'favorites' ? 'all' : 'favorites')}
          >
            Favorites
          </Button>
        </div>
        <ul className="operation-browser__results">
          {filteredOperations.map((operation) => (
            <li data-selected={operation.id === selectedOperation?.id} key={operation.id}>
              <button type="button" onClick={() => selectOperation(operation)}>
                <strong>{operation.title}</strong>
                <small>{operation.category}</small>
              </button>
              <Button
                aria-label={`${favoriteIds.includes(operation.id) ? 'Remove' : 'Add'} ${operation.title} ${favoriteIds.includes(operation.id) ? 'from' : 'to'} favorites`}
                aria-pressed={favoriteIds.includes(operation.id)}
                onClick={() => {
                  const next = favoriteIds.includes(operation.id)
                    ? favoriteIds.filter((id) => id !== operation.id)
                    : [operation.id, ...favoriteIds].slice(0, 12)
                  setFavoriteIds(next)
                  window.localStorage.setItem(FAVORITE_OPERATIONS_KEY, JSON.stringify(next))
                }}
              >
                Favorite
              </Button>
            </li>
          ))}
        </ul>
        {selectedOperation === undefined ? null : (
          <section className="operation-browser__detail" aria-label="Selected operation">
            <h3>{selectedOperation.title}</h3>
            <p>{selectedOperation.description}</p>
            {unavailableReason === undefined ? (
              <p className="availability available">Available for the active dataset.</p>
            ) : (
              <p className="availability unavailable">Unavailable: {unavailableReason}</p>
            )}
            {presets.length === 0 ? null : (
              <label>
                Workflow preset
                <select
                  defaultValue=""
                  onChange={(event) => {
                    const preset = presets.find(({ id }) => id === event.target.value)
                    const parameters = asRecord(preset?.['parameters'])
                    if (parameters !== undefined) setOperationParameters(parameters)
                  }}
                >
                  <option value="">Custom</option>
                  {presets.map((preset) => (
                    <option key={String(preset['id'])} value={String(preset['id'])}>
                      {String(preset['title'])}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {parameterProperties === undefined
              ? null
              : Object.entries(parameterProperties).map(([name, property]) => {
                  if (name === 'displayAxes' || name === 'fixedIndices') return null
                  const schema = asRecord(property)
                  return schema === undefined ? null : (
                    <ParameterControl
                      key={name}
                      name={name}
                      onChange={(value) =>
                        setOperationParameters((current) => ({ ...current, [name]: value }))
                      }
                      schema={schema}
                      value={operationParameters[name]}
                    />
                  )
                })}
            {documentation === undefined ? null : (
              <dl className="operation-docs">
                <div>
                  <dt>Output</dt>
                  <dd>{String(documentation['outputPolicy'])}</dd>
                </div>
                <div>
                  <dt>No data</dt>
                  <dd>{String(documentation['noDataPolicy'])}</dd>
                </div>
                <div>
                  <dt>Boundary</dt>
                  <dd>{String(documentation['boundaryPolicy'])}</dd>
                </div>
                <div>
                  <dt>Calibration</dt>
                  <dd>{String(documentation['calibrationPolicy'])}</dd>
                </div>
                <div>
                  <dt>Cost</dt>
                  <dd>{String(documentation['cost'])}</dd>
                </div>
                <div>
                  <dt>Action</dt>
                  <dd>
                    {String(documentation['actionId'])}@{String(documentation['actionVersion'])}
                  </dd>
                </div>
              </dl>
            )}
            <div className="button-row">
              <Button
                disabled={state.busy || unavailableReason !== undefined}
                onClick={() => runOperation('preview')}
              >
                Preview
              </Button>
              <Button onClick={onCancelPreview}>Cancel</Button>
              <Button
                disabled={state.busy || unavailableReason !== undefined}
                onClick={() => runOperation('apply')}
                variant="primary"
              >
                Apply
              </Button>
              <Button
                onClick={() =>
                  setOperationParameters(defaultParameters(selectedOperation.parameters))
                }
              >
                Reset
              </Button>
            </div>
          </section>
        )}
      </section>
      <label>
        Comparison
        <select value={mode} onChange={(event) => onMode(event.target.value as typeof mode)}>
          <option value="greater-than">Greater than</option>
          <option value="greater-than-or-equal">Greater than or equal</option>
          <option value="less-than">Less than</option>
          <option value="less-than-or-equal">Less than or equal</option>
        </select>
      </label>
      <label>
        Threshold · component {component}
        <input
          aria-label="Threshold value"
          onChange={(event) => onThreshold(Number(event.target.value))}
          step="any"
          type="number"
          value={threshold}
        />
      </label>
      <div className="button-row">
        <Button disabled={state.busy} onClick={onPreview}>
          Preview threshold
        </Button>
        <Button onClick={onCancelPreview}>Cancel preview</Button>
        <Button disabled={state.busy} onClick={onApply} variant="primary">
          Apply threshold
        </Button>
      </div>
      <p className="panel-note">
        Preview is temporary and cancellable. Apply creates one normalized project revision; display
        range is never used as an analysis input.
      </p>
      <hr />
      <p className="panel-note">
        Plane {planeLabel} · component {component}
      </p>
      <label>
        Connectivity
        <select
          value={connectivity}
          onChange={(event) => onConnectivity(Number(event.target.value) as 4 | 8)}
        >
          <option value={4}>4-connected</option>
          <option value={8}>8-connected</option>
        </select>
      </label>
      {estimateRecord === null ? (
        <p className="panel-note">Preview the plan to see resource estimates before execution.</p>
      ) : (
        <dl className="estimate-grid" aria-label="Analysis resource estimate">
          <div>
            <dt>Peak memory</dt>
            <dd>{String(estimateRecord['peakWorkingBytes'] ?? 'unresolved')} bytes</dd>
          </div>
          <div>
            <dt>Compute</dt>
            <dd>{String(estimateRecord['computeMilliseconds'] ?? 'unresolved')} ms</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>{String(estimateRecord['outputBytes'] ?? 'unresolved')} bytes</dd>
          </div>
        </dl>
      )}
      <div className="button-row">
        <Button disabled={state.busy} onClick={onPlanObjects}>
          Plan connected components
        </Button>
        <Button
          disabled={state.busy || !connectedPlanReady}
          onClick={onRunObjects}
          variant="primary"
        >
          Run connected components
        </Button>
      </div>
      <p className="panel-note">Outputs: label overlay and bounded, paged object measurements.</p>
      {state.message === undefined ? null : (
        <p aria-live="polite" className="analysis-message">
          {state.message}
        </p>
      )}
      {state.dryRun?.issues.map((issue) => (
        <p className="error-banner" key={JSON.stringify(issue)}>
          {String(issue['message'] ?? 'Analysis validation failed')}
        </p>
      ))}
    </div>
  )
}

export function analysisPageRows(
  page: AnalysisTablePage,
): readonly Readonly<Record<string, unknown>>[] {
  return Array.from({ length: page.rowCount }, (_value, row) =>
    Object.fromEntries(page.columns.map((column) => [column.name, column.values[row] ?? null])),
  )
}

const MAX_FREQUENCY_PEAK_LABELS = 8

export function frequencyPeakAnnotations(
  page: AnalysisTablePage,
): readonly Readonly<{ x: number; y: number; label: string }>[] {
  const dUnit = page.columns.find(({ name }) => name === 'dSpacing')?.unit
  const frequencyUnit = page.columns.find(({ name }) => name === 'radialFrequency')?.unit
  const annotations: { x: number; y: number; label: string }[] = []
  const labeledKeys = new Set<string>()
  const labeledPoints: { x: number; y: number }[] = []
  for (const row of analysisPageRows(page)) {
    const x = row['x']
    const y = row['y']
    if (typeof x !== 'number' || typeof y !== 'number') continue
    const radial = row['radialFrequency']
    const frequencyX = row['frequencyX']
    const frequencyY = row['frequencyY']
    const isDc =
      (typeof radial === 'number' && Number.isFinite(radial) && radial <= 0) ||
      (typeof frequencyX === 'number' &&
        typeof frequencyY === 'number' &&
        frequencyX === 0 &&
        frequencyY === 0)
    if (isDc) continue
    const dSpacing = row['dSpacing']
    const key =
      typeof dSpacing === 'number' && Number.isFinite(dSpacing)
        ? `d:${dSpacing.toPrecision(3)}`
        : typeof radial === 'number' && Number.isFinite(radial)
          ? `f:${radial.toPrecision(3)}`
          : `p:${annotations.length}`
    const tooClose = labeledPoints.some((point) => Math.hypot(point.x - x, point.y - y) < 28)
    const label =
      labeledKeys.has(key) || tooClose
        ? ''
        : typeof dSpacing === 'number' && Number.isFinite(dSpacing)
          ? `d=${dSpacing.toPrecision(3)}${dUnit === undefined ? '' : ` ${dUnit}`}`
          : typeof radial === 'number' && Number.isFinite(radial)
            ? `${radial.toPrecision(3)}${frequencyUnit === undefined ? '' : ` ${frequencyUnit}`}`
            : `Peak ${annotations.length + 1}`
    if (label !== '') {
      labeledKeys.add(key)
      labeledPoints.push({ x, y })
    }
    annotations.push({ x, y, label })
    if (annotations.length >= MAX_FREQUENCY_PEAK_LABELS) break
  }
  return annotations
}

function previewScalar(
  preview: RpcJsonObject | undefined,
  name: string,
): Readonly<{ value: number; unit?: string }> | undefined {
  const field = asRecord(preview?.[name])
  const value = field?.['preview']
  if (field === undefined || typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const unit = typeof field['unit'] === 'string' ? field['unit'] : undefined
  return unit === undefined ? { value } : { value, unit }
}

export function roughnessMetrics(
  execution: AnalysisExecutionResponse,
): Readonly<{ ra: number; rq: number; rz: number; unit?: string }> | undefined {
  const output = execution.outputs.find(
    (item) => item.kind === 'result' && item.name === 'roughness',
  )
  if (output?.kind !== 'result') return undefined
  const preview = asRecord(output.summary['preview'])
  const ra = previewScalar(preview, 'Ra')
  const rq = previewScalar(preview, 'Rq')
  const rz = previewScalar(preview, 'Rz')
  if (ra === undefined || rq === undefined || rz === undefined) return undefined
  const metadata = asRecord(output.summary['metadata'])
  const reportedUnit =
    rq.unit ??
    ra.unit ??
    rz.unit ??
    (typeof metadata?.['zUnit'] === 'string' ? metadata['zUnit'] : undefined)
  const unit =
    reportedUnit === undefined || reportedUnit === 'dataset value' ? undefined : reportedUnit
  return unit === undefined
    ? { ra: ra.value, rq: rq.value, rz: rz.value }
    : { ra: ra.value, rq: rq.value, rz: rz.value, unit }
}

export function formatRoughnessHeadline(execution: AnalysisExecutionResponse): string | undefined {
  const metrics = roughnessMetrics(execution)
  if (metrics === undefined) return undefined
  const unit = metrics.unit === undefined ? '' : ` ${metrics.unit}`
  return `Rq ${metrics.rq.toPrecision(4)}${unit} · Ra ${metrics.ra.toPrecision(4)}${unit} · Rz ${metrics.rz.toPrecision(4)}${unit}`
}

export function collectionPreviewRows(
  execution: AnalysisExecutionResponse,
): readonly Readonly<{ label: string; value: number; unit?: string }>[] {
  const result = execution.outputs.find(
    (item) =>
      item.kind === 'result' &&
      (item.name === 'statistics' || item.summary['kind'] === 'collection'),
  )
  if (result?.kind !== 'result') return []
  const preview = asRecord(result.summary['preview'])
  if (preview === undefined) return []
  return Object.entries(preview).flatMap(([label, field]) => {
    const record = asRecord(field)
    const value = record?.['preview']
    if (typeof value !== 'number' || !Number.isFinite(value)) return []
    const unit = typeof record['unit'] === 'string' ? record['unit'] : undefined
    return unit === undefined ? [{ label, value }] : [{ label, value, unit }]
  })
}

export function analysisResultHeadline(state: MaterialsPanelState): string {
  const execution = state.execution
  if (execution === undefined) return ''
  const table = state.table
  const objectTable = state.tableOutput === undefined || state.tableOutput === 'objects'
  if (table !== undefined && objectTable)
    return `${table.totalRows.toLocaleString()} particles counted`
  if (table !== undefined && state.tableOutput === 'peaks')
    return `${table.totalRows.toLocaleString()} peaks`
  const roughness = formatRoughnessHeadline(execution)
  if (roughness !== undefined) return roughness
  if (
    execution.outputs.some(
      (output) => output.kind === 'result' && output.summary['kind'] === 'histogram',
    )
  )
    return 'Intensity histogram'
  const scalars = collectionPreviewRows(execution)
  const mean = scalars.find(({ label }) => label === 'mean')
  if (mean !== undefined) {
    const unit = mean.unit === undefined ? '' : ` ${mean.unit}`
    return `mean ${mean.value.toPrecision(4)}${unit}`
  }
  return `${execution.outputs.length} ${execution.outputs.length === 1 ? 'result' : 'results'}`
}

export function shouldShowResultPreview(
  execution: AnalysisExecutionResponse,
  seriesExports: MaterialsPanelState['seriesExports'],
): boolean {
  const result = execution.outputs.find((output) => output.kind === 'result')
  if (result?.kind !== 'result') return false
  return !seriesExports?.some(({ name }) => name === result.name)
}

function numericPreview(value: unknown): readonly number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number')
    : []
}

function keyedValues(values: readonly number[]) {
  const counts = new Map<number, number>()
  return values.map((value) => {
    const ordinal = counts.get(value) ?? 0
    counts.set(value, ordinal + 1)
    return { id: `${value}:${ordinal}`, value }
  })
}

const PARTICLE_SIZE_BIN_IDS = Array.from(
  { length: 16 },
  (_value, index) => `particle-size-bin-${index}`,
)

function ResultPreviewPlot({ execution }: { readonly execution: AnalysisExecutionResponse }) {
  const result = execution.outputs.find((output) => output.kind === 'result')
  if (result?.kind !== 'result') return null
  const preview = result.summary['preview']
  if (typeof preview !== 'object' || preview === null || Array.isArray(preview)) return null
  const previewRecord = preview as Readonly<Record<string, unknown>>
  const values =
    numericPreview(previewRecord['counts']).length > 0
      ? numericPreview(previewRecord['counts'])
      : numericPreview(previewRecord['value'])
  if (values.length === 0) return null
  const maximum = Math.max(1, ...values)
  return (
    <div className="result-plot" aria-label={`Bounded ${result.name} preview`} role="img">
      {keyedValues(values).map(({ id, value }) => (
        <span key={id} style={{ height: `${Math.max(2, (value / maximum) * 54)}px` }} />
      ))}
    </div>
  )
}

function ObjectDistributions({ page }: { readonly page: AnalysisTablePage }) {
  const definitions = [
    ['pixelArea', 'Area'],
    ['equivalentCircularDiameter', 'ECD'],
    ['aspectRatio', 'Aspect ratio'],
    ['orientationRadians', 'Orientation'],
  ] as const
  const available = definitions.flatMap(([name, label]) => {
    const column = page.columns.find((candidate) => candidate.name === name)
    if (column === undefined) return []
    const values = column.values.filter((value): value is number => typeof value === 'number')
    return values.length === 0 ? [] : [{ name, label, values }]
  })
  if (available.length === 0) return null
  return (
    <section className="distribution-grid" aria-label="Bounded object distributions">
      {available.map(({ name, label, values }) => {
        const maximum = Math.max(...values)
        const minimum = Math.min(...values)
        const span = Math.max(Number.EPSILON, maximum - minimum)
        return (
          <figure key={name}>
            <figcaption>{label} · current page</figcaption>
            <div>
              {keyedValues(values.slice(0, 50)).map(({ id, value }) => (
                <span key={id} style={{ height: `${4 + ((value - minimum) / span) * 34}px` }} />
              ))}
            </div>
          </figure>
        )
      })}
    </section>
  )
}

function ParticleDistribution({ distribution }: { readonly distribution: AnalysisSeriesExport }) {
  const sizes = distribution.columns[0]?.values.filter(
    (value): value is number => typeof value === 'number',
  )
  const cumulative = distribution.columns[1]?.values.filter(
    (value): value is number => typeof value === 'number',
  )
  if (sizes === undefined || cumulative === undefined || sizes.length === 0) return null
  const minimum = sizes[0] ?? 0
  const maximum = sizes[sizes.length - 1] ?? minimum
  const span = Math.max(Number.EPSILON, maximum - minimum)
  const quantile = (fraction: number) => sizes[Math.round((sizes.length - 1) * fraction)] ?? minimum
  const bins = new Array<number>(16).fill(0)
  for (const size of sizes) {
    const index = Math.min(15, Math.floor(((size - minimum) / span) * 16))
    bins[index] = (bins[index] ?? 0) + 1
  }
  const maximumBin = Math.max(1, ...bins)
  return (
    <section className="particle-distribution" aria-label="Complete particle size distribution">
      <h3>Complete size distribution</h3>
      <dl className="particle-distribution__five-number">
        {[
          ['Minimum', minimum],
          ['Q1', quantile(0.25)],
          ['Median', quantile(0.5)],
          ['Q3', quantile(0.75)],
          ['Maximum', maximum],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <dt>{label}</dt>
            <dd>{Number(value).toPrecision(4)}</dd>
          </div>
        ))}
      </dl>
      <div className="particle-distribution__plots">
        <figure>
          <figcaption>Equivalent-diameter histogram</figcaption>
          <div className="result-plot" role="img" aria-label="Particle diameter histogram">
            {PARTICLE_SIZE_BIN_IDS.map((id, index) => (
              <span
                key={id}
                style={{ height: `${2 + ((bins[index] ?? 0) / maximumBin) * 52}px` }}
              />
            ))}
          </div>
        </figure>
        <figure>
          <figcaption>Cumulative fraction</figcaption>
          <svg
            aria-label="Empirical cumulative particle diameter distribution"
            preserveAspectRatio="none"
            role="img"
            viewBox="0 0 100 60"
          >
            <polyline
              fill="none"
              points={sizes
                .map((size, index) => {
                  const x = ((size - minimum) / span) * 100
                  const y = 60 - (cumulative[index] ?? 0) * 60
                  return `${x},${y}`
                })
                .join(' ')}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </figure>
      </div>
    </section>
  )
}

function ScientificSeriesPlot({
  name,
  series,
}: Readonly<{ name: string; series: AnalysisSeriesExport }>) {
  const xColumn = series.columns[0]
  const yColumn = series.columns[1]
  if (xColumn === undefined || yColumn === undefined) return null
  const points = xColumn.values.flatMap((x, index) => {
    const y = yColumn.values[index]
    return typeof x === 'number' &&
      Number.isFinite(x) &&
      typeof y === 'number' &&
      Number.isFinite(y)
      ? [{ x, y }]
      : []
  })
  if (points.length === 0) return null
  const minimumX = Math.min(...points.map(({ x }) => x))
  const maximumX = Math.max(...points.map(({ x }) => x))
  const minimumY = Math.min(...points.map(({ y }) => y))
  const maximumY = Math.max(...points.map(({ y }) => y))
  const spanX = Math.max(Number.EPSILON, maximumX - minimumX)
  const spanY = Math.max(Number.EPSILON, maximumY - minimumY)
  return (
    <figure className="scientific-series">
      <figcaption>
        {name} · {xColumn.name}
        {xColumn.unit === undefined ? '' : ` (${xColumn.unit})`} / {yColumn.name}
        {yColumn.unit === undefined ? '' : ` (${yColumn.unit})`}
      </figcaption>
      <svg
        aria-label={`${name} scientific profile`}
        preserveAspectRatio="none"
        role="img"
        viewBox="0 0 100 60"
      >
        <polyline
          fill="none"
          points={points
            .map(
              ({ x, y }) =>
                `${((x - minimumX) / spanX) * 100},${60 - ((y - minimumY) / spanY) * 60}`,
            )
            .join(' ')}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <small>
        {points.length.toLocaleString()} points · X {minimumX.toPrecision(4)}–
        {maximumX.toPrecision(4)} · Y {minimumY.toPrecision(4)}–{maximumY.toPrecision(4)}
      </small>
    </figure>
  )
}

function AnalysisHistogramPlot({
  name,
  series,
}: Readonly<{ name: string; series: AnalysisSeriesExport }>) {
  const edge = series.columns.find(({ name: column }) => column === 'binMinimum')
  const counts = series.columns.find(({ name: column }) => column === 'count')
  if (edge === undefined || counts === undefined) return null
  const bins = edge.values.flatMap((x, index) => {
    const count = counts.values[index]
    return typeof x === 'number' && typeof count === 'number' && Number.isFinite(count)
      ? [{ x, count }]
      : []
  })
  if (bins.length === 0) return null
  const maximum = Math.max(1, ...bins.map(({ count }) => count))
  return (
    <figure className="scientific-series">
      <figcaption>
        {name} · {edge.name}
        {edge.unit === undefined ? '' : ` (${edge.unit})`} / count
      </figcaption>
      <div className="result-plot" role="img" aria-label={`${name} intensity histogram`}>
        {bins.map((bin) => (
          <span
            key={`h-${bin.x}-${bin.count}`}
            style={{ height: `${Math.max(2, (bin.count / maximum) * 54)}px` }}
          />
        ))}
      </div>
      <small>
        {bins.length.toLocaleString()} bins · {bins[0]?.x.toPrecision(4)}–
        {bins[bins.length - 1]?.x.toPrecision(4)}
        {edge.unit === undefined ? '' : ` ${edge.unit}`}
      </small>
    </figure>
  )
}

function DriftTrajectory({ page }: { readonly page: AnalysisTablePage }) {
  const xColumn = page.columns.find(({ name }) => name === 'offsetX')
  const yColumn = page.columns.find(({ name }) => name === 'offsetY')
  if (xColumn === undefined || yColumn === undefined) return null
  const points = xColumn.values.flatMap((x, index) => {
    const y = yColumn.values[index]
    return typeof x === 'number' && typeof y === 'number' ? [{ x, y }] : []
  })
  if (points.length === 0) return null
  const extent = Math.max(1, ...points.flatMap(({ x, y }) => [Math.abs(x), Math.abs(y)]))
  return (
    <figure className="scientific-series">
      <figcaption>Registered frame drift trajectory (pixels)</figcaption>
      <svg
        aria-label="Drift trajectory plot"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        viewBox="0 0 100 100"
      >
        <line x1="50" x2="50" y1="0" y2="100" />
        <line x1="0" x2="100" y1="50" y2="50" />
        <polyline
          fill="none"
          points={points
            .map(({ x, y }) => `${50 + (x / extent) * 45},${50 - (y / extent) * 45}`)
            .join(' ')}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  )
}

export function AnalysisResults({
  state,
  onPage,
  onSort,
  onFilter,
  onSelectLabel,
  onExport,
  onPin,
}: {
  readonly state: MaterialsPanelState
  readonly onPage: (offset: number) => void
  readonly onSort: (column: string) => void
  readonly onFilter: (column: string, minimum?: number) => void
  readonly onSelectLabel: (label?: number) => void
  readonly onExport: (scope: 'selected' | 'all', format: 'csv' | 'json') => void
  readonly onPin: () => void
}) {
  const execution = state.execution
  if (execution === undefined) {
    return <p className="bottom-placeholder">Run an ROI measurement or object workflow.</p>
  }
  const table = state.table
  const objectTable = state.tableOutput === undefined || state.tableOutput === 'objects'
  const roughness = roughnessMetrics(execution)
  const collectionRows = roughness === undefined ? collectionPreviewRows(execution) : []
  const hasDetailedPlot =
    (state.seriesExports !== undefined && state.seriesExports.length > 0) ||
    state.distribution !== undefined
  const rawOutputs = execution.outputs.map(({ kind, name, ...rest }) => ({ kind, name, ...rest }))
  return (
    <div className="analysis-results" data-testid="analysis-results">
      <div className="result-summary-row">
        <strong className="result-count">{analysisResultHeadline(state)}</strong>
        <span>{execution.elapsedMilliseconds.toFixed(1)} ms</span>
        <Button onClick={onPin}>Pin result</Button>
        <Button onClick={() => onExport('selected', 'csv')}>Export selected CSV</Button>
        <Button onClick={() => onExport('all', 'csv')}>Export all CSV</Button>
        <Button onClick={() => onExport('all', 'json')}>Export JSON</Button>
      </div>
      {roughness === undefined ? null : (
        <section className="roughness-summary" aria-label="Surface roughness">
          <h3>Surface roughness</h3>
          <dl>
            {(
              [
                ['Rq', roughness.rq],
                ['Ra', roughness.ra],
                ['Rz', roughness.rz],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {value.toPrecision(4)}
                  {roughness.unit === undefined ? '' : ` ${roughness.unit}`}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {collectionRows.length === 0 ? null : (
        <section className="roughness-summary" aria-label="ROI statistics">
          <h3>ROI statistics</h3>
          <dl>
            {collectionRows.map(({ label, value, unit }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {value.toPrecision(4)}
                  {unit === undefined ? '' : ` ${unit}`}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {shouldShowResultPreview(execution, state.seriesExports) ? (
        <ResultPreviewPlot execution={execution} />
      ) : null}
      {state.seriesExports === undefined && state.distribution !== undefined ? (
        <ParticleDistribution distribution={state.distribution} />
      ) : null}
      {state.seriesExports?.map(({ name, data }) =>
        name === 'sizeDistribution' || name === 'distribution' ? (
          <ParticleDistribution distribution={data} key={name} />
        ) : name === 'histogram' ||
          name === 'heightHistogram' ||
          data.columns.some(({ name: column }) => column === 'count') ? (
          <AnalysisHistogramPlot key={name} name={name} series={data} />
        ) : (
          <ScientificSeriesPlot key={name} name={name} series={data} />
        ),
      )}
      {table === undefined ? (
        hasDetailedPlot || roughness !== undefined || collectionRows.length > 0 ? (
          <details className="result-json-details">
            <summary>Raw output descriptors</summary>
            <pre className="result-json">{JSON.stringify(rawOutputs, null, 2)}</pre>
          </details>
        ) : (
          <pre className="result-json">{JSON.stringify(rawOutputs, null, 2)}</pre>
        )
      ) : (
        <>
          <div className="result-summary-row">
            <strong>
              {objectTable
                ? 'Object measurements'
                : `${table.totalRows.toLocaleString()} ${state.tableOutput ?? 'result'} rows`}
            </strong>
            {objectTable ? (
              <label>
                Minimum area
                <input
                  aria-label="Minimum area filter"
                  min={0}
                  onChange={(event) =>
                    onFilter(
                      'pixelArea',
                      event.target.value === '' ? undefined : Number(event.target.value),
                    )
                  }
                  type="number"
                />
              </label>
            ) : null}
          </div>
          {objectTable ? <ObjectDistributions page={table} /> : null}
          {state.tableOutput === 'drift' ? <DriftTrajectory page={table} /> : null}
          <section
            className="virtual-table"
            aria-label={
              objectTable
                ? 'Paged object measurements'
                : `Paged ${state.tableOutput ?? 'analysis'} results`
            }
          >
            <table>
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th key={column.name}>
                      <button type="button" onClick={() => onSort(column.name)}>
                        {column.name}
                        {column.unit === undefined ? '' : ` (${column.unit})`}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysisPageRows(table).map((row) => {
                  const labelValue = row['label'] ?? row['id']
                  const label = typeof labelValue === 'number' ? labelValue : undefined
                  return (
                    <tr
                      data-selected={label !== undefined && label === state.selectedLabel}
                      key={String(labelValue ?? JSON.stringify(row))}
                      onClick={() => onSelectLabel(label)}
                    >
                      {table.columns.map((column) => {
                        const value = row[column.name]
                        return (
                          <td key={column.name}>
                            {column.name === 'label' && label !== undefined ? (
                              <button
                                aria-label={`Select label ${label}`}
                                aria-pressed={label === state.selectedLabel}
                                className="table-label-button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onSelectLabel(label)
                                }}
                                type="button"
                              >
                                {String(value ?? '—')}
                              </button>
                            ) : (
                              String(value ?? '—')
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
          <div className="button-row">
            <Button
              disabled={table.offset === 0}
              onClick={() => onPage(Math.max(0, table.offset - 50))}
            >
              Previous
            </Button>
            <span>
              {table.offset + 1}–{table.offset + table.rowCount} of {table.totalRows}
            </span>
            <Button
              disabled={table.offset + table.rowCount >= table.totalRows}
              onClick={() => onPage(table.offset + 50)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export function readablePipeline(graph: WorkspaceSnapshot['analysis']['graph']): readonly Readonly<{
  id: string
  label: string
  version: number
  parameters: unknown
}>[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    label: node.label ?? node.operation.id,
    version: node.operation.version,
    parameters: node.parameters,
  }))
}
