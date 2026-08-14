import { describe, expect, it } from 'vitest'

import { getCommandAvailability, resolveShortcut } from '../src/commands.js'

const event = {
  key: 'f',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  target: null,
}

describe('workbench commands', () => {
  it('derives command availability from semantic context', () => {
    expect(getCommandAvailability({ hasDataset: false })['viewport.fit']).toBe(false)
    expect(getCommandAvailability({ hasDataset: true })['viewport.fit']).toBe(true)
  })

  it('resolves shortcuts only when their command is available', () => {
    expect(resolveShortcut(event, { hasDataset: false })).toBeUndefined()
    expect(resolveShortcut(event, { hasDataset: true })).toBe('viewport.fit')
  })

  it('resolves save and revision history shortcuts from semantic availability', () => {
    expect(
      resolveShortcut(
        { ...event, key: 's', ctrlKey: true },
        { hasDataset: false, canUndo: false, canRedo: false },
      ),
    ).toBe('workspace.save')
    expect(
      resolveShortcut(
        { ...event, key: 'z', ctrlKey: true },
        { hasDataset: true, canUndo: true, canRedo: false },
      ),
    ).toBe('workspace.undo')
    expect(
      resolveShortcut(
        { ...event, key: 'z', ctrlKey: true, shiftKey: true },
        { hasDataset: true, canUndo: false, canRedo: true },
      ),
    ).toBe('workspace.redo')
  })

  it('suppresses application shortcuts in editable controls', () => {
    expect(
      resolveShortcut(
        { ...event, key: 'k', ctrlKey: true, target: { tagName: 'INPUT' } as EventTarget },
        { hasDataset: true },
      ),
    ).toBeUndefined()
  })
})
