import { describe, test, expect } from 'vitest';
import { validateInput } from '../src/pipeline.js';
import { SEALED_SERVICE_RPC_CAPSULE_TYPE } from '../src/sealedServiceRpcConstants.js';

function minimalSealedCapsule(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    capsule_type: SEALED_SERVICE_RPC_CAPSULE_TYPE,
    envelope_type: SEALED_SERVICE_RPC_CAPSULE_TYPE,
    handshake_id: 'hs-sealed-val',
    sender_device_id: 'dev-host',
    receiver_device_id: 'dev-sand',
    sender_ephemeral_x25519_pub_b64: Buffer.alloc(32, 1).toString('base64'),
    salt_b64: Buffer.alloc(16, 2).toString('base64'),
    nonce_b64: Buffer.alloc(12, 3).toString('base64'),
    ciphertext_b64: Buffer.alloc(32, 4).toString('base64'),
    ...overrides,
  });
}

describe('sealed_service_rpc_v1 coordination validation', () => {
  test('validateInput accepts opaque sealed envelope without handshake hash fields', () => {
    const r = validateInput(
      {
        body: minimalSealedCapsule(),
        mime_type: 'application/json',
        headers: { 'content-type': 'application/json' },
      },
      'coordination_service',
    );
    expect(r.success).toBe(true);
  });

  test('validateInput rejects missing ciphertext_b64', () => {
    const body = JSON.parse(minimalSealedCapsule()) as Record<string, unknown>;
    delete body.ciphertext_b64;
    const r = validateInput(
      {
        body: JSON.stringify(body),
        mime_type: 'application/json',
        headers: { 'content-type': 'application/json' },
      },
      'coordination_service',
    );
    expect(r.success).toBe(false);
  });

  test('validateInput rejects envelope_type mismatch', () => {
    const r = validateInput(
      {
        body: minimalSealedCapsule({ envelope_type: 'wrong' }),
        mime_type: 'application/json',
        headers: { 'content-type': 'application/json' },
      },
      'coordination_service',
    );
    expect(r.success).toBe(false);
  });
});
