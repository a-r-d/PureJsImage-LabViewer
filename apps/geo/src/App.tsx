import type {
  OpenedDatasetDescriptor,
  OpenedSourceDescriptor,
  WorkerDiagnostics,
} from '@pji-workbench/contracts'
import type {
  BandMapping,
  CatalogSourceCandidate,
  CatalogStoryPreset,
  GeoCatalogReference,
  GeoOpenFailure,
  GeoRasterLayer,
  StacBbox,
} from '@pji-workbench/domain-geo'
import {
  ATLAS_START_DEMOS,
  buildCogXrayReport,
  CATALOG_REGISTRY,
  CATALOG_STORIES,
  catalogById,
  classifyGeoOpenError,
  classifyStacClientError,
  createCatalogService,
  createGeoRasterLayer,
  createGeoRasterSource,
  formatGeoCursorReadout,
  GEO_FILE_ACCEPT,
  geoUiContributions,
  parseAtlasDeepLink,
  registerCrsDefinition,
  StacClientError,
  serializeAtlasDeepLink,
  storiesForCatalog,
} from '@pji-workbench/domain-geo'
import {
  ImagingRpcError,
  preflightRasterAsset,
  type RasterAssetPreflight,
} from '@pji-workbench/imaging'
import { Button, EmptyState, ErrorState, Icon, ThemeRoot } from '@pji-workbench/ui'
import { WorkbenchShell } from '@pji-workbench/workbench-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { CatalogPanel } from './CatalogPanel.js'
import { DemoPicker } from './DemoPicker.js'
import type { PublicEnvironment } from './environment.js'
import { GeoViewport, type GeoViewportPointer } from './GeoViewport.js'
import { InspectorPanel, type InspectorTab } from './InspectorPanel.js'
import { createGeoImagingWorkerClient } from './imaging-client.js'
import { createLocalStacCache } from './stac-storage.js'

interface OpenedRaster {
  readonly source: OpenedSourceDescriptor
  readonly dataset: OpenedDatasetDescriptor
  readonly href?: string
}

interface OpenedAtlas {
  readonly source: OpenedSourceDescriptor
  readonly dataset: OpenedDatasetDescriptor
  readonly rasters: readonly OpenedRaster[]
  readonly layers: readonly GeoRasterLayer[]
  readonly catalog?: GeoCatalogReference
  readonly presets?: readonly CatalogStoryPreset[]
}

export function App({ environment }: { readonly environment: PublicEnvironment }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const generationRef = useRef(0)
  const openAbortRef = useRef<AbortController | null>(null)
  const fileInputId = useId()
  const [client, setClient] = useState<ReturnType<typeof createGeoImagingWorkerClient> | null>(null)
  const [ready, setReady] = useState(false)
  const [opened, setOpened] = useState<OpenedAtlas | null>(null)
  const [error, setError] = useState<GeoOpenFailure | null>(null)
  const [url, setUrl] = useState('')
  const [urlOpen, setUrlOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [openingLabel, setOpeningLabel] = useState<string | undefined>()
  const [searchNonce, setSearchNonce] = useState(0)
  const [demoOpen, setDemoOpen] = useState(
    () => parseAtlasDeepLink(window.location.hash) === undefined,
  )
  const [tab, setTab] = useState<InspectorTab>('catalog')
  const [selectedLayerId, setSelectedLayerId] = useState<string | undefined>()
  const [readout, setReadout] = useState('Move the pointer over the raster')
  const [diagnostics, setDiagnostics] = useState<WorkerDiagnostics | null>(null)
  const [overview, setOverview] = useState(0)
  const [settled, setSettled] = useState(true)
  const [viewBbox, setViewBbox] = useState<StacBbox | undefined>()
  const onViewBbox = useCallback((next: StacBbox | undefined) => {
    setViewBbox((current) => {
      if (current === next) return current
      if (current === undefined || next === undefined) return next
      if (
        current[0] === next[0] &&
        current[1] === next[1] &&
        current[2] === next[2] &&
        current[3] === next[3]
      ) {
        return current
      }
      return next
    })
  }, [])
  const openedRef = useRef(opened)
  openedRef.current = opened
  const catalogServiceRef = useRef(
    createCatalogService({
      fetch,
      cache: createLocalStacCache(),
      cacheVersion: CATALOG_REGISTRY.map(
        (entry) => `${entry.id}:${entry.protocol}:${entry.cacheVersion}`,
      ).join('|'),
    }),
  )

  useEffect(() => {
    const next = createGeoImagingWorkerClient()
    let cancelled = false
    setClient(next)
    void next
      .initialize()
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof Error && error.message === 'Imaging Worker client disposed') return
        setReady(false)
      })
    return () => {
      cancelled = true
      openAbortRef.current?.abort()
      next.dispose()
      setClient(null)
    }
  }, [])

  useEffect(() => {
    for (const entry of CATALOG_REGISTRY) {
      for (const definition of entry.crsDefinitions ?? []) {
        registerCrsDefinition(definition.key, definition.proj4)
      }
    }
  }, [])

  useEffect(() => {
    if (opened === null || client === null) return
    let cancelled = false
    const tick = (): void => {
      void client.diagnostics().then((next) => {
        if (!cancelled) setDiagnostics(next)
      })
    }
    tick()
    const timer = window.setInterval(tick, 750)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [client, opened])

  const openFiles = useCallback(
    async (files: readonly File[]) => {
      const primary = files[0]
      if (client === null || primary === undefined) return
      const { generation, signal } = beginOpen(generationRef, openAbortRef)
      setOpeningLabel(primary.name)
      setBusy(true)
      setError(null)
      setReadout(`Opening ${primary.name}…`)
      let openedSource: OpenedSourceDescriptor | undefined
      let committed = false
      try {
        const source = await client.openLocal(files, primary, generation, signal)
        openedSource = source
        const summary = source.datasets[0]
        if (summary === undefined) throw new Error('The GeoTIFF does not expose a raster dataset.')
        const dataset = await client.openDataset(
          source.documentId,
          summary.id,
          generation,
          signal,
          source.sourceId,
        )
        const atlas = atlasFromOpen(source, dataset, primary.name)
        const nextDiagnostics = await client.diagnostics()
        if (signal.aborted || generationRef.current !== generation) {
          await client.closeSource(source.sourceId, source.generation).catch(() => undefined)
          return
        }
        setDiagnostics(nextDiagnostics)
        setOpened((current) => appendAtlas(current, atlas))
        committed = true
        setSelectedLayerId(`${source.sourceId}-layer`)
        setTab('xray')
        setOverview(0)
        setReadout('Move the pointer over the raster')
        clearCatalogHash()
      } catch (caught) {
        if (!committed && openedSource !== undefined) {
          await client
            .closeSource(openedSource.sourceId, openedSource.generation)
            .catch(() => undefined)
        }
        if (signal.aborted || generationRef.current !== generation) return
        const failure = asOpenFailure(caught)
        setError(failure)
        setReadout(failure.title)
      } finally {
        if (generationRef.current === generation) setBusy(false)
      }
    },
    [client],
  )

  const openRemote = useCallback(
    async (
      remoteUrl: string,
      options?: {
        readonly catalog?: GeoCatalogReference
        readonly inspect?: boolean
        readonly style?: CatalogSourceCandidate['style']
        readonly presets?: readonly CatalogStoryPreset[]
        readonly label?: string
      },
    ) => {
      if (client === null || remoteUrl.length === 0) return
      const existing = openedRef.current?.rasters.find((raster) => raster.href === remoteUrl)
      if (existing !== undefined) {
        setError(null)
        setSelectedLayerId(`${existing.source.sourceId}-layer`)
        setTab(options?.inspect === true ? 'xray' : 'layers')
        return
      }
      const { generation, signal } = beginOpen(generationRef, openAbortRef)
      setOpeningLabel(options?.label ?? remoteFileName(remoteUrl))
      setBusy(true)
      setError(null)
      setReadout(`Opening ${options?.label ?? remoteFileName(remoteUrl)}…`)
      let openedSource: OpenedSourceDescriptor | undefined
      let committed = false
      try {
        const source = await client.openRemote(remoteUrl, generation, signal)
        openedSource = source
        const summary = source.datasets[0]
        if (summary === undefined) throw new Error('The GeoTIFF does not expose a raster dataset.')
        const dataset = await client.openDataset(
          source.documentId,
          summary.id,
          generation,
          signal,
          source.sourceId,
        )
        const nextDiagnostics = await client.diagnostics()
        if (signal.aborted || generationRef.current !== generation) {
          await client.closeSource(source.sourceId, source.generation).catch(() => undefined)
          return
        }
        setDiagnostics(nextDiagnostics)
        setUrlOpen(false)
        const openedAtlas = atlasFromOpen(source, dataset, options?.label ?? source.source.name, {
          href: remoteUrl,
          ...(options?.catalog === undefined ? {} : { catalog: options.catalog }),
          ...(options?.style === undefined ? {} : { style: options.style }),
          ...(options?.presets === undefined ? {} : { presets: options.presets }),
        })
        setOpened((current) => appendAtlas(current, openedAtlas))
        committed = true
        setSelectedLayerId(`${source.sourceId}-layer`)
        setTab(options?.inspect === true || options?.catalog === undefined ? 'xray' : 'layers')
        setOverview(0)
        setReadout('Move the pointer over the raster')
        if (options?.catalog !== undefined) {
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${serializeAtlasDeepLink({
              catalogId: options.catalog.catalogId,
              collectionId: options.catalog.collectionId,
              itemId: options.catalog.itemId,
              assetKey: options.catalog.assetKey,
              href: options.catalog.href,
              ...(options.catalog.sourceUrl === undefined
                ? {}
                : { sourceUrl: options.catalog.sourceUrl }),
              ...(options.inspect === true ? { inspect: true } : {}),
            })}`,
          )
        } else {
          clearCatalogHash()
        }
      } catch (caught) {
        if (!committed && openedSource !== undefined) {
          await client
            .closeSource(openedSource.sourceId, openedSource.generation)
            .catch(() => undefined)
        }
        if (signal.aborted || generationRef.current !== generation) return
        const failure = asOpenFailure(caught)
        setError(failure)
        setReadout(failure.title)
      } finally {
        if (generationRef.current === generation) setBusy(false)
      }
    },
    [client],
  )

  const openCatalogAsset = useCallback(
    (
      candidate: CatalogSourceCandidate,
      inspect: boolean,
      verifiedReport?: RasterAssetPreflight,
    ) => {
      const presets = storiesForCatalog(candidate.catalogId)
        .flatMap((story) => story.presets ?? [])
        .filter((preset) => {
          const required = maxBandIndex(preset.style.mapping)
          return candidate.bandCount === undefined ? required === 0 : required < candidate.bandCount
        })
      void (async () => {
        const probe =
          verifiedReport ??
          (await preflightRasterAsset(candidate.href, { fetch, stage: 'decoder-ready' }))
        if (probe.compatibility !== 'ready') {
          setBusy(false)
          setError({
            kind:
              probe.compatibility === 'metadata-only'
                ? 'metadata-only'
                : probe.compatibility === 'unsupported-scheme'
                  ? 'unsupported-scheme'
                  : probe.compatibility === 'browser-network-blocked'
                    ? 'browser-network-blocked'
                    : probe.compatibility === 'cors'
                      ? 'cors'
                      : probe.compatibility === 'no-range'
                        ? 'range'
                        : 'unsupported',
            title: probe.title,
            message: probe.message,
            ...(probe.guidance === undefined ? {} : { guidance: probe.guidance }),
          })
          return
        }
        if (new URL(probe.href).href !== new URL(candidate.href).href) {
          setError({
            kind: 'unsupported',
            title: 'Stale raster verification',
            message: 'The verified raster does not match the selected catalog asset.',
          })
          return
        }
        openRemote(candidate.href, {
          catalog: candidate,
          inspect,
          ...(candidate.style === undefined ? {} : { style: candidate.style }),
          ...(presets.length === 0 ? {} : { presets }),
          label: candidate.label,
        })
      })()
    },
    [openRemote],
  )

  const openStartDemo = useCallback(
    (demoId: string) => {
      const demo = ATLAS_START_DEMOS.find((entry) => entry.id === demoId)
      if (demo === undefined) return
      const entry = catalogById(demo.identity.catalogId)
      if (entry === undefined) {
        setError({
          kind: 'catalog-unavailable',
          title: 'Demo catalog missing',
          message: `No registry entry for ${demo.identity.catalogId}.`,
        })
        return
      }
      setDemoOpen(false)
      setOpeningLabel(demo.title)
      setBusy(true)
      setError(null)
      void (async () => {
        try {
          const candidate = await catalogServiceRef.current.resolveDeepLink(entry, demo.identity)
          if (candidate === undefined) {
            setBusy(false)
            setError({
              kind: 'catalog-unavailable',
              title: 'Demo item not found',
              message: `${demo.title} is no longer in the catalog. Search from the Catalog panel instead.`,
            })
            return
          }
          openCatalogAsset({ ...candidate, style: demo.style }, demo.inspect === true)
        } catch (caught) {
          setBusy(false)
          setError(asOpenFailure(caught))
        }
      })()
    },
    [openCatalogAsset],
  )

  useEffect(() => {
    if (!ready || client === null) return
    let cancelled = false
    let hashAbort: AbortController | null = null
    const openFromHash = (): void => {
      const link = parseAtlasDeepLink(window.location.hash)
      if (link === undefined) return
      const entry = catalogById(link.catalogId)
      if (entry === undefined) return
      hashAbort?.abort()
      const controller = new AbortController()
      hashAbort = controller
      void (async () => {
        try {
          const candidate = await catalogServiceRef.current.resolveDeepLink(
            entry,
            link,
            controller.signal,
          )
          if (cancelled || controller.signal.aborted || candidate === undefined) return
          openCatalogAsset(candidate, link.inspect === true)
        } catch (caught) {
          if (!cancelled && !controller.signal.aborted) setError(asOpenFailure(caught))
        }
      })()
    }
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => {
      cancelled = true
      hashAbort?.abort()
      window.removeEventListener('hashchange', openFromHash)
    }
  }, [client, openCatalogAsset, ready])

  const onPointer = useCallback(
    (sample: GeoViewportPointer | undefined) => {
      if (sample === undefined || opened === null) {
        setReadout('Move the pointer over the raster')
        return
      }
      const raster = selectedRaster(opened, selectedLayerId)
      setReadout(
        formatGeoCursorReadout({
          pixel: sample.pixel,
          world: sample.world,
          crs: raster.dataset.dataset.spatialReference?.crs ?? { kind: 'unknown' },
          bands: sample.bands,
        }),
      )
    },
    [opened, selectedLayerId],
  )

  const viewportRasters = useMemo(
    () => opened?.rasters.map((raster) => raster.dataset) ?? [],
    [opened?.rasters],
  )

  const inspected = opened === null ? undefined : selectedRaster(opened, selectedLayerId)
  const xray =
    inspected === undefined || diagnostics === null
      ? undefined
      : buildCogXrayReport({
          source: inspected.source,
          dataset: inspected.dataset.dataset,
          diagnostics,
          activeOverview: overview,
        })

  return (
    <ThemeRoot className="workbench-theme" theme="dark">
      <WorkbenchShell
        analysisSettled={!busy}
        environment={environment.appEnvironment}
        rootRef={rootRef}
        style={{}}
        workbenchReady={ready}
      >
        <header className="app-bar">
          <div className="app-identity">
            <span className="app-mark" aria-hidden="true">
              A
            </span>
            <div>
              <h1>{geoUiContributions.shellHeading}</h1>
              <span>{geoUiContributions.emptyState.kicker}</span>
            </div>
          </div>
          <div className="geo-toolbar">
            <input
              accept={GEO_FILE_ACCEPT}
              className="visually-hidden"
              id={fileInputId}
              onChange={(event) => {
                const files = [...(event.currentTarget.files ?? [])]
                event.currentTarget.value = ''
                void openFiles(files)
              }}
              ref={fileInputRef}
              type="file"
            />
            <Button onClick={() => fileInputRef.current?.click()} variant="primary">
              <Icon name="open" size={16} />
              Open GeoTIFF
            </Button>
            <Button onClick={() => setUrlOpen((value) => !value)}>
              <Icon name="link" size={16} />
              Open URL
            </Button>
            <Button
              disabled={opened?.catalog === undefined}
              onClick={() => {
                if (opened?.catalog === undefined) return
                const hash = serializeAtlasDeepLink(opened.catalog)
                void navigator.clipboard.writeText(
                  `${window.location.origin}${window.location.pathname}${hash}`,
                )
              }}
            >
              <Icon name="link" size={16} />
              Copy catalog link
            </Button>
            <Button onClick={() => setDemoOpen(true)}>
              <Icon name="examples" size={16} />
              Demos
            </Button>
            <Button onClick={() => setTab('catalog')}>
              <Icon name="search" size={16} />
              Catalog
            </Button>
          </div>
          {urlOpen ? (
            <form
              className="geo-url-bar"
              onSubmit={(event) => {
                event.preventDefault()
                void openRemote(url.trim())
              }}
            >
              <label>
                HTTPS COG URL
                <input
                  autoComplete="off"
                  onChange={(event) => setUrl(event.currentTarget.value)}
                  placeholder="https://example.com/scene.tif"
                  spellCheck={false}
                  type="url"
                  value={url}
                />
              </label>
              <Button type="submit" variant="primary">
                Load
              </Button>
            </form>
          ) : null}
        </header>
        <main
          className="geo-main geo-main--split"
          data-atlas-settled={opened !== null && settled && !busy ? 'true' : 'false'}
        >
          {client === null || !ready ? (
            <EmptyState
              description="The catalog stays available. You can search while the Worker starts."
              title="Starting imaging Worker…"
            />
          ) : opened !== null ? (
            <div className="geo-viewport-stack">
              {busy ? (
                <div className="geo-opening-banner" data-testid="geo-opening" role="status">
                  <span>{`Opening ${openingLabel ?? 'Cloud Optimized GeoTIFF'}… Range-only fetch.`}</span>
                  <Button onClick={() => openAbortRef.current?.abort()}>Cancel</Button>
                </div>
              ) : null}
              <GeoViewport
                key={opened.rasters.map((raster) => raster.source.sourceId).join('|')}
                client={client}
                layers={opened.layers}
                onOverview={setOverview}
                onPointer={onPointer}
                onSettled={setSettled}
                onViewBbox={onViewBbox}
                rasters={viewportRasters}
              />
            </div>
          ) : busy ? (
            <div className="geo-opening" data-testid="geo-opening" role="status">
              <EmptyState
                action={
                  <Button onClick={() => openAbortRef.current?.abort()} variant="primary">
                    Cancel
                  </Button>
                }
                description="Fetching only the HTTP ranges needed for this view. Tiles appear as soon as the first overview is ready."
                title={`Opening ${openingLabel ?? 'Cloud Optimized GeoTIFF'}…`}
              />
            </div>
          ) : (
            <EmptyState
              action={
                <div className="geo-empty-actions">
                  <Button onClick={() => setDemoOpen(true)} variant="primary">
                    Choose a demo
                  </Button>
                  <Button
                    onClick={() => {
                      setTab('catalog')
                      setSearchNonce((value) => value + 1)
                    }}
                  >
                    Search {CATALOG_REGISTRY[0]?.title ?? 'the catalog'}
                  </Button>
                </div>
              }
              description={geoUiContributions.emptyState.body}
              title={geoUiContributions.emptyState.heading}
            />
          )}
          <InspectorPanel
            bandCount={inspected?.dataset.dataset.components.length ?? 0}
            catalog={
              <CatalogPanel
                busy={busy || !ready}
                catalogs={CATALOG_REGISTRY}
                onOpen={openCatalogAsset}
                onPreflight={(href, signal, stage) =>
                  preflightRasterAsset(href, { fetch, signal, stage })
                }
                searchNonce={searchNonce}
                service={catalogServiceRef.current}
                stories={CATALOG_STORIES}
                {...(viewBbox === undefined ? {} : { viewBbox })}
              />
            }
            layers={opened?.layers ?? []}
            onDuplicateLayer={() =>
              setOpened((current) => (current === null ? current : duplicateLayer(current)))
            }
            onLayerChange={(id, patch) =>
              setOpened((current) => (current === null ? current : patchLayer(current, id, patch)))
            }
            onMoveLayer={(id, direction) =>
              setOpened((current) =>
                current === null ? current : moveLayer(current, id, direction),
              )
            }
            onSelectLayer={setSelectedLayerId}
            onTab={setTab}
            {...(opened?.presets === undefined ? {} : { presets: opened.presets })}
            {...(opened?.catalog === undefined ? {} : { provenance: opened.catalog })}
            selectedLayerId={selectedLayerId}
            tab={tab}
            xray={xray}
          />
        </main>
        {error !== null ? (
          <div className="geo-error" data-testid="open-error">
            <ErrorState
              message={`${error.message}${error.guidance === undefined ? '' : ` ${error.guidance}`}`}
              title={error.title}
            />
          </div>
        ) : null}
        <footer className="status-bar">
          <span className="status-dot" aria-hidden="true" />
          <span data-testid="cursor-readout">{readout}</span>
          <span className="status-spacer" />
          <span>
            {busy
              ? `Opening ${openingLabel ?? 'GeoTIFF'}…`
              : xray === undefined
                ? geoUiContributions.emptyState.kicker
                : `${xray.rangeRequests} ranges · ${xray.percentFetched?.toFixed(1) ?? '0'}% fetched`}
          </span>
        </footer>
      </WorkbenchShell>
      {demoOpen ? (
        <DemoPicker
          demos={ATLAS_START_DEMOS}
          disabled={!ready || client === null || busy}
          onClose={() => setDemoOpen(false)}
          onOpen={openStartDemo}
        />
      ) : null}
    </ThemeRoot>
  )
}

function clearCatalogHash(): void {
  if (parseAtlasDeepLink(window.location.hash) === undefined) return
  window.history.replaceState(null, '', window.location.pathname)
}

function maxBandIndex(mapping: BandMapping): number {
  const values = [mapping.gray, mapping.red, mapping.green, mapping.blue].filter(
    (value): value is number => typeof value === 'number',
  )
  return values.length === 0 ? 0 : Math.max(...values)
}

function beginOpen(
  generationRef: { current: number },
  openAbortRef: { current: AbortController | null },
): { generation: number; signal: AbortSignal } {
  openAbortRef.current?.abort()
  const controller = new AbortController()
  openAbortRef.current = controller
  generationRef.current += 1
  return { generation: generationRef.current, signal: controller.signal }
}

function atlasFromOpen(
  source: OpenedSourceDescriptor,
  dataset: OpenedDatasetDescriptor,
  label: string,
  options?: {
    readonly catalog?: GeoCatalogReference
    readonly style?: CatalogSourceCandidate['style']
    readonly presets?: readonly CatalogStoryPreset[]
    readonly href?: string
  },
): OpenedAtlas {
  const spatial = dataset.dataset.spatialReference
  if (spatial?.pixelToModel === undefined) {
    throw Object.assign(new Error('This GeoTIFF has no pixel-to-model affine.'), {
      code: 'MALFORMED_METADATA',
      retryable: false,
      guidance: 'Native-CRS rendering requires a six-parameter affine.',
    })
  }
  const raster = createGeoRasterSource({
    id: source.sourceId,
    label,
    width: dataset.dataset.axes.find((axis) => axis.id === 'x')?.length ?? 1,
    height: dataset.dataset.axes.find((axis) => axis.id === 'y')?.length ?? 1,
    componentCount: Math.max(1, dataset.dataset.components.length),
    spatialReference: spatial,
    ...(options?.catalog === undefined ? {} : { catalog: options.catalog }),
  })
  const rgb = dataset.dataset.components.length >= 3
  const layer = createGeoRasterLayer({
    id: `${source.sourceId}-layer`,
    sourceId: raster.id,
    label,
    zIndex: 0,
    style: options?.style ?? {
      mapping: rgb ? { red: 0, green: 1, blue: 2 } : { gray: 0 },
      stretch: 'minmax',
      nodataTransparent: true,
    },
  })
  return {
    source,
    dataset,
    rasters: [
      {
        source,
        dataset,
        ...(options?.href === undefined ? {} : { href: options.href }),
      },
    ],
    layers: [layer],
    ...(options?.catalog === undefined ? {} : { catalog: options.catalog }),
    ...(options?.presets === undefined ? {} : { presets: options.presets }),
  }
}

function appendAtlas(current: OpenedAtlas | null, next: OpenedAtlas): OpenedAtlas {
  if (current === null) return next
  const zBase = current.layers.reduce((max, layer) => Math.max(max, layer.zIndex), -1)
  return {
    source: next.source,
    dataset: next.dataset,
    rasters: [...current.rasters, ...next.rasters],
    layers: [
      ...current.layers,
      ...next.layers.map((layer, index) =>
        createGeoRasterLayer({
          id: layer.id,
          sourceId: layer.sourceId,
          label: layer.label,
          zIndex: zBase + 1 + index,
          visible: layer.visible,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          style: layer.style,
        }),
      ),
    ],
    ...(next.catalog === undefined
      ? current.catalog === undefined
        ? {}
        : { catalog: current.catalog }
      : { catalog: next.catalog }),
    ...(next.presets === undefined
      ? current.presets === undefined
        ? {}
        : { presets: current.presets }
      : { presets: next.presets }),
  }
}

function selectedRaster(opened: OpenedAtlas, selectedLayerId: string | undefined): OpenedRaster {
  const layer = opened.layers.find((item) => item.id === selectedLayerId) ?? opened.layers[0]
  return (
    opened.rasters.find((raster) => String(raster.source.sourceId) === String(layer?.sourceId)) ??
    opened.rasters[0] ?? { source: opened.source, dataset: opened.dataset }
  )
}

function patchLayer(opened: OpenedAtlas, id: string, patch: Partial<GeoRasterLayer>): OpenedAtlas {
  return {
    ...opened,
    layers: opened.layers.map((layer) =>
      layer.id === id
        ? createGeoRasterLayer({
            id: layer.id,
            sourceId: layer.sourceId,
            label: patch.label ?? layer.label,
            visible: patch.visible ?? layer.visible,
            opacity: patch.opacity ?? layer.opacity,
            blendMode: patch.blendMode ?? layer.blendMode,
            zIndex: patch.zIndex ?? layer.zIndex,
            style: patch.style ?? layer.style,
          })
        : layer,
    ),
  }
}

function duplicateLayer(opened: OpenedAtlas): OpenedAtlas {
  const last = opened.layers.at(-1)
  if (last === undefined) return opened
  const copy = createGeoRasterLayer({
    id: `${last.id}-copy-${opened.layers.length}`,
    sourceId: last.sourceId,
    label: `${last.label} copy`,
    zIndex: last.zIndex + 1,
    opacity: last.opacity,
    style: last.style,
  })
  return { ...opened, layers: [...opened.layers, copy] }
}

function moveLayer(opened: OpenedAtlas, id: string, direction: -1 | 1): OpenedAtlas {
  const ordered = [...opened.layers].sort((left, right) => left.zIndex - right.zIndex)
  const index = ordered.findIndex((layer) => layer.id === id)
  const swap = ordered[index + direction]
  const current = ordered[index]
  if (current === undefined || swap === undefined) return opened
  return {
    ...opened,
    layers: opened.layers.map((layer) => {
      if (layer.id === current.id) return { ...layer, zIndex: swap.zIndex }
      if (layer.id === swap.id) return { ...layer, zIndex: current.zIndex }
      return layer
    }),
  }
}

function remoteFileName(remoteUrl: string): string {
  try {
    const name = new URL(remoteUrl).pathname.split('/').filter(Boolean).at(-1)
    return name === undefined || name.length === 0 ? remoteUrl : decodeURIComponent(name)
  } catch {
    return remoteUrl
  }
}

function asOpenFailure(error: unknown): GeoOpenFailure {
  if (error instanceof StacClientError) return classifyStacClientError(error)
  if (error instanceof ImagingRpcError) return classifyGeoOpenError(error.detail)
  if (error instanceof Error && hasMalformedMetadataCode(error)) {
    return classifyGeoOpenError({
      code: 'MALFORMED_METADATA',
      message: error.message,
      retryable: false,
      ...(typeof error.guidance === 'string' ? { guidance: error.guidance } : {}),
    })
  }
  return {
    kind: 'other',
    title: 'Could not open this source',
    message: error instanceof Error ? error.message : 'Unknown error',
  }
}

function hasMalformedMetadataCode(
  error: Error,
): error is Error & { readonly code: 'MALFORMED_METADATA'; readonly guidance?: string } {
  const candidate: object = error
  return (
    'code' in candidate &&
    candidate.code === 'MALFORMED_METADATA' &&
    (!('guidance' in candidate) ||
      candidate.guidance === undefined ||
      typeof candidate.guidance === 'string')
  )
}
