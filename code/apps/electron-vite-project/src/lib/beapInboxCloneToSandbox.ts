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
import { SANDBOX_CLONE_COPY, viewSandboxEntitlementRequired, type SandboxCloneFeedbackView } from './sandboxCloneFeedbackUi'
import { SANDBOX_CLONE_INBOX_LEAD_IN } from './inboxMessageSandboxClone'

/**
 * PR 5.2 / Decision B: build the clone provenance as a plain object (not a body-appended string).
 * It moves to `inboxResponsePathMetadata.sandbox_clone_provenance` in the new qBEAP package, so the
 * cloned body bytes are unmodified from the source.
 */
function buildCloneProvenanceObject(
  p: BeapInboxClonePrepareOk,
  atIso: string,
): {
  sandbox_clone: true
  automation_sandbox_clone: true
  beap_sandbox_clone: Record<string, unknown>
} {
  const clonedBy = p.cloned_by_account ?? p.account_tag ?? null
  return {
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
  }
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
      /**
       * live         = green, receiver ACK confirmed
       * relay_pending = amber, transport accepted, awaiting receiver ACK (or ACK API unavailable)
       * queued        = amber, recipient offline / queued at relay
       * failed        = error, delivery not completed
       * unknown       = fallback
       */
      deliveryMode: 'live' | 'relay_pending' | 'queued' | 'failed' | 'unknown'
      cloneId: string
      cloneMetadata: BeapInboxCloneAuditMetadata
    }
  | { success: false; error: string; code: 'SANDBOX_ENTITLEMENT_REQUIRED'; upgradeUrl?: string }
  | { success: false; error: string; code?: 'SANDBOX_SEND_FAILED' }

/**
 * Wait up to `timeoutMs` for a delivery ACK for the given handshakeId.
 * Uses the same `inbox:beapDeliveryAck` IPC event as direct BEAP messages.
 * Returns true if ACK arrived, false on timeout or API unavailable.
 */
function waitForCloneDeliveryAck(
  handshakeId: string,
  cloneId: string,
  timeoutMs: number,
): Promise<boolean> {
  const ackFn = window.emailInbox?.onBeapDeliveryAck
  if (typeof ackFn !== 'function') {
    return Promise.resolve(false)
  }
  return new Promise<boolean>((resolve) => {
    let resolved = false
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        unsub?.()
        resolve(false)
      }
    }, timeoutMs)
    const unsub = ackFn((data: { handshakeId: string; rowId: string }) => {
      if (!resolved && data.handshakeId === handshakeId) {
        resolved = true
        clearTimeout(timer)
        unsub?.()
        // eslint-disable-next-line no-console
        console.log(`[CLONE_SEND] ack_received cloneId=${cloneId} handshake=${data.handshakeId} rowId=${data.rowId}`)
        resolve(true)
      }
    })
  })
}

/**
 * @param preparePayload - From `inbox:cloneBeapToSandbox` (success + prepare object).
 * @param cloneId - Correlation ID generated by the caller; threaded through all log lines.
 */
export async function cloneBeapInboxToSandbox(
  preparePayload: BeapInboxClonePrepareOk,
  cloneId: string,
): Promise<BeapInboxCloneToSandboxResult> {
  // eslint-disable-next-line no-console
  console.log(`[CLONE_RENDERER] handler_started cloneId=${cloneId} sourceMessage=${preparePayload.source_message_id} targetHandshake=${preparePayload.target_handshake_id}`)

  const records = await listHandshakes('active')
  const raw = (records as HandshakeRecord[]).find((r) => r.handshake_id === preparePayload.target_handshake_id)
  if (!raw) {
    // eslint-disable-next-line no-console
    console.log(`[CLONE_SEND] failed cloneId=${cloneId} reason=target_handshake_not_found`)
    return { success: false, code: 'SANDBOX_SEND_FAILED', error: 'Target handshake not found in active list' }
  }
  const selectedRecipient = handshakeRecordToSelectedRecipient(raw)
  if (!hasHandshakeKeyMaterial(selectedRecipient)) {
    // eslint-disable-next-line no-console
    console.log(`[CLONE_SEND] failed cloneId=${cloneId} reason=missing_key_material`)
    return { success: false, code: 'SANDBOX_SEND_FAILED', error: 'Target handshake is missing key material for qBEAP' }
  }

  const kp = await getSigningKeyPair()
  const senderFp = kp.publicKey
  const senderShort =
    senderFp.length > 12 ? `${senderFp.slice(0, 4)}…${senderFp.slice(-4)}` : senderFp
  const at = new Date().toISOString()

  // PR 5.2 / Decision B: provenance is an object — moves to metadata, not body.
  const cloneProvenance = buildCloneProvenanceObject(preparePayload, at)

  // PR 5.2 / Decision B: body is the source bytes unchanged.
  // Lead-in banner is prepended to the public (non-authoritative) text only.
  const pub = `${SANDBOX_CLONE_INBOX_LEAD_IN}${preparePayload.public_text || preparePayload.encrypted_text}`.trim()
  const enc = preparePayload.encrypted_text.trim()

  // eslint-disable-next-line no-console
  console.log(`[CLONE_PACKAGE] created cloneId=${cloneId} type=qBEAP handshake=${preparePayload.target_handshake_id} sourceType=${preparePayload.source_type}`)

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
      // PR 5.2 / Decision B: provenance rides in metadata; sandbox reads it from
      // depackaged_metadata.inbox_response_path.sandbox_clone_provenance.
      sandbox_clone_provenance: cloneProvenance,
    },
    attachments: [],
    // Correlation ID for cross-layer tracing (CLONE_* logs).
    _beapMsgId: cloneId,
    // PR 5.2 / Decision A: forward source session import artefact so the Builder
    // serialises it at the canonical top-level position in the new capsule.
    ...(preparePayload.session_import_artefact != null
      ? { sessionImportArtefact: preparePayload.session_import_artefact as any }
      : {}),
  }

  // eslint-disable-next-line no-console
  console.log(`[CLONE_SEND] target_selected cloneId=${cloneId} handshake=${preparePayload.target_handshake_id} transport=p2p`)
  // eslint-disable-next-line no-console
  console.log(`[CLONE_SEND] send_attempt cloneId=${cloneId}`)

  const delivery = await executeDeliveryAction(config)
  if (!delivery.success) {
    if (delivery.code === 'SANDBOX_ENTITLEMENT_REQUIRED') {
      // eslint-disable-next-line no-console
      console.log(`[CLONE_SEND] failed cloneId=${cloneId} reason=sandbox_entitlement_required`)
      // eslint-disable-next-line no-console
      console.log('[BEAP_SANDBOX_CLONE] entitlement_required', { http_status: 403, relay_error: 'sandbox_entitlement_required' })
      return {
        success: false,
        code: 'SANDBOX_ENTITLEMENT_REQUIRED',
        error: 'sandbox_entitlement_required',
        ...(delivery.upgradeUrl ? { upgradeUrl: delivery.upgradeUrl } : {}),
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[CLONE_SEND] failed cloneId=${cloneId} reason=${delivery.message ?? 'send_failed'}`)
    return { success: false, code: 'SANDBOX_SEND_FAILED', error: delivery.message || 'Send failed' }
  }

  const queuedOffline = delivery.queued === true || delivery.coordinationRelayDelivery === 'queued_recipient_offline'

  if (queuedOffline) {
    // eslint-disable-next-line no-console
    console.log(`[CLONE_SEND] transport_accepted cloneId=${cloneId} status=queued_recipient_offline`)
    const deliveryMode = mapCoordinationDeliveryToMatrixMode(delivery)
    const tu = preparePayload.triggered_url != null && String(preparePayload.triggered_url).trim() ? String(preparePayload.triggered_url).trim() : null
    const cloneMetadata: BeapInboxCloneAuditMetadata = buildCloneMetadata(preparePayload, at, tu)
    void insertOutboxEntry(delivery, deliveryMode, cloneMetadata, preparePayload, raw, pub, enc, cloneId)
    return { success: true, delivery, deliveryMode, cloneId, cloneMetadata }
  }

  // Transport accepted — wait for receiver ACK before declaring live delivery.
  // eslint-disable-next-line no-console
  console.log(`[CLONE_SEND] transport_accepted cloneId=${cloneId} relayAccepted=true deliveredLive=${!!(delivery as any).delivered_peer_live}`)
  // eslint-disable-next-line no-console
  console.log(`[CLONE_SEND] ack_wait_start cloneId=${cloneId} handshake=${preparePayload.target_handshake_id}`)

  // 15 s timeout; sandbox is same-machine so ACK should arrive in < 500 ms.
  const ackReceived = await waitForCloneDeliveryAck(preparePayload.target_handshake_id, cloneId, 15_000)

  if (!ackReceived) {
    // eslint-disable-next-line no-console
    console.log(`[CLONE_SEND] delivery_unconfirmed cloneId=${cloneId} reason=timeout`)
  }

  const tu = preparePayload.triggered_url != null && String(preparePayload.triggered_url).trim() ? String(preparePayload.triggered_url).trim() : null
  const cloneMetadata: BeapInboxCloneAuditMetadata = buildCloneMetadata(preparePayload, at, tu)
  void insertOutboxEntry(delivery, ackReceived ? 'live' : 'relay_pending', cloneMetadata, preparePayload, raw, pub, enc, cloneId)

  return { success: true, delivery, deliveryMode: ackReceived ? 'live' : 'relay_pending', cloneId, cloneMetadata }
}

function buildCloneMetadata(
  preparePayload: BeapInboxClonePrepareOk,
  at: string,
  tu: string | null,
): BeapInboxCloneAuditMetadata {
  return {
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
}

function insertOutboxEntry(
  delivery: DeliveryResult,
  deliveryMode: string,
  cloneMetadata: BeapInboxCloneAuditMetadata,
  preparePayload: BeapInboxClonePrepareOk,
  raw: HandshakeRecord,
  pub: string,
  enc: string,
  cloneId: string,
): Promise<void> {
  try {
    const subj =
      preparePayload.subject.startsWith('Sandbox:') || preparePayload.subject.startsWith('Re:')
        ? preparePayload.subject
        : `Sandbox: ${preparePayload.subject}`
    return (window.outbox
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
          clone_id: cloneId,
          clone_metadata: cloneMetadata,
          original_message_id: preparePayload.source_message_id,
          coordinationRelayDelivery: delivery.coordinationRelayDelivery,
          deliveryMode,
        }),
      })
      .catch((err: unknown) => console.warn('[Outbox] sandbox clone insert failed:', err)) ?? Promise.resolve())
  } catch {
    return Promise.resolve()
  }
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
  if (code === 'vault_locked_or_key_provider_unbound') {
    return err.trim() || 'Vault must be unlocked before cloning this message.'
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
    if ('code' in r && r.code === 'SANDBOX_ENTITLEMENT_REQUIRED') {
      const upgradeUrl = 'upgradeUrl' in r ? (r.upgradeUrl as string | undefined) : undefined
      return {
        kind: 'error',
        text: 'Sandbox mode requires an upgrade',
        view: viewSandboxEntitlementRequired(upgradeUrl),
      }
    }
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
    // relay_pending: transport accepted but receiver ACK not yet confirmed.
    if (r.deliveryMode === 'relay_pending') {
      return {
        kind: 'success_queued',
        text: 'Clone sent — awaiting delivery confirmation.',
        view: {
          variant: 'queued',
          message: 'Clone sent — awaiting delivery confirmation.',
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
  const cloneId = crypto.randomUUID()
  // eslint-disable-next-line no-console
  console.log(`[CLONE_UI] clicked cloneId=${cloneId} sourceMessageId=${params.sourceMessageId} targetHandshake=${params.targetHandshakeId ?? 'auto'}`)

  const fn = window.beapInbox?.cloneBeapToSandbox ?? window.beapInbox?.cloneToSandboxPrepare
  if (typeof fn !== 'function') {
    // eslint-disable-next-line no-console
    console.log(`[CLONE_IPC] failed cloneId=${cloneId} reason=api_not_available`)
    return { success: false, error: 'beapInbox.cloneBeapToSandbox not available' }
  }

  // eslint-disable-next-line no-console
  console.log(`[CLONE_IPC] invoke cloneId=${cloneId} channel=inbox:cloneBeapToSandbox`)
  const r = await fn({
    sourceMessageId: params.sourceMessageId,
    ...(params.targetHandshakeId ? { targetHandshakeId: params.targetHandshakeId } : {}),
    ...(params.cloneReason ? { cloneReason: params.cloneReason } : {}),
    ...(params.triggeredUrl && params.triggeredUrl.trim() ? { triggeredUrl: params.triggeredUrl.trim() } : {}),
    _cloneId: cloneId,
  })

  // eslint-disable-next-line no-console
  console.log(`[CLONE_IPC] response cloneId=${cloneId} success=${r?.success ?? false}`)

  if (!r?.success || !('prepare' in r) || !r.prepare) {
    const fail = r as { success: false; error?: string; code?: CloneBeapToSandboxIpcErrorCode; details?: unknown }
    // eslint-disable-next-line no-console
    console.log(`[CLONE_IPC] prepare_failed cloneId=${cloneId} code=${fail?.code ?? 'none'} error=${fail?.error ?? 'unknown'}`)
    return {
      success: false,
      error: typeof fail?.error === 'string' ? fail.error : 'Prepare failed',
      ...(fail.code != null ? { code: fail.code, details: fail.details } : {}),
    }
  }
  return cloneBeapInboxToSandbox(r.prepare, cloneId)
}
