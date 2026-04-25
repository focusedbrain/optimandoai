/**
 * Fetches internal Host → Sandbox handshakes for the logged-in user (vault must be unlocked).
 * Calls `window.handshakeView.vaultRpc({ method: 'internalSandboxes.listAvailable' })`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type AuthoritativeDeviceInternalRole,
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

/** Return value of {@link useInternalSandboxesList} `refresh` — use for click-time routing without stale React state. */
export type InternalSandboxesListSnapshot = {
  success: boolean
  sandboxes: InternalSandboxTargetWire[]
  incomplete: InternalSandboxIncompleteWire[]
  lastSuccess: boolean
  error: string | null
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
  const [authoritativeDeviceInternalRole, setAuthoritativeDeviceInternalRole] =
    useState<AuthoritativeDeviceInternalRole>('none')

  const refresh = useCallback(async (): Promise<InternalSandboxesListSnapshot> => {
    const rpc = (window as unknown as { handshakeView?: { vaultRpc?: (a: unknown) => Promise<unknown> } })
      .handshakeView?.vaultRpc
    if (!rpc) {
      setError('Handshake bridge unavailable')
      setLoading(false)
      setSandboxes([])
      setIncomplete([])
      setSandboxAvailability(defaultSandboxAvailability)
      setAuthoritativeDeviceInternalRole('none')
      return { success: false, sandboxes: [], incomplete: [], lastSuccess: false, error: 'Handshake bridge unavailable' }
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
        authoritative_device_internal_role?: AuthoritativeDeviceInternalRole
      }
      if (r?.success) {
        const s = (Array.isArray(r.sandboxes) ? r.sandboxes : []) as InternalSandboxTargetWire[]
        const inc = Array.isArray(r.incomplete) ? r.incomplete : []
        setLastSuccess(true)
        setSandboxes(s)
        setIncomplete(inc)
        const ar = r.authoritative_device_internal_role
        setAuthoritativeDeviceInternalRole(
          ar === 'host' || ar === 'sandbox' || ar === 'none' ? ar : 'none',
        )
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
        return { success: true, sandboxes: s, incomplete: inc, lastSuccess: true, error: null }
      } else {
        setLastSuccess(false)
        const err = typeof r?.error === 'string' ? r.error : 'Failed to list internal sandboxes'
        setError(err)
        setSandboxes([])
        setIncomplete([])
        setSandboxAvailability(defaultSandboxAvailability)
        setAuthoritativeDeviceInternalRole('none')
        return { success: false, sandboxes: [], incomplete: [], lastSuccess: false, error: err }
      }
    } catch (e) {
      setLastSuccess(false)
      const err = e instanceof Error ? e.message : 'Failed to list internal sandboxes'
      setError(err)
      setSandboxes([])
      setIncomplete([])
      setSandboxAvailability(defaultSandboxAvailability)
      setAuthoritativeDeviceInternalRole('none')
      return { success: false, sandboxes: [], incomplete: [], lastSuccess: false, error: err }
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

  /** Live relay + keys — display only; must not block clone (use {@link sendableCloneSandboxes}). */
  const cloneEligibleSandboxes = useMemo(
    () => sandboxes.filter((s) => s.beap_clone_eligible === true),
    [sandboxes],
  )
  /**
   * Active internal Host→Sandbox handshakes with enough material to build qBEAP (P2P endpoint + local + peer keys).
   * Clone send works even when relay is down (message may queue).
   */
  const sendableCloneSandboxes = useMemo(
    () => sandboxes.filter((s) => s.sandbox_keying_complete === true),
    [sandboxes],
  )

  const internalSandboxListReady = !loading && lastSuccess
  const hasActiveInternalSandboxHandshake = sandboxes.length > 0

  return {
    sandboxes,
    incomplete,
    loading,
    error,
    lastSuccess,
    /** True after a successful `internalSandboxes.listAvailable` (vault + RPC). */
    internalSandboxListReady,
    /**
     * Host vs Sandbox for ACTIVE internal handshakes (main-process authoritative).
     * `sandbox` ⇒ never show Host → Sandbox clone UI.
     */
    authoritativeDeviceInternalRole,
    refresh,
    /** Tri-state: connected (live send), exists_but_offline (keys OK, relay/path down), not_configured. */
    sandboxAvailability,
    /** True when at least one active internal Host↔Sandbox row exists (identity complete). */
    hasUsableSandbox: sandboxes.length > 0,
    hasActiveInternalSandboxHandshake,
    /** Relays + keys: informational only. */
    cloneEligibleSandboxes,
    hasCloneEligibleSandbox: cloneEligibleSandboxes.length > 0,
    /** Targets that can be used for clone send (keying complete). */
    sendableCloneSandboxes,
    hasSendableCloneSandbox: sendableCloneSandboxes.length > 0,
  }
}
