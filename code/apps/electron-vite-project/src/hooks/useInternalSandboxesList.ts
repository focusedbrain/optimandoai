/**
 * Fetches internal Host → Sandbox handshakes for the logged-in user (vault must be unlocked).
 * Calls `window.handshakeView.vaultRpc({ method: 'internalSandboxes.listAvailable' })`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type SandboxOrchestratorAvailability,
  defaultSandboxAvailability,
} from '../types/sandboxOrchestratorAvailability'

export interface InternalSandboxTargetWire {
  handshake_id: string
  relationship_id: string
  state: string
  peer_role: 'sandbox'
  peer_label: string
  peer_device_id: string
  peer_device_name: string | null
  /** 6-digit internal pairing id when available (not a UUID). */
  peer_pairing_code_six?: string | null
  internal_coordination_identity_complete: boolean
  p2p_endpoint_set: boolean
  last_known_delivery_status: string
  live_status_optional?: string
  beap_clone_eligible?: boolean
  /** Same as main-process list: P2P endpoint + local + peer keys (no relay requirement). */
  sandbox_keying_complete?: boolean
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
  const [sandboxAvailability, setSandboxAvailability] = useState<SandboxOrchestratorAvailability>(
    () => defaultSandboxAvailability,
  )

  const refresh = useCallback(async () => {
    const rpc = (window as unknown as { handshakeView?: { vaultRpc?: (a: unknown) => Promise<unknown> } })
      .handshakeView?.vaultRpc
    if (!rpc) {
      setError('Handshake bridge unavailable')
      setLoading(false)
      setSandboxes([])
      setIncomplete([])
      setSandboxAvailability(defaultSandboxAvailability)
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
        sandbox_availability?: SandboxOrchestratorAvailability
      }
      if (r?.success) {
        setLastSuccess(true)
        setSandboxes((Array.isArray(r.sandboxes) ? r.sandboxes : []) as InternalSandboxTargetWire[])
        setIncomplete(Array.isArray(r.incomplete) ? r.incomplete : [])
        if (r.sandbox_availability && typeof r.sandbox_availability === 'object') {
          const sa = r.sandbox_availability
          setSandboxAvailability({
            status:
              sa.status === 'connected' || sa.status === 'exists_but_offline' || sa.status === 'not_configured'
                ? sa.status
                : 'not_configured',
            relay_connected: sa.relay_connected === true,
            use_coordination: sa.use_coordination === true,
          })
        } else {
          setSandboxAvailability(defaultSandboxAvailability)
        }
      } else {
        setLastSuccess(false)
        setError(typeof r?.error === 'string' ? r.error : 'Failed to list internal sandboxes')
        setSandboxes([])
        setIncomplete([])
        setSandboxAvailability(defaultSandboxAvailability)
      }
    } catch (e) {
      setLastSuccess(false)
      setError(e instanceof Error ? e.message : 'Failed to list internal sandboxes')
      setSandboxes([])
      setIncomplete([])
      setSandboxAvailability(defaultSandboxAvailability)
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

  const cloneEligibleSandboxes = useMemo(
    () => sandboxes.filter((s) => s.beap_clone_eligible === true),
    [sandboxes],
  )

  return {
    sandboxes,
    incomplete,
    loading,
    error,
    lastSuccess,
    refresh,
    /** Tri-state: connected (live send), exists_but_offline (keys OK, relay/path down), not_configured. */
    sandboxAvailability,
    /** True when at least one coordination-complete sandbox target exists. */
    hasUsableSandbox: sandboxes.length > 0,
    /** Relays + keys: eligible for “Sandbox” clone on received BEAP rows. */
    cloneEligibleSandboxes,
    hasCloneEligibleSandbox: cloneEligibleSandboxes.length > 0,
  }
}
