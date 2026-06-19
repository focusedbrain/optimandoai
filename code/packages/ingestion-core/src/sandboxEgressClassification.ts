/**
 * Sandbox outbound data-egress classification — SHARED source of truth.
 *
 * One allowlist, used by both:
 *   - P1 (app/IPC layer): electron/main/sandbox/sandboxOutboundPolicy.ts
 *   - P2 (ingress backstop): coordination-service POST /beap/capsule and
 *     relay-server POST /beap/ingest.
 *
 * A sandbox-role node is data-plane receive-only: it may emit only control-plane /
 * plumbing capsules (handshake lifecycle, internal inference to the paired host,
 * the depackage->host ingestion handoff, and metadata signaling). Every content-
 * bearing capsule (native BEAP message_package, qBEAP/pBEAP, external BEAP, plain
 * email/BEAP-via-email, clone responses, internal_draft, and any unknown/future
 * type) is denied. Deny-by-default: anything not on the allowlist is data-plane.
 *
 * Keep this list IDENTICAL across layers — do not fork it.
 */

import { isCoordinationRelayNativeBeap } from './beapDetection.js';
import { SEALED_SERVICE_RPC_CAPSULE_TYPE } from './sealedServiceRpcConstants.js';

/**
 * The ONLY capsule / service-message types a sandbox-role node may emit outward.
 *
 * `sealed_service_rpc_v1` is the opaque relay envelope (A1/A2): the relay and
 * ingress backstop see only this capsule_type. Which inner service-RPC types a
 * sandbox may place inside the ciphertext is enforced at seal-construction time
 * in the app (`assertSandboxMaySealServiceRpcInnerType` in sandboxOutboundPolicy.ts)
 * — NOT by reading ciphertext on the relay (INV-RELAY-BLIND).
 */
export const SANDBOX_OUTBOUND_ALLOWED_TYPES: ReadonlySet<string> = new Set([
  // Handshake lifecycle (control plane)
  'initiate',
  'accept',
  'refresh',
  'revoke',
  'context_sync',
  // Internal inference to the paired host (Host AI)
  'internal_inference_request',
  'internal_inference_result',
  'internal_inference_error',
  'internal_inference_cancel',
  'internal_inference_capabilities_request',
  // Depackage -> host ingestion handoff (plumbing, not messaging)
  'sandbox_email_delivery',
  // Metadata-only signaling
  'p2p_signal',
  // Opaque E2E-sealed service-RPC (inner type gated before seal in app)
  SEALED_SERVICE_RPC_CAPSULE_TYPE,
]);

/**
 * context_sync is permitted (handshake mechanism) but historically can embed full
 * block content (buildContextSyncCapsuleWithContent), so a compromised sandbox could
 * abuse it as a covert exfil channel. The handshake builder is NOT changed; instead
 * the ingress layer applies an infra-only byte cap + rate limit per sandbox device to
 * BOUND (not eliminate) that residual channel. Env-overridable.
 */
export const SANDBOX_CONTEXT_SYNC_MAX_BYTES = (() => {
  const raw = Number(process.env.WRDESK_SANDBOX_CONTEXT_SYNC_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1_048_576; // 1 MiB default
})();

export const SANDBOX_CONTEXT_SYNC_RATE_WINDOW_MS = (() => {
  const raw = Number(process.env.WRDESK_SANDBOX_CONTEXT_SYNC_RATE_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 60_000; // 60s window
})();

export const SANDBOX_CONTEXT_SYNC_MAX_PER_WINDOW = (() => {
  const raw = Number(process.env.WRDESK_SANDBOX_CONTEXT_SYNC_MAX_PER_WINDOW);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30; // 30 per window per device
})();

export interface SandboxEgressCapsuleClass {
  /** Derived capsule/service-message type, or 'message_package' for native BEAP wire. */
  type: string;
  /** True if the body is a native BEAP message package (qBEAP/pBEAP wire). */
  isNativeBeap: boolean;
  /** True if the type is allowlisted (control-plane / plumbing) for a sandbox node. */
  allowed: boolean;
  /** True if the capsule is content-bearing and forbidden from a sandbox node. */
  dataPlane: boolean;
  /** True only for context_sync (allowed, but subject to the infra cap). */
  isContextSync: boolean;
}

/**
 * Derive the outbound type for an ingress capsule. Native BEAP packages carry no
 * top-level `capsule_type` and are detected structurally -> 'message_package'.
 * Handshake capsules carry `capsule_type`; service messages carry `type`.
 */
export function deriveCapsuleTypeForEgress(parsed: unknown): string {
  if (isCoordinationRelayNativeBeap(parsed)) return 'message_package';
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
  const o = parsed as Record<string, unknown>;
  const ct = typeof o.capsule_type === 'string' ? o.capsule_type.trim() : '';
  if (ct) return ct;
  const t = typeof o.type === 'string' ? o.type.trim() : '';
  if (t) return t;
  // No explicit type but a message-package-shaped body -> treat as message_package.
  if (
    'header' in o ||
    'envelope' in o ||
    'payload' in o ||
    'payloadEnc' in o ||
    'innerEnvelopeCiphertext' in o
  ) {
    return 'message_package';
  }
  return '';
}

export function isSandboxAllowedOutboundType(type: string | null | undefined): boolean {
  const t = typeof type === 'string' ? type.trim() : '';
  return t.length > 0 && SANDBOX_OUTBOUND_ALLOWED_TYPES.has(t);
}

/**
 * Classify a parsed ingress capsule for the sandbox-egress backstop.
 * `allowed === false` => the capsule is data-plane and MUST be refused when the
 * sender device is a registered sandbox role. Deny-by-default.
 */
export function classifySandboxOutboundCapsule(parsed: unknown): SandboxEgressCapsuleClass {
  const isNativeBeap = isCoordinationRelayNativeBeap(parsed);
  const type = deriveCapsuleTypeForEgress(parsed);
  const allowed = !isNativeBeap && isSandboxAllowedOutboundType(type);
  return {
    type: type || 'unknown',
    isNativeBeap,
    allowed,
    dataPlane: !allowed,
    isContextSync: !isNativeBeap && type === 'context_sync',
  };
}

export interface SandboxContextSyncRateLimiter {
  /**
   * Record one context_sync from `deviceId` and report whether it is within the
   * per-device sliding-window quota. Returns `{ ok:false }` when the device has
   * exceeded `SANDBOX_CONTEXT_SYNC_MAX_PER_WINDOW` in the current window.
   */
  check(deviceId: string, now?: number): { ok: boolean; count: number; limit: number };
}

/**
 * Factory for the per-server context_sync rate limiter. The factory is pure; the
 * returned instance holds the sliding-window state in a closure (per-process, per
 * sandbox device id). Shared algorithm so coordination + relay throttle identically.
 */
export function createSandboxContextSyncRateLimiter(
  windowMs: number = SANDBOX_CONTEXT_SYNC_RATE_WINDOW_MS,
  maxPerWindow: number = SANDBOX_CONTEXT_SYNC_MAX_PER_WINDOW,
): SandboxContextSyncRateLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(deviceId: string, now: number = Date.now()) {
      const key = (deviceId ?? '').trim() || '(unknown)';
      const cutoff = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      recent.push(now);
      hits.set(key, recent);
      return { ok: recent.length <= maxPerWindow, count: recent.length, limit: maxPerWindow };
    },
  };
}
