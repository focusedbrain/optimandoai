/**
 * Coordination WS dispatch for sealed_service_rpc_v1 — Host AI inference result first on sandbox,
 * then ingestion poll result (host-only), unified relay, inference request, poll request.
 */

import { SEALED_SERVICE_RPC_CAPSULE_TYPE } from '@repo/ingestion-core'
import { isIngestionPollServiceRpcShape } from './wire'
import {
  isSealedServiceRpcRelayCapsule,
  tryHandleIngestionPollRelayCapsule,
  type IngestionPollRelayCapsuleContext,
} from './relayCapsuleHandler'
import { tryHandleIngestionPollResultRelayCapsule } from './relayResultCapsuleHandler'

export function isPlaintextIngestionPollRelayCapsule(capsule: Record<string, unknown>): boolean {
  if (isSealedServiceRpcRelayCapsule(capsule)) return false
  return isIngestionPollServiceRpcShape(capsule)
}

export async function tryHandleSealedServiceRpcRelayCapsule(
  ctx: IngestionPollRelayCapsuleContext,
): Promise<void> {
  if (isPlaintextIngestionPollRelayCapsule(ctx.capsule)) {
    console.warn(
      '[IngestionPollTrigger] rejected plaintext ingestion_poll_* on relay — INV-ENCRYPT requires sealed_service_rpc_v1',
    )
    ctx.sendAck([ctx.relayMessageId])
    return
  }

  if (!isSealedServiceRpcRelayCapsule(ctx.capsule)) return

  const ct =
    typeof ctx.capsule.capsule_type === 'string' ? ctx.capsule.capsule_type.trim() : ''
  if (ct !== SEALED_SERVICE_RPC_CAPSULE_TYPE) return

  const { tryHandleHostAiSealedInferenceResultRelayCapsule } = await import(
    '../../internalInference/hostAiSealedInferenceRelayResultHandler'
  )
  if (await tryHandleHostAiSealedInferenceResultRelayCapsule(ctx)) return

  if (await tryHandleIngestionPollResultRelayCapsule(ctx)) return
  const { isUnifiedServiceRpcRelayEnabled } = await import('../../internalInference/unifiedServiceRpcRelayFlags')
  if (isUnifiedServiceRpcRelayEnabled()) {
    const { tryHandleHostAiUnifiedServiceRpcRelayCapsule } = await import(
      '../../internalInference/hostAiUnifiedServiceRpcRelayHandler'
    )
    if (await tryHandleHostAiUnifiedServiceRpcRelayCapsule(ctx)) return
  }

  const { tryHandleHostAiSealedInferenceRequestRelayCapsule } = await import(
    '../../internalInference/hostAiSealedInferenceRelayHandler'
  )
  if (await tryHandleHostAiSealedInferenceRequestRelayCapsule(ctx)) return

  if (await tryHandleIngestionPollRelayCapsule(ctx)) return

  console.warn('[IngestionPollTrigger] sealed_service_rpc_v1 not handled on this node — ack to avoid relay retry')
  ctx.sendAck([ctx.relayMessageId])
}
