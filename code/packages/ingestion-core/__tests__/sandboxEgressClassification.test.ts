import { describe, test, expect } from 'vitest';
import {
  SANDBOX_OUTBOUND_ALLOWED_TYPES,
  classifySandboxOutboundCapsule,
  deriveCapsuleTypeForEgress,
  isSandboxAllowedOutboundType,
  createSandboxContextSyncRateLimiter,
} from '@repo/ingestion-core';

/** Native BEAP message package (qBEAP/pBEAP wire) — no top-level relay capsule_type. */
function nativeBeapPackage(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    header: { encoding: 'qBEAP', receiver_binding: { handshake_id: 'hs-1' } },
    metadata: { created_at: new Date().toISOString() },
    payloadEnc: 'ciphertext-bytes',
    ...extra,
  };
}

describe('sandbox egress classification (shared P1/P2 source of truth)', () => {
  test('allowlist contains exactly the control-plane / plumbing types', () => {
    expect([...SANDBOX_OUTBOUND_ALLOWED_TYPES].sort()).toEqual(
      [
        'accept',
        'context_sync',
        'initiate',
        'internal_inference_cancel',
        'internal_inference_capabilities_request',
        'internal_inference_error',
        'internal_inference_request',
        'internal_inference_result',
        'p2p_signal',
        'refresh',
        'revoke',
        'sandbox_email_delivery',
      ].sort(),
    );
  });

  test('native BEAP message package is data-plane (forbidden)', () => {
    const cls = classifySandboxOutboundCapsule(nativeBeapPackage());
    expect(cls.isNativeBeap).toBe(true);
    expect(cls.type).toBe('message_package');
    expect(cls.allowed).toBe(false);
    expect(cls.dataPlane).toBe(true);
    expect(cls.isContextSync).toBe(false);
  });

  test('handshake lifecycle capsules are allowed (control plane)', () => {
    for (const t of ['initiate', 'accept', 'refresh', 'revoke']) {
      const cls = classifySandboxOutboundCapsule({ capsule_type: t, handshake_id: 'hs' });
      expect(cls.allowed).toBe(true);
      expect(cls.dataPlane).toBe(false);
      expect(cls.isContextSync).toBe(false);
    }
  });

  test('context_sync is allowed and flagged for the infra cap', () => {
    const cls = classifySandboxOutboundCapsule({ capsule_type: 'context_sync', handshake_id: 'hs' });
    expect(cls.allowed).toBe(true);
    expect(cls.isContextSync).toBe(true);
  });

  test('inference + sandbox_email_delivery + p2p_signal allowed (service messages via type)', () => {
    for (const t of [
      'internal_inference_request',
      'internal_inference_result',
      'sandbox_email_delivery',
      'p2p_signal',
    ]) {
      const cls = classifySandboxOutboundCapsule({ type: t });
      expect(cls.allowed).toBe(true);
      expect(cls.dataPlane).toBe(false);
    }
  });

  test('unknown / future types are deny-by-default', () => {
    for (const t of ['message_package', 'internal_draft', 'clone_response', 'email_beap', 'totally_new']) {
      const cls = classifySandboxOutboundCapsule({ capsule_type: t });
      expect(cls.allowed).toBe(false);
      expect(cls.dataPlane).toBe(true);
    }
  });

  test('ingestion_poll_* host→sandbox control is NOT sandbox-outbound allowlisted', () => {
    for (const t of ['ingestion_poll_request', 'ingestion_poll_result', 'ingestion_poll_error']) {
      expect(SANDBOX_OUTBOUND_ALLOWED_TYPES.has(t)).toBe(false);
      const cls = classifySandboxOutboundCapsule({ type: t });
      expect(cls.allowed).toBe(false);
      expect(cls.dataPlane).toBe(true);
    }
  });

  test('type-less message-package-shaped body classifies as message_package', () => {
    expect(deriveCapsuleTypeForEgress(nativeBeapPackage())).toBe('message_package');
    expect(deriveCapsuleTypeForEgress({})).toBe('');
    expect(isSandboxAllowedOutboundType('context_sync')).toBe(true);
    expect(isSandboxAllowedOutboundType('message_package')).toBe(false);
    expect(isSandboxAllowedOutboundType('')).toBe(false);
    expect(isSandboxAllowedOutboundType(null)).toBe(false);
  });
});

describe('sandbox context_sync rate limiter', () => {
  test('allows up to the quota then throttles within the window', () => {
    const limiter = createSandboxContextSyncRateLimiter(60_000, 3);
    const now = 1_000_000;
    expect(limiter.check('dev-sand', now).ok).toBe(true); // 1
    expect(limiter.check('dev-sand', now + 1).ok).toBe(true); // 2
    expect(limiter.check('dev-sand', now + 2).ok).toBe(true); // 3
    const over = limiter.check('dev-sand', now + 3); // 4 -> over
    expect(over.ok).toBe(false);
    expect(over.count).toBe(4);
    expect(over.limit).toBe(3);
  });

  test('is per-device and recovers after the window slides', () => {
    const limiter = createSandboxContextSyncRateLimiter(60_000, 1);
    const now = 2_000_000;
    expect(limiter.check('dev-a', now).ok).toBe(true);
    expect(limiter.check('dev-a', now + 1).ok).toBe(false); // over for dev-a
    expect(limiter.check('dev-b', now + 1).ok).toBe(true); // independent device
    // After window slides past the first hit, dev-a is allowed again.
    expect(limiter.check('dev-a', now + 60_001).ok).toBe(true);
  });
});
