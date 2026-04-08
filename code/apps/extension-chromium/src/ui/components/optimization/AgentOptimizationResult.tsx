import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { AgentRunResult } from '../../../types/optimizationTypes'

export type AgentOptimizationResultProps = {
  theme?: 'pro' | 'dark' | 'standard'
  runId: string
  projectId: string
  agentIcon?: string | null
  result: AgentRunResult
  boxNumber: number
  onAccept?: (payload: { projectId: string; runId: string; agentBoxId: string; text: string }) => void
}

export default function AgentOptimizationResult({
  theme = 'pro',
  runId,
  projectId,
  agentIcon,
  result,
  boxNumber,
  onAccept,
}: AgentOptimizationResultProps) {
  const [dismissed, setDismissed] = useState(false)
  const [accepted, setAccepted] = useState(false)

  const isLight = theme === 'standard'
  const borderAccent = isLight ? 'rgba(59,130,246,0.45)' : 'rgba(99,102,241,0.5)'
  const bg = isLight ? 'rgba(59,130,246,0.06)' : 'rgba(99,102,241,0.08)'
  const textColor = isLight ? '#0f172a' : '#e2e8f0'
  const muted = isLight ? 'rgba(15,23,42,0.55)' : 'rgba(226,232,240,0.65)'

  if (dismissed) return null

  const err = result.error
  const icon = (agentIcon?.trim() || '🤖') as string

  return (
    <div
      style={{
        maxWidth: '92%',
        alignSelf: 'flex-start',
        borderRadius: 10,
        borderLeft: `3px solid ${borderAccent}`,
        background: bg,
        border: `1px solid ${isLight ? 'rgba(59,130,246,0.2)' : 'rgba(99,102,241,0.25)'}`,
        padding: '10px 12px',
        fontSize: 12,
        color: textColor,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16 }} aria-hidden>
          {icon}
        </span>
        <span style={{ fontWeight: 700 }}>{result.agentLabel}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: muted,
            padding: '2px 6px',
            borderRadius: 4,
            background: isLight ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.08)',
          }}
        >
          #{boxNumber}
        </span>
        {accepted && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#16a34a',
              marginLeft: 4,
            }}
          >
            Accepted
          </span>
        )}
      </div>

      {err ? (
        <div style={{ color: '#f87171', fontSize: 11, whiteSpace: 'pre-wrap' }}>{err}</div>
      ) : (
        <div
          className="optimization-agent-markdown"
          style={{ fontSize: 11, lineHeight: 1.5 }}
        >
          <ReactMarkdown>{result.output || '(empty response)'}</ReactMarkdown>
        </div>
      )}

      {!err && !accepted && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              setAccepted(true)
              onAccept?.({
                projectId,
                runId,
                agentBoxId: result.agentBoxId,
                text: result.output,
              })
            }}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: 'rgba(22,163,74,0.85)',
              color: '#fff',
            }}
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.12)',
              color: textColor,
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
