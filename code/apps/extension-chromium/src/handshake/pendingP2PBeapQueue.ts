/**
 * Shared processor for p2p_pending_beap rows (P2P / coordination / local ingest).
 * Used by usePendingP2PBeapIngestion (poll + push) and push-triggered runs.
 *
 * Phase B, PR B-8: After Stage-5 verification succeeds, writes through
 * Electron main's sealed-storage gate (mergeDepackagedToElectron), caches
 * the package for "View Original", then refreshes the store from main's
 * sealed rows.  The renderer store is never mutated directly with inbox
 * content — it is a read-only mirror of main.
 *
 * CPU-runaway fix (G2, PR cpu-runaway-fix-g2): refreshFromMain is called
 * ONCE after the loop in patch mode, not once per item in replace mode.
 * Batching prevents K serial full-store rewrites when K items are pending.
 * Per B-8.2 Decision D, patch mode only updates rows already in the loaded
 * window — new rows outside the window appear when the user navigates back.
 */

import { getPendingP2PBeapMessages, ackPendingP2PBeap, getHandshake } from './handshakeRpc'
import { importBeapMessage, verifyImportedMessage } from '../ingress/importPipeline'
import { mergeDepackagedToElectron } from '../ingress/electronDepackagedSync'
import { useBeapInboxStore } from '../beap-messages/useBeapInboxStore'

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
 * Drain pending P2P BEAP rows: import, verify, merge-to-main, cache, refresh.
 * Idempotent with globalProcessing guard.
 *
 * G2 fix: collects rowIds of successfully merged items and calls
 * refreshFromMain once in patch mode after the loop, rather than once per
 * item in replace mode.  cachePackage still runs per-item (cheap, in-memory).
 */
export async function processPendingP2PBeapQueue(): Promise<void> {
  if (globalProcessing) return
  globalProcessing = true
  try {
    const items = await getPendingP2PBeapMessages()
    const mergedRowIds: string[] = []

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
          const pkg = verifyResult.sanitisedPackage
          if (pkg) {
            const handshakeId = verifyResult.resolvedHandshakeId ?? item.handshake_id
            console.log('[MERGE] About to merge depackaged to Electron:', {
              ingressMessageId: importResult.messageId,
              handshakeId,
              hasBody: !!(pkg.capsule?.body && String(pkg.capsule.body).trim()),
              hasTransport: !!(pkg.capsule?.transport_plaintext && String(pkg.capsule.transport_plaintext).trim()),
              attachmentCount: pkg.capsule?.attachments?.length ?? 0,
              artefactCount: pkg.artefacts?.length ?? 0,
            })
            let r = await mergeDepackagedToElectron(item.package_json, handshakeId, pkg)
            for (let attempt = 0; attempt < 3; attempt++) {
              if (r.ok) break
              const retryable =
                typeof r.error === 'string' && /no inbox row|matches this package/i.test(r.error)
              if (!retryable || attempt >= 2) break
              await new Promise((z) => setTimeout(z, 2000))
              console.log('[MERGE] Retrying merge after inbox row delay (attempt ' + (attempt + 2) + '/3)')
              r = await mergeDepackagedToElectron(item.package_json, handshakeId, pkg)
            }
            if (!r.ok) {
              console.warn('[P2P→Electron] merge-depackaged:', r.error ?? 'failed')
            }
            // Phase B, PR B-8: cache package for "View Original" — cheap in-memory op,
            // runs per-item regardless of merge outcome (matches prior behaviour).
            useBeapInboxStore.getState().cachePackage(pkg, handshakeId)
            // G2 fix: collect rowId only for confirmed successful merges.
            // Failed merges have no new sealed row to reflect in the store.
            if (r.ok) {
              mergedRowIds.push(importResult.messageId)
            }
          }
          await ackPendingP2PBeap(item.id)
          console.log('[P2P-POLL] Message imported and verified:', importResult.messageId)
        }
      } catch (err) {
        console.warn('[P2P Ingestion] Error processing pending item', item.id, err)
      }
    }

    // G2 fix: ONE patch-mode refresh after the full batch, not one replace-mode
    // refresh per item.  When K items were pending this reduces K×IPC×full-store-rewrite
    // to a single IPC call that updates only the K affected rows in place.
    // If no merges succeeded, the store is already up to date — skip the call entirely.
    if (mergedRowIds.length > 0) {
      try {
        await useBeapInboxStore.getState().refreshFromMain({ kind: 'patch', rowIds: mergedRowIds })
      } catch (refreshErr) {
        console.warn('[P2P→Electron] refreshFromMain failed (inbox may be stale):', refreshErr)
      }
    }
  } finally {
    globalProcessing = false
  }
}
