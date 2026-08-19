import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  readonly children: ReactNode
}

interface ErrorBoundaryState {
  readonly failed: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  override componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // The bootstrap deliberately avoids logging raw errors or metadata. A bounded diagnostics
    // adapter will be introduced with the application error system.
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="fatal-error" aria-labelledby="fatal-error-title">
          <h1 id="fatal-error-title">Materials Workbench could not start</h1>
          <p>Your files and project data were left unchanged. Reload the page to try again.</p>
        </main>
      )
    }
    return this.props.children
  }
}
