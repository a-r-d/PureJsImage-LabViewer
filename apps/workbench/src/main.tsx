import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@pji-workbench/ui/styles.css'

import { App } from './App.js'
import { ErrorBoundary } from './ErrorBoundary.js'
import { readPublicEnvironment } from './environment.js'
import './styles.css'

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('The application root was not found; no project data was loaded.')
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App environment={readPublicEnvironment(import.meta.env)} />
    </ErrorBoundary>
  </StrictMode>,
)
