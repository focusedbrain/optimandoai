/**
 * Fetches internal Host → Sandbox handshakes for the logged-in user (vault must be unlocked).
 * Calls `window.handshakeView.vaultRpc({ method: 'internalSandboxes.listAvailable' })`.
 */

import { useCallback, useEffect, useState } from 'react'

export interface InternalSandboxTargetWire {
  handshake_id: string
  relationship_id: string
  state: string
  peer_role: 'sandbox'
  peer_label: string
  peer_device_id: string
  peer_device_name: string | null
  internal_coordination_identity_complete: boolean
  p2p_endpoint_set: boolean
  last_known_delivery_status: string
  live_status_optional?: string
}

export interface InternalSandboxIncompleteWire {
  handshake_id: string
  relationship_id: string
  reason: 'identity_incomplete'
}

export function useInternalSandboxesList() {
  const [sandboxes, setSandboxes] = useState<InternalSandboxTargetWire[]>([])
  const [incomplete, setIncomplete] = useState<InternalSandboxIncompleteWire[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastSuccess, setLastSuccess] = useState(false)

  const refresh = useCallback(async () => {
    const rpc = (window as unknown as { handshakeView?: { vaultRpc?: (a: unknown) => Promise<unknown> } })
      .handshakeView?.vaultRpc
    if (!rpc) {
      setError('Handshake bridge unavailable')
      setLoading(false)
      setSandboxes([])
      setIncomplete([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const r = (await rpc({
        method: 'internalSandboxes.listAvailable',
        params: {},
      })) as {
        success?: boolean
        error?: string
        sandboxes?: InternalSandboxTargetWire[]
        incomplete?: InternalSandboxIncompleteWire[]
      }
      if (r?.success) {
        setLastSuccess(true)
        setSandboxes(Array.isArray(r.sandboxes) ? r.sandboxes : [])
        setIncomplete(Array.isArray(r.incomplete) ? r.incomplete : [])
      } else {
        setLastSuccess(false)
        setError(typeof r?.error === 'string' ? r.error : 'Failed to list internal sandboxes')
        setSandboxes([])
        setIncomplete([])
      }
    } catch (e) {
      setLastSuccess(false)
      setError(e instanceof Error ? e.message : 'Failed to list internal sandboxes')
      setSandboxes([])
      setIncomplete([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onVaultStatusChanged = () => {
      void refresh()
    }
    window.addEventListener('vault-status-changed', onVaultStatusChanged)
    return () => window.removeEventListener('vault-status-changed', onVaultStatusChanged)
  }, [refresh])

  return {
    sandboxes,
    incomplete,
    loading,
    error,
    lastSuccess,
    refresh,
    /** True when at least one coordination-complete sandbox target exists. */
    hasUsableSandbox: sandboxes.length > 0,
  }
}
