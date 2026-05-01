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
import { SANDBOX_CLONE_COPY, type SandboxCloneFeedbackView } from './sandboxCloneFeedbackUi'
import { SANDBOX_CLONE_INBOX_LEAD_IN } from './inboxMessageSandboxClone'

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
        original_inbox_source_type: p.source_type,
        original_response_path: p.original_response_path,
        reply_transport: p.reply_transport,
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
        ...(p.triggered_url && String(p.triggered_url).trim()
          ? { triggered_url: String(p.triggered_url).trim() }
          : {}),
      },
    }),
  ].join('')
}

export type BeapInboxCloneAuditMetadata = {
  original_message_id: string
  original_source_type: string
  original_response_path: 'email' | 'native_beap'
  reply_transport: 'email' | 'native_beap'
  original_sender: string | null
  original_received_at: string | null
  cloned_at: string
  target_handshake_id: string
  sandbox_target_handshake_id: string
  sandbox_target_device_id: string
  target_sandbox_device_name: string | null
  sandbox_target_pairing_code: string | null
  clone_reason: 'sandbox_test' | 'external_link_or_artifact_review'
  cloned_by_account: string | null
  triggered_url?: string | null
}

export type BeapInboxCloneToSandboxResult =
  | {
      success: true
      delivery: DeliveryResult
      /** 'live' | 'queued' | 'failed' — from coordinationRelayDelivery + success */
      deliveryMode: 'live' | 'queued' | 'failed' | 'unknown'
      cloneMetadata: BeapInboxCloneAuditMetadata
    }
  | { success: false; error: string; code?: 'SANDBOX_SEND_FAILED' }

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
    return { success: false, code: 'SANDBOX_SEND_FAILED', error: 'Target handshake not found in active list' }
  }
  const selectedRecipient = handshakeRecordToSelectedRecipient(raw)
  if (!hasHandshakeKeyMaterial(selectedRecipient)) {
    return { success: false, code: 'SANDBOX_SEND_FAILED', error: 'Target handshake is missing key material for qBEAP' }
  }

  const kp = await getSigningKeyPair()
  const senderFp = kp.publicKey
  const senderShort =
    senderFp.length > 12 ? `${senderFp.slice(0, 4)}…${senderFp.slice(-4)}` : senderFp
  const at = new Date().toISOString()
  const prov = buildCloneMetadata(preparePayload, at)

  const pub = `${SANDBOX_CLONE_INBOX_LEAD_IN}${preparePayload.public_text || preparePayload.encrypted_text}`.trim()
  const enc = `${preparePayload.encrypted_text.trim()}${prov}`.trim()

  const config: BeapPackageConfig = {
    recipientMode: 'private',
    deliveryMethod: 'p2p',
    selectedRecipient,
    senderFingerprint: senderFp,
    senderFingerprintShort: senderShort,
    messageBody: pub,
    encryptedMessage: enc,
    inboxResponsePathMetadata: {
      sandbox_clone: true,
      original_source_type: preparePayload.source_type,
      original_response_path: preparePayload.original_response_path,
      reply_transport: preparePayload.reply_transport,
    },
    attachments: [],
  }

  const delivery = await executeDeliveryAction(config)
  if (!delivery.success) {
    return { success: false, code: 'SANDBOX_SEND_FAILED', error: delivery.message || 'Send failed' }
  }

  const deliveryMode = mapCoordinationDeliveryToMatrixMode(delivery)

  const tu = preparePayload.triggered_url != null && String(preparePayload.triggered_url).trim() ? String(preparePayload.triggered_url).trim() : null
  const cloneMetadata: BeapInboxCloneAuditMetadata = {
    original_message_id: preparePayload.source_message_id,
    original_source_type: preparePayload.source_type,
    original_response_path: preparePayload.original_response_path,
    reply_transport: preparePayload.reply_transport,
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
    ...(tu ? { triggered_url: tu } : {}),
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

/** User-facing string after a clone attempt (200 vs 202 vs prepare/send failure). */
function sandboxCloneFailureUserText(
  e: string | undefined,
  code?: CloneBeapToSandboxIpcErrorCode,
): string {
  const err = (e && String(e).trim()) || 'Sandbox clone failed.'
  if (code === 'MESSAGE_CONTENT_NOT_EXTRACTABLE') {
    return 'Message content could not be extracted for Sandbox clone.'
  }
  if (code === 'MESSAGE_NOT_FOUND') {
    return 'Inbox message was not found.'
  }
  if (code === 'NO_ACTIVE_SANDBOX_HANDSHAKE') {
    return err
  }
  if (code === 'SANDBOX_SEND_FAILED' || code === 'SANDBOX_TARGET_NOT_CONNECTED') {
    return `Sandbox clone failed: ${err}`
  }
  if (code === 'NOT_HOST_ORCHESTRATOR') {
    return err
  }
  return err.startsWith('Sandbox clone failed:') ? err : `Sandbox clone failed: ${err}`
}

export function sandboxCloneFeedbackFromOutcome(
  r: BeapInboxCloneToSandboxResult | BeapInboxClonePrepareFailure,
): {
  kind: 'success_live' | 'success_queued' | 'error'
  /** @deprecated use view.message — kept for call sites that only read .text */
  text: string
  view: SandboxCloneFeedbackView
} {
  if (r && 'success' in r && r.success === false) {
    const f = r as BeapInboxClonePrepareFailure
    const detail = sandboxCloneFailureUserText(f.error, f.code)
    return {
      kind: 'error',
      text: SANDBOX_CLONE_COPY.failedGeneric,
      view: {
        variant: 'error',
        message: SANDBOX_CLONE_COPY.failedGeneric,
        persistUntilDismiss: true,
        screenReaderDetail: detail,
      },
    }
  }
  if (r && 'success' in r && r.success === true) {
    if (r.deliveryMode === 'queued') {
      return {
        kind: 'success_queued',
        text: SANDBOX_CLONE_COPY.successQueued,
        view: {
          variant: 'queued',
          message: SANDBOX_CLONE_COPY.successQueued,
          persistUntilDismiss: false,
        },
      }
    }
    if (r.deliveryMode === 'failed') {
      return {
        kind: 'error',
        text: SANDBOX_CLONE_COPY.failedGeneric,
        view: {
          variant: 'error',
          message: SANDBOX_CLONE_COPY.failedGeneric,
          persistUntilDismiss: true,
          screenReaderDetail: 'Delivery did not complete',
        },
      }
    }
    return {
      kind: 'success_live',
      text: SANDBOX_CLONE_COPY.successLive,
      view: {
        variant: 'success',
        message: SANDBOX_CLONE_COPY.successLive,
        persistUntilDismiss: false,
      },
    }
  }
  return {
    kind: 'error',
    text: SANDBOX_CLONE_COPY.failedGeneric,
    view: { variant: 'error', message: SANDBOX_CLONE_COPY.failedGeneric, persistUntilDismiss: true },
  }
}

export async function beapInboxCloneToSandboxApi(params: {
  sourceMessageId: string
  targetHandshakeId?: string
  cloneReason?: 'sandbox_test' | 'external_link_or_artifact_review'
  triggeredUrl?: string
}): Promise<BeapInboxCloneToSandboxResult | BeapInboxClonePrepareFailure> {
  const fn = window.beapInbox?.cloneBeapToSandbox ?? window.beapInbox?.cloneToSandboxPrepare
  if (typeof fn !== 'function') {
    return { success: false, error: 'beapInbox.cloneBeapToSandbox not available' }
  }
  const r = await fn({
    sourceMessageId: params.sourceMessageId,
    ...(params.targetHandshakeId ? { targetHandshakeId: params.targetHandshakeId } : {}),
    ...(params.cloneReason ? { cloneReason: params.cloneReason } : {}),
    ...(params.triggeredUrl && params.triggeredUrl.trim() ? { triggeredUrl: params.triggeredUrl.trim() } : {}),
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
