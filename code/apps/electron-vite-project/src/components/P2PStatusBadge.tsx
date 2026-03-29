/**
 * P2P Status Badge — Global P2P health indicator.
 *
 * Shows: Healthy (green), Warning (yellow), Error (red), Disabled (gray)
 */

import { useEffect, useState } from 'react'
import { UI_BADGE } from '../styles/uiContrastTokens'

interface P2PHealthStatus {
  server_running: boolean
  server_error: string | null
  local_endpoint: string | null
  port: number
  pending_queue_count: number
  failed_queue_count: number
  self_test_passed: boolean | null
  enabled?: boolean
  relay_mode?: string
  use_coordination?: boolean
  last_relay_pull_success?: string | null
  last_relay_pull_failure?: string | null
  last_relay_pull_error?: string | null
  relay_capsules_pulled?: number
  coordination_connected?: boolean
  coordination_last_push?: string | null
  coordination_last_error?: string | null
  coordination_reconnect_attempts?: number
  last_outbound_error?: string | null
}

function isAuthRelatedError(err: string | null | undefined): boolean {
  if (!err) return false
  const lower = err.toLowerCase()
  return lower.includes('oidc') || lower.includes('log in') || lower.includes('auth') || lower.includes('401')
}

const chip = {
  fontSize: '10px' as const,
  padding: '2px 8px' as const,
  borderRadius: '4px' as const,
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
      <span title="P2P is disabled. Enable in settings for automatic context sync." style={{ ...chip, ...UI_BADGE.gray }}>
        P2P disabled
      </span>
    )
  }

  // Error: server failed to start
  if (health.server_error) {
    return (
      <span title={health.server_error} style={{ ...chip, ...UI_BADGE.red }}>
        P2P error
      </span>
    )
  }

  // Starting: enabled but server not running yet
  if (!health.server_running) {
    return (
      <span style={{ ...chip, ...UI_BADGE.gray }}>
        P2P starting…
      </span>
    )
  }

  // Warning: some deliveries failed
  if (health.failed_queue_count > 0) {
    return (
      <span title="P2P active — some deliveries failed" style={{ ...chip, ...UI_BADGE.amber }}>
        P2P — some failed
      </span>
    )
  }

  // Warning: delivery pending — distinguish auth-required vs in-progress
  if (health.pending_queue_count > 0) {
    const authRequired = isAuthRelatedError(health.last_outbound_error) || isAuthRelatedError(health.coordination_last_error)
    return (
      <span
        title={authRequired ? `${health.pending_queue_count} item(s) pending — please log in to deliver` : 'P2P active — delivery pending'}
        style={{ ...chip, ...(authRequired ? UI_BADGE.red : UI_BADGE.amber) }}
      >
        {authRequired ? 'Login required to sync' : 'P2P — pending'}
      </span>
    )
  }

  // Coordination mode: show wrdesk.com connection status
  if (health.use_coordination) {
    if (health.coordination_last_error && health.coordination_last_error.toLowerCase().includes('auth')) {
      return (
        <span
          title="Authentication failed — please log in again"
          style={{ ...chip, ...UI_BADGE.red }}
        >
          Auth failed — log in again
        </span>
      )
    }
    if (health.coordination_connected) {
      return (
        <span
          title="Connected to wrdesk.com for instant delivery"
          style={{ ...chip, ...UI_BADGE.green }}
        >
          Connected to wrdesk.com
        </span>
      )
    }
    return (
      <span
        title="Reconnecting to wrdesk.com…"
        style={{ ...chip, ...UI_BADGE.amber }}
      >
        Reconnecting to wrdesk.com…
      </span>
    )
  }

  // Relay remote mode: show relay-specific status
  if (health.relay_mode === 'remote') {
    const err = health.last_relay_pull_error
    if (err) {
      const isAuth = err.toLowerCase().includes('auth')
      return (
        <span
          title={isAuth ? 'Relay auth failed — check configuration' : `Relay unreachable — ${err}. Check your relay server.`}
          style={{ ...chip, ...UI_BADGE.red }}
        >
          {isAuth ? 'Relay auth failed' : 'Relay unreachable'}
        </span>
      )
    }
    const lastSuccess = health.last_relay_pull_success
    const ago = lastSuccess
      ? Math.round((Date.now() - new Date(lastSuccess).getTime()) / 1000)
      : null
    return (
      <span
        title={ago != null ? `Relay active — last sync ${ago}s ago` : 'Relay active'}
        style={{ ...chip, ...UI_BADGE.green }}
      >
        Relay active
      </span>
    )
  }

  // Healthy (local mode)
  return (
    <span title={`P2P active on port ${health.port}`} style={{ ...chip, ...UI_BADGE.green }}>
      P2P active
    </span>
  )
}
