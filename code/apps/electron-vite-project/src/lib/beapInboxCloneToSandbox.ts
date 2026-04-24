/**
 * End-to-end BEAP inbox → internal sandbox clone: main-process prepare + new qBEAP package in renderer.
 * Suggested product API: beapInbox.cloneToSandbox — implemented as prepare IPC + build/send here.
 */

import { executeDeliveryAction, type BeapPackageConfig } from '@ext/beap-messages/services/BeapPackageBuilder'
import { getSigningKeyPair } from '@ext/beap-messages/services/beapCrypto'
import { hasHandshakeKeyMaterial, type HandshakeRecord } from '@ext/handshake/rpcTypes'
import { listHandshakes } from '../shims/handshakeRpc'
import { handshakeRecordToSelectedRecipient } from './handshakeRecipientMap'
import type {
  BeapInboxClonePrepareOk,
  CloneBeapToSandboxIpcErrorCode,
} from '../types/beapInboxClone'
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
  const clonedBy = p.cloned_by_account ?? p.account_tag ?? null
  return [
    '\n\n---\n',
    JSON.stringify({
      sandbox_clone: true,
      automation_sandbox_clone: true,
      beap_sandbox_clone: {
        clone_reason: p.clone_reason,
        original_message_id: p.source_message_id,
        original_sender: p.from_address ?? null,
        original_received_at: p.original_received_at ?? null,
        cloned_at: atIso,
        target_handshake_id: p.target_handshake_id,
        sandbox_target_handshake_id: p.sandbox_target_handshake_id,
        sandbox_target_device_id: p.sandbox_target_device_id,
        target_sandbox_device_name: p.target_sandbox_device_name,
        sandbox_target_pairing_code: p.sandbox_target_pairing_code ?? null,
        cloned_by_account: clonedBy,
        original_handshake_id: p.original_handshake_id,
        account_tag: p.account_tag ?? null,
      },
    }),
  ].join('')
}

export type BeapInboxCloneAuditMetadata = {
  original_message_id: string
  original_sender: string | null
  original_received_at: string | null
  cloned_at: string
  target_handshake_id: string
  sandbox_target_handshake_id: string
  sandbox_target_device_id: string
  target_sandbox_device_name: string | null
  sandbox_target_pairing_code: string | null
  clone_reason: 'sandbox_test'
  cloned_by_account: string | null
}

export type BeapInboxCloneToSandboxResult =
  | {
      success: true
      delivery: DeliveryResult
      /** 'live' | 'queued' | 'failed' — from coordinationRelayDelivery + success */
      deliveryMode: 'live' | 'queued' | 'failed' | 'unknown'
      cloneMetadata: BeapInboxCloneAuditMetadata
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

  const cloneMetadata: BeapInboxCloneAuditMetadata = {
    original_message_id: preparePayload.source_message_id,
    original_sender: preparePayload.from_address ?? null,
    original_received_at: preparePayload.original_received_at ?? null,
    cloned_at: at,
    target_handshake_id: preparePayload.target_handshake_id,
    sandbox_target_handshake_id: preparePayload.sandbox_target_handshake_id,
    sandbox_target_device_id: preparePayload.sandbox_target_device_id,
    target_sandbox_device_name: preparePayload.target_sandbox_device_name,
    sandbox_target_pairing_code: preparePayload.sandbox_target_pairing_code ?? null,
    clone_reason: preparePayload.clone_reason,
    cloned_by_account: preparePayload.cloned_by_account ?? preparePayload.account_tag ?? null,
  }

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
          clone_metadata: cloneMetadata,
          original_message_id: preparePayload.source_message_id,
          coordinationRelayDelivery: delivery.coordinationRelayDelivery,
          deliveryMode,
        }),
      })
      .catch((err: unknown) => console.warn('[Outbox] sandbox clone insert failed:', err))
  } catch {
    /* ignore */
  }

  return { success: true, delivery, deliveryMode, cloneMetadata }
}

/**
 * Call main prepare, then build/send. Returns error from prepare or send.
 * Product name: beapInbox.cloneToSandbox (prepare + renderer qBEAP build).
 */
export type BeapInboxClonePrepareFailure = {
  success: false
  error: string
  code?: CloneBeapToSandboxIpcErrorCode
  details?: unknown
}

export async function beapInboxCloneToSandboxApi(params: {
  sourceMessageId: string
  targetHandshakeId?: string
}): Promise<BeapInboxCloneToSandboxResult | BeapInboxClonePrepareFailure> {
  const fn = window.beapInbox?.cloneBeapToSandbox ?? window.beapInbox?.cloneToSandboxPrepare
  if (typeof fn !== 'function') {
    return { success: false, error: 'beapInbox.cloneBeapToSandbox not available' }
  }
  const r = await fn({
    sourceMessageId: params.sourceMessageId,
    ...(params.targetHandshakeId ? { targetHandshakeId: params.targetHandshakeId } : {}),
  })
  if (!r?.success || !('prepare' in r) || !r.prepare) {
    const fail = r as { success: false; error?: string; code?: CloneBeapToSandboxIpcErrorCode; details?: unknown }
    return {
      success: false,
      error: typeof fail?.error === 'string' ? fail.error : 'Prepare failed',
      ...(fail.code != null ? { code: fail.code, details: fail.details } : {}),
    }
  }
  return cloneBeapInboxToSandbox(r.prepare)
}
