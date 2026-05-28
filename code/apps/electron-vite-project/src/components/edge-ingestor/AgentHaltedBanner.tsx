/**
 * Banner when Agent pod is halted or replacement budget exhausted (PR7).
 */

import { useMemo } from 'react'
import { useAgentActivity } from '../../hooks/useAgentActivity.js'

export interface AgentHaltedBannerProps {
  handshakeId: string | null | undefined
  onViewActivity?: () => void
}

export function AgentHaltedBanner({ handshakeId, onViewActivity }: AgentHaltedBannerProps) {
  const { events } = useAgentActivity(handshakeId)

  const halted = useMemo(
    () =>
      events.find(
        (e) =>
          e.event_code === 'replacement_exhausted' || e.event_code === 'pod_halted_by_anomaly',
      ),
    [events],
  )

  const recovered = useMemo(
    () =>
      events.find(
        (e) =>
          e.event_code === 'pod_started' &&
          halted &&
          new Date(e.timestamp_iso).getTime() > new Date(halted.timestamp_iso).getTime(),
      ),
    [events, halted],
  )

  if (!halted || recovered) return null

  const recover = async () => {
    const api = (window as { edgeAgent?: { recover?: (q: unknown) => Promise<unknown> } }).edgeAgent
    if (!api?.recover) return
    await api.recover({ reason: 'user clicked Try to Recover' })
  }

  return (
    <div
      data-testid="agent-halted-banner"
      style={{
        margin: '0 0 12px',
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid rgba(220,38,38,0.35)',
        background: 'rgba(254,226,226,0.9)',
        color: '#991b1b',
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Verification server needs attention</div>
      <div>{halted.message}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {onViewActivity && (
          <button type="button" style={{ fontSize: 11, fontWeight: 600 }} onClick={onViewActivity}>
            View what happened
          </button>
        )}
        <button type="button" style={{ fontSize: 11, fontWeight: 600 }} onClick={() => void recover()}>
          Try to recover
        </button>
      </div>
    </div>
  )
}
