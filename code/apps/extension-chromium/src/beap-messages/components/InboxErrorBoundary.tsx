/**
 * InboxErrorBoundary
 *
 * Catches render errors in the BEAP Inbox/Builder to prevent a single component
 * failure from blanking the entire sidepanel (e.g. on Linux or when imports fail).
 * Shows a fallback UI with the error message, expandable details, and retry.
 *
 * @version 2.0.0 — added Show Error Details, full stack logging
 */

import React, { Component, type ReactNode } from 'react'

interface InboxErrorBoundaryProps {
  children: ReactNode
  theme?: 'default' | 'dark' | 'professional'
  fallback?: ReactNode
  /** Display name for logging (e.g. "BeapInboxView", "BeapBulkInbox") */
  componentName?: string
}

interface InboxErrorBoundaryState {
  hasError: boolean
  error?: Error
  errorInfo?: React.ErrorInfo
  showDetails: boolean
}

export class InboxErrorBoundary extends Component<
  InboxErrorBoundaryProps,
  InboxErrorBoundaryState
> {
  constructor(props: InboxErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, showDetails: false }
  }

  static getDerivedStateFromError(error: Error): Partial<InboxErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const name = this.props.componentName ?? 'Unknown'
    console.error(
      `[BEAP Error Boundary] ${name}:`,
      error,
      '\nComponent stack:',
      errorInfo.componentStack,
      '\nStack:',
      error.stack,
    )
    this.setState((s) => ({ ...s, errorInfo }))
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined, showDetails: false })
  }

  handleToggleDetails = () => {
    this.setState((s) => ({ showDetails: !s.showDetails }))
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      const isProfessional = this.props.theme === 'professional'
      const textColor = isProfessional ? '#1f2937' : 'white'
      const mutedColor = isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)'
      const borderColor = isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'

      return (
        <div
          style={{
            padding: '24px',
            background: isProfessional ? '#fff' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${borderColor}`,
            borderRadius: '8px',
            margin: '16px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
            Something went wrong loading this view
          </div>
          <p style={{ fontSize: '12px', color: mutedColor, margin: '0 0 12px 0', lineHeight: 1.5 }}>
            {(() => {
              const msg = this.state.error?.message ?? ''
              const isTechnical = /^(TypeError|ReferenceError|SyntaxError|undefined|null is not)/i.test(msg)
              return isTechnical ? 'An unexpected error occurred. Please try again.' : (msg || 'An unexpected error occurred.')
            })()}
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={this.handleRetry}
              style={{
                background: isProfessional ? '#3b82f6' : 'rgba(59,130,246,0.8)',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '12px',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
            <button
              onClick={this.handleToggleDetails}
              style={{
                background: 'transparent',
                border: `1px solid ${borderColor}`,
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '12px',
                color: mutedColor,
                cursor: 'pointer',
              }}
            >
              {this.state.showDetails ? 'Hide' : 'Show'} Error Details
            </button>
          </div>
          {this.state.showDetails && (this.state.error || this.state.errorInfo) && (
            <pre
              style={{
                marginTop: '12px',
                padding: '12px',
                background: isProfessional ? '#f8fafc' : 'rgba(0,0,0,0.2)',
                borderRadius: '6px',
                fontSize: '10px',
                color: mutedColor,
                overflow: 'auto',
                maxHeight: '200px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {[
                this.props.componentName && `Component: ${this.props.componentName}`,
                this.state.error?.message && `Error: ${this.state.error.message}`,
                this.state.error?.stack && `Stack: ${this.state.error.stack}`,
                this.state.errorInfo?.componentStack &&
                  `React stack: ${this.state.errorInfo.componentStack}`,
              ]
                .filter(Boolean)
                .join('\n\n')}
            </pre>
          )}
        </div>
      )
    }
    return this.props.children
  }
}

export default InboxErrorBoundary
