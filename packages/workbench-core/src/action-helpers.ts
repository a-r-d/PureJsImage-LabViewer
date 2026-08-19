import type { ActionHandler, JsonValue } from '@pji-workbench/actions'
import type { RpcJsonObject } from '@pji-workbench/contracts'

export function rpcObject(value: unknown): RpcJsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RpcJsonObject)
    : undefined
}

export function commandAction<Context>(
  execute: () => Promise<void> | void,
): ActionHandler<Context> {
  return {
    execute: async () => {
      await execute()
      return null
    },
  }
}

export function fixtureAction<Context>(
  execute: (input: JsonValue) => JsonValue | Promise<JsonValue>,
): ActionHandler<Context> {
  return {
    dryRun: (input) => execute(input),
    execute: (input) => execute(input),
  }
}

export function executeOnlyAction<Context>(
  execute: (input: JsonValue) => JsonValue | Promise<JsonValue>,
): ActionHandler<Context> {
  return { execute: (input) => execute(input) }
}
