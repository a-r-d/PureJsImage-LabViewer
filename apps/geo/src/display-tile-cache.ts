export interface DisplayTileCacheEntry<T> {
  readonly value: T
  readonly bytes: number
  readonly dispose: (value: T) => void
}

export interface DisplayTileCacheDiagnostics {
  readonly bytes: number
  readonly tiles: number
  readonly byteBudget: number
  readonly tileBudget: number
  readonly hits: number
  readonly misses: number
  readonly evictions: number
  readonly hitRate: number
}

interface CacheRecord<T> extends DisplayTileCacheEntry<T> {
  lastUsed: number
  readonly insertion: number
}

/** Bounded deterministic LRU for display-ready resources only. */
export class DisplayTileCache<T> {
  readonly #records = new Map<string, CacheRecord<T>>()
  readonly #byteBudget: number
  readonly #tileBudget: number
  #clock = 0
  #bytes = 0
  #hits = 0
  #misses = 0
  #evictions = 0

  constructor(byteBudget: number, tileBudget: number) {
    if (!Number.isSafeInteger(byteBudget) || byteBudget < 1)
      throw new RangeError('Invalid byte budget')
    if (!Number.isSafeInteger(tileBudget) || tileBudget < 1)
      throw new RangeError('Invalid tile budget')
    this.#byteBudget = byteBudget
    this.#tileBudget = tileBudget
  }

  has(key: string): boolean {
    return this.#records.has(key)
  }

  get(key: string): T | undefined {
    const record = this.#records.get(key)
    if (record === undefined) {
      this.#misses += 1
      return undefined
    }
    this.#hits += 1
    this.#clock += 1
    record.lastUsed = this.#clock
    return record.value
  }

  peek(key: string): T | undefined {
    return this.#records.get(key)?.value
  }

  set(
    key: string,
    entry: DisplayTileCacheEntry<T>,
    protectedKeys: ReadonlySet<string> = new Set(),
  ): void {
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0)
      throw new RangeError('Invalid entry bytes')
    this.delete(key)
    this.#clock += 1
    this.#records.set(key, {
      ...entry,
      lastUsed: this.#clock,
      insertion: this.#clock,
    })
    this.#bytes += entry.bytes
    this.#evict(protectedKeys)
  }

  delete(key: string): boolean {
    const record = this.#records.get(key)
    if (record === undefined) return false
    this.#records.delete(key)
    this.#bytes -= record.bytes
    record.dispose(record.value)
    return true
  }

  clear(): void {
    for (const key of [...this.#records.keys()]) this.delete(key)
  }

  diagnostics(): DisplayTileCacheDiagnostics {
    const lookups = this.#hits + this.#misses
    return {
      bytes: this.#bytes,
      tiles: this.#records.size,
      byteBudget: this.#byteBudget,
      tileBudget: this.#tileBudget,
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
      hitRate: lookups === 0 ? 0 : this.#hits / lookups,
    }
  }

  #evict(protectedKeys: ReadonlySet<string>): void {
    while (this.#bytes > this.#byteBudget || this.#records.size > this.#tileBudget) {
      const ordered = [...this.#records.entries()].sort(
        ([leftKey, left], [rightKey, right]) =>
          Number(protectedKeys.has(leftKey)) - Number(protectedKeys.has(rightKey)) ||
          left.lastUsed - right.lastUsed ||
          left.insertion - right.insertion ||
          leftKey.localeCompare(rightKey),
      )
      const victim = ordered[0]?.[0]
      if (victim === undefined) return
      this.delete(victim)
      this.#evictions += 1
    }
  }
}
