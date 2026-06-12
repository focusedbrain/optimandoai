/**
 * UX-3 D2 — useSandboxReadCleanupHint
 *
 * Manages the one-time sandbox read-cleanup hint. Listens for the
 * `topology:sandboxReadCleanupHint` window CustomEvent (bridged from main.ts
 * via preload.ts) and persists dismissal per handshakeId in localStorage so
 * the hint is never shown again once dismissed.
 *
 * Unlike useRevocationBanner (24h TTL), this hint is dismissed forever once
 * the user acts on it or explicitly dismisses it — it is informational and
 * non-urgent.
 *
 * Dismissal key: `wr.sandboxReadCleanupHint.dismissed.<handshakeId>`
 *
 * NOTE: Fires for both the local-user and remote-capsule revoke paths, driven
 * by main.ts callbacks registered on setRevokeNotifyCallback (revocation.ts)
 * and setSandboxRevokeHintCallback (enforcement.ts) respectively.
 */

import { useCallback, useEffect, useState } from 'react'

export interface ReadAccount {
  accountId: string
  email: string
  provider: string
}

export interface SandboxReadCleanupHintState {
  handshakeId: string
  readAccounts: ReadAccount[]
}

export interface UseSandboxReadCleanupHintResult {
  hint: SandboxReadCleanupHintState | null
  dismiss: () => void
}

const DISMISSED_PREFIX = 'wr.sandboxReadCleanupHint.dismissed.'

function isDismissed(handshakeId: string): boolean {
  try {
    return !!localStorage.getItem(`${DISMISSED_PREFIX}${handshakeId}`)
  } catch {
    return false
  }
}

function markDismissed(handshakeId: string): void {
  try {
    localStorage.setItem(`${DISMISSED_PREFIX}${handshakeId}`, '1')
  } catch {
    /* storage full / unavailable — fail gracefully */
  }
}

export function useSandboxReadCleanupHint(): UseSandboxReadCleanupHintResult {
  const [hint, setHint] = useState<SandboxReadCleanupHintState | null>(null)

  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<{
        handshakeId?: string
        readAccounts?: ReadAccount[]
      }>).detail
      const hid = detail?.handshakeId
      if (!hid || typeof hid !== 'string') return
      if (isDismissed(hid)) return
      const accounts = Array.isArray(detail.readAccounts) ? detail.readAccounts : []
      if (!accounts.length) return
      setHint({ handshakeId: hid, readAccounts: accounts })
    }
    window.addEventListener('topology:sandboxReadCleanupHint', onEvent)
    return () => window.removeEventListener('topology:sandboxReadCleanupHint', onEvent)
  }, [])

  const dismiss = useCallback(() => {
    setHint((prev) => {
      if (prev) markDismissed(prev.handshakeId)
      return null
    })
  }, [])

  return { hint, dismiss }
}
