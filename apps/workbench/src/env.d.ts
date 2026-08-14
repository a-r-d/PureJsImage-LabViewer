/// <reference types="vite/client" />

interface Window {
  __PJI_WORKBENCH_METRICS__: {
    reactRenders: number
    viewportFrames: number
  }
}

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: 'development' | 'test' | 'production'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
