import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  LocalWorkbenchPreferenceStore,
  validatePreferences,
} from '../src/preferences.js'

describe('workbench preferences', () => {
  it('validates theme and clamps panel dimensions', () => {
    expect(
      validatePreferences({
        theme: 'light',
        leftPanelWidth: 9,
        rightPanelWidth: 9_000,
        bottomPanelHeight: 200,
      }),
    ).toEqual({ theme: 'light', leftPanelWidth: 184, rightPanelWidth: 420, bottomPanelHeight: 200 })
  })

  it('persists and restores bounded preferences through the interface', () => {
    let value: string | null = null
    const store = new LocalWorkbenchPreferenceStore({
      getItem: () => value,
      setItem: (_key, next) => {
        value = next
      },
    })
    expect(store.load()).toEqual(DEFAULT_PREFERENCES)
    store.save({ ...DEFAULT_PREFERENCES, theme: 'light', leftPanelWidth: 300 })
    expect(store.load()).toMatchObject({ theme: 'light', leftPanelWidth: 300 })
  })
})
