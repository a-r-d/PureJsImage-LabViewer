import { geoDomainProfile, geoUiContributions } from '@pji-workbench/domain-geo'
import { EmptyState, ThemeRoot } from '@pji-workbench/ui'
import { WorkbenchShell } from '@pji-workbench/workbench-react'
import { useRef } from 'react'

import type { PublicEnvironment } from './environment.js'

export function App({ environment }: { readonly environment: PublicEnvironment }) {
  const rootRef = useRef<HTMLDivElement>(null)
  return (
    <ThemeRoot className="workbench-theme" theme="dark">
      <WorkbenchShell
        analysisSettled
        environment={environment.appEnvironment}
        rootRef={rootRef}
        style={{}}
        workbenchReady
      >
        <header className="app-bar">
          <div className="app-identity">
            <span className="app-mark" aria-hidden="true">
              G
            </span>
            <div>
              <h1>{geoUiContributions.shellHeading}</h1>
              <span>{geoDomainProfile.title}</span>
            </div>
          </div>
        </header>
        <main className="geo-main">
          <EmptyState
            description={geoUiContributions.emptyState.body}
            title={geoUiContributions.emptyState.heading}
          />
        </main>
        <footer className="status-bar">
          <span className="status-dot" aria-hidden="true" />
          <span>{geoUiContributions.emptyState.kicker}</span>
          <span className="status-spacer" />
          <span>{geoDomainProfile.deploymentHostname}</span>
        </footer>
      </WorkbenchShell>
    </ThemeRoot>
  )
}
