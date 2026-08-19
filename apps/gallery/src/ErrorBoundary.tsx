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
    // Avoid logging raw errors or metadata from this lightweight gallery.
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="fatal-error" aria-labelledby="fatal-error-title">
          <h1 id="fatal-error-title">PureJsImage Showcase could not start</h1>
          <p>Reload the page to try again. No project data is stored in this gallery.</p>
        </main>
      )
    }
    return this.props.children
  }
}
