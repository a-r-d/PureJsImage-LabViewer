import { describe, expect, it, vi } from 'vitest'

import {
  type ActionDefinition,
  WorkbenchActionHost,
  WorkbenchActionRegistry,
} from '../src/index.js'

interface Context {
  readonly hasDataset: boolean
}

const definitions: readonly ActionDefinition<Context>[] = [
  {
    descriptor: {
      schemaVersion: 1,
      id: 'viewport.fit',
      version: 1,
      title: 'Fit image',
      description: 'Fit the active dataset in the viewport.',
      category: 'viewport',
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'null' },
      mutability: 'mutation',
      cost: 'trivial',
      permissions: ['viewport.propose'],
      cancellable: false,
    },
    availability: ({ hasDataset }) =>
      hasDataset ? { available: true } : { available: false, reason: 'Open a dataset first.' },
  },
  {
    descriptor: {
      schemaVersion: 1,
      id: 'project.set-title',
      version: 1,
      title: 'Set project title',
      description: 'Change the semantic project title.',
      category: 'project',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string', minLength: 1, maxLength: 4_096 } },
        required: ['title'],
        additionalProperties: false,
      },
      outputSchema: { type: 'null' },
      mutability: 'mutation',
      cost: 'trivial',
      permissions: ['workspace.propose'],
      cancellable: false,
    },
  },
]

describe('WorkbenchActionRegistry', () => {
  it('enumerates deterministically and resolves exact versions', () => {
    const registry = new WorkbenchActionRegistry([...definitions].toReversed())
    expect(registry.list().map(({ id }) => id)).toEqual(['project.set-title', 'viewport.fit'])
    expect(registry.get('viewport.fit', 1)?.title).toBe('Fit image')
    expect(registry.get('viewport.fit', 2)).toBeUndefined()
    expect(registry.manifest()).toEqual({ schemaVersion: 1, actions: registry.list() })
  })

  it('reports availability reasons and bounded schema issues', () => {
    const registry = new WorkbenchActionRegistry(definitions)
    expect(registry.availability('viewport.fit', 1, { hasDataset: false })).toEqual({
      available: false,
      reason: 'Open a dataset first.',
    })
    expect(registry.validate('project.set-title', 1, { title: '', extra: true })).toEqual([
      { path: '/title', message: 'Value must contain at least 1 characters.' },
      { path: '/extra', message: 'Unknown property.' },
    ])
  })

  it('validates before executing a registered handler', async () => {
    const registry = new WorkbenchActionRegistry(definitions)
    const execute = vi.fn(() => null)
    const host = new WorkbenchActionHost(registry, new Map([['project.set-title@1', { execute }]]))
    await expect(
      host.execute(
        'project.set-title',
        1,
        { title: 'Microscopy project' },
        { hasDataset: false },
        new AbortController().signal,
      ),
    ).resolves.toBeNull()
    expect(execute).toHaveBeenCalledOnce()
    await expect(
      host.execute(
        'project.set-title',
        1,
        { title: '' },
        { hasDataset: false },
        new AbortController().signal,
      ),
    ).rejects.toThrow('at least 1 characters')
  })

  it('rejects handler output that violates the public action schema', async () => {
    const registry = new WorkbenchActionRegistry(definitions)
    const host = new WorkbenchActionHost(
      registry,
      new Map([['project.set-title@1', { execute: () => ({ unexpected: true }) }]]),
    )
    await expect(
      host.execute(
        'project.set-title',
        1,
        { title: 'Valid input' },
        { hasDataset: false },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Action output failed validation')
  })
})
