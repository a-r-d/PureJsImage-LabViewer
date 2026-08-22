import type { AgentDecision, AgentPermission } from '@pji-workbench/agent'

import type { DomainWorkflowRecipe } from '@pji-workbench/workbench-core'

export const SCIENCE_WORKFLOW_RECIPES: readonly DomainWorkflowRecipe[] = Object.freeze([
  {
    id: 'analysis.threshold',
    title: 'Manual threshold',
    summary: 'Commit a bounded threshold graph on the active plane.',
    kind: 'analysis-graph',
  },
  {
    id: 'analysis.connected-components',
    title: 'Connected components',
    summary: 'Plan and execute connected-component labeling.',
    kind: 'analysis-graph',
  },
  {
    id: 'analysis.particle-count',
    title: 'Particle count',
    summary: 'Threshold, optional watershed, and particle measurement.',
    kind: 'analysis-graph',
  },
  {
    id: 'analysis.fft',
    title: 'FFT workspace',
    summary: 'Calibrated frequency transform with optional radial profile.',
    kind: 'analysis-graph',
  },
  {
    id: 'analysis.stack',
    title: 'Stack projection',
    summary: 'Mean or other projection along a volume axis.',
    kind: 'analysis-graph',
  },
  {
    id: 'analysis.surface',
    title: 'AFM leveling and roughness',
    summary: 'First-order leveling with Ra, Rq, and Rz.',
    kind: 'analysis-graph',
  },
  {
    id: 'builtin.particle-count-recipe',
    title: 'Particle count recipe',
    summary: 'Declarative threshold, watershed, and particle-measurement graph proposal.',
    kind: 'recipe',
  },
  {
    id: 'builtin.watershed-particles',
    title: 'Watershed particle script',
    summary: 'Plans shared segmentation and watershed separation.',
    kind: 'script',
  },
  {
    id: 'builtin.fft-radial-profile',
    title: 'FFT radial-profile script',
    summary: 'Plans the calibrated FFT workspace and radial-profile result.',
    kind: 'script',
  },
  {
    id: 'builtin.afm-level-roughness',
    title: 'AFM leveling and roughness script',
    summary: 'Plans first-order leveling followed by Ra, Rq, and Rz.',
    kind: 'script',
  },
  {
    id: 'builtin.real-ecoli-components',
    title: 'Real E. coli segmentation review',
    summary: 'Bounded threshold and connected-components preset for the bundled CDC SEM image.',
    kind: 'script',
  },
  {
    id: 'builtin.real-staph-components',
    title: 'Real S. aureus JPEG segmentation review',
    summary: 'Bounded threshold and connected-components preset for the original CDC JPEG.',
    kind: 'script',
  },
  {
    id: 'builtin.real-image-inspection',
    title: 'Real micrograph inspection',
    summary: 'ROI-first inspection without inventing missing calibration.',
    kind: 'script',
  },
  {
    id: 'builtin.real-hhv6-histogram',
    title: 'Real TEM intensity histogram',
    summary: 'Whole-plane histogram for the bundled HHV-6 TEM image.',
    kind: 'script',
  },
  {
    id: 'builtin.stack-mean-projection',
    title: 'Stack mean-projection script',
    summary: 'Mean projection along the generated eight-plane drifting stack.',
    kind: 'script',
  },
  {
    id: 'builtin.batch-measurement',
    title: 'Batch measurement script',
    summary: 'Bounded local batch recipe proposal with per-item isolation.',
    kind: 'script',
  },
])

function scienceAgentDecision(permission: AgentPermission): AgentDecision {
  switch (permission) {
    case 'network.read':
    case 'network.explicit-hosts':
    case 'network.open-source':
    case 'network.relay':
    case 'source.read-pixels':
    case 'file.export':
    case 'plugin.install':
      return 'deny'
    case 'workspace.read':
    case 'workspace.propose':
    case 'analysis.execute':
    case 'compute.expensive':
    case 'source.read-metadata':
    case 'viewport.read':
    case 'viewport.propose':
    case 'model.preview':
      return 'allow'
  }
}

export const scienceAgentPolicy = {
  enabled: true,
  liveModelEnabled: true,
  decisionFor: scienceAgentDecision,
} as const
