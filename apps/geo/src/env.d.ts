/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: 'development' | 'test' | 'production'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
