import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Panel,
  ProgressRow,
  Splitter,
  Tabs,
  type ThemeName,
  ThemeRoot,
  Toolbar,
  TreeRow,
} from '@pji-workbench/ui'
import { useState } from 'react'

const LAB_TABS = [
  { id: 'parameters', label: 'Parameters' },
  { id: 'results', label: 'Results' },
  { id: 'approval', label: 'Approval' },
] as const

const ICONS = [
  'browse',
  'roi',
  'analyze',
  'results',
  'code',
  'examples',
  'agent',
  'settings',
] as const

function requestedTheme(): ThemeName {
  return new URLSearchParams(window.location.search).get('theme') === 'light' ? 'light' : 'dark'
}

export function UiLab() {
  const [tab, setTab] = useState<(typeof LAB_TABS)[number]['id']>('parameters')
  const theme = requestedTheme()
  return (
    <ThemeRoot className="ui-lab-theme" theme={theme}>
      <main
        className="ui-lab"
        data-analysis-settled="true"
        data-render-settled="true"
        data-workbench-ready="true"
      >
        <header className="ui-lab__header">
          <div>
            <p>Deterministic component route</p>
            <h1>PureJsImage Lab · UI system V2</h1>
          </div>
          <Toolbar label="UI lab theme">
            <Button aria-pressed={theme === 'dark'}>Dark</Button>
            <Button aria-pressed={theme === 'light'}>Light</Button>
          </Toolbar>
        </header>

        <section className="ui-lab__section" aria-labelledby="lab-actions">
          <h2 id="lab-actions">Actions, icons, and tooltips</h2>
          <Toolbar label="Button examples">
            <Button variant="primary">Primary action</Button>
            <Button>Secondary action</Button>
            <Button variant="ghost">Quiet action</Button>
            <Button disabled>Unavailable</Button>
            {ICONS.map((name) => (
              <IconButton key={name} label={`${name} mode`}>
                <Icon name={name} />
              </IconButton>
            ))}
          </Toolbar>
        </section>

        <section className="ui-lab__grid" aria-label="Workbench component states">
          <Panel className="ui-lab__panel" label="Navigation examples">
            <h2>Navigator and ROI list</h2>
            <TreeRow detail="local" label="sample-sem.gsf" selected />
            <TreeRow depth={1} detail="2D" label="Height field" />
            <ul className="ui-lab__roi-list">
              <li data-selected="true">
                <strong>Particle field</strong>
                <span>Rectangle · 42.0 nm × 28.0 nm</span>
              </li>
              <li>
                <strong>Background</strong>
                <span>Ellipse · 615 nm²</span>
              </li>
            </ul>
          </Panel>
          <Splitter
            label="UI lab splitter"
            maximum={420}
            minimum={184}
            onChange={() => undefined}
            value={248}
          />
          <Panel className="ui-lab__panel" label="Operation controls">
            <Tabs items={LAB_TABS} label="UI lab tabs" onSelect={setTab} selectedId={tab} />
            <div className="ui-lab__controls">
              <label>
                Operation search
                <input defaultValue="threshold" />
              </label>
              <label>
                Threshold
                <input defaultValue="128" type="number" />
              </label>
              <label>
                Method
                <select defaultValue="manual">
                  <option value="manual">Manual</option>
                  <option value="otsu">Otsu</option>
                </select>
              </label>
              <div className="ui-lab__chips">
                <span>Recent</span>
                <span>Segmentation</span>
                <span>Favorite</span>
              </div>
              <ProgressRow label="Preview tiles" value={72} />
            </div>
          </Panel>
          <Panel className="ui-lab__panel" label="Result examples">
            <h2>Results and plot</h2>
            <div
              className="ui-lab__plot"
              aria-label="Deterministic particle-size distribution"
              role="img"
            >
              {[22, 48, 70, 88, 63, 39, 18].map((height) => (
                <span key={height} style={{ height: `${height}%` }} />
              ))}
            </div>
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Area</th>
                  <th>ECD</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>1</td>
                  <td>124 nm²</td>
                  <td>12.6 nm</td>
                </tr>
                <tr>
                  <td>2</td>
                  <td>98 nm²</td>
                  <td>11.2 nm</td>
                </tr>
              </tbody>
            </table>
          </Panel>
        </section>

        <section className="ui-lab__states" aria-label="Loading empty error and approval states">
          <div>
            <h2>Loading</h2>
            <ProgressRow label="Opening source" value={38} />
          </div>
          <EmptyState
            title="No result selected"
            description="Run an operation or choose a pinned result."
          />
          <ErrorState
            title="Source could not be opened"
            message="The workspace and existing results remain unchanged."
          />
          <article
            aria-labelledby="ui-lab-approval-title"
            className="ui-lab__approval"
            role="dialog"
          >
            <p>Approval required</p>
            <h2 id="ui-lab-approval-title">Connected components</h2>
            <dl>
              <div>
                <dt>Peak memory</dt>
                <dd>128 MiB</dd>
              </div>
              <div>
                <dt>Permission</dt>
                <dd>analysis.execute</dd>
              </div>
            </dl>
            <div>
              <Button>Cancel</Button>
              <Button variant="primary">Approve run</Button>
            </div>
          </article>
        </section>
      </main>
    </ThemeRoot>
  )
}
