import type { DomainUiContributions } from '../domain-profile.js'

export const scienceUiContributions: DomainUiContributions = Object.freeze({
  applicationTitle: 'Materials Workbench',
  shellHeading: 'PureJsImage Lab',
  emptyState: Object.freeze({
    kicker: 'Local-first scientific imaging',
    heading: 'Start with an original file or a verified example',
    body: 'Inspect calibration, measure regions, and replay analysis without uploading local source pixels.',
    primaryActionId: 'source.open-local',
    secondaryAction: 'browse-examples',
  }),
  defaultLayout: Object.freeze({
    inspectorTab: 'info',
    bottomTab: 'histogram',
  }),
  panels: Object.freeze([
    Object.freeze({ id: 'navigator', title: 'Navigator', surface: 'navigator' }),
    Object.freeze({ id: 'info', title: 'Info', surface: 'inspector' }),
    Object.freeze({ id: 'display', title: 'Display', surface: 'inspector' }),
    Object.freeze({ id: 'roi', title: 'ROI', surface: 'inspector' }),
    Object.freeze({ id: 'analysis', title: 'Analysis', surface: 'inspector' }),
    Object.freeze({ id: 'agent', title: 'Agent', surface: 'inspector' }),
    Object.freeze({ id: 'pipeline', title: 'Pipeline', surface: 'bottom' }),
    Object.freeze({ id: 'history', title: 'History', surface: 'bottom' }),
    Object.freeze({ id: 'histogram', title: 'Histogram', surface: 'bottom' }),
    Object.freeze({ id: 'profile', title: 'Line Profile', surface: 'bottom' }),
    Object.freeze({ id: 'results', title: 'Results', surface: 'bottom' }),
    Object.freeze({ id: 'log', title: 'Log', surface: 'bottom' }),
    Object.freeze({ id: 'examples', title: 'Example gallery', surface: 'dialog' }),
    Object.freeze({ id: 'projects', title: 'Projects', surface: 'dialog' }),
    Object.freeze({ id: 'scripts', title: 'Script Studio', surface: 'overlay' }),
  ]),
  routes: Object.freeze([
    Object.freeze({
      path: '/',
      id: 'science-workbench',
      component: 'WorkbenchApp',
      title: 'Materials Workbench',
      readyAttribute: 'data-workbench-ready',
    }),
    Object.freeze({
      path: '/__ui-lab',
      id: 'ui-lab',
      component: 'UiLab',
      title: 'PureJsImage Lab · UI system V2',
      readyAttribute: 'data-workbench-ready',
    }),
  ]),
})
