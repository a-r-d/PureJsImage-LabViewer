import type { ReactNode } from 'react'

export interface WorkbenchBadgeProps {
  readonly children: ReactNode
}

export function formatWorkbenchStatus(status: string): string {
  return `Workbench status: ${status}`
}

export function WorkbenchBadge({ children }: WorkbenchBadgeProps) {
  return <span className="workbench-badge">{children}</span>
}
