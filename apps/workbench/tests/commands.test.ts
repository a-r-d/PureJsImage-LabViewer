import { describe, expect, it } from 'vitest'

import {
  getCommandAvailability,
  resolveShortcut,
  workbenchActionRegistry,
} from '../src/commands.js'

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

  it('registers bounded, revision-checked Script Studio actions', () => {
    const ids = workbenchActionRegistry
      .list()
      .filter(({ category }) => category === 'scripts')
      .map(({ id }) => id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'script.create_draft',
        'script.read',
        'script.apply_patch',
        'script.typecheck',
        'script.run_tests',
        'script.diff',
        'script.request_install',
        'script.request_execute',
      ]),
    )
    expect(
      workbenchActionRegistry.validate('script.apply_patch', 1, {
        id: 'local.script',
        expectedDigest: 'a'.repeat(64),
        source: 'x'.repeat(256 * 1024 + 1),
      }),
    ).toContainEqual({ path: '/source', message: 'Value must contain at most 262144 characters.' })
    expect(
      workbenchActionRegistry.validate('script.request_execute', 1, {
        id: 'local.script',
        expectedDigest: 'short',
      }),
    ).not.toEqual([])
  })
})
