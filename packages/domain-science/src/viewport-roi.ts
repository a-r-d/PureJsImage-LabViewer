import type { WorkspaceSnapshot } from '@pji-workbench/workspace'

export type RoiTool = 'select' | 'point' | 'line' | 'polyline' | 'rectangle' | 'ellipse' | 'polygon'
export type ViewportRoi = WorkspaceSnapshot['analysis']['roiSet']['rois'][number]
