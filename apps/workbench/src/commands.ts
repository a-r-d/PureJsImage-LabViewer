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

export interface CommandContext {
  readonly hasDataset: boolean
  readonly canUndo?: boolean
  readonly canRedo?: boolean
}

export interface WorkbenchCommand {
  readonly id: CommandId
  readonly label: string
  readonly shortcut?: string
  readonly available: (context: CommandContext) => boolean
}

export const workbenchCommands: readonly WorkbenchCommand[] = [
  {
    id: 'workspace.new',
    label: 'New project',
    shortcut: 'Ctrl+Shift+N',
    available: () => true,
  },
  {
    id: 'workspace.openProject',
    label: 'Open recent project',
    shortcut: 'Ctrl+Shift+O',
    available: () => true,
  },
  {
    id: 'workspace.save',
    label: 'Save project locally',
    shortcut: 'Ctrl+S',
    available: () => true,
  },
  {
    id: 'workspace.export',
    label: 'Export project JSON',
    available: () => true,
  },
  {
    id: 'workspace.undo',
    label: 'Undo project change',
    shortcut: 'Ctrl+Z',
    available: ({ canUndo }) => canUndo === true,
  },
  {
    id: 'workspace.redo',
    label: 'Redo project change',
    shortcut: 'Ctrl+Shift+Z',
    available: ({ canRedo }) => canRedo === true,
  },
  {
    id: 'workspace.openSample',
    label: 'Open sample SEM image',
    shortcut: 'Ctrl+O',
    available: () => true,
  },
  {
    id: 'viewport.fit',
    label: 'Fit image to viewport',
    shortcut: 'F',
    available: ({ hasDataset }) => hasDataset,
  },
  {
    id: 'viewport.oneToOne',
    label: 'Set viewport to 1:1',
    shortcut: '1',
    available: ({ hasDataset }) => hasDataset,
  },
  {
    id: 'panel.agent',
    label: 'Show agent panel',
    shortcut: 'Ctrl+Shift+A',
    available: () => true,
  },
  {
    id: 'theme.toggle',
    label: 'Toggle color theme',
    shortcut: 'Ctrl+Shift+T',
    available: () => true,
  },
  {
    id: 'palette.open',
    label: 'Open command palette',
    shortcut: 'Ctrl+K',
    available: () => true,
  },
]

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
  return id !== undefined &&
    workbenchCommands.find((command) => command.id === id)?.available(context)
    ? id
    : undefined
}

export function getCommandAvailability(
  context: CommandContext,
): Readonly<Record<CommandId, boolean>> {
  return Object.fromEntries(
    workbenchCommands.map((command) => [command.id, command.available(context)]),
  ) as Readonly<Record<CommandId, boolean>>
}
