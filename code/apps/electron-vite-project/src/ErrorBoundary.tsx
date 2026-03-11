import React, { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Render error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: 'system-ui, sans-serif',
            background: '#0f172a',
            color: '#e2e8f0',
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <h2 style={{ color: '#f87171' }}>Dashboard Error</h2>
          <pre
            style={{
              background: '#1e293b',
              padding: 16,
              borderRadius: 8,
              overflow: 'auto',
              fontSize: 13,
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '8px 16px',
              background: '#9333ea',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              alignSelf: 'flex-start',
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
