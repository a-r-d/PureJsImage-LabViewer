import type { SandboxLimitsV1 } from '@pji-workbench/plugin-sdk'

export const DEFAULT_SANDBOX_LIMITS: SandboxLimitsV1 = Object.freeze({
  memoryBytes: 32 * 1024 * 1024,
  stackBytes: 512 * 1024,
  deadlineMilliseconds: 2_000,
  sourceBytes: 256 * 1024,
  outputBytes: 128 * 1024,
  messages: 256,
  messageBytes: 128 * 1024,
  apiCalls: 64,
  consoleLines: 128,
})
