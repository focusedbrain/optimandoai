/**
 * Sandbox-side handler for inbound sealed Host AI inference RESULT/ERROR capsules.
 *
 * Open (A1) → match request_id to pending → resolve async caller.
 * INV-ENCRYPT: completion lives ONLY inside ciphertext — relay never sees plaintext.
 */

import { getHandshakeRecord } from '../handshake/db'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { isEffectiveSandboxNode } from '../sandbox/sandboxOutboundPolicy'
import {
  openServiceRpcPayloadResolvingLocalKey,
} from '../serviceRpc/sealedServiceRpc'
import {
  parseSealedServiceRpcEnvelopeFromRelayCapsule,
  type IngestionPollRelayCapsuleContext,
} from '../email/ingestionPollTrigger/relayCapsuleHandler'
import { assertRecordForServiceRpc } from './policy'
import { resolveInternalInferenceByRequestId, type PendingResult } from './pendingRequests'
import {
  isHostAiInferenceResultOrErrorRelayInnerType,
  parseHostAiInferenceResultOrErrorFromPlaintext,
  HOST_AI_INFERENCE_RESULT_INNER_TYPE,
} from './hostAiSealedInferenceRelayWire'

const L = '[HOST_AI_SEALED_INFERENCE_RESULT_RELAY]'

function innerTypeFromPlaintext(plaintextJson: string): string | null {
  try {
    const o = JSON.parse(plaintextJson) as { type?: unknown }
    return typeof o.type === 'string' ? o.type.trim() : null
  } catch {
    return null
  }
}

/**
 * Handle one inbound sealed_service_rpc_v1 capsule containing host_ai_inference_result_v1 or _error_v1.
 * Sandbox-only. Returns true if consumed.
 */
export async function tryHandleHostAiSealedInferenceResultRelayCapsule(
  ctx: IngestionPollRelayCapsuleContext,
): Promise<boolean> {
  if (!isEffectiveSandboxNode(ctx.db)) {
    console.log(`${L} skipped reason=not_sandbox_receiver`)
    return false
  }

  const envelope = parseSealedServiceRpcEnvelopeFromRelayCapsule(ctx.capsule)
  if (!envelope) return false

  const localDeviceId = getInstanceId().trim()
  if (envelope.receiver_device_id !== localDeviceId) return false

  const record = getHandshakeRecord(ctx.db as any, envelope.handshake_id)
  if (!record) {
    console.warn(`${L} drop reason=no_handshake handshake=${envelope.handshake_id}`)
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const opened = await openServiceRpcPayloadResolvingLocalKey(record, envelope)
  if (!opened.ok) {
    console.warn(`${L} drop reason=open_failed code=${opened.code} handshake=${envelope.handshake_id}`)
    ctx.sendAck([ctx.relayMessageId])
    return true
  }

  const innerType = innerTypeFromPlaintext(opened.plaintextJson)
  if (!innerType || !isHostAiInferenceResultOrErrorRelayInnerType(innerType)) {
    return false
  }

  ctx.sendAck([ctx.relayMessageId])

  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) {
    console.warn(`${L} drop reason=policy code=${ar.code} handshake=${envelope.handshake_id}`)
    return true
  }

  const parsed = parseHostAiInferenceResultOrErrorFromPlaintext(opened.plaintextJson)
  if (!parsed.ok) {
    console.warn(`${L} drop reason=wire_invalid handshake=${envelope.handshake_id}`)
    return true
  }

  const wire = parsed.wire
  let pr: PendingResult

  if (wire.type === HOST_AI_INFERENCE_RESULT_INNER_TYPE) {
    pr = {
      kind: 'result',
      output: wire.output,
      model: wire.model,
      duration_ms: wire.duration_ms,
    }
  } else {
    pr = {
      kind: 'error',
      code: wire.code,
      message: wire.message,
    }
  }

  if (resolveInternalInferenceByRequestId(wire.request_id, pr)) {
    console.log(`${L} resolved request_id=${wire.request_id} type=${wire.type} handshake=${wire.handshake_id}`)
  } else {
    console.warn(`${L} no_pending request_id=${wire.request_id} handshake=${wire.handshake_id}`)
  }

  return true
}
