/**
 * usePendingP2PBeapIngestion Hook
 *
 * Processes pending P2P BEAP message packages (coordination WS, relay pull, local P2P).
 * Primary: push notification from Electron (P2P_BEAP_RECEIVED) for real-time ingest.
 * Fallback: 5s poll when the BEAP inbox view is mounted.
 */

import { useEffect, useRef } from 'react'
import { processPendingP2PBeapQueue } from './pendingP2PBeapQueue'
import { useBeapInboxStore } from '../beap-messages/useBeapInboxStore'

const POLL_INTERVAL_MS = 5_000
/** Fallback refresh cadence — catches any push notifications missed by the WS bridge. */
const FALLBACK_REFRESH_MS = 30_000

export function usePendingP2PBeapIngestion(): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fallbackRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function processPending() {
      await processPendingP2PBeapQueue()
    }

    processPending()
    intervalRef.current = setInterval(processPending, POLL_INTERVAL_MS)

    // Fallback: every 30s force a replace-refresh so the inbox is never permanently
    // stale even when a P2P_BEAP_RECEIVED push notification is missed (e.g. WS not
    // yet connected, chrome.runtime.sendMessage had no listener, extension reloaded).
    fallbackRefreshRef.current = setInterval(async () => {
      try {
        await useBeapInboxStore.getState().refreshFromMain({ kind: 'replace' })
      } catch {
        /* non-fatal */
      }
    }, FALLBACK_REFRESH_MS)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      if (fallbackRefreshRef.current) {
        clearInterval(fallbackRefreshRef.current)
        fallbackRefreshRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const listener = (
      msg: { type?: string; handshakeId?: string },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (r?: unknown) => void,
    ): boolean => {
      if (msg?.type === 'P2P_BEAP_RECEIVED') {
        console.log('[P2P-POLL] Immediate processing triggered by push notification', msg.handshakeId ?? '')
        void processPendingP2PBeapQueue().then(
          async () => {
            // The canonical pipeline (processBeapPackageInline) already wrote the
            // sealed row to inbox_messages before broadcasting P2P_BEAP_RECEIVED.
            // The pending queue table was dropped in v66, so mergedCount is always
            // 0 and pendingP2PBeapQueue never calls refreshFromMain itself.
            // Force a replace-refresh here so the extension store picks up the new row.
            try {
              await useBeapInboxStore.getState().refreshFromMain({ kind: 'replace' })
            } catch {
              /* non-fatal — inbox may show on next poll */
            }
            try {
              sendResponse({ ok: true })
            } catch {
              /* channel may be gone */
            }
          },
          () => {
            try {
              sendResponse({ ok: false })
            } catch {
              /* channel may be gone */
            }
          },
        )
        return true
      }
      return false
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => {
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [])
}
