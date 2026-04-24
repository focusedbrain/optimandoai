/**
 * End-to-end BEAP inbox → internal sandbox clone: main-process prepare + new qBEAP package in renderer.
 * Suggested product API: beapInbox.cloneToSandbox — implemented as prepare IPC + build/send here.
 */

import { executeDeliveryAction, type BeapPackageConfig } from '@ext/beap-messages/services/BeapPackageBuilder'
import { getSigningKeyPair } from '@ext/beap-messages/services/beapCrypto'
import { hasHandshakeKeyMaterial, type HandshakeRecord } from '@ext/handshake/rpcTypes'
import { listHandshakes } from '../shims/handshakeRpc'
import { handshakeRecordToSelectedRecipient } from './handshakeRecipientMap'
import type { BeapInboxClonePrepareOk } from '../types/beapInboxClone'
import type { DeliveryResult } from '@ext/beap-messages/services/BeapPackageBuilder'
import '../components/handshakeViewTypes'
import { mapCoordinationDeliveryToMatrixMode } from './beapSandboxCloneDeliverySemantics'

const SANDBOX_BANNER =
  '[BEAP sandbox clone — sent by you]\n' +
  'This is a test clone for your sandbox; the original inbox message is unchanged. New qBEAP only — no original ciphertext reuse.\n' +
  'Automation: sandbox_clone=true in metadata below.\n\n'

function buildCloneMetadata(
  p: BeapInboxClonePrepareOk,
  atIso: string,
): string {
  return [
    '\n\n---\n',
    JSON.stringify({
      sandbox_clone: true,
      beap_sandbox_clone: {
        clone_reason: 'sandbox_test',
        original_message_id: p.source_message_id,
        original_handshake_id: p.original_handshake_id,
        cloned_at: atIso,
        sandbox_target_device_id: p.sandbox_target_device_id,
        sandbox_target_handshake_id: p.sandbox_target_handshake_id,
        source_sender: p.from_address || undefined,
        account: p.account_tag || undefined,
      },
    }),
  ].join('')
}

export type BeapInboxCloneToSandboxResult =
  | {
      success: true
      delivery: DeliveryResult
      /** 'live' | 'queued' | 'failed' — from coordinationRelayDelivery + success */
      deliveryMode: 'live' | 'queued' | 'failed' | 'unknown'
    }
  | { success: false; error: string }

/**
 * @param prepare - From `inbox:beapInboxCloneToSandboxPrepare` (success + prepare object).
 * @param preparePayload - The `prepare` field when success
 */
export async function cloneBeapInboxToSandbox(
  preparePayload: BeapInboxClonePrepareOk,
): Promise<BeapInboxCloneToSandboxResult> {
  const records = await listHandshakes('active')
  const raw = (records as HandshakeRecord[]).find((r) => r.handshake_id === preparePayload.target_handshake_id)
  if (!raw) {
    return { success: false, error: 'Target handshake not found in active list' }
  }
  const selectedRecipient = handshakeRecordToSelectedRecipient(raw)
  if (!hasHandshakeKeyMaterial(selectedRecipient)) {
    return { success: false, error: 'Target handshake is missing key material for qBEAP' }
  }

  const kp = await getSigningKeyPair()
  const senderFp = kp.publicKey
  const senderShort =
    senderFp.length > 12 ? `${senderFp.slice(0, 4)}…${senderFp.slice(-4)}` : senderFp
  const at = new Date().toISOString()
  const prov = buildCloneMetadata(preparePayload, at)

  const pub = `${SANDBOX_BANNER}${preparePayload.public_text || preparePayload.encrypted_text}`.trim()
  const enc = `${preparePayload.encrypted_text.trim()}${prov}`.trim()

  const config: BeapPackageConfig = {
    recipientMode: 'private',
    deliveryMethod: 'p2p',
    selectedRecipient,
    senderFingerprint: senderFp,
    senderFingerprintShort: senderShort,
    messageBody: pub,
    encryptedMessage: enc,
    attachments: [],
  }

  const delivery = await executeDeliveryAction(config)
  if (!delivery.success) {
    return { success: false, error: delivery.message || 'Send failed' }
  }

  const deliveryMode = mapCoordinationDeliveryToMatrixMode(delivery)

  try {
    const subj =
      preparePayload.subject.startsWith('Sandbox:') || preparePayload.subject.startsWith('Re:')
        ? preparePayload.subject
        : `Sandbox: ${preparePayload.subject}`
    void window.outbox
      ?.insertSent?.({
        id: crypto.randomUUID(),
        handshakeId: preparePayload.target_handshake_id,
        counterpartyDisplay: raw.counterparty_email || 'Sandbox',
        subject: subj,
        publicBodyPreview: pub.slice(0, 500),
        encryptedBodyPreview: enc.slice(0, 500),
        hasEncryptedInner: true,
        deliveryMethod: 'p2p',
        deliveryStatus: deliveryMode === 'queued' ? 'queued' : 'sent',
        deliveryDetailJson: JSON.stringify({
          beap_sandbox_clone: true,
          original_message_id: preparePayload.source_message_id,
          coordinationRelayDelivery: delivery.coordinationRelayDelivery,
          deliveryMode,
        }),
      })
      .catch((err: unknown) => console.warn('[Outbox] sandbox clone insert failed:', err))
  } catch {
    /* ignore */
  }

  return { success: true, delivery, deliveryMode }
}

/**
 * Call main prepare, then build/send. Returns error from prepare or send.
 * Product name: beapInbox.cloneToSandbox (prepare + renderer qBEAP build).
 */
export async function beapInboxCloneToSandboxApi(params: {
  sourceMessageId: string
  targetHandshakeId: string
}): Promise<BeapInboxCloneToSandboxResult | { success: false; error: string }> {
  const fn = window.beapInbox?.cloneToSandboxPrepare
  if (typeof fn !== 'function') {
    return { success: false, error: 'beapInbox.cloneToSandboxPrepare not available' }
  }
  const r = await fn({
    sourceMessageId: params.sourceMessageId,
    targetHandshakeId: params.targetHandshakeId,
  })
  if (!r?.success || !r.prepare) {
    return { success: false, error: typeof r?.error === 'string' ? r.error : 'Prepare failed' }
  }
  return cloneBeapInboxToSandbox(r.prepare)
}
