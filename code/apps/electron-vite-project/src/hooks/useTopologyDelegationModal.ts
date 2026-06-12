/**
 * UX-1 D4 — useTopologyDelegationModal
 *
 * Listens for the `topology:ingestionDelegated` window CustomEvent (bridged
 * from the main process by preload.ts) and manages one-time dismissal via
 * localStorage.
 *
 * One-time = persisted per handshakeId. If the user has already dismissed the
 * modal for a given handshakeId (e.g. from a previous session or a re-fire of
 * the event), the modal is NOT shown again.
 *
 * The hook only exposes the pending handshakeId (null when nothing to show)
 * and a dismiss callback. The consumer (EmailInboxView) renders the modal
 * and handles its own account-presence guard.
 */

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY_PREFIX = 'wr.ingestionDelegation.dismissed.'

function isDismissed(handshakeId: string): boolean {
  try {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}${handshakeId}`) === '1'
  } catch {
    return false
  }
}

function markDismissed(handshakeId: string): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${handshakeId}`, '1')
  } catch {
    /* noop — storage unavailable */
  }
}

export interface UseTopologyDelegationModalResult {
  /**
   * The handshakeId that triggered the modal, or null when there is nothing
   * to show (no event received, already dismissed, or suppressed).
   */
  pendingHandshakeId: string | null
  /** Dismiss the current modal and persist the decision. */
  dismiss: () => void
}

export function useTopologyDelegationModal(): UseTopologyDelegationModalResult {
  const [pendingHandshakeId, setPendingHandshakeId] = useState<string | null>(null)

  useEffect(() => {
    const onEvent = (e: Event) => {
      const hid = (e as CustomEvent<{ handshakeId?: string }>).detail?.handshakeId
      if (!hid || typeof hid !== 'string') return
      if (isDismissed(hid)) return
      setPendingHandshakeId(hid)
    }
    window.addEventListener('topology:ingestionDelegated', onEvent)
    return () => window.removeEventListener('topology:ingestionDelegated', onEvent)
  }, [])

  const dismiss = useCallback(() => {
    setPendingHandshakeId((prev) => {
      if (prev) markDismissed(prev)
      return null
    })
  }, [])

  return { pendingHandshakeId, dismiss }
}
