/**
 * InboxSecurityPanel — "Security analysis" section for the AI detail panel.
 *
 * Renders phishing score, signals, flagged URLs, validation crosscheck, and a
 * persistent advisory disclaimer. All AI output is advisory-only; the panel
 * never gates message display or takes automated action.
 *
 * Non-goals (deferred to later phases):
 * - Actual sandbox-orchestrator link-open flow (P2.7)
 * - Any HTML sanitization changes (done in the depackager, not here)
 */

import React from 'react'
import type { PhishingAssessmentUi, ValidationCrosscheckUi } from '../types/inboxAi'

export const SECURITY_DISCLAIMER =
  'AI phishing analysis can miss attacks. Open links only via the sandbox orchestrator. Do not enter credentials based on email contents.'

// ── Badge colour helpers ─────────────────────────────────────────────────────

const LABEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  high: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444', border: '#ef4444' },
  elevated: { bg: 'rgba(234,179,8,0.15)', text: '#eab308', border: '#eab308' },
  low: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e', border: '#22c55e' },
}

function labelStyle(label: string): React.CSSProperties {
  const c = LABEL_COLORS[label] ?? { bg: 'rgba(148,163,184,0.1)', text: '#94a3b8', border: '#94a3b8' }
  return {
    display: 'inline-block',
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 7px',
    borderRadius: 4,
    background: c.bg,
    color: c.text,
    border: `1px solid ${c.border}`,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  }
}

function scoreExplanation(score: number, label: string): string {
  if (label === 'high') return `Score ${score}/10 — strong indicators of a phishing attempt.`
  if (label === 'elevated') return `Score ${score}/10 — some phishing indicators present; treat with caution.`
  return `Score ${score}/10 — no significant phishing indicators detected.`
}

// ── Sub-components ──────────────────────────────────────────────────────────

function PhishingScoreRow({ score, label }: { score: number; label: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
      <span style={labelStyle(label)}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--color-text-muted, #94a3b8)' }}>
        {scoreExplanation(score, label)}
      </span>
    </div>
  )
}

function SignalsList({ signals }: { signals: PhishingAssessmentUi['signals'] }) {
  if (!signals.length) return null
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)', marginBottom: 4 }}>
        SIGNALS
      </div>
      <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
        {signals.map((s, i) => (
          <li key={i} style={{ fontSize: 11, color: 'var(--color-text, #e2e8f0)', marginBottom: 3 }}>
            <span style={{ fontWeight: 600 }}>{s.kind}:</span>{' '}
            <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>{s.evidence}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FlaggedUrlsList({ urls }: { urls: PhishingAssessmentUi['flagged_urls'] }) {
  if (!urls.length) return null
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)', marginBottom: 4 }}>
        FLAGGED URLS
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {urls.map((u, i) => (
          <li
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              marginBottom: 6,
              padding: '6px 8px',
              borderRadius: 4,
              background: 'rgba(239,68,68,0.07)',
              border: '1px solid rgba(239,68,68,0.2)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: '#ef4444',
                  wordBreak: 'break-all',
                  marginBottom: 2,
                }}
              >
                {u.url}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted, #94a3b8)' }}>{u.reason}</div>
            </div>
            {/* Sandbox button: rendered disabled until P2.7 wires the actual flow */}
            <button
              type="button"
              disabled
              title="Sandbox link-open is available in a future update"
              style={{
                flexShrink: 0,
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 4,
                border: '1px solid rgba(148,163,184,0.3)',
                background: 'transparent',
                color: 'var(--color-text-muted, #94a3b8)',
                cursor: 'not-allowed',
                opacity: 0.6,
              }}
            >
              Open in sandbox
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CrosscheckSection({ crosscheck }: { crosscheck: ValidationCrosscheckUi }) {
  if (crosscheck.agrees_with_validator) return null
  return (
    <div
      style={{
        marginTop: 10,
        padding: '8px 10px',
        borderRadius: 4,
        background: 'rgba(148,163,184,0.06)',
        border: '1px solid rgba(148,163,184,0.2)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: crosscheck.findings.length ? 6 : 0,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: 3,
            background: 'rgba(148,163,184,0.15)',
            color: '#94a3b8',
            border: '1px solid rgba(148,163,184,0.3)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          needs review
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)' }}>
          AI disagrees with validator outcome
        </span>
      </div>
      {crosscheck.findings.length > 0 && (
        <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
          {crosscheck.findings.map((f, i) => (
            <li key={i} style={{ fontSize: 11, color: 'var(--color-text, #e2e8f0)', marginBottom: 2 }}>
              <span style={{ fontWeight: 600 }}>{f.kind}:</span>{' '}
              <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>{f.evidence}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export interface InboxSecurityPanelProps {
  phishing?: PhishingAssessmentUi
  crosscheck?: ValidationCrosscheckUi
  /** True while inbox:aiSubAnalysisStarted has been received but Complete has not yet arrived. */
  loading?: boolean
}

export function InboxSecurityPanel({ phishing, crosscheck, loading }: InboxSecurityPanelProps) {
  const hasData = !!(phishing || crosscheck)
  if (!hasData && !loading) return null

  return (
    <div className="inbox-detail-ai-section inbox-detail-ai-section--tab-panel" data-testid="security-panel">
      <div className="inbox-detail-ai-section-heading">SECURITY ANALYSIS</div>
      <div style={{ padding: '8px 0' }}>
        {loading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 8,
              fontSize: 11,
              color: 'var(--color-text-muted, #94a3b8)',
            }}
            role="status"
            aria-live="polite"
          >
            <span
              className="inbox-detail-ai-skeleton-inline"
              style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0 }}
              aria-hidden
            />
            analyzing security signals…
          </div>
        )}

        {phishing && (
          <div>
            <PhishingScoreRow score={phishing.score} label={phishing.label} />
            <SignalsList signals={phishing.signals} />
            <FlaggedUrlsList urls={phishing.flagged_urls} />
          </div>
        )}

        {crosscheck && <CrosscheckSection crosscheck={crosscheck} />}

        <div
          style={{
            marginTop: 12,
            padding: '8px 10px',
            borderRadius: 4,
            background: 'rgba(148,163,184,0.05)',
            border: '1px solid rgba(148,163,184,0.15)',
            fontSize: 10,
            color: 'var(--color-text-muted, #94a3b8)',
            lineHeight: '1.5',
          }}
          data-testid="security-disclaimer"
        >
          {SECURITY_DISCLAIMER}
        </div>
      </div>
    </div>
  )
}

// ── Row badge ─────────────────────────────────────────────────────────────────

export interface InboxPhishingBadgeProps {
  phishing?: PhishingAssessmentUi
  crosscheck?: ValidationCrosscheckUi
}

/**
 * Small inline badge for the inbox message row.
 * - high → red "phishing risk"
 * - elevated → yellow "phishing risk"
 * - crosscheck disagrees → grey "needs review"
 * - otherwise nothing
 */
export function InboxPhishingBadge({ phishing, crosscheck }: InboxPhishingBadgeProps) {
  const needsReview = crosscheck && !crosscheck.agrees_with_validator

  if (phishing?.label === 'high') {
    return (
      <span
        data-testid="phishing-badge-high"
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: '2px 6px',
          borderRadius: 3,
          background: 'rgba(239,68,68,0.15)',
          color: '#ef4444',
          border: '1px solid rgba(239,68,68,0.4)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
        }}
      >
        phishing risk
      </span>
    )
  }

  if (phishing?.label === 'elevated') {
    return (
      <span
        data-testid="phishing-badge-elevated"
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: '2px 6px',
          borderRadius: 3,
          background: 'rgba(234,179,8,0.15)',
          color: '#eab308',
          border: '1px solid rgba(234,179,8,0.4)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
        }}
      >
        phishing risk
      </span>
    )
  }

  if (needsReview) {
    return (
      <span
        data-testid="phishing-badge-needs-review"
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: '2px 6px',
          borderRadius: 3,
          background: 'rgba(148,163,184,0.1)',
          color: '#94a3b8',
          border: '1px solid rgba(148,163,184,0.3)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
        }}
      >
        needs review
      </span>
    )
  }

  return null
}
