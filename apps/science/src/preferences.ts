import { isThemeName, type ThemeName } from '@pji-workbench/ui'

export interface WorkbenchPreferences {
  readonly theme: ThemeName
  readonly leftPanelWidth: number
  readonly rightPanelWidth: number
  readonly bottomPanelHeight: number
}

export interface WorkbenchPreferenceStore {
  load(): WorkbenchPreferences
  save(preferences: WorkbenchPreferences): void
}

export const DEFAULT_PREFERENCES: WorkbenchPreferences = {
  theme: 'dark',
  leftPanelWidth: 248,
  rightPanelWidth: 344,
  bottomPanelHeight: 188,
}

export const PREFERENCE_BOUNDS = {
  leftPanelWidth: { minimum: 184, maximum: 380 },
  rightPanelWidth: { minimum: 300, maximum: 480 },
  bottomPanelHeight: { minimum: 126, maximum: 320 },
} as const

const PREFERENCE_KEY = 'purejsimage.workbench.preferences.v1'

function boundedNumber(
  value: unknown,
  fallback: number,
  bounds: { readonly minimum: number; readonly maximum: number },
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(bounds.maximum, Math.max(bounds.minimum, value))
    : fallback
}

export function validatePreferences(value: unknown): WorkbenchPreferences {
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFERENCES
  const candidate = value as {
    readonly theme?: unknown
    readonly leftPanelWidth?: unknown
    readonly rightPanelWidth?: unknown
    readonly bottomPanelHeight?: unknown
  }
  return {
    theme: isThemeName(candidate.theme) ? candidate.theme : DEFAULT_PREFERENCES.theme,
    leftPanelWidth: boundedNumber(
      candidate.leftPanelWidth,
      DEFAULT_PREFERENCES.leftPanelWidth,
      PREFERENCE_BOUNDS.leftPanelWidth,
    ),
    rightPanelWidth: boundedNumber(
      candidate.rightPanelWidth,
      DEFAULT_PREFERENCES.rightPanelWidth,
      PREFERENCE_BOUNDS.rightPanelWidth,
    ),
    bottomPanelHeight: boundedNumber(
      candidate.bottomPanelHeight,
      DEFAULT_PREFERENCES.bottomPanelHeight,
      PREFERENCE_BOUNDS.bottomPanelHeight,
    ),
  }
}

export class LocalWorkbenchPreferenceStore implements WorkbenchPreferenceStore {
  readonly #storage: Pick<Storage, 'getItem' | 'setItem'>

  constructor(storage: Pick<Storage, 'getItem' | 'setItem'>) {
    this.#storage = storage
  }

  load(): WorkbenchPreferences {
    try {
      const serialized = this.#storage.getItem(PREFERENCE_KEY)
      return serialized === null ? DEFAULT_PREFERENCES : validatePreferences(JSON.parse(serialized))
    } catch {
      return DEFAULT_PREFERENCES
    }
  }

  save(preferences: WorkbenchPreferences): void {
    try {
      this.#storage.setItem(PREFERENCE_KEY, JSON.stringify(validatePreferences(preferences)))
    } catch {
      // Preferences are deliberately best-effort; workspace data is never written here.
    }
  }
}
