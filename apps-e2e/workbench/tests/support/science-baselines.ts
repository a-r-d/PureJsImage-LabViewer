import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface ScienceWorkbenchBaselines {
  readonly schemaVersion: 1
  readonly application: 'science-workbench'
  readonly recordedAt: string
  readonly budgets: {
    readonly routeChunkGzipBytes: number
    readonly languageWorkerGzipBytes: number
    readonly warmShellInteractiveMilliseconds: number
    readonly largestTilePixels: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readScienceWorkbenchBaselines(): ScienceWorkbenchBaselines {
  const raw: unknown = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../../tooling/baselines/science-workbench.json', import.meta.url),
      ),
      'utf8',
    ),
  )
  if (
    !isRecord(raw) ||
    raw['schemaVersion'] !== 1 ||
    raw['application'] !== 'science-workbench' ||
    typeof raw['recordedAt'] !== 'string' ||
    !isRecord(raw['budgets'])
  ) {
    throw new Error('Science workbench performance baseline is missing or invalid.')
  }
  const budgets = raw['budgets']
  const routeChunkGzipBytes = budgets['routeChunkGzipBytes']
  const languageWorkerGzipBytes = budgets['languageWorkerGzipBytes']
  const warmShellInteractiveMilliseconds = budgets['warmShellInteractiveMilliseconds']
  const largestTilePixels = budgets['largestTilePixels']
  if (
    typeof routeChunkGzipBytes !== 'number' ||
    typeof languageWorkerGzipBytes !== 'number' ||
    typeof warmShellInteractiveMilliseconds !== 'number' ||
    typeof largestTilePixels !== 'number'
  ) {
    throw new Error('Science workbench performance budgets are missing or invalid.')
  }
  return {
    schemaVersion: 1,
    application: 'science-workbench',
    recordedAt: raw['recordedAt'],
    budgets: {
      routeChunkGzipBytes,
      languageWorkerGzipBytes,
      warmShellInteractiveMilliseconds,
      largestTilePixels,
    },
  }
}
