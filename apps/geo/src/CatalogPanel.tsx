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
  readonly onOpen: (candidate: CatalogSourceCandidate, inspect: boolean) => void
  readonly onPreflight: (href: string, signal: AbortSignal) => Promise<RasterAssetPreflight>
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
    }
  }, [loadCollections])

  const runPreflight = useCallback(
    async (pageItems: readonly CatalogSearchItem[], signal: AbortSignal) => {
      preflightRef.current?.abort()
      const controller = new AbortController()
      preflightRef.current = controller
      const combined = AbortSignal.any([signal, controller.signal])
      const updates: Record<string, RasterAssetPreflight> = {}
      for (const item of pageItems) {
        const candidate = preferredSearchCandidate(item, undefined, catalog?.preferredAssetKeys)
        if (candidate === undefined) continue
        try {
          updates[candidate.href] = await onPreflight(candidate.href, combined)
        } catch {
          if (combined.aborted) return
          updates[candidate.href] = {
            href: candidate.href,
            compatibility: 'unknown',
            title: 'Preflight failed',
            message: 'Could not probe this raster.',
            transport: { href: candidate.href, scheme: '', bytesRead: 0 },
          }
        }
        if (combined.aborted) return
        setPreflight((current) => ({ ...current, ...updates }))
      }
    },
    [catalog?.preferredAssetKeys, onPreflight],
  )

  const search = useCallback(
    async (overrides?: {
      readonly collections?: readonly string[]
      readonly bbox?: StacBbox
      readonly datetime?: string
    }) => {
      if (catalog === undefined) return
      const { generation, signal } = beginRequest()
      setLoading(true)
      setError(null)
      setPreflight({})
      try {
        const bbox = overrides?.bbox ?? parseBbox(bboxText) ?? catalog.defaultBbox
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
        setSelectedItemId((current) =>
          page.items.some((item) => item.id === current) ? current : undefined,
        )
        setAssetKey(undefined)
        setStatus(
          page.numberMatched === undefined
            ? `${page.items.length} items`
            : `${page.items.length} of ${page.numberMatched} items`,
        )
        void runPreflight(page.items, signal)
      } catch (caught) {
        if (signal.aborted || requestGenRef.current !== generation) return
        setItems([])
        setNext(undefined)
        setError(asCatalogFailure(caught))
      } finally {
        if (requestGenRef.current === generation) setLoading(false)
      }
    },
    [beginRequest, bboxText, catalog, collectionId, datetime, runPreflight, service],
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
      onOpen(nextCandidate, inspect)
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
                disabled={opening || probe?.compatibility !== 'ready'}
                onClick={() => openItem(item, preferInspect)}
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
          <div className="geo-inspector-toolbar">
            <Button
              disabled={busy || !canOpen}
              onClick={() => openItem(selected, false, active.assetKey)}
              variant={preferInspect ? 'secondary' : 'primary'}
            >
              Open as layer
            </Button>
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
  return [west, south, east, north]
}

function asCatalogFailure(error: unknown): GeoOpenFailure {
  if (error instanceof StacClientError) return classifyStacClientError(error)
  return {
    kind: 'catalog-unavailable',
    title: 'Catalog unavailable',
    message: error instanceof Error ? error.message : 'Unknown catalog error',
  }
}
