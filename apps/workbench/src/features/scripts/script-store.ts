import {
  assertScriptStudioRecordIntegrity,
  SCRIPT_STUDIO_LIMITS,
  type ScriptStudioRecordV1,
  type ScriptStudioRepository,
  validateScriptStudioRecord,
} from '@pji-workbench/plugin-sdk'

const DATABASE_NAME = 'purejsimage-lab-script-studio-v1'
const DATABASE_VERSION = 1
const RECORDS = 'records'

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Script Studio IndexedDB request failed.')),
      { once: true },
    )
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('Script Studio transaction aborted.')),
      { once: true },
    )
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('Script Studio transaction failed.')),
      { once: true },
    )
  })
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION)
    request.addEventListener('upgradeneeded', (event) => {
      const database = request.result
      if (event.oldVersion === 0 && !database.objectStoreNames.contains(RECORDS))
        database.createObjectStore(RECORDS, { keyPath: 'id' })
    })
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Unable to open the Script Studio database.')),
      { once: true },
    )
    request.addEventListener(
      'blocked',
      () => reject(new Error('Script Studio storage migration is blocked by another tab.')),
      { once: true },
    )
  })
}

export class IndexedDbScriptStudioRepository implements ScriptStudioRepository {
  readonly #database: Promise<IDBDatabase>
  readonly #warnings: string[] = []

  constructor(factory: IDBFactory, databaseName = DATABASE_NAME) {
    this.#database = openDatabase(factory, databaseName)
  }

  async put(record: ScriptStudioRecordV1): Promise<void> {
    const validation = validateScriptStudioRecord(record)
    if (!validation.ok || validation.value === undefined)
      throw new Error(
        `Cannot store invalid Script Studio content:\n${validation.issues
          .map(({ path, message }) => `${path || '/'}: ${message}`)
          .join('\n')}`,
      )
    const database = await this.#database
    await assertScriptStudioRecordIntegrity(validation.value)
    const transaction = database.transaction(RECORDS, 'readwrite')
    const store = transaction.objectStore(RECORDS)
    const countRequest = store.count()
    const keyRequest = store.getKey(record.id)
    const [existing, alreadyStored] = await Promise.all([
      requestResult(countRequest),
      requestResult(keyRequest),
    ])
    if (alreadyStored === undefined && existing >= SCRIPT_STUDIO_LIMITS.records) {
      transaction.abort()
      throw new Error('Script Studio record limit exceeded.')
    }
    store.put(structuredClone(validation.value))
    await transactionDone(transaction)
  }

  async get(id: string): Promise<ScriptStudioRecordV1 | undefined> {
    const database = await this.#database
    const transaction = database.transaction(RECORDS, 'readonly')
    const value = await requestResult(transaction.objectStore(RECORDS).get(id))
    await transactionDone(transaction)
    if (value === undefined) return undefined
    return this.#validatedOrWarn(id, value)
  }

  async list(): Promise<readonly ScriptStudioRecordV1[]> {
    const database = await this.#database
    const transaction = database.transaction(RECORDS, 'readonly')
    const values = (await requestResult(transaction.objectStore(RECORDS).getAll())) as unknown[]
    await transactionDone(transaction)
    const records: ScriptStudioRecordV1[] = []
    for (const value of values) {
      const id =
        typeof value === 'object' && value !== null && 'id' in value
          ? String((value as { readonly id?: unknown }).id)
          : 'unknown'
      const record = await this.#validatedOrWarn(id, value)
      if (record !== undefined) records.push(record)
    }
    return records.sort((left, right) => left.document.title.localeCompare(right.document.title))
  }

  async delete(id: string): Promise<void> {
    const database = await this.#database
    const transaction = database.transaction(RECORDS, 'readwrite')
    transaction.objectStore(RECORDS).delete(id)
    await transactionDone(transaction)
  }

  warnings(): readonly string[] {
    return [...this.#warnings]
  }

  async #validatedOrWarn(id: string, value: unknown): Promise<ScriptStudioRecordV1 | undefined> {
    const validation = validateScriptStudioRecord(value)
    if (validation.ok && validation.value !== undefined) {
      try {
        await assertScriptStudioRecordIntegrity(validation.value)
        return validation.value
      } catch {
        // Report the same bounded recovery warning as structurally corrupt content.
      }
    }
    const warning = `Ignored corrupt Script Studio record ${id}; import or recreate it to recover.`
    if (!this.#warnings.includes(warning)) this.#warnings.push(warning)
    return undefined
  }
}
