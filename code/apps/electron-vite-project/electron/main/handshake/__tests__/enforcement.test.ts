import { describe, test, expect } from 'vitest'
import { verifyHandshakeOwnership } from '../steps/ownership'
import { checkDuplicateCapsule } from '../steps/dedup'
import { checkSchemaVersion } from '../steps/schemaCheck'
import { verifySenderDomain } from '../steps/domain'
import { verifyWrdeskPolicyAnchor } from '../steps/policyAnchor'
import { verifyInputLimits } from '../steps/inputLimits'
import { verifyTimestamp } from '../steps/timestamp'
import { checkExpiry } from '../steps/expiry'
import { enforceMinimumTier, runTierSpecificChecks } from '../steps/tierSteps'
import { ReasonCode, HandshakeState, INPUT_LIMITS } from '../types'
import { buildCtx, buildVerifiedCapsuleInput, buildHandshakeRecord, buildActiveHandshakeRecord, buildReceiverPolicy, buildTierDecision, buildTierSignals, buildContextBlock } from './helpers'

describe('Schema Version', () => {
  test('schema_version 1 → passes', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ schema_version: 1 }) })
    expect(checkSchemaVersion.execute(ctx).passed).toBe(true)
  })
  test('schema_version 0 → UNSUPPORTED_SCHEMA', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ schema_version: 0 }) })
    const r = checkSchemaVersion.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.UNSUPPORTED_SCHEMA)
  })
  test('schema_version 2 (unknown) → UNSUPPORTED_SCHEMA', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ schema_version: 2 }) })
    const r = checkSchemaVersion.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.UNSUPPORTED_SCHEMA)
  })
})

describe('Duplicate Capsule', () => {
  test('same capsule_hash twice for same handshake → DUPLICATE_CAPSULE', () => {
    const seen = new Set(['hs-001:hash-1'])
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ handshake_id: 'hs-001', capsule_hash: 'hash-1' }), seenCapsuleHashes: seen })
    const r = checkDuplicateCapsule.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.DUPLICATE_CAPSULE)
  })
  test('same capsule_hash in different handshake → no conflict', () => {
    const seen = new Set(['hs-002:hash-1'])
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ handshake_id: 'hs-001', capsule_hash: 'hash-1' }), seenCapsuleHashes: seen })
    expect(checkDuplicateCapsule.execute(ctx).passed).toBe(true)
  })
  test('new capsule_hash → passes', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ capsule_hash: 'new-hash' }), seenCapsuleHashes: new Set() })
    expect(checkDuplicateCapsule.execute(ctx).passed).toBe(true)
  })
})

describe('Handshake Ownership', () => {
  test('capsule from correct counterparty → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-refresh', sender_wrdesk_user_id: 'sender-user-001', seq: 1, prev_hash: 'h' }),
      handshakeRecord: buildActiveHandshakeRecord({ initiator: { email: 'sender@example.com', wrdesk_user_id: 'sender-user-001', iss: 'i', sub: 's' } }),
      localUserId: 'local-user-001',
    })
    expect(verifyHandshakeOwnership.execute(ctx).passed).toBe(true)
  })

  test('capsule from unrelated user → HANDSHAKE_OWNERSHIP_VIOLATION', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-refresh', sender_wrdesk_user_id: 'unknown-user' }),
      handshakeRecord: buildActiveHandshakeRecord(),
      localUserId: 'local-user-001',
    })
    const r = verifyHandshakeOwnership.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION)
  })

  test('accept from initiator (own handshake) → HANDSHAKE_OWNERSHIP_VIOLATION', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', sender_wrdesk_user_id: 'sender-user-001' }),
      handshakeRecord: buildHandshakeRecord({ initiator: { email: 's@e.com', wrdesk_user_id: 'sender-user-001', iss: 'i', sub: 's' } }),
      localUserId: 'local-user-001',
    })
    const r = verifyHandshakeOwnership.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION)
  })

  test('self-handshake initiate → HANDSHAKE_OWNERSHIP_VIOLATION', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-initiate', sender_wrdesk_user_id: 'local-user-001' }),
      handshakeRecord: null,
      localUserId: 'local-user-001',
    })
    const r = verifyHandshakeOwnership.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION)
  })
})

describe('Duplicate Active Handshake', () => {
  test('initiate when PENDING_ACCEPT exists for same tuple → DUPLICATE_ACTIVE_HANDSHAKE', () => {
    const existing = buildHandshakeRecord({ state: HandshakeState.PENDING_ACCEPT, relationship_id: 'rel-001', initiator: { email: 's@e.com', wrdesk_user_id: 'sender-user-001', iss: 'i', sub: 's' } })
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-initiate', relationship_id: 'rel-001', sender_wrdesk_user_id: 'sender-user-001' }),
      handshakeRecord: null,
      existingHandshakes: [existing],
      localUserId: 'local-user-001',
    })
    const r = verifyHandshakeOwnership.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.DUPLICATE_ACTIVE_HANDSHAKE)
  })

  test('initiate when REVOKED exists → allowed (re-establishment)', () => {
    const existing = buildHandshakeRecord({ state: HandshakeState.REVOKED, relationship_id: 'rel-001' })
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-initiate', relationship_id: 'rel-001' }),
      handshakeRecord: null,
      existingHandshakes: [existing],
      localUserId: 'local-user-001',
    })
    expect(verifyHandshakeOwnership.execute(ctx).passed).toBe(true)
  })

  test('initiate when EXPIRED exists → allowed (re-establishment)', () => {
    const existing = buildHandshakeRecord({ state: HandshakeState.EXPIRED, relationship_id: 'rel-001' })
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-initiate', relationship_id: 'rel-001' }),
      handshakeRecord: null,
      existingHandshakes: [existing],
      localUserId: 'local-user-001',
    })
    expect(verifyHandshakeOwnership.execute(ctx).passed).toBe(true)
  })
})

describe('Sender Domain Policy', () => {
  test('null domains → passes', () => {
    const ctx = buildCtx({ receiverPolicy: buildReceiverPolicy({ allowedSenderDomains: null }) })
    expect(verifySenderDomain.execute(ctx).passed).toBe(true)
  })
  test('domain in list → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ senderIdentity: { email: 'user@example.com', iss: 'i', sub: 's', email_verified: true, wrdesk_user_id: 'u' } }),
      receiverPolicy: buildReceiverPolicy({ allowedSenderDomains: ['example.com'] }),
    })
    expect(verifySenderDomain.execute(ctx).passed).toBe(true)
  })
  test('domain not in list → SENDER_DOMAIN_DENIED', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ senderIdentity: { email: 'user@other.com', iss: 'i', sub: 's', email_verified: true, wrdesk_user_id: 'u' } }),
      receiverPolicy: buildReceiverPolicy({ allowedSenderDomains: ['example.com'] }),
    })
    const r = verifySenderDomain.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.SENDER_DOMAIN_DENIED)
  })
})

describe('WR Desk Platform Policy Anchor', () => {
  test('wrdesk_policy_hash in acceptedWrdeskPolicyHashes → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ wrdesk_policy_hash: 'policy-hash-v1' }),
      receiverPolicy: buildReceiverPolicy({ acceptedWrdeskPolicyHashes: ['policy-hash-v1'] }),
    })
    expect(verifyWrdeskPolicyAnchor.execute(ctx).passed).toBe(true)
  })
  test('wrdesk_policy_hash not in list → WRDESK_POLICY_ANCHOR_MISMATCH', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ wrdesk_policy_hash: 'unknown-hash' }),
      receiverPolicy: buildReceiverPolicy({ acceptedWrdeskPolicyHashes: ['policy-hash-v1'] }),
    })
    const r = verifyWrdeskPolicyAnchor.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.WRDESK_POLICY_ANCHOR_MISMATCH)
  })
  test('multiple accepted hashes → any match passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ wrdesk_policy_hash: 'hash-v2' }),
      receiverPolicy: buildReceiverPolicy({ acceptedWrdeskPolicyHashes: ['hash-v1', 'hash-v2', 'hash-v3'] }),
    })
    expect(verifyWrdeskPolicyAnchor.execute(ctx).passed).toBe(true)
  })
})

describe('Input Limits', () => {
  test('within limits → passes', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput() })
    expect(verifyInputLimits.execute(ctx).passed).toBe(true)
  })
  test('exceeds ID length → INPUT_LIMIT_EXCEEDED', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ handshake_id: 'x'.repeat(300) }) })
    const r = verifyInputLimits.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.INPUT_LIMIT_EXCEEDED)
  })
})

describe('Timestamp Verification (Email-Delay Safe)', () => {
  test('timestamp in past → passes', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ timestamp: new Date(Date.now() - 86400000).toISOString() }) })
    expect(verifyTimestamp.execute(ctx).passed).toBe(true)
  })
  test('timestamp 1 second ago → passes', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ timestamp: new Date(Date.now() - 1000).toISOString() }) })
    expect(verifyTimestamp.execute(ctx).passed).toBe(true)
  })
  test('timestamp from yesterday → passes', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ timestamp: new Date(Date.now() - 24*3600*1000).toISOString() }) })
    expect(verifyTimestamp.execute(ctx).passed).toBe(true)
  })
  test('timestamp exactly at now + 5min → passes (inclusive)', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ timestamp: new Date(Date.now() + INPUT_LIMITS.CLOCK_SKEW_TOLERANCE_MS).toISOString() }) })
    expect(verifyTimestamp.execute(ctx).passed).toBe(true)
  })
  test('timestamp 10 minutes in future → CLOCK_SKEW', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ timestamp: new Date(Date.now() + 10*60*1000).toISOString() }) })
    const r = verifyTimestamp.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.CLOCK_SKEW)
  })
  test('missing timestamp → CLOCK_SKEW', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ timestamp: '' }) })
    const r = verifyTimestamp.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.CLOCK_SKEW)
  })
  test('unparseable timestamp → CLOCK_SKEW', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ timestamp: 'not-a-date' }) })
    const r = verifyTimestamp.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.CLOCK_SKEW)
  })
})

describe('Expiry', () => {
  test('accept narrows → allowed', () => {
    const later = new Date(Date.now() + 7*24*3600000).toISOString()
    const earlier = new Date(Date.now() + 3*24*3600000).toISOString()
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', expires_at: earlier }),
      handshakeRecord: buildHandshakeRecord({ expires_at: later }),
    })
    expect(checkExpiry.execute(ctx).passed).toBe(true)
  })
  test('accept extends → EXPIRY_EXTENSION_DENIED', () => {
    const earlier = new Date(Date.now() + 3*24*3600000).toISOString()
    const later = new Date(Date.now() + 14*24*3600000).toISOString()
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-accept', expires_at: later }),
      handshakeRecord: buildHandshakeRecord({ expires_at: earlier }),
    })
    const r = checkExpiry.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.EXPIRY_EXTENSION_DENIED)
  })
  test('refresh includes expires_at → EXPIRY_MUTATION_FORBIDDEN', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-refresh', expires_at: new Date().toISOString() }),
      handshakeRecord: buildActiveHandshakeRecord(),
    })
    const r = checkExpiry.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.EXPIRY_MUTATION_FORBIDDEN)
  })
  test('expired handshake → HANDSHAKE_EXPIRED', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ capsuleType: 'handshake-refresh' }),
      handshakeRecord: buildActiveHandshakeRecord({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    })
    const r = checkExpiry.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.HANDSHAKE_EXPIRED)
  })
})

describe('Tier-Specific Checks', () => {
  test('pro without WRStamp → TIER_WRSTAMP_REQUIRED', () => {
    const ctx = buildCtx()
    ctx.tierDecision = buildTierDecision({ effectiveTier: 'pro', signals: buildTierSignals({ wrStampStatus: null }) })
    const r = runTierSpecificChecks.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.TIER_WRSTAMP_REQUIRED)
  })
  test('publisher without DNS → TIER_DNS_REQUIRED', () => {
    const ctx = buildCtx()
    ctx.tierDecision = buildTierDecision({ effectiveTier: 'publisher', signals: buildTierSignals({ wrStampStatus: { verified: true, stampId: 's' }, dnsVerification: null }) })
    const r = runTierSpecificChecks.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.TIER_DNS_REQUIRED)
  })
  test('enterprise with stale attestation → TIER_ATTESTATION_STALE', () => {
    const ctx = buildCtx()
    ctx.tierDecision = buildTierDecision({
      effectiveTier: 'enterprise',
      signals: buildTierSignals({
        wrStampStatus: { verified: true, stampId: 's' },
        dnsVerification: { verified: true, domain: 'd' },
        hardwareAttestation: { verified: true, fresh: false, attestedAt: new Date().toISOString() },
      }),
    })
    const r = runTierSpecificChecks.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.TIER_ATTESTATION_STALE)
  })
  test('free → always passes', () => {
    const ctx = buildCtx()
    ctx.tierDecision = buildTierDecision({ effectiveTier: 'free', signals: buildTierSignals({ plan: 'free', wrStampStatus: null }) })
    expect(runTierSpecificChecks.execute(ctx).passed).toBe(true)
  })
})

describe('Minimum Tier Enforcement', () => {
  test('sender tier meets minimum → passes', () => {
    const ctx = buildCtx({ receiverPolicy: buildReceiverPolicy({ minimumTier: 'pro' }) })
    ctx.tierDecision = buildTierDecision({ effectiveTier: 'publisher' })
    expect(enforceMinimumTier.execute(ctx).passed).toBe(true)
  })
  test('sender tier below minimum → TIER_BELOW_RECEIVER_MINIMUM', () => {
    const ctx = buildCtx({ receiverPolicy: buildReceiverPolicy({ minimumTier: 'publisher' }) })
    ctx.tierDecision = buildTierDecision({ effectiveTier: 'pro' })
    const r = enforceMinimumTier.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.TIER_BELOW_RECEIVER_MINIMUM)
  })
})
