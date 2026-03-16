/**
 * usePendingP2PBeapIngestion Hook
 *
 * Polls for pending P2P BEAP message packages received via /beap/ingest,
 * imports them into the inbox, verifies (decrypts) with handshake context,
 * and acknowledges processing. Messages appear in inbox via the import pipeline.
 */

import { useEffect, useRef } from 'react'
import { getPendingP2PBeapMessages, ackPendingP2PBeap } from './handshakeRpc'
import { importBeapMessage, verifyImportedMessage } from '../ingress/importPipeline'

const POLL_INTERVAL_MS = 5_000

let globalProcessing = false

export function usePendingP2PBeapIngestion(): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    async function processPending() {
      if (globalProcessing) return
      globalProcessing = true
      try {
        const items = await getPendingP2PBeapMessages()
        for (const item of items) {
          try {
            const importResult = await importBeapMessage(item.package_json, 'p2p')
            if (!importResult.success || !importResult.messageId) {
              console.warn('[P2P Ingestion] Import failed for pending item', item.id, importResult.error)
              continue
            }
            const verifyResult = await verifyImportedMessage(importResult.messageId, {
              handshakeId: item.handshake_id,
            })
            if (verifyResult.success) {
              await ackPendingP2PBeap(item.id)
            }
            // On verify failure, message is rejected in store; we do not ack so it can be retried
          } catch (err) {
            console.warn('[P2P Ingestion] Error processing pending item', item.id, err)
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
