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
 * ONCE after the loop, not once per item.  Batching prevents K serial
 * full-store rewrites when K items are pending.
 *
 * Refresh mode: replace (not patch).
 * patch mode enforces Decision D — it only updates rows already present in
 * the loaded window and silently skips new ones (if (!next.has(rowId)) continue).
 * P2P BEAP arrivals are new rows, so patch would always find nothing and the
 * cloned message would never appear without a manual navigation.  replace
 * rebuilds the store from main's sealed rows, making new arrivals visible
 * immediately.  The CPU saving is preserved: one replace per batch, not K.
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
 * G2 fix: calls refreshFromMain ONCE after the loop (replace mode), not once
 * per item.  cachePackage still runs per-item (cheap, in-memory).
 * replace mode is required — see module-level comment for why patch mode cannot
 * be used for new row insertions (Decision D).
 */
export async function processPendingP2PBeapQueue(): Promise<void> {
  if (globalProcessing) return
  globalProcessing = true
  try {
    const items = await getPendingP2PBeapMessages()
    let mergedCount = 0

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
            if (r.ok) {
              mergedCount++
              console.log(
                '[P2P→Electron] Merge succeeded for pending item',
                item.id,
                'ingressId:', importResult.messageId,
              )
            } else {
              console.warn('[P2P→Electron] merge-depackaged failed for pending item', item.id, r.error ?? 'failed')
            }
            // Phase B, PR B-8: cache package for "View Original" — cheap in-memory op,
            // runs per-item regardless of merge outcome (matches prior behaviour).
            useBeapInboxStore.getState().cachePackage(pkg, handshakeId)
          }
          await ackPendingP2PBeap(item.id)
          console.log('[P2P-POLL] Message imported and verified:', importResult.messageId)
        }
      } catch (err) {
        console.warn('[P2P Ingestion] Error processing pending item', item.id, err)
      }
    }

    // G2 fix: ONE replace-mode refresh after the full batch, not one refresh per item.
    // When K items were pending this reduces K×IPC×full-store-rewrite to a single IPC call.
    // replace mode (not patch) is required: P2P BEAPs are new inbox rows.  patch mode
    // enforces Decision D and silently skips rows not already in the store window, so
    // cloned messages would never appear.  If no merges succeeded, skip the call entirely.
    if (mergedCount > 0) {
      console.log('[P2P→Electron] Triggering replace refresh for', mergedCount, 'merged item(s)')
      try {
        await useBeapInboxStore.getState().refreshFromMain({ kind: 'replace' })
      } catch (refreshErr) {
        console.warn('[P2P→Electron] refreshFromMain failed (inbox may be stale):', refreshErr)
      }
    }
  } finally {
    globalProcessing = false
  }
}
