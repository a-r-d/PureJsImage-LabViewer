import {
  type CatalogRegistryEntry,
  type CatalogSourceCandidate,
  type CatalogStory,
  candidatesFromItem,
  classifyStacClientError,
  collectionIdsForStory,
  type GeoOpenFailure,
  preferredCandidate,
  type RasterStyle,
  type StacBbox,
  type StacClient,
  StacClientError,
  type StacCollection,
  type StacItem,
} from '@pji-workbench/domain-geo'
import { Button, ErrorState } from '@pji-workbench/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

export function CatalogPanel({
  client,
  catalogs,
  stories,
  viewBbox,
  busy,
  onOpen,
}: {
  readonly client: StacClient
  readonly catalogs: readonly CatalogRegistryEntry[]
  readonly stories: readonly CatalogStory[]
  readonly viewBbox?: StacBbox
  readonly busy: boolean
  readonly onOpen: (candidate: CatalogSourceCandidate, inspect: boolean) => void
}) {
  const [catalogId, setCatalogId] = useState(catalogs[0]?.id ?? '')
  const catalog = catalogs.find((entry) => entry.id === catalogId) ?? catalogs[0]
  const [collections, setCollections] = useState<readonly StacCollection[]>([])
  const [collectionId, setCollectionId] = useState('')
  const [datetime, setDatetime] = useState('')
  const [bboxText, setBboxText] = useState(formatBbox(catalog?.defaultBbox))
  const [items, setItems] = useState<readonly StacItem[]>([])
  const [nextHref, setNextHref] = useState<string | undefined>()
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>()
  const [assetKey, setAssetKey] = useState<string | undefined>()
  const [error, setError] = useState<GeoOpenFailure | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Search a collection to list Cloud Optimized GeoTIFF tiles.')
  const [preferInspect, setPreferInspect] = useState(false)
  const [storyStyle, setStoryStyle] = useState<RasterStyle | undefined>()
  const requestRef = useRef<AbortController | null>(null)
  const requestGenRef = useRef(0)

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
      const root = await client.getCatalog(catalog.href, signal)
      const next = await client.listCollections(root, signal)
      if (requestGenRef.current !== generation) return
      setCollections(next)
      setStatus(`${next.length} collections`)
    } catch (caught) {
      if (signal.aborted || requestGenRef.current !== generation) return
      setCollections([])
      setError(asCatalogFailure(caught))
    } finally {
      if (requestGenRef.current === generation) setLoading(false)
    }
  }, [beginRequest, catalog, client])

  useEffect(() => {
    void loadCollections()
    return () => {
      requestRef.current?.abort()
    }
  }, [loadCollections])

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
      try {
        const root = await client.getCatalog(catalog.href, signal)
        const bbox = overrides?.bbox ?? parseBbox(bboxText) ?? catalog.defaultBbox
        const collectionsFilter =
          overrides?.collections ?? (collectionId.length > 0 ? [collectionId] : undefined)
        const page = await client.search(
          root,
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
        setNextHref(page.nextHref)
        setSelectedItemId(page.items[0]?.id)
        setAssetKey(undefined)
        setStatus(
          page.numberMatched === undefined
            ? `${page.items.length} items`
            : `${page.items.length} of ${page.numberMatched} items`,
        )
      } catch (caught) {
        if (signal.aborted || requestGenRef.current !== generation) return
        setItems([])
        setNextHref(undefined)
        setError(asCatalogFailure(caught))
      } finally {
        if (requestGenRef.current === generation) setLoading(false)
      }
    },
    [beginRequest, bboxText, catalog, client, collectionId, datetime],
  )

  const loadMore = useCallback(async () => {
    if (nextHref === undefined) return
    const { generation, signal } = beginRequest()
    setLoading(true)
    try {
      const page = await client.follow(nextHref, signal)
      if (requestGenRef.current !== generation) return
      setItems((current) => [...current, ...page.items])
      setNextHref(page.nextHref)
    } catch (caught) {
      if (signal.aborted || requestGenRef.current !== generation) return
      setError(asCatalogFailure(caught))
    } finally {
      if (requestGenRef.current === generation) setLoading(false)
    }
  }, [beginRequest, client, nextHref])

  const selected = items.find((item) => item.id === selectedItemId)
  const candidates =
    catalog === undefined || selected === undefined
      ? []
      : storyStyle === undefined
        ? candidatesFromItem(catalog, selected)
        : candidatesFromItem(catalog, selected, { style: storyStyle })
  const active =
    selected === undefined ? undefined : preferredCandidate(candidates, selected, assetKey)

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
            const next = catalogs.find((entry) => entry.id === nextId)
            setBboxText(formatBbox(next?.defaultBbox))
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
              await client.invalidate()
              await loadCollections()
            })()
          }}
        >
          Refresh catalog
        </Button>
      </div>
      <p data-testid="catalog-status">{loading ? 'Loading…' : status}</p>
      {error !== null ? (
        <ErrorState
          message={`${error.message}${error.guidance === undefined ? '' : ` ${error.guidance}`}`}
          title={error.title}
        />
      ) : null}
      <ol className="geo-catalog-results">
        {items.map((item) => (
          <li key={item.id}>
            <button
              aria-pressed={item.id === selectedItemId}
              onClick={() => {
                setSelectedItemId(item.id)
                setAssetKey(undefined)
              }}
              type="button"
            >
              <strong>{item.id}</strong>
              <span>
                {item.collection ?? 'item'}
                {item.datetime === undefined ? '' : ` · ${item.datetime.slice(0, 10)}`}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {nextHref === undefined ? null : <Button onClick={() => void loadMore()}>More items</Button>}
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
          <div className="geo-inspector-toolbar">
            <Button
              disabled={busy}
              onClick={() => onOpen(active, false)}
              variant={preferInspect ? 'secondary' : 'primary'}
            >
              Open as layer
            </Button>
            <Button
              disabled={busy}
              onClick={() => onOpen(active, true)}
              variant={preferInspect ? 'primary' : 'secondary'}
            >
              Inspect asset
            </Button>
          </div>
        </div>
      )}
      {catalogStories.length > 0 ? (
        <details className="geo-story-list" open>
          <summary>Stories</summary>
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
              type="button"
            >
              <strong>{story.title}</strong>
              <span>{story.summary}</span>
              {story.note === undefined ? null : <em>{story.note}</em>}
            </button>
          ))}
        </details>
      ) : null}
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
