import {
  exportGeoProjectDocument,
  GEO_PROJECT_DOCUMENT_LIMITS,
  type GeoProject,
  importGeoProjectDocument,
} from '@pji-workbench/domain-geo'
import { PUREJSIMAGE_PACKAGE_VERSION } from '@pji-workbench/imaging'

export interface GeoStoredProjectSummary {
  readonly id: string
  readonly title: string
  readonly updatedAt: string
  readonly bytes: number
  readonly schemaVersion: 2
}

export interface GeoStoredProject extends GeoStoredProjectSummary {
  readonly text: string
}

export interface GeoProjectStore {
  save(project: GeoProject): Promise<GeoStoredProjectSummary>
  load(id: string): Promise<GeoStoredProject | undefined>
  list(): Promise<readonly GeoStoredProjectSummary[]>
  delete(id: string): Promise<void>
}

export class MemoryGeoProjectStore implements GeoProjectStore {
  readonly #records = new Map<string, GeoStoredProject>()

  constructor(
    readonly versions: Readonly<{ appVersion: string; pureJsImageVersion: string }> = {
      appVersion: '0.0.0',
      pureJsImageVersion: PUREJSIMAGE_PACKAGE_VERSION,
    },
  ) {}

  async save(project: GeoProject): Promise<GeoStoredProjectSummary> {
    if (
      !this.#records.has(project.id) &&
      this.#records.size >= GEO_PROJECT_DOCUMENT_LIMITS.maxProjects
    )
      throw new Error('Atlas project store reached its project-count limit')
    const exported = exportGeoProjectDocument(project, this.versions)
    const record: GeoStoredProject = {
      id: project.id,
      title: project.title,
      updatedAt: project.updatedAt,
      bytes: exported.bytes,
      schemaVersion: 2,
      text: exported.text,
    }
    this.#records.set(record.id, record)
    return summary(record)
  }

  async load(id: string): Promise<GeoStoredProject | undefined> {
    return this.#records.get(id)
  }

  async list(): Promise<readonly GeoStoredProjectSummary[]> {
    return [...this.#records.values()]
      .map(summary)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async delete(id: string): Promise<void> {
    this.#records.delete(id)
  }
}

const DATABASE_NAME = 'purejsimage-atlas-projects-v2'
const DATABASE_VERSION = 1
const PROJECTS = 'projects'

export class IndexedDbGeoProjectStore implements GeoProjectStore {
  readonly #database: Promise<IDBDatabase>

  constructor(
    factory: IDBFactory,
    readonly versions: Readonly<{ appVersion: string; pureJsImageVersion: string }> = {
      appVersion: '0.0.0',
      pureJsImageVersion: PUREJSIMAGE_PACKAGE_VERSION,
    },
    databaseName = DATABASE_NAME,
  ) {
    this.#database = openDatabase(factory, databaseName)
  }

  async save(project: GeoProject): Promise<GeoStoredProjectSummary> {
    const exported = exportGeoProjectDocument(project, this.versions)
    const database = await this.#database
    const record: GeoStoredProject = {
      id: project.id,
      title: project.title,
      updatedAt: project.updatedAt,
      bytes: exported.bytes,
      schemaVersion: 2,
      text: exported.text,
    }
    const transaction = database.transaction(PROJECTS, 'readwrite')
    const store = transaction.objectStore(PROJECTS)
    const [count, existing] = await Promise.all([
      requestResult(store.count()),
      requestResult(store.get(project.id)),
    ])
    if (existing === undefined && count >= GEO_PROJECT_DOCUMENT_LIMITS.maxProjects) {
      transaction.abort()
      throw new Error('Atlas project store reached its project-count limit')
    }
    store.put(record)
    await transactionDone(transaction)
    return summary(record)
  }

  async load(id: string): Promise<GeoStoredProject | undefined> {
    const database = await this.#database
    const transaction = database.transaction(PROJECTS, 'readonly')
    const value = await requestResult(transaction.objectStore(PROJECTS).get(id))
    await transactionDone(transaction)
    if (value === undefined) return undefined
    const record = value as GeoStoredProject
    importGeoProjectDocument(record.text)
    return record
  }

  async list(): Promise<readonly GeoStoredProjectSummary[]> {
    const database = await this.#database
    const transaction = database.transaction(PROJECTS, 'readonly')
    const values = (await requestResult(
      transaction.objectStore(PROJECTS).getAll(),
    )) as GeoStoredProject[]
    await transactionDone(transaction)
    return values.map(summary).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async delete(id: string): Promise<void> {
    const database = await this.#database
    const transaction = database.transaction(PROJECTS, 'readwrite')
    transaction.objectStore(PROJECTS).delete(id)
    await transactionDone(transaction)
  }
}

function summary(record: GeoStoredProject): GeoStoredProjectSummary {
  const { text: _text, ...value } = record
  return value
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION)
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(PROJECTS))
        request.result.createObjectStore(PROJECTS, { keyPath: 'id' })
    })
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Atlas IndexedDB could not be opened')),
      { once: true },
    )
  })
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Atlas IndexedDB request failed')),
      { once: true },
    )
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('Atlas IndexedDB transaction aborted')),
      { once: true },
    )
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('Atlas IndexedDB transaction failed')),
      { once: true },
    )
  })
}
