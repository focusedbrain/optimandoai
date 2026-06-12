/**
 * UX-3 D1 — useRevocationBanner
 *
 * Manages the 24h-dismissible revoke transition banner. Listens for the
 * `topology:handshakeRevoked` window CustomEvent (bridged from main.ts via
 * preload.ts) and persists the notice in localStorage so it survives across
 * app restarts within 24 hours.
 *
 * Storage schema (per handshakeId):
 *   localStorage['wr.revokeNotice.<handshakeId>'] = JSON.stringify({
 *     handshakeId: string,
 *     hasAccounts: boolean,
 *     revokedAt: number (ms),
 *     dismissed: boolean,
 *   })
 *
 * Returns the most recent active (< 24h, not dismissed) notice plus a dismiss fn.
 * Cleans up stale (> 24h) entries from localStorage on mount.
 *
 * NOTE: Only fires for local-user revocations (remote-capsule path is a known gap,
 * see DEFERRED.md — UX-3 / Revocation section).
 */

import { useCallback, useEffect, useState } from 'react'

const STORAGE_PREFIX = 'wr.revokeNotice.'
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface RevokeNoticeRecord {
  handshakeId: string
  hasAccounts: boolean
  revokedAt: number
  dismissed: boolean
}

export interface UseRevocationBannerResult {
  /** Active revoke notice to display, or null when none pending. */
  notice: RevokeNoticeRecord | null
  /** Dismiss and persist the dismissal. */
  dismiss: () => void
}

function storageKey(handshakeId: string): string {
  return `${STORAGE_PREFIX}${handshakeId}`
}

function readRecord(handshakeId: string): RevokeNoticeRecord | null {
  try {
    const raw = localStorage.getItem(storageKey(handshakeId))
    if (!raw) return null
    return JSON.parse(raw) as RevokeNoticeRecord
  } catch {
    return null
  }
}

function writeRecord(record: RevokeNoticeRecord): void {
  try {
    localStorage.setItem(storageKey(record.handshakeId), JSON.stringify(record))
  } catch {
    /* storage full / unavailable — fail gracefully */
  }
}

function isActive(record: RevokeNoticeRecord): boolean {
  return !record.dismissed && Date.now() - record.revokedAt < TTL_MS
}

/** Scan localStorage for any active (< 24h, not dismissed) revoke notices. */
function findActiveNotice(): RevokeNoticeRecord | null {
  try {
    const active: RevokeNoticeRecord[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(STORAGE_PREFIX)) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const record = JSON.parse(raw) as RevokeNoticeRecord
        if (isActive(record)) active.push(record)
        else if (!isActive(record) && Date.now() - record.revokedAt >= TTL_MS) {
          // Clean up expired entry
          localStorage.removeItem(key)
        }
      } catch {
        /* malformed entry — skip */
      }
    }
    // Return most recent
    return active.sort((a, b) => b.revokedAt - a.revokedAt)[0] ?? null
  } catch {
    return null
  }
}

export function useRevocationBanner(): UseRevocationBannerResult {
  const [notice, setNotice] = useState<RevokeNoticeRecord | null>(() => findActiveNotice())

  // Listen for new revoke events in this session
  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ handshakeId?: string; hasAccounts?: boolean }>).detail
      const hid = detail?.handshakeId
      if (!hid || typeof hid !== 'string') return

      const record: RevokeNoticeRecord = {
        handshakeId: hid,
        hasAccounts: detail.hasAccounts ?? true,
        revokedAt: Date.now(),
        dismissed: false,
      }
      writeRecord(record)
      setNotice(record)
    }
    window.addEventListener('topology:handshakeRevoked', onEvent)
    return () => window.removeEventListener('topology:handshakeRevoked', onEvent)
  }, [])

  const dismiss = useCallback(() => {
    setNotice((prev) => {
      if (!prev) return null
      const updated: RevokeNoticeRecord = { ...prev, dismissed: true }
      writeRecord(updated)
      return null
    })
  }, [])

  return { notice, dismiss }
}
