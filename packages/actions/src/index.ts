export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type JsonSchema = Readonly<{
  type?: 'array' | 'boolean' | 'integer' | 'null' | 'number' | 'object' | 'string'
  title?: string
  description?: string
  enum?: readonly JsonPrimitive[]
  properties?: Readonly<Record<string, JsonSchema>>
  required?: readonly string[]
  additionalProperties?: boolean
  items?: JsonSchema
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  maxItems?: number
}>

export type ActionMutability = 'read' | 'proposal' | 'mutation'
export type ActionCost = 'trivial' | 'interactive' | 'expensive' | 'external'

export interface WorkbenchActionDescriptorV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly version: number
  readonly title: string
  readonly description: string
  readonly category: string
  readonly inputSchema: JsonSchema
  readonly outputSchema: JsonSchema
  readonly mutability: ActionMutability
  readonly cost: ActionCost
  readonly permissions: readonly string[]
  readonly cancellable: boolean
}

export interface ActionValidationIssue {
  readonly path: string
  readonly message: string
}

export interface ActionAvailability {
  readonly available: boolean
  readonly reason?: string
}

export interface ActionCapabilityManifestV1 {
  readonly schemaVersion: 1
  readonly actions: readonly WorkbenchActionDescriptorV1[]
}

export interface ActionDefinition<Context> {
  readonly descriptor: WorkbenchActionDescriptorV1
  readonly availability?: (context: Context) => ActionAvailability
}

export interface ActionExecutionPlan {
  readonly actionId: string
  readonly actionVersion: number
  readonly mutability: ActionMutability
  readonly cost: ActionCost
  readonly permissions: readonly string[]
  readonly input: JsonValue
}

export interface ActionAbortSignal {
  readonly aborted: boolean
  throwIfAborted(): void
}

export interface ActionHandler<Context> {
  readonly dryRun?: (
    input: JsonValue,
    context: Context,
    signal: ActionAbortSignal,
  ) => Promise<JsonValue> | JsonValue
  readonly execute: (
    input: JsonValue,
    context: Context,
    signal: ActionAbortSignal,
  ) => Promise<JsonValue> | JsonValue
}

const MAX_DESCRIPTOR_TEXT = 4_096
const MAX_ACTIONS = 512

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonEqual(left: JsonPrimitive, right: unknown): boolean {
  return left === right
}

function validateSchemaValue(
  schema: JsonSchema,
  value: unknown,
  path: string,
  issues: ActionValidationIssue[],
): void {
  const type = schema.type
  const validType =
    type === undefined ||
    (type === 'null' && value === null) ||
    (type === 'array' && Array.isArray(value)) ||
    (type === 'object' && isRecord(value)) ||
    (type === 'integer' && typeof value === 'number' && Number.isInteger(value)) ||
    (type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
    (type === 'boolean' && typeof value === 'boolean') ||
    (type === 'string' && typeof value === 'string')
  if (!validType) {
    issues.push({ path, message: `Expected ${type ?? 'a JSON value'}.` })
    return
  }
  if (schema.enum !== undefined && !schema.enum.some((candidate) => jsonEqual(candidate, value))) {
    issues.push({ path, message: 'Value is not one of the permitted values.' })
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum)
      issues.push({ path, message: `Value must be at least ${schema.minimum}.` })
    if (schema.maximum !== undefined && value > schema.maximum)
      issues.push({ path, message: `Value must be at most ${schema.maximum}.` })
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      issues.push({ path, message: `Value must contain at least ${schema.minLength} characters.` })
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      issues.push({ path, message: `Value must contain at most ${schema.maxLength} characters.` })
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      issues.push({ path, message: `Array must contain at most ${schema.maxItems} items.` })
    if (schema.items !== undefined)
      value.forEach((item, index) => {
        validateSchemaValue(schema.items ?? {}, item, `${path}/${index}`, issues)
      })
  }
  if (isRecord(value) && schema.type === 'object') {
    for (const required of schema.required ?? []) {
      if (!(required in value))
        issues.push({ path: `${path}/${required}`, message: 'Required value is missing.' })
    }
    for (const [key, item] of Object.entries(value)) {
      const property = schema.properties?.[key]
      if (property !== undefined) validateSchemaValue(property, item, `${path}/${key}`, issues)
      else if (schema.additionalProperties === false)
        issues.push({ path: `${path}/${key}`, message: 'Unknown property.' })
    }
  }
}

export function validateActionInput(
  schema: JsonSchema,
  value: unknown,
): readonly ActionValidationIssue[] {
  const issues: ActionValidationIssue[] = []
  validateSchemaValue(schema, value, '', issues)
  return issues
}

function descriptorKey(id: string, version: number): string {
  return `${id}@${version}`
}

function assertDescriptor(descriptor: WorkbenchActionDescriptorV1): void {
  if (descriptor.schemaVersion !== 1) throw new Error('Unsupported action descriptor schema.')
  if (!/^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/u.test(descriptor.id))
    throw new Error(`Invalid action id: ${descriptor.id}`)
  if (!Number.isSafeInteger(descriptor.version) || descriptor.version < 1)
    throw new Error(`Invalid action version: ${descriptor.id}@${descriptor.version}`)
  for (const [label, value] of [
    ['title', descriptor.title],
    ['description', descriptor.description],
    ['category', descriptor.category],
  ] as const) {
    if (value.trim() === '' || value.length > MAX_DESCRIPTOR_TEXT)
      throw new Error(`Invalid action ${label}: ${descriptor.id}`)
  }
}

export class WorkbenchActionRegistry<Context> {
  readonly #definitions: readonly ActionDefinition<Context>[]
  readonly #byKey: ReadonlyMap<string, ActionDefinition<Context>>

  constructor(definitions: readonly ActionDefinition<Context>[]) {
    if (definitions.length > MAX_ACTIONS)
      throw new Error(`Action registry exceeds ${MAX_ACTIONS} actions.`)
    const ordered = [...definitions].sort(
      (left, right) =>
        left.descriptor.id.localeCompare(right.descriptor.id) ||
        left.descriptor.version - right.descriptor.version,
    )
    const byKey = new Map<string, ActionDefinition<Context>>()
    for (const definition of ordered) {
      assertDescriptor(definition.descriptor)
      const key = descriptorKey(definition.descriptor.id, definition.descriptor.version)
      if (byKey.has(key)) throw new Error(`Duplicate action descriptor: ${key}`)
      byKey.set(key, definition)
    }
    this.#definitions = Object.freeze(ordered)
    this.#byKey = byKey
  }

  list(): readonly WorkbenchActionDescriptorV1[] {
    return this.#definitions.map(({ descriptor }) => descriptor)
  }

  get(id: string, version: number): WorkbenchActionDescriptorV1 | undefined {
    return this.#byKey.get(descriptorKey(id, version))?.descriptor
  }

  availability(id: string, version: number, context: Context): ActionAvailability {
    const definition = this.#byKey.get(descriptorKey(id, version))
    if (definition === undefined) return { available: false, reason: 'Unknown action version.' }
    return definition.availability?.(context) ?? { available: true }
  }

  validate(id: string, version: number, input: unknown): readonly ActionValidationIssue[] {
    const descriptor = this.get(id, version)
    return descriptor === undefined
      ? [{ path: '', message: 'Unknown action version.' }]
      : validateActionInput(descriptor.inputSchema, input)
  }

  manifest(): ActionCapabilityManifestV1 {
    return { schemaVersion: 1, actions: this.list() }
  }
}

export class WorkbenchActionHost<Context> {
  readonly #registry: WorkbenchActionRegistry<Context>
  readonly #handlers: ReadonlyMap<string, ActionHandler<Context>>

  constructor(
    registry: WorkbenchActionRegistry<Context>,
    handlers: ReadonlyMap<string, ActionHandler<Context>>,
  ) {
    this.#registry = registry
    this.#handlers = handlers
  }

  plan(id: string, version: number, input: unknown, context: Context): ActionExecutionPlan {
    const descriptor = this.#registry.get(id, version)
    if (descriptor === undefined) throw new Error(`Unknown action: ${id}@${version}`)
    const availability = this.#registry.availability(id, version, context)
    if (!availability.available) throw new Error(availability.reason ?? 'Action is unavailable.')
    const issues = this.#registry.validate(id, version, input)
    if (issues.length > 0)
      throw new Error(issues.map(({ path, message }) => `${path || '/'}: ${message}`).join('\n'))
    return {
      actionId: id,
      actionVersion: version,
      mutability: descriptor.mutability,
      cost: descriptor.cost,
      permissions: descriptor.permissions,
      input: input as JsonValue,
    }
  }

  async dryRun(
    id: string,
    version: number,
    input: unknown,
    context: Context,
    signal: ActionAbortSignal,
  ): Promise<JsonValue> {
    const plan = this.plan(id, version, input, context)
    const handler = this.#handlers.get(descriptorKey(id, version))
    return handler?.dryRun === undefined
      ? (plan as unknown as JsonValue)
      : handler.dryRun(plan.input, context, signal)
  }

  async execute(
    id: string,
    version: number,
    input: unknown,
    context: Context,
    signal: ActionAbortSignal,
  ): Promise<JsonValue> {
    const plan = this.plan(id, version, input, context)
    const handler = this.#handlers.get(descriptorKey(id, version))
    if (handler === undefined) throw new Error(`No action handler registered: ${id}@${version}`)
    return handler.execute(plan.input, context, signal)
  }
}
