/**
 * Capsule fixtures for E2E transport tests.
 *
 * These are the canonical payloads used across HTTP, WebSocket, and IPC tests.
 * No mocking of pipeline internals — these flow through the real pipeline.
 */

import { INGESTION_CONSTANTS } from '../../types'

export function validBeapCapsule(): Record<string, unknown> {
  return {
    schema_version: 1,
    capsule_type: 'initiate',
    handshake_id: 'hs-e2e-transport-001',
    sender_id: 'user-e2e-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: new Date().toISOString(),
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
    relationship_id: 'rel-e2e-001',
    senderIdentity: {
      email: 'sender@example.com',
      iss: 'test-issuer',
      sub: 'test-sub',
      email_verified: true,
      wrdesk_user_id: 'user-e2e-1',
    },
    sender_wrdesk_user_id: 'user-e2e-1',
    external_processing: 'none',
    reciprocal_allowed: false,
    tierSignals: {
      plan: 'free',
      hardwareAttestation: null,
      dnsVerification: null,
      wrStampStatus: null,
    },
    wrdesk_policy_version: '1.0',
  }
}

export function malformedJsonString(): string {
  return '{this is completely invalid JSON! @#$%'
}

export function oversizedBody(): string {
  return 'x'.repeat(INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES + 1)
}

export function futureTimestampCapsule(): Record<string, unknown> {
  return {
    ...validBeapCapsule(),
    timestamp: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  }
}

export function unsupportedSchemaCapsule(): Record<string, unknown> {
  return {
    ...validBeapCapsule(),
    schema_version: 99,
  }
}

export function brandForgeryCapsule(): Record<string, unknown> {
  return {
    __brand: 'ValidatedCapsule',
    provenance: { source_type: 'api' },
    capsule: { capsule_type: 'initiate' },
    validated_at: new Date().toISOString(),
    validator_version: '1.0.0',
    schema_version: 1,
  }
}
