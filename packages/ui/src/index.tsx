import {
  Bot,
  ChartNoAxesColumn,
  CircleQuestionMark,
  CodeXml,
  Command,
  FlaskConical,
  Folder,
  FolderOpen,
  Images,
  Layers,
  type LucideIcon,
  Moon,
  MousePointer2,
  PanelRight,
  Redo2,
  Scan,
  ScanLine,
  Search,
  Settings,
  SlidersHorizontal,
  SquareDashed,
  Sun,
  Table2,
  Undo2,
  X,
} from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

export type ThemeName = 'dark' | 'light'

export const workbenchTokens = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { sm: 3, md: 6, pill: 999 },
  typography: {
    ui: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    essential: 12,
    compact: 11,
    heading: 14,
  },
  density: { control: 32, toolbar: 40, status: 27, rail: 42 },
  motion: { fast: 100, normal: 160 },
  elevation: { panel: '0 8px 24px rgb(0 0 0 / 24%)', dialog: '0 18px 60px rgb(0 0 0 / 42%)' },
  scientificLabel: { letterSpacing: '0.06em', weight: 700 },
} as const

const colorTokens = {
  dark: {
    background: '#090c10',
    surface: '#10151b',
    surfaceRaised: '#171e26',
    surfaceHover: '#202a34',
    border: '#2b3742',
    borderStrong: '#435363',
    text: '#edf3f7',
    textMuted: '#9baab6',
    accent: '#55b7ef',
    accentText: '#061018',
    accentSurface: '#12384d',
    success: '#64d49b',
    warning: '#f1bb58',
    danger: '#ff7e78',
    canvas: '#050709',
    overlay: 'rgb(4 7 10 / 78%)',
  },
  light: {
    background: '#eef2f5',
    surface: '#ffffff',
    surfaceRaised: '#f7f9fb',
    surfaceHover: '#e7edf2',
    border: '#c8d2db',
    borderStrong: '#97a8b7',
    text: '#17212a',
    textMuted: '#596b79',
    accent: '#0878b4',
    accentText: '#ffffff',
    accentSurface: '#d9effb',
    success: '#17764a',
    warning: '#875900',
    danger: '#b72e2a',
    canvas: '#0b0e11',
    overlay: 'rgb(236 242 246 / 82%)',
  },
} as const satisfies Record<ThemeName, Record<string, string>>

export type WorkbenchColorToken = keyof (typeof colorTokens)['dark']

export function getThemeColor(theme: ThemeName, token: WorkbenchColorToken): string {
  return colorTokens[theme][token]
}

export function themeVariables(theme: ThemeName): CSSProperties {
  const variables: Record<string, string> = {
    '--wb-font-ui': workbenchTokens.typography.ui,
    '--wb-font-mono': workbenchTokens.typography.mono,
    '--wb-font-size-essential': `${workbenchTokens.typography.essential}px`,
    '--wb-font-size-compact': `${workbenchTokens.typography.compact}px`,
    '--wb-control-size': `${workbenchTokens.density.control}px`,
    '--wb-mode-rail-size': `${workbenchTokens.density.rail}px`,
    '--wb-elevation-panel': workbenchTokens.elevation.panel,
    '--wb-elevation-dialog': workbenchTokens.elevation.dialog,
  }
  for (const [name, value] of Object.entries(colorTokens[theme])) {
    variables[`--wb-${name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}`] =
      value
  }
  return variables as CSSProperties
}

export function isThemeName(value: unknown): value is ThemeName {
  return value === 'dark' || value === 'light'
}

export interface ThemeRootProps {
  readonly theme: ThemeName
  readonly children: ReactNode
  readonly className?: string
}

export function ThemeRoot({ theme, children, className }: ThemeRootProps) {
  return (
    <div className={className} data-theme={theme} style={themeVariables(theme)}>
      {children}
    </div>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant
}

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button className={`ui-button ui-button--${variant} ${className}`} type={type} {...props} />
  )
}

export interface IconButtonProps extends Omit<ButtonProps, 'aria-label'> {
  readonly label: string
  readonly tooltip?: string
}

export function IconButton({
  label,
  tooltip = label,
  children,
  className = '',
  ...props
}: IconButtonProps) {
  return (
    <Tooltip label={tooltip}>
      <Button
        aria-label={label}
        className={`ui-icon-button ${className}`}
        variant="ghost"
        {...props}
      >
        {children}
      </Button>
    </Tooltip>
  )
}

export interface TooltipProps {
  readonly label: string
  readonly children: ReactNode
}

export function Tooltip({ label, children }: TooltipProps) {
  const tooltipId = useId()
  return (
    <span className="ui-tooltip">
      {children}
      <span className="ui-tooltip__bubble" id={tooltipId} role="tooltip">
        {label}
      </span>
    </span>
  )
}

export type IconName =
  | 'agent'
  | 'analyze'
  | 'browse'
  | 'chart'
  | 'close'
  | 'code'
  | 'command'
  | 'examples'
  | 'fit'
  | 'folder'
  | 'help'
  | 'layers'
  | 'moon'
  | 'open'
  | 'panel'
  | 'pointer'
  | 'redo'
  | 'results'
  | 'roi'
  | 'search'
  | 'settings'
  | 'sliders'
  | 'sun'
  | 'undo'
  | 'zoom'

const iconComponents: Readonly<Record<IconName, LucideIcon>> = {
  agent: Bot,
  analyze: FlaskConical,
  browse: FolderOpen,
  chart: ChartNoAxesColumn,
  close: X,
  code: CodeXml,
  command: Command,
  examples: Images,
  fit: Scan,
  folder: Folder,
  help: CircleQuestionMark,
  layers: Layers,
  moon: Moon,
  open: FolderOpen,
  panel: PanelRight,
  pointer: MousePointer2,
  redo: Redo2,
  results: Table2,
  roi: SquareDashed,
  search: Search,
  settings: Settings,
  sliders: SlidersHorizontal,
  sun: Sun,
  undo: Undo2,
  zoom: ScanLine,
}

export interface IconProps {
  readonly name: IconName
  readonly label?: string
  readonly size?: number
}

export function Icon({ name, label, size = 18 }: IconProps) {
  const Component = iconComponents[name]
  return (
    <Component
      aria-hidden={label === undefined}
      aria-label={label}
      className="ui-icon"
      role={label === undefined ? undefined : 'img'}
      size={size}
      strokeWidth={1.7}
    />
  )
}

export interface TabItem<Id extends string = string> {
  readonly id: Id
  readonly label: string
}

export interface TabsProps<Id extends string = string> {
  readonly label: string
  readonly items: readonly TabItem<Id>[]
  readonly selectedId: Id
  readonly onSelect: (id: Id) => void
  readonly compact?: boolean
}

export function Tabs<Id extends string>({
  label,
  items,
  selectedId,
  onSelect,
  compact = false,
}: TabsProps<Id>) {
  function selectNeighbor(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
    const next = items[nextIndex]
    if (next !== undefined) onSelect(next.id)
  }

  return (
    <div
      aria-label={label}
      className={`ui-tabs ${compact ? 'ui-tabs--compact' : ''}`}
      role="tablist"
    >
      {items.map((item, index) => (
        <button
          aria-selected={selectedId === item.id}
          className="ui-tabs__tab"
          key={item.id}
          onClick={() => onSelect(item.id)}
          onKeyDown={(event) => selectNeighbor(event, index)}
          role="tab"
          tabIndex={selectedId === item.id ? 0 : -1}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export interface PanelProps {
  readonly label: string
  readonly children: ReactNode
  readonly className?: string
}

export function Panel({ label, children, className = '' }: PanelProps) {
  return (
    <section aria-label={label} className={`ui-panel ${className}`}>
      {children}
    </section>
  )
}

export type SplitterOrientation = 'horizontal' | 'vertical'

export function nextSplitterValue(
  value: number,
  key: string,
  minimum: number,
  maximum: number,
  orientation: SplitterOrientation,
  step = 16,
): number {
  const decrement = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
  const increment = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
  if (key === 'Home') return minimum
  if (key === 'End') return maximum
  if (key === decrement) return Math.max(minimum, value - step)
  if (key === increment) return Math.min(maximum, value + step)
  return value
}

export interface SplitterProps {
  readonly label: string
  readonly value: number
  readonly minimum: number
  readonly maximum: number
  readonly orientation?: SplitterOrientation
  readonly onChange: (value: number) => void
  readonly onCommit?: (value: number) => void
  readonly onPointerDown?: (event: React.PointerEvent<HTMLHRElement>) => void
}

export function Splitter({
  label,
  value,
  minimum,
  maximum,
  orientation = 'vertical',
  onChange,
  onCommit,
  onPointerDown,
}: SplitterProps) {
  return (
    <hr
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemax={maximum}
      aria-valuemin={minimum}
      aria-valuenow={Math.round(value)}
      className={`ui-splitter ui-splitter--${orientation}`}
      onKeyDown={(event) => {
        const next = nextSplitterValue(value, event.key, minimum, maximum, orientation)
        if (next !== value) {
          event.preventDefault()
          onChange(next)
          onCommit?.(next)
        }
      }}
      onPointerDown={onPointerDown}
      tabIndex={0}
    />
  )
}

export interface TreeRowProps {
  readonly label: string
  readonly detail?: string
  readonly depth?: number
  readonly selected?: boolean
  readonly onSelect?: () => void
}

export function TreeRow({ label, detail, depth = 0, selected = false, onSelect }: TreeRowProps) {
  return (
    <button
      aria-current={selected ? 'true' : undefined}
      className="ui-tree-row"
      onClick={onSelect}
      style={{ paddingInlineStart: `${8 + depth * 16}px` }}
      type="button"
    >
      <span className="ui-tree-row__marker" aria-hidden="true" />
      <span className="ui-tree-row__label">{label}</span>
      {detail === undefined ? null : <span className="ui-tree-row__detail">{detail}</span>}
    </button>
  )
}

export function Toolbar({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div aria-label={label} className="ui-toolbar" role="toolbar">
      {children}
    </div>
  )
}

export function StatusItem({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <span className="ui-status-item">
      <span className="visually-hidden">{label}: </span>
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  readonly title: string
  readonly description: string
  readonly action?: ReactNode
}) {
  return (
    <div className="ui-empty-state">
      <Icon name="open" size={28} />
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function ErrorState({
  title,
  message,
}: {
  readonly title: string
  readonly message: string
}) {
  return (
    <div className="ui-error-state" role="alert">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  )
}

export function ProgressRow({
  label,
  value,
  onCancel,
}: {
  readonly label: string
  readonly value: number
  readonly onCancel?: () => void
}) {
  return (
    <div className="ui-progress-row">
      <label>
        {label}
        <progress max={100} value={Math.min(100, Math.max(0, value))} />
      </label>
      {onCancel === undefined ? null : (
        <Button onClick={onCancel} variant="ghost">
          Cancel
        </Button>
      )}
    </div>
  )
}

export interface PaletteCommand {
  readonly id: string
  readonly label: string
  readonly shortcut?: string
  readonly disabled?: boolean
}

export interface CommandPaletteProps {
  readonly open: boolean
  readonly commands: readonly PaletteCommand[]
  readonly onClose: () => void
  readonly onRun: (id: string) => void
}

export function restoreFocus(target: Pick<HTMLElement, 'focus'> | null): void {
  target?.focus()
}

export function CommandPalette({ open, commands, onClose, onRun }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const filtered = useMemo(
    () => commands.filter(({ label }) => label.toLowerCase().includes(query.trim().toLowerCase())),
    [commands, query],
  )

  useEffect(() => {
    if (!open) return
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    return () => restoreFocus(restoreRef.current)
  }, [open])

  if (!open) return null
  return (
    <div
      aria-label="Command palette"
      aria-modal="true"
      className="ui-command-palette"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      role="dialog"
    >
      <div className="ui-command-palette__surface">
        <label className="visually-hidden" htmlFor="command-search">
          Search commands
        </label>
        <input
          autoComplete="off"
          id="command-search"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Type a command…"
          ref={inputRef}
          value={query}
        />
        <div className="ui-command-palette__list" role="listbox">
          {filtered.map((command) => (
            <button
              aria-disabled={command.disabled}
              className="ui-command-palette__command"
              key={command.id}
              onClick={() => {
                if (command.disabled) return
                onRun(command.id)
                onClose()
              }}
              role="option"
              type="button"
            >
              <span>{command.label}</span>
              {command.shortcut === undefined ? null : <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export interface WorkbenchBadgeProps {
  readonly children: ReactNode
}

export function formatWorkbenchStatus(status: string): string {
  return `Workbench status: ${status}`
}

export function WorkbenchBadge({ children }: WorkbenchBadgeProps) {
  return <span className="workbench-badge">{children}</span>
}

export function VisuallyHidden({ children }: { readonly children: ReactNode }) {
  return <span className="visually-hidden">{children}</span>
}

export function useFocusReturn(): RefObject<HTMLElement | null> {
  const reference = useRef<HTMLElement | null>(null)
  return reference
}
