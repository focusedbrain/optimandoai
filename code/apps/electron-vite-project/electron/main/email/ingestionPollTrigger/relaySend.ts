/**
 * Host → sandbox sealed service-RPC send via coordination relay (A3).
 * INV-ENCRYPT: inner JSON sealed before POST; relay sees routing + ciphertext only.
 * INV-RELAY-BLIND: no decryption on this path — structure + identity routing only.
 */

import { SEALED_SERVICE_RPC_CAPSULE_TYPE } from '@repo/ingestion-core'
import type { HandshakeRecord } from '../../handshake/types'
import { sendCapsuleViaCoordination, type SendCapsuleResult } from '../../handshake/p2pTransport'
import { getCoordinationOidcToken } from '../../handshake/ipc'
import { getP2PConfig } from '../../p2p/p2pConfig'
import {
  sealServiceRpcPayload,
  type SealedServiceRpcEnvelope,
  type SealServiceRpcInput,
} from '../../serviceRpc/sealedServiceRpc'

export type SealedRelaySendResult = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string }

export type SealedRelayCapsuleSender = (
  capsule: object,
  coordinationUrl: string,
  oidcToken: string,
  queueHandshakeId: string,
  db?: unknown,
) => Promise<SendCapsuleResult>

export type CoordinationOidcTokenProvider = () => Promise<string | null>

export function buildSealedServiceRpcRelayCapsule(envelope: SealedServiceRpcEnvelope): Record<string, unknown> {
  return {
    capsule_type: SEALED_SERVICE_RPC_CAPSULE_TYPE,
    schema_version: envelope.schema_version,
    envelope_type: envelope.envelope_type,
    handshake_id: envelope.handshake_id,
    sender_device_id: envelope.sender_device_id,
    receiver_device_id: envelope.receiver_device_id,
    sender_ephemeral_x25519_pub_b64: envelope.sender_ephemeral_x25519_pub_b64,
    salt_b64: envelope.salt_b64,
    nonce_b64: envelope.nonce_b64,
    ciphertext_b64: envelope.ciphertext_b64,
  }
}

export function sealServiceRpcForRelay(
  record: HandshakeRecord,
  input: SealServiceRpcInput,
): { readonly ok: true; readonly envelope: SealedServiceRpcEnvelope } | { readonly ok: false; readonly code: string; readonly message: string } {
  return sealServiceRpcPayload(record, input)
}

export async function sendSealedServiceRpcViaCoordinationRelay(
  db: unknown,
  record: HandshakeRecord,
  envelope: SealedServiceRpcEnvelope,
  deps: {
    sendCapsule?: SealedRelayCapsuleSender
    getOidcToken?: CoordinationOidcTokenProvider
  } = {},
): Promise<SealedRelaySendResult> {
  const sendCapsule = deps.sendCapsule ?? sendCapsuleViaCoordination
  const getOidcToken = deps.getOidcToken ?? getCoordinationOidcToken

  const cfg = getP2PConfig(db as never)
  const coordUrl = cfg.coordination_url?.trim() ?? ''
  if (!cfg.use_coordination || !coordUrl) {
    return {
      ok: false,
      code: 'E_INGESTION_POLL_RELAY_UNAVAILABLE',
      message: 'coordination relay not configured — cannot send sealed poll trigger',
    }
  }

  const token = await getOidcToken()
  if (!token?.trim()) {
    return {
      ok: false,
      code: 'E_INGESTION_POLL_AUTH',
      message: 'coordination OIDC token missing — cannot send sealed poll trigger',
    }
  }

  const capsule = buildSealedServiceRpcRelayCapsule(envelope)
  const result = await sendCapsule(capsule, coordUrl, token.trim(), record.handshake_id, db)

  if (result.localRelayValidationFailed) {
    return {
      ok: false,
      code: 'E_INGESTION_POLL_PROTOCOL',
      message: result.localRelayValidation?.message ?? 'local relay validation blocked sealed send',
    }
  }

  if (!result.success) {
    const status = result.statusCode
    if (status === 401 || status === 403) {
      return {
        ok: false,
        code: 'E_INGESTION_POLL_AUTH',
        message: result.error ?? `relay rejected sealed send (HTTP ${String(status)})`,
      }
    }
    return {
      ok: false,
      code: 'E_INGESTION_POLL_LINK_DOWN',
      message: result.error ?? 'relay POST failed for sealed poll trigger',
    }
  }

  return { ok: true }
}
