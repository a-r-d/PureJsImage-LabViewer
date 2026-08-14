import { defaultAgentDecision } from '@pji-workbench/agent'
import { RPC_SCHEMA_VERSION } from '@pji-workbench/contracts'
import { PUREJSIMAGE_PACKAGE_VERSION } from '@pji-workbench/imaging'
import { PLUGIN_MANIFEST_SCHEMA_VERSION } from '@pji-workbench/plugin-sdk'
import { generatedCorpusDescriptor } from '@pji-workbench/test-corpus'
import { WorkbenchBadge } from '@pji-workbench/ui'
import { translateCamera } from '@pji-workbench/viewport'
import { createEmptyWorkspace } from '@pji-workbench/workspace'

import type { PublicEnvironment } from './environment.js'

interface AppProps {
  readonly environment: PublicEnvironment
}

export function App({ environment }: AppProps) {
  const workspace = createEmptyWorkspace()
  const camera = translateCamera({ x: 0, y: 0 }, { x: 0, y: 0 })
  const corpus = generatedCorpusDescriptor()
  const packageCount = 8

  return (
    <main className="workbench" aria-labelledby="workbench-title">
      <section className="workbench__panel" aria-describedby="workbench-description">
        <WorkbenchBadge>Bootstrap ready</WorkbenchBadge>
        <p className="workbench__eyebrow">Local-first scientific imaging</p>
        <h1 id="workbench-title">Materials Workbench</h1>
        <p id="workbench-description" className="workbench__description">
          The browser application shell is ready for calibrated microscopy workflows.
        </p>
        <dl className="workbench__facts">
          <div>
            <dt>PureJsImage</dt>
            <dd>{PUREJSIMAGE_PACKAGE_VERSION}</dd>
          </div>
          <div>
            <dt>Workspace</dt>
            <dd>{workspace.title}</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>{environment.appEnvironment}</dd>
          </div>
          <div>
            <dt>Packages wired</dt>
            <dd>{packageCount}</dd>
          </div>
        </dl>
        <p className="workbench__privacy">
          Local files will be processed in this browser unless you explicitly choose a remote
          service.
        </p>
        <span className="visually-hidden">
          Contract schema {RPC_SCHEMA_VERSION}, plugin schema {PLUGIN_MANIFEST_SCHEMA_VERSION},
          agent reads {defaultAgentDecision('workspace.read')}, generated corpus {corpus.id}, camera
          origin {camera.x}, {camera.y}.
        </span>
      </section>
    </main>
  )
}
