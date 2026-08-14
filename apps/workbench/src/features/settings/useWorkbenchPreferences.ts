import type { CSSProperties } from 'react'
import { useCallback, useMemo, useState } from 'react'

import type { WorkbenchPreferences } from '../../preferences.js'

interface PreferenceStore {
  load(): WorkbenchPreferences
  save(preferences: WorkbenchPreferences): void
}

export function useWorkbenchPreferences(store: PreferenceStore) {
  const [preferences, setPreferences] = useState(() => store.load())
  const updatePreferences = useCallback(
    (update: Partial<WorkbenchPreferences>, persist = true): void => {
      setPreferences((current) => {
        const next = { ...current, ...update }
        if (persist) store.save(next)
        return next
      })
    },
    [store],
  )
  const preferenceStyle = useMemo(
    () =>
      ({
        '--left-panel-width': `${preferences.leftPanelWidth}px`,
        '--right-panel-width': `${preferences.rightPanelWidth}px`,
        '--bottom-panel-height': `${preferences.bottomPanelHeight}px`,
      }) as CSSProperties,
    [preferences.bottomPanelHeight, preferences.leftPanelWidth, preferences.rightPanelWidth],
  )
  return { preferences, preferenceStyle, updatePreferences } as const
}
