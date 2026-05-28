import { useCallback, useEffect, useState } from 'react'

export interface AgentActivityEvent {
  event_id: string
  timestamp_iso: string
  level: string
  source: string
  event_code: string
  message: string
  fields: Record<string, string | number | boolean | null>
  received_at_iso?: string
}

export interface AgentActivityState {
  events: AgentActivityEvent[]
  reachability: 'unknown' | 'reachable' | 'unreachable'
  lastError: string | null
  loading: boolean
}

export function useAgentActivity(handshakeId: string | null | undefined): AgentActivityState & {
  refresh: () => Promise<void>
} {
  const [events, setEvents] = useState<AgentActivityEvent[]>([])
  const [reachability, setReachability] = useState<AgentActivityState['reachability']>('unknown')
  const [lastError, setLastError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    const api = (window as { edgeAgent?: { getActivity?: (q: unknown) => Promise<unknown> } }).edgeAgent
    if (!api?.getActivity || !handshakeId) return
    setLoading(true)
    try {
      const res = (await api.getActivity({
        handshake_id: handshakeId,
        limit: 200,
        levels: ['info', 'warn', 'error', 'critical'],
      })) as {
        ok?: boolean
        data?: {
          events?: AgentActivityEvent[]
          reachability?: AgentActivityState['reachability']
          lastError?: string | null
        }
      }
      if (res.ok && res.data) {
        setEvents(res.data.events ?? [])
        setReachability(res.data.reachability ?? 'unknown')
        setLastError(res.data.lastError ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [handshakeId])

  useEffect(() => {
    void refresh()
    const handler = () => void refresh()
    window.addEventListener('edge-agent-activity-updated', handler)
    const off = (
      window as { edgeAgent?: { onActivityUpdated?: (cb: () => void) => () => void } }
    ).edgeAgent?.onActivityUpdated?.(handler)
    return () => {
      window.removeEventListener('edge-agent-activity-updated', handler)
      off?.()
    }
  }, [refresh])

  return { events, reachability, lastError, loading, refresh }
}
