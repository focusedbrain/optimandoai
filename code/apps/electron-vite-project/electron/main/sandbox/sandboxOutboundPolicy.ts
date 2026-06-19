/**
 * Sandbox outbound data-egress policy — allowlist, deny-by-default.
 *
 * THREAT MODEL
 *   The sandbox is the node most likely to be compromised: it opens untrusted
 *   mail, attachments, and links. It is NOT a messaging environment and has no
 *   legitimate reason to emit human-composed content outward. A compromised
 *   renderer can call any IPC directly, so enforcement here is server-side and
 *   real — the UI (P3) is only the honest surface, the relay (P2) the backstop.
 *
 * BOUNDARY
 *   control-plane out  = ALLOWED  (pairing / lifecycle / signaling / Host AI /
 *                                  ingestion plumbing to the paired host)
 *   data-plane out     = FORBIDDEN (any content-bearing message: BEAP message
 *                                  packages, qBEAP/pBEAP, external BEAP, BEAP-
 *                                  via-email, plain email send/reply/compose,
 *                                  clone responses, internal_draft, unknown)
 *
 * This module is ALLOWLIST-based: only the enumerated system flows are permitted
 * from a sandbox-role node; everything else (including unknown, future types) is
 * denied. Discrimination is BY TYPE — never a blanket "if sandbox, refuse" — so
 * the handshake, Host AI, and depackage→host handoff keep working end to end.
 *
 * The effective-sandbox signal is the SAME ledger-authoritative proof used by
 * Host AI and `orchestrator:getMode` (mode==='sandbox' OR the ACTIVE internal
 * ledger proves this device is the Sandbox side of a Sandbox↔Host pair). It is
 * NOT mode-only: `orchestrator-mode.json` can remain 'host' after a sandbox-role
 * accept (no sync-back exists).
 */

import { getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { ledgerProvesLocalSandboxToHostFromDb } from '../internalInference/hostAiInternalPairingLedger'
import { SANDBOX_OUTBOUND_ALLOWED_TYPES, SEALED_SERVICE_RPC_CAPSULE_TYPE } from '@repo/ingestion-core'

export { SANDBOX_OUTBOUND_ALLOWED_TYPES, SEALED_SERVICE_RPC_CAPSULE_TYPE }

export const SANDBOX_DATA_EGRESS_FORBIDDEN = 'SANDBOX_DATA_EGRESS_FORBIDDEN' as const

/**
 * Inner service-RPC types a sandbox may receive inside a sealed_service_rpc_v1
 * envelope from the paired host (inbound relay). Host-only triggers only.
 */
export const SANDBOX_PERMITTED_SEALED_SERVICE_RPC_INBOUND_INNER_TYPES: ReadonlySet<string> = new Set([
  'ingestion_poll_request',
])

export type SandboxSealedServiceRpcInboundInnerVerdict =
  | { ok: true }
  | {
      ok: false
      code: 'E_INGESTION_POLL_FORBIDDEN'
      innerType: string
      message: string
    }

/** Gate after openServiceRpcPayload — sandbox may act only on host poll triggers. */
export function assertSandboxMayReceiveSealedServiceRpcInnerType(
  innerType: string,
): SandboxSealedServiceRpcInboundInnerVerdict {
  const t = typeof innerType === 'string' ? innerType.trim() : ''
  if (!t) {
    return {
      ok: false,
      code: 'E_INGESTION_POLL_FORBIDDEN',
      innerType: t || '(empty)',
      message: 'Sealed service-RPC inner type is required on inbound relay',
    }
  }
  if (SANDBOX_PERMITTED_SEALED_SERVICE_RPC_INBOUND_INNER_TYPES.has(t)) {
    return { ok: true }
  }
  return {
    ok: false,
    code: 'E_INGESTION_POLL_FORBIDDEN',
    innerType: t,
    message:
      'This sandbox is not permitted to act on that sealed service-RPC type. ' +
      'Only host-originated ingestion_poll_request triggers may be processed.',
  }
}

/**
 * Inner service-RPC types a sandbox may place inside a sealed_service_rpc_v1
 * envelope before sealing. Enforced at construction time in the app — the relay
 * and ingress classifiers see only the opaque capsule_type (INV-RELAY-BLIND).
 *
 * Host-only inner types (e.g. ingestion_poll_request) must never appear here.
 */
export const SANDBOX_PERMITTED_SEALED_SERVICE_RPC_INNER_TYPES: ReadonlySet<string> = new Set([
  'ingestion_poll_result',
  'ingestion_poll_error',
])

export type SandboxSealedServiceRpcInnerVerdict =
  | { ok: true }
  | {
      ok: false
      code: typeof SANDBOX_DATA_EGRESS_FORBIDDEN
      innerType: string
      message: string
    }

/**
 * Gate before `sealServiceRpcPayload` on sandbox nodes. Plaintext inner types
 * like `ingestion_poll_request` remain forbidden even though the outer relay
 * capsule_type is opaque.
 */
export function assertSandboxMaySealServiceRpcInnerType(innerType: string): SandboxSealedServiceRpcInnerVerdict {
  const t = typeof innerType === 'string' ? innerType.trim() : ''
  if (!t) {
    return {
      ok: false,
      code: SANDBOX_DATA_EGRESS_FORBIDDEN,
      innerType: t || '(empty)',
      message: 'Sealed service-RPC inner type is required before egress',
    }
  }
  if (SANDBOX_PERMITTED_SEALED_SERVICE_RPC_INNER_TYPES.has(t)) {
    return { ok: true }
  }
  return {
    ok: false,
    code: SANDBOX_DATA_EGRESS_FORBIDDEN,
    innerType: t,
    message:
      'This sandbox is not permitted to seal and send that service-RPC type outward. ' +
      'Poll triggers are host-only; only poll results/errors may egress from the sandbox.',
  }
}

/**
 * The ONLY capsule / service-message types a sandbox-role node may emit outward
 * (re-exported from the shared source of truth `@repo/ingestion-core` so P1 (IPC)
 * and P2 (relay/coordination ingress) classify identically — do not fork):
 *
 *   - Handshake lifecycle (pairing / staying paired): initiate, accept, refresh,
 *     revoke, context_sync. Pairing a fresh sandbox happens before the device has
 *     touched untrusted mail; breaking these bricks the device.
 *   - Internal inference request/result/etc. to the paired host (Host AI). Carries
 *     prompts/results to the SAME-principal paired host only (policy-gated upstream).
 *   - sandbox_email_delivery: the depackaged→host ingestion handoff. Ingestion
 *     plumbing, NOT messaging — it carries guest-derived safe content to the paired
 *     host inbox only and originates no user-composed message.
 *   - p2p_signal: metadata-only WebRTC signaling (SDP/ICE control, no bodies).
 *   - sealed_service_rpc_v1: opaque E2E envelope; inner type gated before seal.
 */

/**
 * Logical outbound operations. `capsule_enqueue` is the relay-queue choke point
 * and discriminates by `capsuleType`. The remaining operations are human-
 * originated messaging surfaces that are NEVER permitted from a sandbox node,
 * regardless of credential state or payload.
 */
export type SandboxOutboundOperation =
  | 'capsule_enqueue'
  | 'beap_send'
  | 'beap_reply'
  | 'email_send'
  | 'email_reply'
  | 'email_beap_send'

export interface SandboxEgressRequest {
  operation: SandboxOutboundOperation
  /** Capsule / service-message type for queue-path requests (null for raw messaging ops). */
  capsuleType?: string | null
  /** Optional destination hint for logs (no secrets). */
  destination?: string | null
}

export type SandboxEgressVerdict =
  | { ok: true }
  | {
      ok: false
      code: typeof SANDBOX_DATA_EGRESS_FORBIDDEN
      operation: SandboxOutboundOperation
      capsuleType: string | null
      message: string
    }

const SANDBOX_EGRESS_USER_MESSAGE =
  'Sending messages is disabled on the sandbox for security. ' +
  'The sandbox can receive and analyze, but cannot send messages outward.'

function deny(
  operation: SandboxOutboundOperation,
  capsuleType: string | null,
): SandboxEgressVerdict {
  return {
    ok: false,
    code: SANDBOX_DATA_EGRESS_FORBIDDEN,
    operation,
    capsuleType,
    message: SANDBOX_EGRESS_USER_MESSAGE,
  }
}

/**
 * Pure allowlist decision. Call ONLY after confirming the node is an effective
 * sandbox (see {@link isEffectiveSandboxNode}). Deny-by-default:
 *   - messaging operations (beap_send / email_* / …) are always denied;
 *   - queue-path (`capsule_enqueue`) is allowed iff `capsuleType` is on the
 *     allowlist — missing / unknown / future types are denied.
 */
export function assertSandboxDataEgressAllowed(
  req: SandboxEgressRequest,
): SandboxEgressVerdict {
  const capsuleType = typeof req.capsuleType === 'string' ? req.capsuleType.trim() : null

  if (req.operation === 'capsule_enqueue') {
    if (capsuleType && SANDBOX_OUTBOUND_ALLOWED_TYPES.has(capsuleType)) {
      return { ok: true }
    }
    return deny(req.operation, capsuleType)
  }

  // All non-queue operations are human-originated messaging surfaces — never
  // permitted from a sandbox node (deny regardless of credentials or payload).
  return deny(req.operation, capsuleType)
}

/**
 * Derive the outbound type for a capsule/object headed to the relay queue.
 * Native BEAP message packages (qBEAP/pBEAP) carry no top-level `capsule_type`
 * and are detected structurally — they normalize to 'message_package' (denied).
 * Handshake capsules carry `capsule_type`; service messages carry `type`.
 */
export function deriveOutboundCapsuleType(capsule: unknown): string | null {
  if (!capsule || typeof capsule !== 'object') return null
  const o = capsule as Record<string, unknown>
  const ct = typeof o.capsule_type === 'string' ? o.capsule_type.trim() : ''
  if (ct) return ct
  const t = typeof o.type === 'string' ? o.type.trim() : ''
  if (t) return t
  // No explicit type: structurally a native BEAP message package (header/metadata
  // + envelope/payload). Treat as 'message_package' so the allowlist denies it.
  if ('header' in o || 'envelope' in o || 'payload' in o || 'payloadEnc' in o) {
    return 'message_package'
  }
  return null
}

/**
 * Synchronous, db-based effective-sandbox check. Reuses the ledger-authoritative
 * signal (mode==='sandbox' OR ledger-proves-sandbox). NOT mode-only.
 *
 * Used at synchronous choke points (e.g. `enqueueOutboundCapsule`). Never throws.
 */
export function isEffectiveSandboxNode(db: unknown): boolean {
  try {
    if (getOrchestratorMode().mode === 'sandbox') return true
  } catch {
    /* fall through to ledger */
  }
  if (!db) return false
  return ledgerProvesLocalSandboxToHostFromDb(db)
}

/**
 * Async effective-sandbox check for call sites without a db handle in scope
 * (e.g. the email send IPCs). Resolves the handshake ledger db itself, then
 * delegates to the synchronous {@link isEffectiveSandboxNode}. Never throws.
 */
export async function resolveEffectiveSandboxNode(): Promise<boolean> {
  try {
    if (getOrchestratorMode().mode === 'sandbox') return true
  } catch {
    /* fall through to ledger */
  }
  try {
    const { getHandshakeDbForInternalInference } = await import(
      '../internalInference/dbAccess'
    )
    const db = await getHandshakeDbForInternalInference()
    return isEffectiveSandboxNode(db)
  } catch {
    return false
  }
}
