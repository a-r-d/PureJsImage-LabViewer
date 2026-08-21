import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  expandedBottomPanelHeight,
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
    ).toEqual({ theme: 'light', leftPanelWidth: 184, rightPanelWidth: 480, bottomPanelHeight: 200 })
  })

  it('expands the results panel into the lower half of the viewport', () => {
    expect(expandedBottomPanelHeight(1_000)).toBe(580)
    expect(expandedBottomPanelHeight(2_000)).toBe(720)
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
