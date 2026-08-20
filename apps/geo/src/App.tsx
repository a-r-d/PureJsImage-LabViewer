import type { SourceId, WorkerDiagnostics } from '@pji-workbench/contracts'
import type {
  CatalogSearchPage,
  CatalogService,
  CatalogSourceCandidate,
  GeoRasterLayer,
  StacBbox,
} from '@pji-workbench/domain-geo'
import {
  ATLAS_START_DEMOS,
  buildCogXrayReport,
  CATALOG_REGISTRY,
  catalogById,
  createCatalogService,
  displayPresetsForCandidate,
  formatGeoCursorReadout,
  GEO_FILE_ACCEPT,
  geoUiContributions,
  parseAtlasDeepLink,
  registerCrsDefinition,
  serializeAtlasDeepLink,
} from '@pji-workbench/domain-geo'
import { GeoWorkbenchController, GeoWorkflowRunner } from '@pji-workbench/geo-workbench'
import { preflightRasterAsset, type RasterAssetPreflight } from '@pji-workbench/imaging'
import { Button, EmptyState, ErrorState, Icon, ThemeRoot } from '@pji-workbench/ui'
import { WorkbenchShell } from '@pji-workbench/workbench-react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { CatalogPanel } from './CatalogPanel.js'
import { DemoPicker } from './DemoPicker.js'
import type { PublicEnvironment } from './environment.js'
import { GeoViewport, type GeoViewportPointer } from './GeoViewport.js'
import { InspectorPanel, type InspectorTab } from './InspectorPanel.js'
import { createGeoImagingWorkerClient } from './imaging-client.js'
import { createLocalStacCache } from './stac-storage.js'
import { WorkflowBrowser } from './WorkflowBrowser.js'

export function App({ environment }: { readonly environment: PublicEnvironment }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileInputId = useId()
  const openAbortRef = useRef<AbortController | null>(null)
  const verifiedPreflightsRef = useRef(new Map<string, RasterAssetPreflight>())
  const runtimeRef = useRef<ReturnType<typeof createGeoImagingWorkerClient> | null>(null)
  if (runtimeRef.current === null) runtimeRef.current = createGeoImagingWorkerClient()
  const runtime = runtimeRef.current
  const rawCatalogServiceRef = useRef<CatalogService | null>(null)
  if (rawCatalogServiceRef.current === null) {
    rawCatalogServiceRef.current = createCatalogService({
      fetch,
      cache: createLocalStacCache(),
      cacheVersion: CATALOG_REGISTRY.map(
        (entry) => `${entry.id}:${entry.protocol}:${entry.cacheVersion}`,
      ).join('|'),
    })
  }
  const rawCatalogService = rawCatalogServiceRef.current
  const controllerRef = useRef<GeoWorkbenchController | null>(null)
  if (controllerRef.current === null) {
    controllerRef.current = new GeoWorkbenchController({
      runtime,
      catalogService: rawCatalogService,
      preflightCatalogAsset: async (candidate, signal) => {
        const cached = verifiedPreflightsRef.current.get(new URL(candidate.href).href)
        if (cached?.compatibility === 'ready') return
        const report = await preflightRasterAsset(candidate.href, {
          fetch,
          ...(signal === undefined ? {} : { signal }),
          stage: 'decoder-ready',
        })
        if (report.compatibility !== 'ready') throw new Error(report.message)
        verifiedPreflightsRef.current.set(new URL(candidate.href).href, report)
      },
    })
  }
  const controller = controllerRef.current
  const workflowRunnerRef = useRef<GeoWorkflowRunner | null>(null)
  if (workflowRunnerRef.current === null)
    workflowRunnerRef.current = new GeoWorkflowRunner(controller)
  const workflowRunner = workflowRunnerRef.current
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  )
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const subscribeWorkflow = useCallback(
    (listener: () => void) => workflowRunner.subscribe(listener),
    [workflowRunner],
  )
  const getWorkflowSnapshot = useCallback(() => workflowRunner.getSnapshot(), [workflowRunner])
  const workflowSnapshot = useSyncExternalStore(
    subscribeWorkflow,
    getWorkflowSnapshot,
    getWorkflowSnapshot,
  )

  const [ready, setReady] = useState(false)
  const [url, setUrl] = useState('')
  const [urlOpen, setUrlOpen] = useState(false)
  const [searchNonce, setSearchNonce] = useState(0)
  const [demoOpen, setDemoOpen] = useState(
    () => parseAtlasDeepLink(window.location.hash) === undefined,
  )
  const [tab, setTab] = useState<InspectorTab>('workflows')
  const [readout, setReadout] = useState('Move the pointer over the raster')
  const [diagnostics, setDiagnostics] = useState<WorkerDiagnostics | null>(null)
  const [settled, setSettled] = useState(true)
  const [viewBbox, setViewBbox] = useState<StacBbox | undefined>()
  const [blinkInterval, setBlinkInterval] = useState(750)

  const semanticCatalogService = useMemo(
    () => createSemanticCatalogService(controller, rawCatalogService),
    [controller, rawCatalogService],
  )
  const busy = snapshot.task.kind !== 'idle'
  const selectedBinding = controller.bindingForLayer(snapshot.selectedLayerId)
  const selectedSource = snapshot.project.sources.find(({ id }) => id === snapshot.selectedSourceId)
  const rasterLayers = useMemo(
    () =>
      snapshot.project.layers.filter((layer): layer is GeoRasterLayer => layer.kind === 'raster'),
    [snapshot.project.layers],
  )
  const comparisonPair = rasterLayers.filter(({ visible }) => visible).slice(0, 2)
  const viewportRasters = useMemo(() => {
    const bindings = new Map(
      controller.runtimeBindings().map((binding) => [binding.semanticSourceId, binding]),
    )
    return snapshot.project.sources.flatMap((source) => {
      const binding = bindings.get(source.id)
      return binding === undefined
        ? []
        : [{ ...binding.dataset, sourceId: binding.semanticSourceId as unknown as SourceId }]
    })
  }, [controller, snapshot.project.sources])
  const onOverview = useCallback(
    (sourceId: string, level: number) => {
      controller.setActiveOverview(sourceId, level)
    },
    [controller],
  )

  useEffect(() => {
    let cancelled = false
    void runtime
      .initialize()
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch(() => {
        if (!cancelled) setReady(false)
      })
    return () => {
      cancelled = true
      openAbortRef.current?.abort()
      void controller.dispose()
    }
  }, [controller, runtime])

  useEffect(() => {
    for (const entry of CATALOG_REGISTRY) {
      for (const definition of entry.crsDefinitions ?? []) {
        registerCrsDefinition(definition.key, definition.proj4)
      }
    }
  }, [])

  useEffect(() => {
    if (snapshot.project.sources.length === 0) return
    let cancelled = false
    const tick = (): void => {
      void runtime.diagnostics().then((next) => {
        if (!cancelled) setDiagnostics(next)
      })
    }
    tick()
    const timer = window.setInterval(tick, 750)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [runtime, snapshot.project.sources.length])

  const onViewBbox = useCallback((next: StacBbox | undefined) => {
    setViewBbox((current) => (sameBbox(current, next) ? current : next))
  }, [])

  const executeOpen = useCallback(
    async (action: 'geo.source.open_local_resource' | 'geo.source.open_remote', input: unknown) => {
      openAbortRef.current?.abort()
      const abort = new AbortController()
      openAbortRef.current = abort
      try {
        await controller.executeAction(action, input, abort.signal)
        setUrlOpen(false)
        setTab('xray')
        setReadout('Move the pointer over the raster')
      } catch {
        // The controller publishes a typed error snapshot for the shared UI.
      }
    },
    [controller],
  )

  const openFiles = useCallback(
    async (files: readonly File[]) => {
      const primary = files[0]
      if (!ready || primary === undefined) return
      const resourceId = controller.registerLocalResource(files, primary)
      clearCatalogHash()
      await executeOpen('geo.source.open_local_resource', { resourceId })
    },
    [controller, executeOpen, ready],
  )

  const openRemote = useCallback(
    async (remoteUrl: string) => {
      if (!ready || remoteUrl.length === 0) return
      clearCatalogHash()
      await executeOpen('geo.source.open_remote', { url: remoteUrl })
    },
    [executeOpen, ready],
  )

  const openCatalogAsset = useCallback(
    (
      candidate: CatalogSourceCandidate,
      inspect: boolean,
      verifiedReport?: RasterAssetPreflight,
    ) => {
      if (verifiedReport?.compatibility === 'ready') {
        verifiedPreflightsRef.current.set(new URL(candidate.href).href, verifiedReport)
      }
      const presets = displayPresetsForCandidate(candidate)
      openAbortRef.current?.abort()
      const abort = new AbortController()
      openAbortRef.current = abort
      void controller
        .executeAction('geo.source.open_catalog_asset', { candidate, presets }, abort.signal)
        .then(() => {
          setTab(inspect ? 'xray' : 'layers')
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${serializeAtlasDeepLink({
              catalogId: candidate.catalogId,
              collectionId: candidate.collectionId,
              itemId: candidate.itemId,
              assetKey: candidate.assetKey,
              href: candidate.href,
              ...(candidate.sourceUrl === undefined ? {} : { sourceUrl: candidate.sourceUrl }),
              ...(inspect ? { inspect: true } : {}),
            })}`,
          )
        })
        .catch(() => undefined)
    },
    [controller],
  )

  const openStartDemo = useCallback(
    (demoId: string) => {
      const demo = ATLAS_START_DEMOS.find(({ id }) => id === demoId)
      const entry = demo === undefined ? undefined : catalogById(demo.identity.catalogId)
      if (demo === undefined || entry === undefined) return
      setDemoOpen(false)
      void semanticCatalogService.resolveDeepLink(entry, demo.identity).then((candidate) => {
        if (candidate !== undefined) {
          openCatalogAsset({ ...candidate, style: demo.style }, demo.inspect === true)
        }
      })
    },
    [openCatalogAsset, semanticCatalogService],
  )

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    let abort: AbortController | undefined
    const openFromHash = (): void => {
      const link = parseAtlasDeepLink(window.location.hash)
      const entry = link === undefined ? undefined : catalogById(link.catalogId)
      if (link === undefined || entry === undefined) return
      abort?.abort()
      abort = new AbortController()
      void semanticCatalogService.resolveDeepLink(entry, link, abort.signal).then((candidate) => {
        if (!cancelled && !abort?.signal.aborted && candidate !== undefined) {
          openCatalogAsset(candidate, link.inspect === true)
        }
      })
    }
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => {
      cancelled = true
      abort?.abort()
      window.removeEventListener('hashchange', openFromHash)
    }
  }, [openCatalogAsset, ready, semanticCatalogService])

  const onPointer = useCallback(
    (sample: GeoViewportPointer | undefined) => {
      if (sample === undefined) {
        setReadout('Move the pointer over the raster')
        return
      }
      const sampledBinding = controller.bindingForSource(sample.sourceId)
      setReadout(
        formatGeoCursorReadout({
          pixel: sample.pixel,
          world: sample.projectMapCoordinate,
          crs: sampledBinding?.dataset.dataset.spatialReference?.crs ?? { kind: 'unknown' },
          bands: sample.bands,
        }),
      )
    },
    [controller],
  )

  const onComparisonChange = useCallback(
    (next: typeof snapshot.project.comparison) => {
      const input = next.mode === 'single' ? {} : next
      void controller.executeAction(`geo.comparison.set_${next.mode}`, input).catch(() => undefined)
    },
    [controller],
  )

  const xray =
    selectedBinding === undefined || diagnostics === null
      ? undefined
      : buildCogXrayReport({
          source: selectedBinding.source,
          dataset: selectedBinding.dataset.dataset,
          diagnostics,
          activeOverview: selectedBinding.activeOverview,
        })

  const invoke = useCallback(
    (id: Parameters<GeoWorkbenchController['executeAction']>[0], input: unknown) => {
      void controller.executeAction(id, input).catch(() => undefined)
    },
    [controller],
  )

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
              disabled={selectedSource?.catalog === undefined}
              onClick={() => {
                if (selectedSource?.catalog === undefined) return
                const hash = serializeAtlasDeepLink(selectedSource.catalog)
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
            {comparisonPair.length === 2 ? (
              <fieldset className="geo-compare-controls">
                <legend className="visually-hidden">Compare visible layers</legend>
                <Button onClick={() => onComparisonChange({ mode: 'single' })}>Single</Button>
                <Button
                  onClick={() =>
                    onComparisonChange({
                      mode: 'overlay',
                      overlayLayerIds: comparisonPair.map(({ id }) => id),
                    })
                  }
                >
                  Overlay
                </Button>
                <Button
                  onClick={() => {
                    const [left, right] = comparisonPair
                    if (left === undefined || right === undefined) return
                    onComparisonChange({
                      mode: 'swipe',
                      leftLayerId: left.id,
                      rightLayerId: right.id,
                      swipePosition: 0.5,
                    })
                  }}
                >
                  Swipe
                </Button>
                <Button
                  onClick={() => {
                    const [first, second] = comparisonPair
                    if (first === undefined || second === undefined) return
                    onComparisonChange({
                      mode: 'blink',
                      firstLayerId: first.id,
                      secondLayerId: second.id,
                      intervalMilliseconds: blinkInterval,
                    })
                  }}
                >
                  Blink
                </Button>
                <label>
                  Blink interval
                  <select
                    aria-label="Blink interval"
                    onChange={(event) => setBlinkInterval(Number(event.currentTarget.value))}
                    value={blinkInterval}
                  >
                    <option value={250}>0.25 s</option>
                    <option value={500}>0.5 s</option>
                    <option value={750}>0.75 s</option>
                    <option value={1000}>1 s</option>
                    <option value={2000}>2 s</option>
                  </select>
                </label>
              </fieldset>
            ) : null}
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
          data-atlas-settled={
            snapshot.project.sources.length > 0 && settled && !busy ? 'true' : 'false'
          }
        >
          {!ready ? (
            <EmptyState
              description="The catalog stays available. You can search while the Worker starts."
              title="Starting imaging Worker…"
            />
          ) : viewportRasters.length > 0 ? (
            <div className="geo-viewport-stack">
              {busy ? (
                <div className="geo-opening-banner" data-testid="geo-opening" role="status">
                  <span>{`Opening ${snapshot.task.label ?? 'GeoTIFF'}… Range-only fetch.`}</span>
                  <Button onClick={() => openAbortRef.current?.abort()}>Cancel</Button>
                </div>
              ) : null}
              <GeoViewport
                key={controller
                  .runtimeBindings()
                  .map(({ semanticSourceId }) => semanticSourceId)
                  .join('|')}
                client={runtime}
                comparison={snapshot.project.comparison}
                layers={snapshot.project.layers}
                onComparisonChange={onComparisonChange}
                onOverview={onOverview}
                onPointer={onPointer}
                onSettled={setSettled}
                onViewBbox={onViewBbox}
                rasters={viewportRasters}
                sources={snapshot.project.sources}
                {...(snapshot.selectedLayerId === undefined
                  ? {}
                  : { selectedLayerId: snapshot.selectedLayerId })}
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
                description="Fetching only the HTTP ranges needed for this view."
                title={`Opening ${snapshot.task.label ?? 'GeoTIFF'}…`}
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
            bandCount={selectedSource?.componentCount ?? 0}
            catalog={
              <CatalogPanel
                busy={busy || !ready}
                catalogs={CATALOG_REGISTRY}
                onOpen={openCatalogAsset}
                onPreflight={async (href, signal, stage) => {
                  const report = await preflightRasterAsset(href, { fetch, signal, stage })
                  if (report.compatibility === 'ready') {
                    verifiedPreflightsRef.current.set(new URL(href).href, report)
                  }
                  return report
                }}
                searchNonce={searchNonce}
                service={semanticCatalogService}
                {...(viewBbox === undefined ? {} : { viewBbox })}
              />
            }
            workflows={
              <WorkflowBrowser
                disabled={!ready || busy}
                onCompleted={(run) =>
                  setTab(run.workflowId === 'cog-anatomy' ? 'xray' : 'workflows')
                }
                runner={workflowRunner}
                snapshot={workflowSnapshot}
              />
            }
            layers={rasterLayers}
            onCloseSource={(sourceId) =>
              invoke('geo.source.close', { sourceId, dependentLayers: 'remove' })
            }
            onDuplicateLayer={() => {
              if (snapshot.selectedLayerId !== undefined) {
                invoke('geo.layer.duplicate', { layerId: snapshot.selectedLayerId })
              }
            }}
            onLayerChange={(layerId, patch) => {
              if (patch.style !== undefined)
                invoke('geo.layer.set_style', { layerId, style: patch.style })
              if (patch.visible !== undefined)
                invoke('geo.layer.set_visibility', { layerId, visible: patch.visible })
              if (patch.opacity !== undefined)
                invoke('geo.layer.set_opacity', { layerId, opacity: patch.opacity })
            }}
            onMoveLayer={(layerId, direction) =>
              invoke('geo.layer.set_order', { layerId, direction })
            }
            onSelectLayer={(layerId) => invoke('geo.layer.select', { layerId })}
            onTab={setTab}
            {...(selectedBinding?.presets.length ? { presets: selectedBinding.presets } : {})}
            {...(selectedSource?.catalog === undefined
              ? {}
              : { provenance: selectedSource.catalog })}
            selectedLayerId={snapshot.selectedLayerId}
            sources={snapshot.project.sources}
            tab={tab}
            xray={xray}
          />
        </main>
        {snapshot.error === undefined ? null : (
          <div className="geo-error" data-testid="open-error">
            <ErrorState message={snapshot.error.message} title={errorTitle(snapshot.error.code)} />
          </div>
        )}
        <footer className="status-bar">
          <span className="status-dot" aria-hidden="true" />
          <span data-testid="cursor-readout">{readout}</span>
          <span className="status-spacer" />
          <span>
            {busy
              ? `Opening ${snapshot.task.label ?? 'GeoTIFF'}…`
              : xray === undefined
                ? `${snapshot.project.sources.length}/32 sources`
                : `${xray.rangeRequests} ranges · ${xray.percentFetched?.toFixed(1) ?? '0'}% fetched`}
          </span>
        </footer>
      </WorkbenchShell>
      {demoOpen ? (
        <DemoPicker
          demos={ATLAS_START_DEMOS}
          disabled={!ready || busy}
          onClose={() => setDemoOpen(false)}
          onOpen={openStartDemo}
        />
      ) : null}
    </ThemeRoot>
  )
}

function createSemanticCatalogService(
  controller: GeoWorkbenchController,
  backend: CatalogService,
): CatalogService {
  return {
    async listCollections(entry, signal) {
      return (await controller.executeAction(
        'geo.catalog.list_collections',
        { catalogId: entry.id },
        signal,
      )) as never
    },
    async search(entry, request, signal) {
      return (await controller.executeAction(
        'geo.catalog.search',
        { catalogId: entry.id, request },
        signal,
      )) as unknown as CatalogSearchPage
    },
    async follow(entry, cursor, signal) {
      return (await controller.executeAction(
        'geo.catalog.follow',
        { catalogId: entry.id, cursor },
        signal,
      )) as unknown as CatalogSearchPage
    },
    async resolveDeepLink(entry, identity, signal) {
      return (await controller.executeAction(
        'geo.catalog.inspect_asset',
        { catalogId: entry.id, identity },
        signal,
      )) as unknown as CatalogSourceCandidate
    },
    invalidate(url) {
      return backend.invalidate(url)
    },
  }
}

function sameBbox(left: StacBbox | undefined, right: StacBbox | undefined): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.every((value, index) => value === right[index]))
  )
}

function clearCatalogHash(): void {
  if (parseAtlasDeepLink(window.location.hash) !== undefined) {
    window.history.replaceState(null, '', window.location.pathname)
  }
}

function errorTitle(code: string): string {
  if (code === 'CRS_INCOMPATIBLE') return 'Raster CRS is incompatible'
  if (code === 'SOURCE_LIMIT') return 'Source limit reached'
  return 'Could not complete this Atlas action'
}
