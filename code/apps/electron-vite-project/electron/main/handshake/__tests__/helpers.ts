/**
 * Test helpers: builders, factories, and mock data.
 */

import type {
  VerifiedCapsuleInput,
  ReceiverPolicy,
  HandshakeRecord,
  SSOSession,
  TierSignals,
  TierDecision,
  EffectivePolicy,
  ContextBlockInput,
  CapsulePolicy,
  HandshakeVerificationContext,
  SharingMode,
  HandshakeTier,
  CapsuleType,
  ExternalProcessing,
  CloudPayloadMode,
} from '../types'
import {
  HandshakeState,
  buildDefaultReceiverPolicy,
} from '../types'

let idCounter = 0
function nextId(): string { return `test-id-${++idCounter}` }

export function buildSSOSession(overrides?: Partial<SSOSession>): SSOSession {
  return {
    wrdesk_user_id: 'local-user-001',
    email: 'local@wrdesk.com',
    iss: 'https://auth.wrdesk.com',
    sub: 'sub-local-001',
    email_verified: true,
    plan: 'pro',
    currentHardwareAttestation: null,
    currentDnsVerification: null,
    currentWrStampStatus: null,
    session_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  }
}

export function buildTierSignals(overrides?: Partial<TierSignals>): TierSignals {
  return {
    plan: 'pro',
    hardwareAttestation: null,
    dnsVerification: null,
    wrStampStatus: { verified: true, stampId: 'stamp-001' },
    ...overrides,
  }
}

export function buildContextBlock(overrides?: Partial<ContextBlockInput>): ContextBlockInput {
  const id = nextId()
  return {
    block_id: `block-${id}`,
    block_hash: `hash-${id}`,
    relationship_id: 'rel-001',
    handshake_id: 'hs-001',
    type: 'pricing',
    data_classification: 'public',
    version: 1,
    payload: 'test payload content',
    ...overrides,
  }
}

export function buildVerifiedCapsuleInput(
  overrides?: Partial<VerifiedCapsuleInput>,
): VerifiedCapsuleInput {
  return {
    schema_version: 1,
    capsule_hash: `capsule-hash-${nextId()}`,
    senderIdentity: {
      email: 'sender@example.com',
      iss: 'https://auth.wrdesk.com',
      sub: 'sub-sender-001',
      email_verified: true,
      wrdesk_user_id: 'sender-user-001',
    },
    signatureValid: true,
    containerIntegrityValid: true,
    sender_wrdesk_user_id: 'sender-user-001',
    capsuleType: 'handshake-initiate',
    handshake_id: 'hs-001',
    seq: 0,
    timestamp: new Date().toISOString(),
    relationship_id: 'rel-001',
    external_processing: 'none',
    reciprocal_allowed: true,
    tierSignals: buildTierSignals(),
    wrdesk_policy_hash: 'policy-hash-v1',
    wrdesk_policy_version: '2025-03-01',
    ...overrides,
  }
}

export function buildReceiverPolicy(
  overrides?: Partial<ReceiverPolicy>,
): ReceiverPolicy {
  return buildDefaultReceiverPolicy({
    acceptedWrdeskPolicyHashes: ['policy-hash-v1'],
    ...overrides,
  })
}

export function buildEffectivePolicy(overrides?: Partial<EffectivePolicy>): EffectivePolicy {
  return {
    allowedScopes: ['*'],
    effectiveTier: 'pro',
    allowsCloudEscalation: false,
    allowsExport: false,
    onRevocationDeleteBlocks: false,
    effectiveExternalProcessing: 'none',
    reciprocalAllowed: true,
    effectiveSharingModes: ['receive-only', 'reciprocal'],
    ...overrides,
  }
}

export function buildTierDecision(overrides?: Partial<TierDecision>): TierDecision {
  return {
    claimedTier: null,
    computedTier: 'pro',
    effectiveTier: 'pro',
    signals: buildTierSignals(),
    downgraded: false,
    ...overrides,
  }
}

export function buildHandshakeRecord(
  overrides?: Partial<HandshakeRecord>,
): HandshakeRecord {
  return {
    handshake_id: 'hs-001',
    relationship_id: 'rel-001',
    state: HandshakeState.PENDING_ACCEPT,
    initiator: {
      email: 'sender@example.com',
      wrdesk_user_id: 'sender-user-001',
      iss: 'https://auth.wrdesk.com',
      sub: 'sub-sender-001',
    },
    acceptor: null,
    local_role: 'acceptor',
    sharing_mode: null,
    reciprocal_allowed: true,
    tier_snapshot: buildTierDecision(),
    current_tier_signals: buildTierSignals(),
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: 'capsule-hash-init',
    effective_policy: buildEffectivePolicy(),
    external_processing: 'none',
    created_at: new Date().toISOString(),
    activated_at: null,
    expires_at: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: 'policy-hash-v1',
    initiator_wrdesk_policy_version: '2025-03-01',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    ...overrides,
  }
}

export function buildActiveHandshakeRecord(
  overrides?: Partial<HandshakeRecord>,
): HandshakeRecord {
  return buildHandshakeRecord({
    state: HandshakeState.ACTIVE,
    sharing_mode: 'reciprocal',
    acceptor: {
      email: 'local@wrdesk.com',
      wrdesk_user_id: 'local-user-001',
      iss: 'https://auth.wrdesk.com',
      sub: 'sub-local-001',
    },
    activated_at: new Date().toISOString(),
    last_seq_received: 0,
    last_capsule_hash_received: 'capsule-hash-accept',
    acceptor_wrdesk_policy_hash: 'policy-hash-v1',
    acceptor_wrdesk_policy_version: '2025-03-01',
    ...overrides,
  })
}

export function buildCtx(
  overrides?: Partial<HandshakeVerificationContext>,
): HandshakeVerificationContext {
  return {
    input: buildVerifiedCapsuleInput(),
    receiverPolicy: buildReceiverPolicy(),
    ssoSession: buildSSOSession(),
    handshakeRecord: null,
    signals: {},
    tierDecision: null,
    seenCapsuleHashes: new Set(),
    contextBlockVersions: new Map(),
    existingHandshakes: [],
    localUserId: 'local-user-001',
    ...overrides,
  }
}
