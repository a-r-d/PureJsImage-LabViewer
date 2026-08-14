import { type CSSProperties, type ReactNode, type Ref, useEffect } from 'react'
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
  useEffect(() => observeUxLayoutShift(), [])

  return (
    <div
      className="workbench"
      data-analysis-settled={analysisSettled ? 'true' : 'false'}
      data-environment={environment}
      data-render-settled="true"
      data-workbench-ready={workbenchReady ? 'true' : 'false'}
      ref={rootRef}
      style={style}
    >
      {children}
    </div>
  )
}
