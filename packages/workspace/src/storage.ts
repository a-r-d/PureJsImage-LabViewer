import {
  type ArtifactReferenceId,
  type JsonValue,
  type ProjectId,
  WORKSPACE_LIMITS,
  type WorkspaceSnapshot,
} from './model.js'
import { serializeWorkspaceProject } from './serialization.js'
import { importWorkspaceProject } from './validation.js'

export interface ProjectSummary {
  readonly id: ProjectId
  readonly title: string
  readonly updatedAt: string
  readonly bytes: number
}

export interface ProjectStore {
  save(project: WorkspaceSnapshot): Promise<void>
  load(id: ProjectId): Promise<WorkspaceSnapshot | undefined>
  list(): Promise<readonly ProjectSummary[]>
  delete(id: ProjectId): Promise<void>
}

export interface StoredArtifact {
  readonly id: ArtifactReferenceId
  readonly projectId: ProjectId
  readonly kind: string
  readonly mediaType: string
  readonly bytes: number
  readonly metadata: Readonly<Record<string, JsonValue>>
  readonly data: Blob
}

export interface ArtifactStore {
  put(artifact: StoredArtifact): Promise<void>
  get(id: ArtifactReferenceId): Promise<StoredArtifact | undefined>
  list(projectId: ProjectId): Promise<readonly Omit<StoredArtifact, 'data'>[]>
  delete(id: ArtifactReferenceId): Promise<void>
  deleteProject(projectId: ProjectId): Promise<void>
}

export interface PreferenceStore<Value> {
  load(): Value
  save(value: Value): void
  clear(): void
}

interface ProjectRecord extends ProjectSummary {
  readonly json: string
}

const DATABASE_NAME = 'purejsimage-lab-workspace-v1'
const DATABASE_VERSION = 1
const PROJECTS = 'projects'
const ARTIFACTS = 'artifacts'

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed')),
      {
        once: true,
      },
    )
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')),
      { once: true },
    )
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed')),
      { once: true },
    )
  })
}

function openDatabase(factory: IDBFactory, name = DATABASE_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION)
    request.addEventListener('upgradeneeded', () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PROJECTS)) {
        database.createObjectStore(PROJECTS, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(ARTIFACTS)) {
        const store = database.createObjectStore(ARTIFACTS, { keyPath: 'id' })
        store.createIndex('projectId', 'projectId', { unique: false })
      }
    })
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Unable to open IndexedDB')),
      { once: true },
    )
  })
}

export class IndexedDbProjectStore implements ProjectStore {
  readonly #database: Promise<IDBDatabase>

  constructor(factory: IDBFactory, databaseName = DATABASE_NAME) {
    this.#database = openDatabase(factory, databaseName)
  }

  async save(project: WorkspaceSnapshot): Promise<void> {
    const json = serializeWorkspaceProject(project)
    const validated = importWorkspaceProject(json)
    const database = await this.#database
    const transaction = database.transaction(PROJECTS, 'readwrite')
    const record: ProjectRecord = {
      id: validated.project.id,
      title: validated.project.title,
      updatedAt: validated.project.updatedAt,
      bytes: new TextEncoder().encode(json).byteLength,
      json,
    }
    transaction.objectStore(PROJECTS).put(record)
    await transactionDone(transaction)
  }

  async load(id: ProjectId): Promise<WorkspaceSnapshot | undefined> {
    const database = await this.#database
    const transaction = database.transaction(PROJECTS, 'readonly')
    const result = await requestResult(transaction.objectStore(PROJECTS).get(id))
    await transactionDone(transaction)
    if (result === undefined) return undefined
    const candidate = result as ProjectRecord
    return importWorkspaceProject(candidate.json)
  }

  async list(): Promise<readonly ProjectSummary[]> {
    const database = await this.#database
    const transaction = database.transaction(PROJECTS, 'readonly')
    const values = (await requestResult(
      transaction.objectStore(PROJECTS).getAll(),
    )) as ProjectRecord[]
    await transactionDone(transaction)
    return values
      .map(({ id, title, updatedAt, bytes }) => ({ id, title, updatedAt, bytes }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async delete(id: ProjectId): Promise<void> {
    const database = await this.#database
    const transaction = database.transaction(PROJECTS, 'readwrite')
    transaction.objectStore(PROJECTS).delete(id)
    await transactionDone(transaction)
  }
}

export class IndexedDbArtifactStore implements ArtifactStore {
  readonly #database: Promise<IDBDatabase>

  constructor(factory: IDBFactory, databaseName = DATABASE_NAME) {
    this.#database = openDatabase(factory, databaseName)
  }

  async put(artifact: StoredArtifact): Promise<void> {
    if (artifact.bytes !== artifact.data.size) throw new Error('artifact byte count does not match')
    if (artifact.bytes > WORKSPACE_LIMITS.maxArtifactBytes)
      throw new Error('artifact exceeds its byte limit')
    const existing = await this.list(artifact.projectId)
    const retained = existing
      .filter(({ id }) => id !== artifact.id)
      .reduce((total, item) => total + item.bytes, 0)
    if (retained + artifact.bytes > WORKSPACE_LIMITS.maxArtifactTotalBytes) {
      throw new Error('project artifacts exceed their total byte limit')
    }
    const database = await this.#database
    const transaction = database.transaction(ARTIFACTS, 'readwrite')
    transaction.objectStore(ARTIFACTS).put(artifact)
    await transactionDone(transaction)
  }

  async get(id: ArtifactReferenceId): Promise<StoredArtifact | undefined> {
    const database = await this.#database
    const transaction = database.transaction(ARTIFACTS, 'readonly')
    const value = await requestResult(transaction.objectStore(ARTIFACTS).get(id))
    await transactionDone(transaction)
    return value as StoredArtifact | undefined
  }

  async list(projectId: ProjectId): Promise<readonly Omit<StoredArtifact, 'data'>[]> {
    const database = await this.#database
    const transaction = database.transaction(ARTIFACTS, 'readonly')
    const index = transaction.objectStore(ARTIFACTS).index('projectId')
    const values = (await requestResult(
      index.getAll(IDBKeyRange.only(projectId)),
    )) as StoredArtifact[]
    await transactionDone(transaction)
    return values.map(({ data: _data, ...metadata }) => metadata)
  }

  async delete(id: ArtifactReferenceId): Promise<void> {
    const database = await this.#database
    const transaction = database.transaction(ARTIFACTS, 'readwrite')
    transaction.objectStore(ARTIFACTS).delete(id)
    await transactionDone(transaction)
  }

  async deleteProject(projectId: ProjectId): Promise<void> {
    const artifacts = await this.list(projectId)
    const database = await this.#database
    const transaction = database.transaction(ARTIFACTS, 'readwrite')
    const store = transaction.objectStore(ARTIFACTS)
    for (const artifact of artifacts) store.delete(artifact.id)
    await transactionDone(transaction)
  }
}

export class LocalStoragePreferenceStore<Value> implements PreferenceStore<Value> {
  constructor(
    readonly storage: Storage,
    readonly key: string,
    readonly fallback: Value,
    readonly validate: (value: unknown) => Value,
    readonly maxBytes = 16 * 1_024,
  ) {}

  load(): Value {
    const stored = this.storage.getItem(this.key)
    if (stored === null) return this.fallback
    if (new TextEncoder().encode(stored).byteLength > this.maxBytes) return this.fallback
    try {
      return this.validate(JSON.parse(stored) as unknown)
    } catch {
      return this.fallback
    }
  }

  save(value: Value): void {
    const normalized = this.validate(value)
    const json = JSON.stringify(normalized)
    if (new TextEncoder().encode(json).byteLength > this.maxBytes) {
      throw new Error('preference value exceeds the byte limit')
    }
    this.storage.setItem(this.key, json)
  }

  clear(): void {
    this.storage.removeItem(this.key)
  }
}

export class MemoryProjectStore implements ProjectStore {
  readonly #projects = new Map<ProjectId, string>()

  async save(project: WorkspaceSnapshot): Promise<void> {
    this.#projects.set(project.project.id, serializeWorkspaceProject(project))
  }

  async load(id: ProjectId): Promise<WorkspaceSnapshot | undefined> {
    const json = this.#projects.get(id)
    return json === undefined ? undefined : importWorkspaceProject(json)
  }

  async list(): Promise<readonly ProjectSummary[]> {
    return [...this.#projects.values()]
      .map((json) => {
        const project = importWorkspaceProject(json)
        return {
          id: project.project.id,
          title: project.project.title,
          updatedAt: project.project.updatedAt,
          bytes: new TextEncoder().encode(json).byteLength,
        }
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async delete(id: ProjectId): Promise<void> {
    this.#projects.delete(id)
  }
}

export class MemoryArtifactStore implements ArtifactStore {
  readonly #artifacts = new Map<ArtifactReferenceId, StoredArtifact>()

  async put(artifact: StoredArtifact): Promise<void> {
    if (artifact.bytes > WORKSPACE_LIMITS.maxArtifactBytes)
      throw new Error('artifact exceeds its byte limit')
    const others = [...this.#artifacts.values()]
      .filter(({ projectId, id }) => projectId === artifact.projectId && id !== artifact.id)
      .reduce((total, item) => total + item.bytes, 0)
    if (others + artifact.bytes > WORKSPACE_LIMITS.maxArtifactTotalBytes) {
      throw new Error('project artifacts exceed their total byte limit')
    }
    this.#artifacts.set(artifact.id, artifact)
  }

  async get(id: ArtifactReferenceId): Promise<StoredArtifact | undefined> {
    return this.#artifacts.get(id)
  }

  async list(projectId: ProjectId): Promise<readonly Omit<StoredArtifact, 'data'>[]> {
    return [...this.#artifacts.values()]
      .filter((artifact) => artifact.projectId === projectId)
      .map(({ data: _data, ...metadata }) => metadata)
  }

  async delete(id: ArtifactReferenceId): Promise<void> {
    this.#artifacts.delete(id)
  }

  async deleteProject(projectId: ProjectId): Promise<void> {
    for (const [id, artifact] of this.#artifacts) {
      if (artifact.projectId === projectId) this.#artifacts.delete(id)
    }
  }
}
