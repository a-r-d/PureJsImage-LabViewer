import { describe, expect, it, vi } from 'vitest'

import {
  formatWorkbenchStatus,
  getThemeColor,
  isThemeName,
  nextSplitterValue,
  restoreFocus,
  themeVariables,
} from '../src/index.js'

describe('design system contracts', () => {
  it('provides a complete accessible status phrase', () => {
    expect(formatWorkbenchStatus('ready')).toBe('Workbench status: ready')
  })

  it('exposes typed dark and light theme values as CSS variables', () => {
    expect(getThemeColor('dark', 'background')).not.toBe(getThemeColor('light', 'background'))
    expect(themeVariables('dark')).toMatchObject({ '--wb-font-ui': expect.any(String) })
    expect(isThemeName('dark')).toBe(true)
    expect(isThemeName('system')).toBe(false)
  })

  it('moves splitters with orientation-aware keyboard controls', () => {
    expect(nextSplitterValue(240, 'ArrowRight', 180, 420, 'vertical')).toBe(256)
    expect(nextSplitterValue(240, 'ArrowUp', 120, 300, 'horizontal')).toBe(224)
    expect(nextSplitterValue(240, 'Home', 180, 420, 'vertical')).toBe(180)
    expect(nextSplitterValue(240, 'End', 180, 420, 'vertical')).toBe(420)
  })

  it('restores focus after an overlay closes', () => {
    const focus = vi.fn()
    restoreFocus({ focus })
    expect(focus).toHaveBeenCalledOnce()
  })
})
