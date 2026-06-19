/**
 * UX-1 D3 — useIngestionStatus
 *
 * Polls `email:getIngestionStatus` (D1 IPC) and returns a typed snapshot
 * the IngestionStatusBanner renders. Single-machine topology suppression is
 * applied here: when this node is clearly host-only (no linked sandbox, not
 * in sandbox mode) the hook returns null so the banner is never shown.
 *
 * Poll interval: 30 s. Also refreshes on:
 *   - visibilitychange → visible
 *   - orchestrator-mode-changed
 *   - handshake-list-refresh
 *   - inbox:newMessages (via window event emitted by the inbox store)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IngestionStatusResult } from '../../electron/main/email/ingestionStatus'

export type { IngestionStatusResult }

const POLL_MS = 30_000

// ── Suppression rule ─────────────────────────────────────────────────────────
// Only show topology banners when at least one of these is true:
//   a) mode is 'sandbox' (this node is the sandbox — it must confirm it's fetching)
//   b) ledgerProvesLocalHostPeerSandbox (host paired with sandbox — delegated state possible)
//   c) mode is null (unknown — don't suppress, show the banner if IPC says so)
// When mode='host' AND no linked sandbox is detected via ledger, suppress all
// topology banners (single-machine). This mirrors the backend
// hasLinkedDepackageSandbox() guard in ingestionOwnership.ts.

function shouldSuppressBanners(
  mode: 'host' | 'sandbox' | null,
  ledgerProvesLocalHostPeerSandbox: boolean,
): boolean {
  if (mode === 'sandbox') return false
  if (mode === null) return false
  // mode === 'host'
  return !ledgerProvesLocalHostPeerSandbox
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseIngestionStatusOptions {
  mode: 'host' | 'sandbox' | null
  ledgerProvesLocalHostPeerSandbox: boolean
  /** Explicitly provided account ids; omit to let the IPC auto-discover. */
  accountIds?: string[]
}

export interface UseIngestionStatusResult {
  /** null when loading, suppressed (single-machine), or IPC unavailable. */
  status: IngestionStatusResult | null
  loading: boolean
  /** Trigger an immediate refresh (e.g. after connecting an account). */
  refresh: () => void
}

export function useIngestionStatus({
  mode,
  ledgerProvesLocalHostPeerSandbox,
  accountIds,
}: UseIngestionStatusOptions): UseIngestionStatusResult {
  const [status, setStatus] = useState<IngestionStatusResult | null>(null)
  const [loading, setLoading] = useState(true)
  const cancelRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const suppressed = shouldSuppressBanners(mode, ledgerProvesLocalHostPeerSandbox)

  const fetch = useCallback(async () => {
    if (suppressed) {
      setStatus(null)
      setLoading(false)
      return
    }
    const api = (window as unknown as {
      emailAccounts?: { getIngestionStatus?: (ids?: string[]) => Promise<{ ok: boolean; data?: IngestionStatusResult; error?: string }> }
    }).emailAccounts
    if (typeof api?.getIngestionStatus !== 'function') {
      setStatus(null)
      setLoading(false)
      return
    }
    try {
      const res = await api.getIngestionStatus(accountIds)
      if (cancelRef.current) return
      if (res?.ok && res.data) {
        setStatus(res.data)
      } else {
        setStatus(null)
      }
    } catch {
      if (!cancelRef.current) setStatus(null)
    } finally {
      if (!cancelRef.current) setLoading(false)
    }
  }, [suppressed, accountIds])

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void fetch().then(scheduleNext)
    }, POLL_MS)
  }, [fetch])

  const refresh = useCallback(() => {
    void fetch().then(scheduleNext)
  }, [fetch, scheduleNext])

  // Initial fetch + poll
  useEffect(() => {
    cancelRef.current = false
    setLoading(true)
    void fetch().then(scheduleNext)
    return () => {
      cancelRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [fetch, scheduleNext])

  // Event-driven refresh
  useEffect(() => {
    const onEvent = () => { void fetch().then(scheduleNext) }
    const onVis = () => { if (document.visibilityState === 'visible') onEvent() }
    window.addEventListener('orchestrator-mode-changed', onEvent)
    window.addEventListener('handshake-list-refresh', onEvent)
    window.addEventListener('email-account-connected', onEvent)
    window.addEventListener('inbox-sync-complete', onEvent)
    window.addEventListener('email:hostIngestionPollComplete', onEvent)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('orchestrator-mode-changed', onEvent)
      window.removeEventListener('handshake-list-refresh', onEvent)
      window.removeEventListener('email-account-connected', onEvent)
      window.removeEventListener('inbox-sync-complete', onEvent)
      window.removeEventListener('email:hostIngestionPollComplete', onEvent)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [fetch, scheduleNext])

  return { status, loading, refresh }
}
