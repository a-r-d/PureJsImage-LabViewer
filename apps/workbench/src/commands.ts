import {
  type ActionDefinition,
  type WorkbenchActionDescriptorV1,
  WorkbenchActionRegistry,
} from '@pji-workbench/actions'

export type CommandId =
  | 'palette.open'
  | 'panel.agent'
  | 'theme.toggle'
  | 'viewport.fit'
  | 'viewport.oneToOne'
  | 'workspace.export'
  | 'workspace.new'
  | 'workspace.openProject'
  | 'workspace.openSample'
  | 'workspace.redo'
  | 'workspace.save'
  | 'workspace.undo'

export type WorkbenchActionId =
  | CommandId
  | 'analysis.connected-components.execute'
  | 'analysis.connected-components.plan'
  | 'analysis.threshold.commit'
  | 'analysis.threshold.preview'
  | 'panel.select'
  | 'pipeline.node.remove'
  | 'result.page.read'
  | 'roi.create'
  | 'roi.remove'
  | 'roi.select'
  | 'source.open-local'
  | 'source.open-remote'
  | 'viewport.state.read'

export interface CommandContext {
  readonly hasDataset: boolean
  readonly canUndo?: boolean
  readonly canRedo?: boolean
}

interface CommandPresentation {
  readonly id: CommandId
  readonly shortcut?: string
}

export interface WorkbenchCommand extends CommandPresentation {
  readonly label: string
}

const EMPTY_INPUT = { type: 'object', additionalProperties: false } as const
const NULL_OUTPUT = { type: 'null' } as const

function descriptor(
  id: WorkbenchActionId,
  title: string,
  description: string,
  category: string,
  options: Partial<
    Pick<
      WorkbenchActionDescriptorV1,
      'cancellable' | 'cost' | 'inputSchema' | 'mutability' | 'outputSchema' | 'permissions'
    >
  > = {},
): WorkbenchActionDescriptorV1 {
  return {
    schemaVersion: 1,
    id,
    version: 1,
    title,
    description,
    category,
    inputSchema: options.inputSchema ?? EMPTY_INPUT,
    outputSchema: options.outputSchema ?? NULL_OUTPUT,
    mutability: options.mutability ?? 'mutation',
    cost: options.cost ?? 'trivial',
    permissions: options.permissions ?? ['workspace.propose'],
    cancellable: options.cancellable ?? false,
  }
}

const requiresDataset = ({ hasDataset }: CommandContext) =>
  hasDataset ? { available: true } : { available: false, reason: 'Open a dataset first.' }
const requiresUndo = ({ canUndo }: CommandContext) =>
  canUndo === true ? { available: true } : { available: false, reason: 'Nothing to undo.' }
const requiresRedo = ({ canRedo }: CommandContext) =>
  canRedo === true ? { available: true } : { available: false, reason: 'Nothing to redo.' }

const actionDefinitions: readonly ActionDefinition<CommandContext>[] = [
  {
    descriptor: descriptor(
      'workspace.new',
      'New project',
      'Create a new local workspace.',
      'project',
    ),
  },
  {
    descriptor: descriptor(
      'workspace.openProject',
      'Open recent project',
      'Open the local project browser.',
      'project',
    ),
  },
  {
    descriptor: descriptor(
      'workspace.save',
      'Save project locally',
      'Save the current project to IndexedDB.',
      'project',
    ),
  },
  {
    descriptor: descriptor(
      'workspace.export',
      'Export project JSON',
      'Export a bounded project document.',
      'project',
      { cost: 'external', permissions: ['file.export'] },
    ),
  },
  {
    descriptor: descriptor(
      'workspace.undo',
      'Undo project change',
      'Undo one semantic project command.',
      'project',
    ),
    availability: requiresUndo,
  },
  {
    descriptor: descriptor(
      'workspace.redo',
      'Redo project change',
      'Redo one semantic project command.',
      'project',
    ),
    availability: requiresRedo,
  },
  {
    descriptor: descriptor(
      'workspace.openSample',
      'Open sample SEM image',
      'Open the deterministic generated calibrated sample.',
      'source',
      { cost: 'interactive', cancellable: true, permissions: ['source.read-metadata'] },
    ),
  },
  {
    descriptor: descriptor(
      'source.open-local',
      'Open local source',
      'Open user-selected local scientific files.',
      'source',
      { cost: 'interactive', cancellable: true, permissions: ['source.read-metadata'] },
    ),
  },
  {
    descriptor: descriptor(
      'source.open-remote',
      'Open remote source',
      'Open an explicit HTTPS range-backed source.',
      'source',
      { cost: 'external', cancellable: true, permissions: ['network.explicit-hosts'] },
    ),
  },
  {
    descriptor: descriptor(
      'viewport.fit',
      'Fit image to viewport',
      'Fit the active dataset in the specimen viewport.',
      'viewport',
      { permissions: ['viewport.propose'] },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'viewport.oneToOne',
      'Set viewport to 1:1',
      'Show one source pixel per display pixel.',
      'viewport',
      { permissions: ['viewport.propose'] },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'viewport.state.read',
      'Read viewport state',
      'Read a bounded camera and selection summary.',
      'viewport',
      { mutability: 'read', permissions: ['viewport.read'] },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'roi.create',
      'Create ROI',
      'Create a validated ROI on the active dataset.',
      'roi',
      { cost: 'interactive', cancellable: true, permissions: ['roi.propose'] },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor('roi.select', 'Select ROI', 'Select a workspace ROI.', 'roi', {
      permissions: ['roi.propose'],
    }),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'roi.remove',
      'Remove ROI',
      'Remove a workspace ROI through project history.',
      'roi',
      { permissions: ['roi.propose'] },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'analysis.threshold.preview',
      'Preview threshold',
      'Run a bounded threshold preview without project history.',
      'analysis',
      { cost: 'interactive', cancellable: true, permissions: ['analysis.execute'] },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'analysis.threshold.commit',
      'Commit threshold',
      'Normalize and commit one threshold graph change.',
      'analysis',
      { cost: 'interactive', cancellable: true, permissions: ['analysis.execute'] },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'analysis.connected-components.plan',
      'Plan connected components',
      'Dry-run connected components and return resource estimates.',
      'analysis',
      {
        mutability: 'read',
        cost: 'interactive',
        cancellable: true,
        permissions: ['analysis.dry-run'],
      },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'analysis.connected-components.execute',
      'Run connected components',
      'Execute the reviewed connected-components plan.',
      'analysis',
      { cost: 'expensive', cancellable: true, permissions: ['analysis.execute'] },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'result.page.read',
      'Read result page',
      'Read one bounded page from a result table.',
      'results',
      {
        mutability: 'read',
        cost: 'interactive',
        cancellable: true,
        permissions: ['result.read-page'],
      },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'pipeline.node.remove',
      'Remove pipeline node',
      'Remove an unconsumed operation node.',
      'pipeline',
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'panel.select',
      'Select workbench panel',
      'Open a named workbench surface.',
      'ui',
      { permissions: ['ui.propose'] },
    ),
  },
  {
    descriptor: descriptor(
      'panel.agent',
      'Show agent panel',
      'Open the disabled future-agent surface.',
      'ui',
      { permissions: ['ui.propose'] },
    ),
  },
  {
    descriptor: descriptor(
      'theme.toggle',
      'Toggle color theme',
      'Switch between light and dark workbench themes.',
      'settings',
      { permissions: ['ui.propose'] },
    ),
  },
  {
    descriptor: descriptor(
      'palette.open',
      'Open command palette',
      'Search available semantic workbench actions.',
      'ui',
      { permissions: ['ui.propose'] },
    ),
  },
]

export const workbenchActionRegistry = new WorkbenchActionRegistry(actionDefinitions)

const commandPresentation: readonly CommandPresentation[] = [
  { id: 'workspace.new', shortcut: 'Ctrl+Shift+N' },
  { id: 'workspace.openProject', shortcut: 'Ctrl+Shift+O' },
  { id: 'workspace.save', shortcut: 'Ctrl+S' },
  { id: 'workspace.export' },
  { id: 'workspace.undo', shortcut: 'Ctrl+Z' },
  { id: 'workspace.redo', shortcut: 'Ctrl+Shift+Z' },
  { id: 'workspace.openSample', shortcut: 'Ctrl+O' },
  { id: 'viewport.fit', shortcut: 'F' },
  { id: 'viewport.oneToOne', shortcut: '1' },
  { id: 'panel.agent', shortcut: 'Ctrl+Shift+A' },
  { id: 'theme.toggle', shortcut: 'Ctrl+Shift+T' },
  { id: 'palette.open', shortcut: 'Ctrl+K' },
]

export const workbenchCommands: readonly WorkbenchCommand[] = commandPresentation.map(
  (presentation) => ({
    ...presentation,
    label: workbenchActionRegistry.get(presentation.id, 1)?.title ?? presentation.id,
  }),
)

export interface ShortcutEvent {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly target: EventTarget | null
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false
  const candidate = target as { readonly tagName?: unknown; readonly isContentEditable?: unknown }
  const tagName = typeof candidate.tagName === 'string' ? candidate.tagName.toLowerCase() : ''
  return ['input', 'textarea', 'select'].includes(tagName) || candidate.isContentEditable === true
}

function commandForShortcut(event: ShortcutEvent): CommandId | undefined {
  const key = event.key.toLowerCase()
  const control = event.ctrlKey || event.metaKey
  if (control && !event.shiftKey && key === 'k') return 'palette.open'
  if (control && !event.shiftKey && key === 'o') return 'workspace.openSample'
  if (control && event.shiftKey && key === 'n') return 'workspace.new'
  if (control && event.shiftKey && key === 'o') return 'workspace.openProject'
  if (control && !event.shiftKey && key === 's') return 'workspace.save'
  if (control && !event.shiftKey && key === 'z') return 'workspace.undo'
  if (control && event.shiftKey && key === 'z') return 'workspace.redo'
  if (control && event.shiftKey && key === 'a') return 'panel.agent'
  if (control && event.shiftKey && key === 't') return 'theme.toggle'
  if (!control && !event.shiftKey && !event.altKey && key === 'f') return 'viewport.fit'
  if (!control && !event.shiftKey && !event.altKey && key === '1') return 'viewport.oneToOne'
  return undefined
}

export function resolveShortcut(
  event: ShortcutEvent,
  context: CommandContext,
): CommandId | undefined {
  if (isEditableTarget(event.target)) return undefined
  const id = commandForShortcut(event)
  return id !== undefined && workbenchActionRegistry.availability(id, 1, context).available
    ? id
    : undefined
}

export function getCommandAvailability(
  context: CommandContext,
): Readonly<Record<CommandId, boolean>> {
  return Object.fromEntries(
    workbenchCommands.map(({ id }) => [
      id,
      workbenchActionRegistry.availability(id, 1, context).available,
    ]),
  ) as Readonly<Record<CommandId, boolean>>
}
