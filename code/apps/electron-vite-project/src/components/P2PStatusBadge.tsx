/**
 * P2P Status Badge — Global P2P health indicator.
 *
 * Shows: Healthy (green), Warning (yellow), Error (red), Disabled (gray)
 */

import { useEffect, useState } from 'react'

interface P2PHealthStatus {
  server_running: boolean
  server_error: string | null
  local_endpoint: string | null
  port: number
  pending_queue_count: number
  failed_queue_count: number
  self_test_passed: boolean | null
  enabled?: boolean
}

export default function P2PStatusBadge() {
  const [health, setHealth] = useState<P2PHealthStatus | null>(null)

  useEffect(() => {
    const load = () => {
      ;(window as any).p2p?.getHealth?.().then((h: P2PHealthStatus) => setHealth(h)).catch(() => setHealth(null))
    }
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [])

  if (!health) return null

  const p2p = (window as any).p2p
  if (!p2p) return null

  // Disabled: config says disabled
  if (health.enabled === false) {
    return (
      <span title="P2P is disabled. Enable in settings for automatic context sync." style={{
        fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
        background: 'rgba(107,114,128,0.15)', color: '#94a3b8',
        border: '1px solid rgba(107,114,128,0.3)',
      }}>
        P2P disabled
      </span>
    )
  }

  // Error: server failed to start
  if (health.server_error) {
    return (
      <span title={health.server_error} style={{
        fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
        background: 'rgba(239,68,68,0.15)', color: '#ef4444',
        border: '1px solid rgba(239,68,68,0.3)',
      }}>
        P2P error
      </span>
    )
  }

  // Starting: enabled but server not running yet
  if (!health.server_running) {
    return (
      <span style={{
        fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
        background: 'rgba(107,114,128,0.15)', color: '#94a3b8',
        border: '1px solid rgba(107,114,128,0.3)',
      }}>
        P2P starting…
      </span>
    )
  }

  // Warning: some deliveries failed
  if (health.failed_queue_count > 0) {
    return (
      <span title="P2P active — some deliveries failed" style={{
        fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
        background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
        border: '1px solid rgba(245,158,11,0.3)',
      }}>
        P2P — some failed
      </span>
    )
  }

  // Warning: delivery pending
  if (health.pending_queue_count > 0) {
    return (
      <span title="P2P active — delivery pending" style={{
        fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
        background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
        border: '1px solid rgba(245,158,11,0.3)',
      }}>
        P2P — pending
      </span>
    )
  }

  // Healthy
  return (
    <span title={`P2P active on port ${health.port}`} style={{
      fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
      background: 'rgba(34,197,94,0.15)', color: '#22c55e',
      border: '1px solid rgba(34,197,94,0.3)',
    }}>
      P2P active
    </span>
  )
}
