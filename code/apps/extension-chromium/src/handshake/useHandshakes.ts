/**
 * useHandshakes Hook
 *
 * Replaces the old Zustand-based useHandshakeStore for reading handshakes.
 * Reads from the backend via handshake.list RPC — the backend (SQLite) is
 * the single source of truth.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { HandshakeRecord, HandshakeState } from './rpcTypes'
import { listHandshakes } from './handshakeRpc'

export interface UseHandshakesResult {
  handshakes: HandshakeRecord[]
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useHandshakes(
  filter?: 'active' | 'pending' | 'all',
): UseHandshakesResult {
  const [handshakes, setHandshakes] = useState<HandshakeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const fetchHandshakes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const records = await listHandshakes(filter)
      if (mountedRef.current) {
        setHandshakes(records)
      }
    } catch (err) {
      if (mountedRef.current) {
        const msg = err instanceof Error ? err.message : 'Failed to load handshakes'
        setError(msg)
        console.error('[useHandshakes] Error:', msg)
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [filter])

  useEffect(() => {
    mountedRef.current = true
    fetchHandshakes()
    return () => {
      mountedRef.current = false
    }
  }, [fetchHandshakes])

  return { handshakes, loading, error, refresh: fetchHandshakes }
}

export type { HandshakeRecord, HandshakeState }
