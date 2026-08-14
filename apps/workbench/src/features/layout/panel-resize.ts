import type { PointerEvent as ReactPointerEvent } from 'react'

import { PREFERENCE_BOUNDS, type WorkbenchPreferences } from '../../preferences.js'

export interface ResizeConfig {
  readonly key: 'leftPanelWidth' | 'rightPanelWidth' | 'bottomPanelHeight'
  readonly axis: 'x' | 'y'
  readonly direction: 1 | -1
}

export function startPanelResize(
  config: ResizeConfig,
  event: ReactPointerEvent<HTMLHRElement>,
  preferences: WorkbenchPreferences,
  update: (patch: Partial<WorkbenchPreferences>, persist?: boolean) => void,
): void {
  event.preventDefault()
  const startPosition = config.axis === 'x' ? event.clientX : event.clientY
  const startValue = preferences[config.key]
  const bounds = PREFERENCE_BOUNDS[config.key]
  let lastValue = startValue
  const move = (moveEvent: PointerEvent): void => {
    const position = config.axis === 'x' ? moveEvent.clientX : moveEvent.clientY
    lastValue = Math.min(
      bounds.maximum,
      Math.max(bounds.minimum, startValue + (position - startPosition) * config.direction),
    )
    update({ [config.key]: lastValue }, false)
  }
  const stop = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    update({ [config.key]: lastValue })
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop, { once: true })
}
