/**
 * Shared processor for p2p_pending_beap rows (P2P / coordination / local ingest).
 * Used by usePendingP2PBeapIngestion (poll + push) and push-triggered runs.
 */

import { getPendingP2PBeapMessages, ackPendingP2PBeap, getHandshake } from './handshakeRpc'
import { importBeapMessage, verifyImportedMessage } from '../ingress/importPipeline'
import { buildElectronMergePayload } from '../ingress/electronDepackagedSync'
import type { SanitisedDecryptedPackage } from '../beap-messages/sandbox/sandboxProtocol'

let globalProcessing = false

/** Push Stage-5 decrypted content to Electron inbox DB (localhost HTTP via background). */
function mergeDepackagedToElectron(
  packageJson: string,
  handshakeId: string,
  pkg: SanitisedDecryptedPackage,
): Promise<{ ok: boolean; error?: string }> {
  const payload = buildElectronMergePayload(packageJson, handshakeId, pkg)
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { type: 'ELECTRON_INBOX_MERGE_DEPACKAGED', payload },
        (response: { ok?: boolean; error?: string } | undefined) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }
          resolve(response ?? { ok: false, error: 'no response' })
        },
      )
    } catch (e) {
      reject(e)
    }
  })
}

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
          if (verifyResult.sanitisedPackage) {
            const pkg = verifyResult.sanitisedPackage
            try {
              console.log('[MERGE] About to merge depackaged to Electron:', {
                ingressMessageId: importResult.messageId,
                handshakeId: item.handshake_id,
                hasBody: !!(pkg.capsule?.body && String(pkg.capsule.body).trim()),
                hasTransport: !!(pkg.capsule?.transport_plaintext && String(pkg.capsule.transport_plaintext).trim()),
                attachmentCount: pkg.capsule?.attachments?.length ?? 0,
                artefactCount: pkg.artefacts?.length ?? 0,
              })
              let r = await mergeDepackagedToElectron(item.package_json, item.handshake_id, pkg)
              for (let attempt = 0; attempt < 3; attempt++) {
                if (r.ok) break
                const retryable =
                  typeof r.error === 'string' && /no inbox row|matches this package/i.test(r.error)
                if (!retryable || attempt >= 2) break
                await new Promise((z) => setTimeout(z, 2000))
                console.log('[MERGE] Retrying merge after inbox row delay (attempt ' + (attempt + 2) + '/3)')
                r = await mergeDepackagedToElectron(item.package_json, item.handshake_id, pkg)
              }
              if (!r.ok) {
                console.warn('[P2P→Electron] merge-depackaged:', r.error ?? 'failed')
              }
            } catch (syncErr) {
              console.warn('[P2P→Electron] merge depackaged failed (inbox may show placeholders):', syncErr)
            }
          }
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
