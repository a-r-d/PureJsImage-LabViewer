import { scienceDomainProfile, scienceUiContributions } from '@pji-workbench/domain-science'
import { UiLab } from './app/UiLab.js'
import { WorkbenchApp } from './app/WorkbenchApp.js'
import type { PublicEnvironment } from './environment.js'

export function App({ environment }: { readonly environment: PublicEnvironment }) {
  if (window.location.pathname === '/__ui-lab') return <UiLab />
  return (
    <WorkbenchApp
      environment={environment}
      profile={scienceDomainProfile}
      ui={scienceUiContributions}
    />
  )
}
