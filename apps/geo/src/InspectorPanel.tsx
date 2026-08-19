import type {
  BandMapping,
  CogXrayReport,
  GeoRasterLayer,
  RasterStyle,
} from '@pji-workbench/domain-geo'
import { Button, Panel, Tabs } from '@pji-workbench/ui'

export type InspectorTab = 'layers' | 'display' | 'xray'

export function InspectorPanel({
  tab,
  onTab,
  layers,
  selectedLayerId,
  onSelectLayer,
  onLayerChange,
  onDuplicateLayer,
  onMoveLayer,
  bandCount,
  xray,
}: {
  readonly tab: InspectorTab
  readonly onTab: (tab: InspectorTab) => void
  readonly layers: readonly GeoRasterLayer[]
  readonly selectedLayerId: string | undefined
  readonly onSelectLayer: (id: string) => void
  readonly onLayerChange: (
    id: string,
    patch: Partial<GeoRasterLayer> & { style?: RasterStyle },
  ) => void
  readonly onDuplicateLayer: () => void
  readonly onMoveLayer: (id: string, direction: -1 | 1) => void
  readonly bandCount: number
  readonly xray: CogXrayReport | undefined
}) {
  const selected = layers.find((layer) => layer.id === selectedLayerId) ?? layers[0]
  return (
    <Panel className="geo-inspector" label="Inspector">
      <Tabs
        items={[
          { id: 'layers', label: 'Layers' },
          { id: 'display', label: 'Display' },
          { id: 'xray', label: 'COG X-ray' },
        ]}
        label="Inspector views"
        onSelect={onTab}
        selectedId={tab}
      />
      {tab === 'layers' ? (
        <div className="geo-inspector-body" data-testid="layer-panel">
          <div className="geo-inspector-toolbar">
            <Button onClick={onDuplicateLayer}>Duplicate layer</Button>
          </div>
          <ol className="geo-layer-list">
            {[...layers]
              .sort((left, right) => right.zIndex - left.zIndex)
              .map((layer) => (
                <li key={layer.id}>
                  <div
                    className={
                      layer.id === selected?.id ? 'geo-layer-row is-selected' : 'geo-layer-row'
                    }
                  >
                    <label>
                      <input
                        aria-label={`Show ${layer.label}`}
                        checked={layer.visible}
                        onChange={(event) =>
                          onLayerChange(layer.id, { visible: event.currentTarget.checked })
                        }
                        type="checkbox"
                      />
                      Visible
                    </label>
                    <button onClick={() => onSelectLayer(layer.id)} type="button">
                      {layer.label}
                    </button>
                    <label>
                      Opacity
                      <input
                        aria-label={`${layer.label} opacity`}
                        max={1}
                        min={0}
                        onChange={(event) =>
                          onLayerChange(layer.id, { opacity: Number(event.currentTarget.value) })
                        }
                        step={0.05}
                        type="range"
                        value={layer.opacity}
                      />
                    </label>
                    <Button
                      aria-label={`Move ${layer.label} up`}
                      onClick={() => onMoveLayer(layer.id, 1)}
                    >
                      Up
                    </Button>
                    <Button
                      aria-label={`Move ${layer.label} down`}
                      onClick={() => onMoveLayer(layer.id, -1)}
                    >
                      Down
                    </Button>
                  </div>
                </li>
              ))}
          </ol>
        </div>
      ) : null}
      {tab === 'display' && selected !== undefined ? (
        <DisplayControls
          bandCount={bandCount}
          layer={selected}
          onChange={(style) => onLayerChange(selected.id, { style })}
        />
      ) : null}
      {tab === 'xray' ? <XrayPanel report={xray} /> : null}
    </Panel>
  )
}

function DisplayControls({
  layer,
  bandCount,
  onChange,
}: {
  readonly layer: GeoRasterLayer
  readonly bandCount: number
  readonly onChange: (style: RasterStyle) => void
}) {
  const rgb = layer.style.mapping.red !== undefined
  const bands = Array.from({ length: bandCount }, (_, index) => index)
  return (
    <form className="geo-inspector-body" data-testid="display-panel">
      <fieldset>
        <legend>Band mapping</legend>
        <label>
          <input
            checked={!rgb}
            name="mapping"
            onChange={() => onChange({ ...layer.style, mapping: { gray: 0 } })}
            type="radio"
          />
          Grayscale
        </label>
        <label>
          <input
            checked={rgb}
            name="mapping"
            onChange={() =>
              onChange({
                ...layer.style,
                mapping: {
                  red: 0,
                  green: Math.min(1, Math.max(0, bandCount - 1)),
                  blue: Math.min(2, Math.max(0, bandCount - 1)),
                },
              })
            }
            type="radio"
          />
          RGB
        </label>
        {rgb ? (
          <div className="geo-band-grid">
            {(['red', 'green', 'blue'] as const).map((channel) => (
              <label key={channel}>
                {channel}
                <select
                  aria-label={`${channel} band`}
                  onChange={(event) =>
                    onChange({
                      ...layer.style,
                      mapping: {
                        ...omitGray(layer.style.mapping),
                        [channel]: Number(event.currentTarget.value),
                      },
                    })
                  }
                  value={layer.style.mapping[channel] ?? 0}
                >
                  {bands.map((band) => (
                    <option key={band} value={band}>
                      Band {band}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : (
          <label>
            Gray band
            <select
              aria-label="Gray band"
              onChange={(event) =>
                onChange({ ...layer.style, mapping: { gray: Number(event.currentTarget.value) } })
              }
              value={layer.style.mapping.gray ?? 0}
            >
              {bands.map((band) => (
                <option key={band} value={band}>
                  Band {band}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
      <label>
        Stretch
        <select
          aria-label="Stretch"
          onChange={(event) => {
            const stretch = event.currentTarget.value === 'percentile' ? 'percentile' : 'minmax'
            onChange(
              mergeStyle(layer.style, {
                stretch,
                ...(stretch === 'percentile'
                  ? {
                      percentileLow: layer.style.percentileLow ?? 2,
                      percentileHigh: layer.style.percentileHigh ?? 98,
                    }
                  : {}),
              }),
            )
          }}
          value={layer.style.stretch ?? 'minmax'}
        >
          <option value="minmax">Min / max</option>
          <option value="percentile">Percentile</option>
        </select>
      </label>
      <div className="geo-band-grid">
        <label>
          Minimum
          <input
            aria-label="Stretch minimum"
            onChange={(event) =>
              onChange(
                mergeStyle(layer.style, {
                  minimum: parseOptionalNumber(event.currentTarget.value),
                }),
              )
            }
            placeholder="auto"
            type="number"
            value={layer.style.minimum ?? ''}
          />
        </label>
        <label>
          Maximum
          <input
            aria-label="Stretch maximum"
            onChange={(event) =>
              onChange(
                mergeStyle(layer.style, {
                  maximum: parseOptionalNumber(event.currentTarget.value),
                }),
              )
            }
            placeholder="auto"
            type="number"
            value={layer.style.maximum ?? ''}
          />
        </label>
      </div>
      {layer.style.stretch === 'percentile' ? (
        <div className="geo-band-grid">
          <label>
            Low percentile
            <input
              aria-label="Low percentile"
              max={100}
              min={0}
              onChange={(event) =>
                onChange(
                  mergeStyle(layer.style, {
                    percentileLow: Number(event.currentTarget.value),
                  }),
                )
              }
              step={0.5}
              type="number"
              value={layer.style.percentileLow ?? 2}
            />
          </label>
          <label>
            High percentile
            <input
              aria-label="High percentile"
              max={100}
              min={0}
              onChange={(event) =>
                onChange(
                  mergeStyle(layer.style, {
                    percentileHigh: Number(event.currentTarget.value),
                  }),
                )
              }
              step={0.5}
              type="number"
              value={layer.style.percentileHigh ?? 98}
            />
          </label>
        </div>
      ) : null}
      <label>
        Gamma
        <input
          aria-label="Gamma"
          max={4}
          min={0.2}
          onChange={(event) =>
            onChange(mergeStyle(layer.style, { gamma: Number(event.currentTarget.value) }))
          }
          step={0.05}
          type="number"
          value={layer.style.gamma ?? 1}
        />
      </label>
      <label>
        <input
          checked={layer.style.nodataTransparent !== false}
          onChange={(event) =>
            onChange({ ...layer.style, nodataTransparent: event.currentTarget.checked })
          }
          type="checkbox"
        />
        Nodata transparency
      </label>
    </form>
  )
}

function omitGray(mapping: BandMapping): BandMapping {
  const { gray: _gray, ...rest } = mapping
  return rest
}

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === '') return null
  const next = Number(value)
  return Number.isFinite(next) ? next : null
}

interface StylePatch {
  readonly mapping?: BandMapping
  readonly stretch?: RasterStyle['stretch']
  readonly nodataTransparent?: boolean
  readonly minimum?: number | null
  readonly maximum?: number | null
  readonly percentileLow?: number | null
  readonly percentileHigh?: number | null
  readonly gamma?: number | null
}

function mergeStyle(style: RasterStyle, patch: StylePatch): RasterStyle {
  const minimum = patch.minimum === null ? undefined : (patch.minimum ?? style.minimum)
  const maximum = patch.maximum === null ? undefined : (patch.maximum ?? style.maximum)
  const percentileLow =
    patch.percentileLow === null ? undefined : (patch.percentileLow ?? style.percentileLow)
  const percentileHigh =
    patch.percentileHigh === null ? undefined : (patch.percentileHigh ?? style.percentileHigh)
  const gamma = patch.gamma === null ? undefined : (patch.gamma ?? style.gamma)
  return {
    mapping: patch.mapping ?? style.mapping,
    stretch: patch.stretch ?? style.stretch ?? 'minmax',
    nodataTransparent: patch.nodataTransparent ?? style.nodataTransparent ?? true,
    ...(style.palette === undefined ? {} : { palette: style.palette }),
    ...(style.resample === undefined ? {} : { resample: style.resample }),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(percentileLow === undefined ? {} : { percentileLow }),
    ...(percentileHigh === undefined ? {} : { percentileHigh }),
    ...(gamma === undefined ? {} : { gamma }),
  }
}

function XrayPanel({ report }: { readonly report: CogXrayReport | undefined }) {
  if (report === undefined) {
    return (
      <p className="geo-inspector-body">Open a GeoTIFF to inspect container and range telemetry.</p>
    )
  }
  const affine = report.affine?.map((value) => value.toPrecision(6)).join(', ')
  const crs =
    report.crs === undefined
      ? 'unknown'
      : [report.crs.authority, report.crs.code, report.crs.name].filter(Boolean).join(' ')
  return (
    <dl className="geo-xray" data-testid="cog-xray">
      <Fact label="Object size" value={formatBytes(report.objectSize)} />
      <Fact label="Container" value={report.container} />
      <Fact label="Byte order" value={report.byteOrder} />
      <Fact label="Dimensions" value={`${report.width} × ${report.height}`} />
      <Fact
        label="Tile dimensions"
        value={
          report.tileWidth !== undefined && report.tileHeight !== undefined
            ? `${report.tileWidth} × ${report.tileHeight}`
            : report.tiled
              ? 'tiled'
              : 'strips'
        }
      />
      <Fact
        label="Bands"
        value={`${report.bandCount} · ${formatList(report.bitsPerSample)} bit · sample ${formatList(report.sampleFormats)}`}
      />
      <Fact
        label="Compression"
        value={
          report.compression === undefined
            ? 'unknown'
            : `${report.compression.name} (${report.compression.status})`
        }
      />
      <Fact label="IFDs" value={String(report.topLevelIfds)} />
      <Fact label="SubIFDs" value={String(report.subIfdCount)} />
      <Fact
        label="Overviews"
        value={
          report.overviewLevels.length === 0
            ? 'none'
            : report.overviewLevels
                .map((level) => `L${level.level} ${level.width}×${level.height}`)
                .join(', ')
        }
      />
      <Fact
        label="Nodata"
        value={
          report.nodata === undefined
            ? 'none'
            : report.nodata.kind === 'scalar'
              ? String(report.nodata.value)
              : report.nodata.values.join(', ')
        }
      />
      <Fact label="Affine" value={affine ?? 'none'} />
      <Fact label="CRS" value={crs} />
      <Fact label="Range requests" value={String(report.rangeRequests)} />
      <Fact label="Bytes fetched" value={formatBytes(report.bytesFetched)} />
      <Fact label="Cache hits" value={String(report.cacheHits)} />
      <Fact label="Cache misses" value={String(report.cacheMisses)} />
      <Fact
        label="Source fetched"
        value={report.percentFetched === undefined ? 'n/a' : `${report.percentFetched.toFixed(2)}%`}
      />
      <Fact label="Active overview" value={`L${report.activeOverview}`} />
      <Fact label="Likely COG" value={report.likelyCog ? 'yes' : 'no'} />
    </dl>
  )
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

function formatList(values: readonly number[]): string {
  return values.length === 0 ? '—' : values.join('/')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}
