import { WorkbenchShell as SharedWorkbenchShell } from '@pji-workbench/workbench-react'
import type { CSSProperties, ReactNode, Ref } from 'react'

import { observeUxLayoutShift } from '../ux-instrumentation.js'

export function WorkbenchShell({
  analysisSettled,
  children,
  environment,
  rootRef,
  style,
  workbenchReady,
}: {
  readonly analysisSettled: boolean
  readonly children: ReactNode
  readonly environment: string
  readonly rootRef: Ref<HTMLDivElement>
  readonly style: CSSProperties
  readonly workbenchReady: boolean
}) {
  return (
    <SharedWorkbenchShell
      analysisSettled={analysisSettled}
      environment={environment}
      onMount={observeUxLayoutShift}
      rootRef={rootRef}
      style={style}
      workbenchReady={workbenchReady}
    >
      {children}
    </SharedWorkbenchShell>
  )
}
