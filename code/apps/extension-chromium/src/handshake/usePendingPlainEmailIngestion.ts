/**
 * usePendingPlainEmailIngestion Hook
 *
 * Polls for pending plain emails (Canon §6 depackaged) from the Electron backend,
 * adds them to the BeapInbox store, and acknowledges processing.
 * Plain emails appear in the inbox with ✉️ icon (handshakeId null).
 */

import { useEffect, useRef } from 'react'
import { getPendingPlainEmails, ackPendingPlainEmail } from './handshakeRpc'
import { useBeapInboxStore } from '../beap-messages/useBeapInboxStore'
import type { BeapMessage } from '../beap-messages/beapInboxTypes'

const POLL_INTERVAL_MS = 5_000

let globalProcessing = false

export function usePendingPlainEmailIngestion(): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function processPending() {
      if (globalProcessing) return
      globalProcessing = true
      try {
        const items = await getPendingPlainEmails()
        for (const item of items) {
          try {
            const msg = JSON.parse(item.message_json) as BeapMessage
            useBeapInboxStore.getState().addPlainEmailMessage(msg)
            await ackPendingPlainEmail(item.id)
          } catch (err) {
            console.warn('[Plain Email Ingestion] Error processing item', item.id, err)
          }
        }
      } finally {
        globalProcessing = false
      }
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
}
