/// <reference types="vite/client" />

interface Window {
  __PJI_WORKBENCH_METRICS__: {
    reactRenders: number
    viewportFrames: number
    tilesTransferred: number
    tileBytesTransferred: number
    tilePixelsTransferred: number
    largestTilePixels: number
    sourceBytes: number
    datasetPixels: number
    firstTileMilliseconds: number | null
    projectId: string
    invocationIds: string[]
  }
  __PJI_TEST_CRASH_WORKER__?: () => Promise<void>
  __PJI_UX_METRICS__?: import('./ux-instrumentation.js').UxMetrics
}

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: 'development' | 'test' | 'production'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
