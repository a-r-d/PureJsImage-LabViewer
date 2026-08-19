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
  | 'analysis.catalog.read'
  | 'analysis.cancel'
  | 'analysis.describe'
  | 'analysis.dry-run'
  | 'analysis.normalize'
  | 'analysis.graph.request-execute'
  | 'analysis.request-execute'
  | 'analysis.batch.request-execute'
  | 'analysis.threshold.commit'
  | 'analysis.threshold.preview'
  | 'dataset.describe'
  | 'dataset.list'
  | 'panel.select'
  | 'pipeline.node.remove'
  | 'pipeline.read'
  | 'result.export.propose'
  | 'result.page.read'
  | 'result.summary.read'
  | 'roi.create'
  | 'roi.list'
  | 'roi.update'
  | 'roi.remove'
  | 'roi.select'
  | 'source.open-local'
  | 'source.open-remote'
  | 'source.list'
  | 'script.log'
  | 'script.apply_patch'
  | 'script.create_draft'
  | 'script.diff'
  | 'script.read'
  | 'script.request_execute'
  | 'script.request_install'
  | 'script.run_tests'
  | 'script.typecheck'
  | 'viewport.state.read'
  | 'viewport.state.propose'
  | 'workspace.summary.read'

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
const SCRIPT_ID = { type: 'string', minLength: 1, maxLength: 128 } as const
const SCRIPT_DIGEST = { type: 'string', minLength: 64, maxLength: 64 } as const

function scriptActionInput(id: Extract<WorkbenchActionId, `script.${string}`>) {
  if (id === 'script.create_draft')
    return {
      type: 'object' as const,
      properties: {
        id: SCRIPT_ID,
        title: { type: 'string' as const, minLength: 1, maxLength: 256 },
      },
      required: ['id', 'title'] as const,
      additionalProperties: false,
    }
  if (id === 'script.apply_patch')
    return {
      type: 'object' as const,
      properties: {
        id: SCRIPT_ID,
        expectedDigest: SCRIPT_DIGEST,
        source: { type: 'string' as const, maxLength: 256 * 1024 },
      },
      required: ['id', 'expectedDigest', 'source'] as const,
      additionalProperties: false,
    }
  if (id === 'script.read')
    return {
      type: 'object' as const,
      properties: { id: SCRIPT_ID },
      required: ['id'] as const,
      additionalProperties: false,
    }
  return {
    type: 'object' as const,
    properties: { id: SCRIPT_ID, expectedDigest: SCRIPT_DIGEST },
    required: ['id', 'expectedDigest'] as const,
    additionalProperties: false,
  }
}

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

export const scienceActionDefinitions: readonly ActionDefinition<CommandContext>[] = [
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
      'workspace.summary.read',
      'Read workspace summary',
      'Return a bounded semantic workspace and revision summary.',
      'workspace',
      {
        mutability: 'read',
        permissions: ['workspace.read'],
        outputSchema: { type: 'object' },
      },
    ),
  },
  {
    descriptor: descriptor(
      'source.list',
      'List sources',
      'List bounded source descriptors.',
      'source',
      {
        mutability: 'read',
        permissions: ['source.read-metadata'],
        outputSchema: { type: 'array', maxItems: 64 },
      },
    ),
  },
  {
    descriptor: descriptor(
      'dataset.list',
      'List datasets',
      'List bounded dataset descriptors.',
      'dataset',
      {
        mutability: 'read',
        permissions: ['dataset.read-descriptor'],
        outputSchema: { type: 'array', maxItems: 256 },
      },
    ),
  },
  {
    descriptor: descriptor(
      'dataset.describe',
      'Describe dataset',
      'Read one bounded dataset descriptor.',
      'dataset',
      {
        mutability: 'read',
        permissions: ['dataset.read-descriptor'],
        inputSchema: {
          type: 'object',
          properties: { datasetId: { type: 'string', minLength: 1, maxLength: 256 } },
          required: ['datasetId'],
          additionalProperties: false,
        },
        outputSchema: { type: 'object' },
      },
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
      {
        mutability: 'read',
        permissions: ['viewport.read'],
        outputSchema: { type: 'object' },
      },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'viewport.state.propose',
      'Propose viewport state',
      'Validate a bounded viewport state proposal without mutating the camera.',
      'viewport',
      {
        mutability: 'proposal',
        permissions: ['viewport.propose'],
        inputSchema: { type: 'object', additionalProperties: true },
        outputSchema: { type: 'object' },
      },
    ),
  },
  {
    descriptor: descriptor(
      'roi.create',
      'Create ROI',
      'Create a validated ROI on the active dataset.',
      'roi',
      {
        cost: 'interactive',
        cancellable: true,
        permissions: ['roi.propose'],
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['rectangle', 'ellipse', 'line', 'polygon'] },
            label: { type: 'string', minLength: 1, maxLength: 256 },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number', minimum: 0 },
            height: { type: 'number', minimum: 0 },
          },
          required: ['kind', 'label'],
          additionalProperties: false,
        },
        outputSchema: { type: 'object' },
      },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'roi.list',
      'List ROIs',
      'List bounded semantic ROI descriptors.',
      'roi',
      {
        mutability: 'read',
        permissions: ['roi.read'],
        outputSchema: { type: 'array', maxItems: 256 },
      },
    ),
  },
  {
    descriptor: descriptor(
      'roi.update',
      'Propose ROI update',
      'Validate a bounded ROI update proposal without applying it.',
      'roi',
      {
        mutability: 'proposal',
        permissions: ['roi.propose'],
        inputSchema: {
          type: 'object',
          properties: {
            roiId: { type: 'string', minLength: 1, maxLength: 256 },
            patch: { type: 'object', additionalProperties: true },
          },
          required: ['roiId', 'patch'],
          additionalProperties: false,
        },
        outputSchema: { type: 'object' },
      },
    ),
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
      'analysis.catalog.read',
      'Read analysis catalog',
      'Return bounded operation identities and titles.',
      'analysis',
      { mutability: 'read', permissions: ['analysis.catalog'], outputSchema: { type: 'object' } },
    ),
  },
  {
    descriptor: descriptor(
      'analysis.describe',
      'Describe analysis operation',
      'Describe one versioned operation.',
      'analysis',
      {
        mutability: 'read',
        permissions: ['analysis.catalog'],
        inputSchema: {
          type: 'object',
          properties: { operationId: { type: 'string', minLength: 1, maxLength: 256 } },
          required: ['operationId'],
          additionalProperties: false,
        },
        outputSchema: { type: 'object' },
      },
    ),
  },
  {
    descriptor: descriptor(
      'analysis.normalize',
      'Normalize analysis input',
      'Normalize bounded operation parameters.',
      'analysis',
      {
        mutability: 'read',
        permissions: ['analysis.dry-run'],
        inputSchema: { type: 'object', additionalProperties: true },
        outputSchema: { type: 'object' },
      },
    ),
  },
  {
    descriptor: descriptor(
      'analysis.dry-run',
      'Dry-run analysis operation',
      'Return a bounded resource plan without execution.',
      'analysis',
      {
        mutability: 'read',
        cost: 'interactive',
        cancellable: true,
        permissions: ['analysis.dry-run'],
        inputSchema: { type: 'object', additionalProperties: true },
        outputSchema: { type: 'object' },
      },
    ),
  },
  {
    descriptor: descriptor(
      'analysis.graph.request-execute',
      'Request analysis graph execution',
      'Validate, plan, and execute an explicit visible analysis graph after approval.',
      'analysis',
      {
        mutability: 'mutation',
        cost: 'expensive',
        cancellable: true,
        permissions: ['analysis.execute'],
        inputSchema: {
          type: 'object',
          properties: {
            graph: { type: 'object', additionalProperties: true },
            roiId: { type: 'string', minLength: 1, maxLength: 256 },
          },
          required: ['graph'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { status: { type: 'string', enum: ['completed'] } },
          required: ['status'],
          additionalProperties: false,
        },
      },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'analysis.request-execute',
      'Request analysis execution',
      'Create a reviewed execution proposal without bypassing approval.',
      'analysis',
      {
        mutability: 'proposal',
        cost: 'expensive',
        cancellable: true,
        permissions: ['analysis.execute'],
        inputSchema: {
          type: 'object',
          properties: {
            operationId: { type: 'string', minLength: 1, maxLength: 4_096 },
            operationVersion: { type: 'integer', minimum: 1 },
            parameters: { type: 'object', additionalProperties: true },
            mode: { type: 'string', enum: ['preview', 'apply'] },
          },
          required: ['operationId', 'operationVersion', 'parameters', 'mode'],
          additionalProperties: false,
        },
        outputSchema: { type: 'object' },
      },
    ),
    availability: requiresDataset,
  },
  {
    descriptor: descriptor(
      'analysis.batch.request-execute',
      'Request local batch execution',
      'Create a bounded batch-recipe proposal without opening files or executing items.',
      'analysis',
      {
        mutability: 'proposal',
        cost: 'expensive',
        cancellable: true,
        permissions: ['analysis.execute'],
        inputSchema: { type: 'object', additionalProperties: true },
        outputSchema: { type: 'object' },
      },
    ),
  },
  {
    descriptor: descriptor(
      'analysis.cancel',
      'Cancel active analysis',
      'Request cancellation of the currently active analysis operation.',
      'analysis',
      {
        cost: 'interactive',
        permissions: ['analysis.execute'],
        outputSchema: { type: 'object' },
      },
    ),
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
      'result.summary.read',
      'Read result summary',
      'Read one bounded result summary without table payloads.',
      'results',
      {
        mutability: 'read',
        permissions: ['result.read-summary'],
        outputSchema: { type: 'object' },
      },
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
        outputSchema: { type: 'object' },
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
      'pipeline.read',
      'Read analysis pipeline',
      'Return the bounded committed operation graph.',
      'pipeline',
      {
        mutability: 'read',
        permissions: ['workspace.read'],
        outputSchema: { type: 'object' },
      },
    ),
  },
  {
    descriptor: descriptor(
      'result.export.propose',
      'Propose result CSV export',
      'Validate a bounded result export proposal without creating a file.',
      'results',
      {
        mutability: 'proposal',
        cost: 'external',
        permissions: ['file.export'],
        inputSchema: { type: 'object', additionalProperties: true },
        outputSchema: { type: 'object' },
      },
    ),
  },
  {
    descriptor: descriptor(
      'panel.select',
      'Select workbench panel',
      'Open a named workbench surface.',
      'ui',
      {
        mutability: 'proposal',
        permissions: ['ui.propose'],
        inputSchema: {
          type: 'object',
          properties: { panel: { type: 'string', minLength: 1, maxLength: 64 } },
          required: ['panel'],
          additionalProperties: false,
        },
        outputSchema: { type: 'object' },
      },
    ),
  },
  {
    descriptor: descriptor(
      'script.log',
      'Write bounded script log',
      'Record one bounded sandbox log line.',
      'scripts',
      {
        mutability: 'read',
        permissions: ['workspace.read'],
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string', minLength: 1, maxLength: 4_096 } },
          required: ['message'],
          additionalProperties: false,
        },
      },
    ),
  },
  ...(
    [
      [
        'script.create_draft',
        'Create script draft',
        'Create a bounded local draft for review.',
        'workspace.propose',
      ],
      ['script.read', 'Read script', 'Read one bounded local script or recipe.', 'workspace.read'],
      [
        'script.apply_patch',
        'Apply script patch',
        'Apply a revision-checked source replacement to a draft.',
        'workspace.propose',
      ],
      [
        'script.typecheck',
        'Typecheck script',
        'Typecheck a script in the lazy language Worker.',
        'workspace.read',
      ],
      [
        'script.run_tests',
        'Run script tests',
        'Run deterministic fixture tests in the restricted runtime.',
        'analysis.execute',
      ],
      [
        'script.diff',
        'Read script diff',
        'Return a bounded saved-versus-draft diff.',
        'workspace.read',
      ],
      [
        'script.request_install',
        'Request local script installation',
        'Create an installation proposal for exact reviewed content.',
        'workspace.propose',
      ],
      [
        'script.request_execute',
        'Request script execution',
        'Create an execution proposal for exact reviewed content.',
        'analysis.execute',
      ],
    ] as const
  ).map(([id, title, description, permission]) => ({
    descriptor: descriptor(id, title, description, 'scripts', {
      mutability:
        id === 'script.read' || id === 'script.typecheck' || id === 'script.diff'
          ? 'read'
          : 'proposal',
      cost:
        id === 'script.run_tests' || id === 'script.request_execute'
          ? 'expensive'
          : id === 'script.request_install'
            ? 'external'
            : 'interactive',
      cancellable: false,
      permissions: [permission],
      inputSchema: scriptActionInput(id),
      outputSchema: { type: 'object' },
    }),
  })),
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

export const workbenchActionRegistry = new WorkbenchActionRegistry(scienceActionDefinitions)

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
