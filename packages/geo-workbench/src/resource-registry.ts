export interface LocalResourceRecord {
  readonly id: string
  readonly files: readonly File[]
  readonly primary: File
}

/** Session-only Blob/File ownership. Resource ids are action inputs, never project locators. */
export class GeoLocalResourceRegistry {
  readonly #records = new Map<string, LocalResourceRecord>()
  #nextId = 1

  register(files: readonly File[], primary: File): string {
    if (files.length === 0 || !files.includes(primary)) {
      throw new Error('A local resource requires a primary file from the registered file set.')
    }
    const id = `local-resource-${this.#nextId}`
    this.#nextId += 1
    this.#records.set(id, { id, files: [...files], primary })
    return id
  }

  get(id: string): LocalResourceRecord | undefined {
    return this.#records.get(id)
  }

  hasAny(): boolean {
    return this.#records.size > 0
  }

  release(id: string): void {
    this.#records.delete(id)
  }

  clear(): void {
    this.#records.clear()
  }
}
