/**
 * usePendingP2PBeapIngestion Hook
 *
 * Processes pending P2P BEAP message packages (coordination WS, relay pull, local P2P).
 * Primary: push notification from Electron (P2P_BEAP_RECEIVED) for real-time ingest.
 * Fallback: 5s poll when the BEAP inbox view is mounted.
 */

import { useEffect, useRef } from 'react'
import { processPendingP2PBeapQueue } from './pendingP2PBeapQueue'

const POLL_INTERVAL_MS = 5_000

export function usePendingP2PBeapIngestion(): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function processPending() {
      await processPendingP2PBeapQueue()
    }

    processPending()
    intervalRef.current = setInterval(processPending, POLL_INTERVAL_MS)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
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
          () => {
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
