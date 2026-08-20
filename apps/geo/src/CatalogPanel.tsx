import {
  type CatalogCollectionSummary,
  type CatalogCursor,
  type CatalogRegistryEntry,
  type CatalogSearchItem,
  type CatalogService,
  type CatalogSourceCandidate,
  type CatalogStory,
  catalogProtocolHint,
  classifyStacClientError,
  collectionIdsForStory,
  collectionSummariesFromRegistry,
  type GeoOpenFailure,
  preferredSearchCandidate,
  type RasterStyle,
  type StacBbox,
  StacClientError,
} from '@pji-workbench/domain-geo'
import {
  preflightBadgeLabel,
  type RasterAssetPreflight,
  type RasterPreflightCompatibility,
  type RasterPreflightStage,
} from '@pji-workbench/imaging'
import { Button, ErrorState } from '@pji-workbench/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

export function CatalogPanel({
  service,
  catalogs,
  stories,
  viewBbox,
  busy,
  searchNonce = 0,
  onOpen,
  onPreflight,
}: {
  readonly service: CatalogService
  readonly catalogs: readonly CatalogRegistryEntry[]
  readonly stories: readonly CatalogStory[]
  readonly viewBbox?: StacBbox
  readonly busy: boolean
  readonly searchNonce?: number
  readonly onOpen: (
    candidate: CatalogSourceCandidate,
    inspect: boolean,
    preflight: RasterAssetPreflight,
  ) => void
  readonly onPreflight: (
    href: string,
    signal: AbortSignal,
    stage: RasterPreflightStage,
  ) => Promise<RasterAssetPreflight>
}) {
  const [catalogId, setCatalogId] = useState(catalogs[0]?.id ?? '')
  const catalog = catalogs.find((entry) => entry.id === catalogId) ?? catalogs[0]
  const [collections, setCollections] = useState<readonly CatalogCollectionSummary[]>([])
  const [collectionId, setCollectionId] = useState('')
  const [datetime, setDatetime] = useState(catalog?.defaultDatetime ?? '')
  const [bboxText, setBboxText] = useState(formatBbox(catalog?.defaultBbox))
  const [items, setItems] = useState<readonly CatalogSearchItem[]>([])
  const [next, setNext] = useState<CatalogCursor | undefined>()
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>()
  const [assetKey, setAssetKey] = useState<string | undefined>()
  const [error, setError] = useState<GeoOpenFailure | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Search a collection to list Cloud Optimized GeoTIFF tiles.')
  const [preferInspect, setPreferInspect] = useState(false)
  const [storyStyle, setStoryStyle] = useState<RasterStyle | undefined>()
  const [preflight, setPreflight] = useState<Readonly<Record<string, RasterAssetPreflight>>>({})
  const requestRef = useRef<AbortController | null>(null)
  const requestGenRef = useRef(0)
  const lastSearchNonceRef = useRef(0)
  const preflightRef = useRef<AbortController | null>(null)
  const selectedPreflightRef = useRef<AbortController | null>(null)
  const preflightGenerationRef = useRef(0)
  const preflightCacheRef = useRef(
    new Map<string, { readonly report: RasterAssetPreflight; readonly expiresAt?: number }>(),
  )
  const inflightPreflightRef = useRef(
    new Map<
      string,
      { readonly promise: Promise<RasterAssetPreflight>; readonly signal: AbortSignal }
    >(),
  )
  const [retryNonce, setRetryNonce] = useState(0)

  const catalogStories = stories.filter((story) => story.catalogId === catalog?.id)

  const beginRequest = useCallback((): { generation: number; signal: AbortSignal } => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    requestGenRef.current += 1
    return { generation: requestGenRef.current, signal: controller.signal }
  }, [])

  const loadCollections = useCallback(async () => {
    if (catalog === undefined) return
    const { generation, signal } = beginRequest()
    setLoading(true)
    setError(null)
    try {
      const nextCollections = await service.listCollections(catalog, signal)
      if (requestGenRef.current !== generation) return
      setCollections(nextCollections)
      setCollectionId((current) =>
        nextCollections.some((collection) => collection.id === current)
          ? current
          : (nextCollections[0]?.id ?? ''),
      )
      setStatus(`${nextCollections.length} collections`)
    } catch (caught) {
      if (signal.aborted || requestGenRef.current !== generation) return
      const fallback = collectionSummariesFromRegistry(catalog)
      setCollections(fallback)
      setCollectionId((current) =>
        fallback.some((collection) => collection.id === current)
          ? current
          : (fallback[0]?.id ?? ''),
      )
      setStatus('')
      setError(asCatalogFailure(caught))
    } finally {
      if (requestGenRef.current === generation) setLoading(false)
    }
  }, [beginRequest, catalog, service])

  useEffect(() => {
    void loadCollections()
    return () => {
      requestRef.current?.abort()
      preflightRef.current?.abort()
      selectedPreflightRef.current?.abort()
    }
  }, [loadCollections])

  const probe = useCallback(
    async (
      href: string,
      stage: RasterPreflightStage,
      signal: AbortSignal,
      force = false,
    ): Promise<RasterAssetPreflight> => {
      const key = normalizeHref(href)
      const cached = preflightCacheRef.current.get(key)
      if (
        !force &&
        cached !== undefined &&
        (cached.expiresAt === undefined || cached.expiresAt > Date.now()) &&
        stageRank(cached.report.stage) >= stageRank(stage)
      ) {
        return cached.report
      }
      const inflightKey = `${key}:${stage}`
      const existing = inflightPreflightRef.current.get(inflightKey)
      if (!force && existing !== undefined && !existing.signal.aborted) return existing.promise
      if (existing?.signal.aborted === true) inflightPreflightRef.current.delete(inflightKey)
      const pending = onPreflight(href, signal, stage).then((report) => {
        const success =
          report.compatibility === 'ready' ||
          report.compatibility === 'tiff-compatible' ||
          report.compatibility === 'range-readable'
        preflightCacheRef.current.set(key, {
          report,
          ...(success ? {} : { expiresAt: Date.now() + 15_000 }),
        })
        const validator = report.transport.validator
        if (validator !== undefined) {
          preflightCacheRef.current.set(`${key}|${validator.header}:${validator.value}`, { report })
        }
        return report
      })
      inflightPreflightRef.current.set(inflightKey, { promise: pending, signal })
      try {
        return await pending
      } finally {
        if (inflightPreflightRef.current.get(inflightKey)?.promise === pending) {
          inflightPreflightRef.current.delete(inflightKey)
        }
      }
    },
    [onPreflight],
  )

  const runPreflight = useCallback(
    async (pageItems: readonly CatalogSearchItem[], signal: AbortSignal, selectedHref?: string) => {
      preflightRef.current?.abort()
      const controller = new AbortController()
      preflightRef.current = controller
      const combined = AbortSignal.any([signal, controller.signal])
      const generation = ++preflightGenerationRef.current
      const candidates = pageItems
        .map((item) => preferredSearchCandidate(item, undefined, catalog?.preferredAssetKeys))
        .filter((candidate): candidate is CatalogSourceCandidate => candidate !== undefined)
        .filter((candidate) => normalizeHref(candidate.href) !== normalizeHref(selectedHref ?? ''))
      let index = 0
      const worker = async (): Promise<void> => {
        while (index < candidates.length && !combined.aborted) {
          const candidate = candidates[index]
          index += 1
          if (candidate === undefined) continue
          try {
            const report = await probe(candidate.href, 'tiff-compatible', combined)
            if (combined.aborted || preflightGenerationRef.current !== generation) return
            setPreflight((current) => ({ ...current, [candidate.href]: report }))
          } catch {
            if (combined.aborted || preflightGenerationRef.current !== generation) return
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, () => worker()))
    },
    [catalog?.preferredAssetKeys, probe],
  )

  const search = useCallback(
    async (overrides?: {
      readonly collections?: readonly string[]
      readonly bbox?: StacBbox
      readonly datetime?: string
    }) => {
      if (catalog === undefined) return
      const explicitBbox = overrides?.bbox ?? parseBbox(bboxText)
      if (
        overrides?.bbox === undefined &&
        bboxText.trim().length > 0 &&
        explicitBbox === undefined
      ) {
        setError({
          kind: 'catalog-unavailable',
          title: 'Invalid bounding box',
          message:
            'Enter west,south,east,north with finite WGS84 coordinates, west < east, and south < north.',
        })
        setStatus('')
        return
      }
      const { generation, signal } = beginRequest()
      setLoading(true)
      setError(null)
      setPreflight({})
      try {
        const bbox = explicitBbox ?? catalog.defaultBbox
        const collectionsFilter =
          overrides?.collections ?? (collectionId.length > 0 ? [collectionId] : undefined)
        const page = await service.search(
          catalog,
          {
            ...(bbox === undefined ? {} : { bbox }),
            ...((overrides?.datetime ?? datetime).length > 0
              ? { datetime: overrides?.datetime ?? datetime }
              : {}),
            ...(collectionsFilter === undefined ? {} : { collections: collectionsFilter }),
            limit: 12,
          },
          signal,
        )
        if (requestGenRef.current !== generation) return
        setItems(page.items)
        setNext(page.next)
        const selectedItem = page.items.find((item) => item.id === selectedItemId) ?? page.items[0]
        const selectedCandidate =
          selectedItem === undefined
            ? undefined
            : preferredSearchCandidate(selectedItem, undefined, catalog.preferredAssetKeys)
        setSelectedItemId(selectedItem?.id)
        setAssetKey(selectedCandidate?.assetKey)
        setStatus(
          page.numberMatched === undefined
            ? `${page.items.length} items`
            : `${page.items.length} of ${page.numberMatched} items`,
        )
        void runPreflight(page.items, signal, selectedCandidate?.href)
      } catch (caught) {
        if (signal.aborted || requestGenRef.current !== generation) return
        setItems([])
        setNext(undefined)
        setError(asCatalogFailure(caught))
      } finally {
        if (requestGenRef.current === generation) setLoading(false)
      }
    },
    [
      beginRequest,
      bboxText,
      catalog,
      collectionId,
      datetime,
      runPreflight,
      selectedItemId,
      service,
    ],
  )

  const loadMore = useCallback(async () => {
    if (catalog === undefined || next === undefined) return
    const { generation, signal } = beginRequest()
    setLoading(true)
    try {
      const page = await service.follow(catalog, next, signal)
      if (requestGenRef.current !== generation) return
      setItems((current) => {
        const merged = [...current, ...page.items]
        void runPreflight(page.items, signal)
        return merged
      })
      setNext(page.next)
    } catch (caught) {
      if (signal.aborted || requestGenRef.current !== generation) return
      setError(asCatalogFailure(caught))
    } finally {
      if (requestGenRef.current === generation) setLoading(false)
    }
  }, [beginRequest, catalog, next, runPreflight, service])

  const openItem = useCallback(
    (item: CatalogSearchItem, inspect: boolean, nextAssetKey?: string) => {
      if (catalog === undefined) return
      const styled =
        storyStyle === undefined
          ? item.candidates
          : item.candidates.map((candidate) => ({ ...candidate, style: storyStyle }))
      const nextCandidate = preferredSearchCandidate(
        { ...item, candidates: styled },
        nextAssetKey,
        catalog.preferredAssetKeys,
      )
      setSelectedItemId(item.id)
      setAssetKey(nextAssetKey ?? nextCandidate?.assetKey)
      if (nextCandidate === undefined) return
      const probe = preflight[nextCandidate.href]
      if (probe?.compatibility !== 'ready') return
      onOpen(nextCandidate, inspect, probe)
    },
    [catalog, onOpen, preflight, storyStyle],
  )

  useEffect(() => {
    if (searchNonce === lastSearchNonceRef.current) return
    lastSearchNonceRef.current = searchNonce
    if (searchNonce < 1) return
    setStoryStyle(undefined)
    void search()
  }, [search, searchNonce])

  const selected = items.find((item) => item.id === selectedItemId)
  const candidates =
    selected === undefined
      ? []
      : storyStyle === undefined
        ? selected.candidates
        : selected.candidates.map((candidate) => ({ ...candidate, style: storyStyle }))
  const active =
    selected === undefined
      ? undefined
      : preferredSearchCandidate({ ...selected, candidates }, assetKey, catalog?.preferredAssetKeys)
  const activeProbe = active === undefined ? undefined : preflight[active.href]
  const canOpen = activeProbe?.compatibility === 'ready'
  const activeHref = active?.href

  useEffect(() => {
    if (activeHref === undefined) return
    preflightRef.current?.abort()
    selectedPreflightRef.current?.abort()
    const controller = new AbortController()
    selectedPreflightRef.current = controller
    const generation = ++preflightGenerationRef.current
    void probe(activeHref, 'decoder-ready', controller.signal, retryNonce > 0)
      .then((report) => {
        if (controller.signal.aborted || preflightGenerationRef.current !== generation) return
        setPreflight((current) => ({ ...current, [activeHref]: report }))
        void runPreflight(items, controller.signal, activeHref)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [activeHref, items, probe, retryNonce, runPreflight])

  return (
    <div className="geo-inspector-body geo-catalog" data-testid="catalog-panel">
      <label>
        Catalog
        <select
          aria-label="Catalog"
          onChange={(event) => {
            const nextId = event.currentTarget.value
            setCatalogId(nextId)
            setCollectionId('')
            setItems([])
            setPreferInspect(false)
            setStoryStyle(undefined)
            setPreflight({})
            const nextCatalog = catalogs.find((entry) => entry.id === nextId)
            setBboxText(formatBbox(nextCatalog?.defaultBbox))
            setDatetime(nextCatalog?.defaultDatetime ?? '')
          }}
          value={catalog?.id ?? ''}
        >
          {catalogs.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title}
            </option>
          ))}
        </select>
      </label>
      {catalog === undefined ? null : (
        <p>
          <a href={catalog.homepage} rel="noreferrer" target="_blank">
            {catalog.title}
          </a>
          {` · ${catalog.license} · ${catalog.attribution}`}
        </p>
      )}
      {catalog === undefined ? null : (
        <p className="geo-catalog-hint">{catalogProtocolHint(catalog)}</p>
      )}
      <label>
        Collection
        <select
          aria-label="Collection"
          onChange={(event) => setCollectionId(event.currentTarget.value)}
          value={collectionId}
        >
          <option value="">All collections</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.title ?? collection.id}
            </option>
          ))}
        </select>
      </label>
      <label>
        Bounding box (WGS84 west,south,east,north)
        <input
          aria-label="Bounding box"
          onChange={(event) => setBboxText(event.currentTarget.value)}
          value={bboxText}
        />
      </label>
      <div className="geo-inspector-toolbar">
        <Button
          onClick={() => {
            if (catalog?.defaultBbox !== undefined) setBboxText(formatBbox(catalog.defaultBbox))
          }}
        >
          Catalog AOI
        </Button>
        <Button
          disabled={viewBbox === undefined}
          onClick={() => {
            if (viewBbox !== undefined) setBboxText(formatBbox(viewBbox))
          }}
        >
          Current view
        </Button>
      </div>
      <label>
        Datetime or interval
        <input
          aria-label="Datetime"
          onChange={(event) => setDatetime(event.currentTarget.value)}
          placeholder="2019-01-01/2019-12-31"
          value={datetime}
        />
      </label>
      <div className="geo-inspector-toolbar">
        <Button
          onClick={() => {
            setStoryStyle(undefined)
            void search()
          }}
          variant="primary"
        >
          Search
        </Button>
        <Button
          onClick={() => {
            void (async () => {
              await service.invalidate()
              await loadCollections()
            })()
          }}
        >
          Refresh catalog
        </Button>
      </div>
      <p data-testid="catalog-status">{loading ? 'Loading…' : status}</p>
      <p className="geo-catalog-hint">
        {items.length === 0
          ? 'Search a collection or pick a story, then click a tile to open it.'
          : 'Click a Ready tile to open it in the map. Atlas fetches only the HTTP ranges for the current view.'}
      </p>
      {error !== null ? (
        <ErrorState
          message={`${error.message}${error.guidance === undefined ? '' : ` ${error.guidance}`}`}
          title={error.title}
        />
      ) : null}
      <ol className="geo-catalog-results">
        {items.map((item) => {
          const candidate = preferredSearchCandidate(item, undefined, catalog?.preferredAssetKeys)
          const probe = candidate === undefined ? undefined : preflight[candidate.href]
          const compatibility: RasterPreflightCompatibility = probe?.compatibility ?? 'checking'
          const opening = busy && item.id === selectedItemId
          return (
            <li key={`${item.collectionId}:${item.id}`}>
              <button
                aria-label={`Open ${item.id}`}
                aria-pressed={item.id === selectedItemId}
                disabled={
                  opening || (item.id === selectedItemId && probe?.compatibility !== 'ready')
                }
                onClick={() => {
                  if (probe?.compatibility === 'ready') {
                    openItem(item, preferInspect)
                    return
                  }
                  setSelectedItemId(item.id)
                  setAssetKey(candidate?.assetKey)
                }}
                type="button"
              >
                <strong>{item.id}</strong>
                <span>
                  {item.collectionId}
                  {item.datetime === undefined ? '' : ` · ${item.datetime.slice(0, 10)}`}
                  {` · ${opening ? 'Opening…' : preflightBadgeLabel(compatibility)}`}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      {next === undefined ? null : <Button onClick={() => void loadMore()}>More items</Button>}
      {catalogStories.length > 0 ? (
        <fieldset className="geo-story-chips">
          <legend>Stories</legend>
          {catalogStories.map((story) => (
            <button
              key={story.id}
              onClick={() => {
                if (catalog === undefined) return
                const ids = collectionIdsForStory(catalog, story)
                if (story.bbox !== undefined) setBboxText(formatBbox(story.bbox))
                if (story.datetime !== undefined) setDatetime(story.datetime)
                setCollectionId(ids[0] ?? '')
                setPreferInspect(story.inspect === true)
                setStoryStyle(story.style)
                void search({
                  ...(ids.length === 0 ? {} : { collections: ids }),
                  ...(story.bbox === undefined ? {} : { bbox: story.bbox }),
                  ...(story.datetime === undefined ? {} : { datetime: story.datetime }),
                })
              }}
              title={story.summary}
              type="button"
            >
              {story.title}
            </button>
          ))}
        </fieldset>
      ) : null}
      {selected === undefined || active === undefined ? null : (
        <div className="geo-asset-picker">
          {candidates.length > 1 ? (
            <label>
              Raster asset
              <select
                aria-label="Raster asset"
                onChange={(event) => setAssetKey(event.currentTarget.value)}
                value={active.assetKey}
              >
                {candidates.map((candidate) => (
                  <option key={candidate.assetKey} value={candidate.assetKey}>
                    {candidate.assetKey}
                    {candidate.mediaType === undefined ? '' : ` · ${candidate.mediaType}`}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>{`Asset ${active.assetKey}`}</p>
          )}
          <p className="geo-catalog-hint" data-testid="catalog-preflight">
            {activeProbe === undefined
              ? 'Checking…'
              : `${preflightBadgeLabel(activeProbe.compatibility)}. ${activeProbe.message}`}
          </p>
          <p className="geo-catalog-hint">
            {`${selected.collectionTitle ?? selected.collectionId} · ${active.provider ?? 'Unknown provider'} · ${active.license ?? 'Unknown'} · ${active.attribution ?? 'Unknown attribution'}`}
          </p>
          <div className="geo-inspector-toolbar">
            <Button
              disabled={busy || !canOpen}
              onClick={() => openItem(selected, false, active.assetKey)}
              variant={preferInspect ? 'secondary' : 'primary'}
            >
              Open as layer
            </Button>
            {activeProbe !== undefined &&
            activeProbe.compatibility !== 'ready' &&
            activeProbe.compatibility !== 'checking' ? (
              <Button
                onClick={() => {
                  preflightCacheRef.current.delete(normalizeHref(active.href))
                  setRetryNonce((value) => value + 1)
                }}
              >
                Retry
              </Button>
            ) : null}
            <Button
              disabled={busy || !canOpen}
              onClick={() => openItem(selected, true, active.assetKey)}
              variant={preferInspect ? 'primary' : 'secondary'}
            >
              Inspect asset
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function formatBbox(bbox: StacBbox | undefined): string {
  return bbox === undefined ? '' : bbox.map((value) => value.toFixed(4)).join(',')
}

function parseBbox(value: string): StacBbox | undefined {
  const parts = value.split(',').map((part) => Number(part.trim()))
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined
  const west = parts[0]
  const south = parts[1]
  const east = parts[2]
  const north = parts[3]
  if (west === undefined || south === undefined || east === undefined || north === undefined) {
    return undefined
  }
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    return undefined
  }
  return [west, south, east, north]
}

function normalizeHref(href: string): string {
  try {
    return new URL(href).href
  } catch {
    return href
  }
}

function stageRank(stage: RasterPreflightStage): number {
  switch (stage) {
    case 'metadata-only':
      return 0
    case 'range-readable':
      return 1
    case 'tiff-compatible':
      return 2
    case 'decoder-ready':
      return 3
  }
}

function asCatalogFailure(error: unknown): GeoOpenFailure {
  if (error instanceof StacClientError) return classifyStacClientError(error)
  return {
    kind: 'catalog-unavailable',
    title: 'Catalog unavailable',
    message: error instanceof Error ? error.message : 'Unknown catalog error',
  }
}
