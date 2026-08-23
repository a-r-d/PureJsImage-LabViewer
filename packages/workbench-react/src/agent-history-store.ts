import {
  type AgentRunStatus,
  type AgentRuntimeSnapshot,
  type AgentTurnAction,
  compactTurnActions,
} from '@pji-workbench/agent'

const DATABASE_NAME = 'purejsimage-agent-history-v1'
const DATABASE_VERSION = 1
const SESSIONS = 'sessions'
const MAXIMUM_SESSIONS_PER_SCOPE = 64
const MAXIMUM_TURNS_PER_SESSION = 128
const MAXIMUM_SESSION_BYTES = 512 * 1_024
const MAXIMUM_REQUEST_CHARACTERS = 16_384
const MAXIMUM_ANSWER_CHARACTERS = 65_536
const MAXIMUM_ERROR_CHARACTERS = 2_048

export type AgentHistoryTurnOutcome = 'active' | 'completed' | 'cancelled' | 'failed'

export interface AgentHistoryTurn {
  readonly id: string
  readonly request: string
  readonly answer?: string
  readonly model?: string
  readonly startedAt: string
  readonly completedAt?: string
  readonly outcome: AgentHistoryTurnOutcome
  readonly actions: readonly AgentTurnAction[]
  readonly error?: Readonly<{ code: string; message: string }>
}

export interface AgentHistorySession {
  readonly schemaVersion: 1
  readonly key: string
  readonly id: string
  readonly scope: string
  readonly title: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly status: AgentHistoryTurnOutcome
  readonly turns: readonly AgentHistoryTurn[]
}

export interface AgentHistoryStore {
  upsert(session: AgentHistorySession): Promise<void>
  list(scope: string): Promise<readonly AgentHistorySession[]>
  delete(scope: string, id: string): Promise<void>
  clear(scope: string): Promise<void>
}

export interface ActiveAgentHistoryRequest {
  readonly request: string
  readonly turnCount: number
  readonly startedAt: string
}

export function createAgentHistorySessionId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  )
}

export function agentHistoryOutcome(status: AgentRunStatus): AgentHistoryTurnOutcome {
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'completed') return 'completed'
  return 'active'
}

export function agentHistorySessionFromSnapshot(
  metadata: Readonly<{
    id: string
    scope: string
    createdAt: string
    updatedAt: string
  }>,
  snapshot: AgentRuntimeSnapshot,
  activeRequest?: ActiveAgentHistoryRequest,
): AgentHistorySession | undefined {
  const turns: AgentHistoryTurn[] = snapshot.conversation.map((turn) => ({
    id: turn.id,
    request: turn.request,
    answer: turn.answer,
    model: turn.model,
    startedAt: turn.completedAt,
    completedAt: turn.completedAt,
    outcome: 'completed',
    actions: turn.actions,
  }))
  if (activeRequest !== undefined && snapshot.conversationTurnCount === activeRequest.turnCount) {
    const turnOutcome = agentHistoryOutcome(snapshot.status)
    const completedAt =
      turnOutcome === 'active' ? undefined : (snapshot.audit?.completedAt ?? metadata.updatedAt)
    turns.push({
      id: snapshot.activeTaskId ?? snapshot.audit?.id ?? `${metadata.id}-active`,
      request: activeRequest.request,
      ...(snapshot.model === undefined ? {} : { model: snapshot.model }),
      startedAt: activeRequest.startedAt,
      ...(completedAt === undefined ? {} : { completedAt }),
      outcome: turnOutcome,
      actions: compactTurnActions(snapshot.trace),
      ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
    })
  }
  if (turns.length === 0) return undefined
  const latest = turns.at(-1)
  if (latest === undefined) return undefined
  return boundedAgentHistorySession({
    schemaVersion: 1,
    key: `${metadata.scope}:${metadata.id}`,
    id: metadata.id,
    scope: metadata.scope,
    title: turns[0]?.request.slice(0, 256) ?? 'Agent session',
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    status: latest.outcome,
    turns,
  })
}

export function normalizeAgentHistorySession(value: unknown): AgentHistorySession {
  const record = requiredRecord(value, 'Agent history session')
  if (record['schemaVersion'] !== 1) throw new Error('Agent history schema version is unsupported.')
  const scope = boundedString(record['scope'], 'Agent history scope', 128)
  const id = boundedString(record['id'], 'Agent history session ID', 256)
  const key = `${scope}:${id}`
  if (record['key'] !== key) throw new Error('Agent history session key is invalid.')
  const rawTurns = record['turns']
  if (!Array.isArray(rawTurns) || rawTurns.length > MAXIMUM_TURNS_PER_SESSION)
    throw new Error('Agent history turn count is invalid.')
  const turns = rawTurns.map(normalizeTurn)
  const session: AgentHistorySession = {
    schemaVersion: 1,
    key,
    id,
    scope,
    title: redactCredentialText(boundedString(record['title'], 'Agent history title', 256)),
    createdAt: timestamp(record['createdAt'], 'Agent history creation time'),
    updatedAt: timestamp(record['updatedAt'], 'Agent history update time'),
    status: outcome(record['status']),
    turns,
  }
  if (encodedBytes(session) > MAXIMUM_SESSION_BYTES)
    throw new Error('Agent history session exceeds its byte limit.')
  return Object.freeze(session)
}

export function boundedAgentHistorySession(session: AgentHistorySession): AgentHistorySession {
  let turns = session.turns.slice(-MAXIMUM_TURNS_PER_SESSION).map(normalizeTurn)
  let candidate = normalizeSessionWithoutByteCheck({ ...session, turns })
  while (turns.length > 1 && encodedBytes(candidate) > MAXIMUM_SESSION_BYTES) {
    turns = turns.slice(1)
    candidate = normalizeSessionWithoutByteCheck({ ...session, turns })
  }
  if (encodedBytes(candidate) > MAXIMUM_SESSION_BYTES)
    throw new Error('The latest agent history turn exceeds its byte limit.')
  return Object.freeze(candidate)
}

export class IndexedDbAgentHistoryStore implements AgentHistoryStore {
  readonly #database: Promise<IDBDatabase>

  constructor(factory: IDBFactory, databaseName = DATABASE_NAME) {
    this.#database = openDatabase(factory, databaseName)
  }

  async upsert(session: AgentHistorySession): Promise<void> {
    const normalized = boundedAgentHistorySession(session)
    const database = await this.#database
    const transaction = database.transaction(SESSIONS, 'readwrite')
    transaction.objectStore(SESSIONS).put(structuredClone(normalized))
    await transactionDone(transaction)
    await this.#prune(normalized.scope)
  }

  async list(scope: string): Promise<readonly AgentHistorySession[]> {
    const normalizedScope = boundedString(scope, 'Agent history scope', 128)
    const database = await this.#database
    const transaction = database.transaction(SESSIONS, 'readonly')
    const values = (await requestResult(transaction.objectStore(SESSIONS).getAll())) as unknown[]
    await transactionDone(transaction)
    return values
      .flatMap((value) => {
        try {
          const session = normalizeAgentHistorySession(value)
          return session.scope === normalizedScope ? [session] : []
        } catch {
          return []
        }
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async delete(scope: string, id: string): Promise<void> {
    const key = `${boundedString(scope, 'Agent history scope', 128)}:${boundedString(id, 'Agent history session ID', 256)}`
    const database = await this.#database
    const transaction = database.transaction(SESSIONS, 'readwrite')
    transaction.objectStore(SESSIONS).delete(key)
    await transactionDone(transaction)
  }

  async clear(scope: string): Promise<void> {
    const sessions = await this.list(scope)
    const database = await this.#database
    const transaction = database.transaction(SESSIONS, 'readwrite')
    const store = transaction.objectStore(SESSIONS)
    for (const session of sessions) store.delete(session.key)
    await transactionDone(transaction)
  }

  async #prune(scope: string): Promise<void> {
    const sessions = await this.list(scope)
    if (sessions.length <= MAXIMUM_SESSIONS_PER_SCOPE) return
    const database = await this.#database
    const transaction = database.transaction(SESSIONS, 'readwrite')
    const store = transaction.objectStore(SESSIONS)
    for (const session of sessions.slice(MAXIMUM_SESSIONS_PER_SCOPE)) store.delete(session.key)
    await transactionDone(transaction)
  }
}

export class InMemoryAgentHistoryStore implements AgentHistoryStore {
  readonly #sessions = new Map<string, AgentHistorySession>()

  async upsert(session: AgentHistorySession): Promise<void> {
    const normalized = boundedAgentHistorySession(session)
    this.#sessions.set(normalized.key, normalized)
    const sessions = await this.list(normalized.scope)
    for (const item of sessions.slice(MAXIMUM_SESSIONS_PER_SCOPE)) this.#sessions.delete(item.key)
  }

  async list(scope: string): Promise<readonly AgentHistorySession[]> {
    const normalizedScope = boundedString(scope, 'Agent history scope', 128)
    return [...this.#sessions.values()]
      .filter((session) => session.scope === normalizedScope)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async delete(scope: string, id: string): Promise<void> {
    this.#sessions.delete(
      `${boundedString(scope, 'Agent history scope', 128)}:${boundedString(id, 'Agent history session ID', 256)}`,
    )
  }

  async clear(scope: string): Promise<void> {
    for (const session of await this.list(scope)) this.#sessions.delete(session.key)
  }
}

function normalizeSessionWithoutByteCheck(value: AgentHistorySession): AgentHistorySession {
  const scope = boundedString(value.scope, 'Agent history scope', 128)
  const id = boundedString(value.id, 'Agent history session ID', 256)
  return {
    schemaVersion: 1,
    key: `${scope}:${id}`,
    id,
    scope,
    title: redactCredentialText(boundedString(value.title, 'Agent history title', 256)),
    createdAt: timestamp(value.createdAt, 'Agent history creation time'),
    updatedAt: timestamp(value.updatedAt, 'Agent history update time'),
    status: outcome(value.status),
    turns: value.turns.map(normalizeTurn),
  }
}

function normalizeTurn(value: unknown): AgentHistoryTurn {
  const record = requiredRecord(value, 'Agent history turn')
  const answer = optionalBoundedString(
    record['answer'],
    'Agent history answer',
    MAXIMUM_ANSWER_CHARACTERS,
  )
  const model = optionalBoundedString(record['model'], 'Agent history model', 256)
  const completedAt = optionalTimestamp(record['completedAt'], 'Agent history completion time')
  const errorRecord =
    record['error'] === undefined
      ? undefined
      : requiredRecord(record['error'], 'Agent history error')
  const rawActions = record['actions']
  if (!Array.isArray(rawActions) || rawActions.length > 64)
    throw new Error('Agent history action count is invalid.')
  return Object.freeze({
    id: boundedString(record['id'], 'Agent history turn ID', 256),
    request: redactCredentialText(
      boundedString(record['request'], 'Agent history request', MAXIMUM_REQUEST_CHARACTERS),
    ),
    ...(answer === undefined ? {} : { answer: redactCredentialText(answer) }),
    ...(model === undefined ? {} : { model }),
    startedAt: timestamp(record['startedAt'], 'Agent history start time'),
    ...(completedAt === undefined ? {} : { completedAt }),
    outcome: outcome(record['outcome']),
    actions: rawActions.map(normalizeAction),
    ...(errorRecord === undefined
      ? {}
      : {
          error: Object.freeze({
            code: boundedString(errorRecord['code'], 'Agent history error code', 128),
            message: redactCredentialText(
              boundedString(
                errorRecord['message'],
                'Agent history error message',
                MAXIMUM_ERROR_CHARACTERS,
              ),
            ),
          }),
        }),
  })
}

function normalizeAction(value: unknown): AgentTurnAction {
  const record = requiredRecord(value, 'Agent history action')
  const approval = record['approval']
  if (approval !== 'automatic' && approval !== 'approved' && approval !== 'remembered')
    throw new Error('Agent history action approval is invalid.')
  const version = record['actionVersion']
  if (!Number.isSafeInteger(version) || Number(version) < 1)
    throw new Error('Agent history action version is invalid.')
  return Object.freeze({
    callId: boundedString(record['callId'], 'Agent history call ID', 256),
    actionId: boundedString(record['actionId'], 'Agent history action ID', 512),
    actionVersion: Number(version),
    approval,
  })
}

function requiredRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object.`)
  return value as Readonly<Record<string, unknown>>
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum)
    throw new Error(`${label} must contain 1-${maximum} characters.`)
  return value
}

function optionalBoundedString(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined) return undefined
  return boundedString(value, label, maximum)
}

function timestamp(value: unknown, label: string): string {
  const text = boundedString(value, label, 64)
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} is invalid.`)
  return text
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : timestamp(value, label)
}

function outcome(value: unknown): AgentHistoryTurnOutcome {
  if (value === 'active' || value === 'completed' || value === 'cancelled' || value === 'failed')
    return value
  throw new Error('Agent history outcome is invalid.')
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function redactCredentialText(value: string): string {
  return value
    .replace(/sk-or-v1-[A-Za-z0-9_-]{8,}/gu, '[redacted OpenRouter key]')
    .replace(/sk-or-[A-Za-z0-9_-]{8,}/gu, '[redacted OpenRouter key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}/gu, 'Bearer [redacted credential]')
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Agent history IndexedDB request failed.')),
      { once: true },
    )
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('Agent history transaction aborted.')),
      { once: true },
    )
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('Agent history transaction failed.')),
      { once: true },
    )
  })
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION)
    request.addEventListener('upgradeneeded', () => {
      const database = request.result
      if (!database.objectStoreNames.contains(SESSIONS))
        database.createObjectStore(SESSIONS, { keyPath: 'key' })
    })
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Unable to open agent history IndexedDB.')),
      { once: true },
    )
    request.addEventListener(
      'blocked',
      () => reject(new Error('Agent history storage migration is blocked by another tab.')),
      { once: true },
    )
  })
}
