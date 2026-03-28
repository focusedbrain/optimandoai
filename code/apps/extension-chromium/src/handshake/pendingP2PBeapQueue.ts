/**
 * Shared processor for p2p_pending_beap rows (P2P / coordination / local ingest).
 * Used by usePendingP2PBeapIngestion (poll + push) and push-triggered runs.
 */

import { getPendingP2PBeapMessages, ackPendingP2PBeap, getHandshake } from './handshakeRpc'
import { importBeapMessage, verifyImportedMessage } from '../ingress/importPipeline'

let globalProcessing = false

async function buildVerifyOptions(
  handshakeId: string,
): Promise<{ handshakeId: string; senderX25519PublicKey?: string; mlkemSecretKeyB64?: string }> {
  const opts: { handshakeId: string; senderX25519PublicKey?: string; mlkemSecretKeyB64?: string } = {
    handshakeId,
  }
  if (!handshakeId || handshakeId === '__file_import__' || handshakeId === '__email_import__') return opts
  try {
    const hs = await getHandshake(handshakeId)
    if (hs.peerX25519PublicKey) opts.senderX25519PublicKey = hs.peerX25519PublicKey
    return opts
  } catch {
    return opts
  }
}

/**
 * Drain pending P2P BEAP rows: import, verify, ack. Idempotent with globalProcessing guard.
 */
export async function processPendingP2PBeapQueue(): Promise<void> {
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
        const verifyOptions = await buildVerifyOptions(item.handshake_id)
        const verifyResult = await verifyImportedMessage(importResult.messageId, verifyOptions)
        if (verifyResult.success) {
          await ackPendingP2PBeap(item.id)
          console.log('[P2P-POLL] Message imported and verified:', importResult.messageId)
        }
      } catch (err) {
        console.warn('[P2P Ingestion] Error processing pending item', item.id, err)
      }
    }
  } finally {
    globalProcessing = false
  }
}
