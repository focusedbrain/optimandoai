/**
 * Run 4 — §XVI.7.6 Gate 6 Capsule admission, end to end.
 *
 * The final admission boundary: a reference that passed Gates 1–5 still
 * receives NO capsule admission unless the full ordered chain passes —
 * capsule signature via the initiator's Delegation Certificate chaining to
 * a directory-registered key, initiator status re-verified at admission
 * time, SSO domain agreement, both Party Bindings, request_instance_id
 * idempotency, freshness/expiry, sealed nonce_I opening to the clear
 * H(nonce_I), scope policy, and the pipeline-owned P15 scan.
 *
 * Consumption invariant (Run 2, §XVI.8.4): failed verification never
 * consumes a use — a Gate-6 failure after the Gate-5 claim releases the
 * claim; successful admission leaves the claim HELD (consume_at =
 * acceptance means the user's explicit acceptance spends it, not admission).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { buildWrCodeReference, captureWrCodeReference } from '@repo/ingestion-core'
import { runWrCodeGatePipeline, type WrCodeGateDeps, type WrCodeReceiverIdentity } from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { deriveEntryDesignator, useLimitEntryKey } from '../entryDesignator'
import {
  createMemoryRelay,
  principalKeyFingerprint,
  type WrcRelayClient,
  type WrcRelayEnvelope,
} from '../relayRelease'
import { openSealed, type WrcPendingCapsule } from '../capsuleAdmission'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import {
  createMemoryUseLimitStore,
  defaultUseLimitProfile,
  type WrcUseLimitStore,
} from '../useLimitStore'
import {
  buildPendingCapsule,
  buildPublisherFixture,
  createMultiFixtureTransport,
  makeClaimKey,
  makeKeyPair,
  signObject,
  signPrincipalDelegation,
} from './wrcFixtures'

const NOW = 1_754_650_100
const INITIATOR = 'WR7X4K'
const RESPONDER = 'RCVPBX'
const OTHER_ORG = 'ZZPQB7'
const RESPONDER_PARTY = 'party-9'
const RESPONDER_EMAIL = 'ceo@responder.test'

const INGEST = makeKeyPair('wrc-ingest-shared')
const OPERATOR = makeKeyPair('dir-op-shared')

const initiatorFx = buildPublisherFixture({
  publisherPart: INITIATOR,
  domain: 'publisher.test',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
  extraEntries: [
    {
      lookupKey: RESPONDER,
      entryId: 'CREL01',
      designation: { cls: 'C', initiator_part: INITIATOR, counterparty_part: RESPONDER },
    },
  ],
})

const responderFx = buildPublisherFixture({
  publisherPart: RESPONDER,
  domain: 'responder.test',
  entryId: 'RSPENT',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
})

const otherOrgFx = buildPublisherFixture({
  publisherPart: OTHER_ORG,
  domain: 'other.test',
  entryId: 'ZZZENT',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
})

const C_REF = (() => {
  const r = buildWrCodeReference('C', [INITIATOR, RESPONDER])
  if (!r.ok) throw new Error(r.reason)
  return r.canonical
})()

const C_ENTRY_KEY = (() => {
  const captured = captureWrCodeReference(C_REF)
  if (!captured.ok) throw new Error(captured.reason)
  const derived = deriveEntryDesignator(
    captured,
    { cls: 'C', initiator_part: INITIATOR, counterparty_part: RESPONDER },
    'CREL01',
  )
  if (!derived.ok) throw new Error(derived.reason)
  return useLimitEntryKey(derived.designator)
})()

const RECEIVER: WrCodeReceiverIdentity = {
  publisher_part: RESPONDER,
  party_id: RESPONDER_PARTY,
  sso_email: RESPONDER_EMAIL,
}

// The initiator's signing principal and the responder's claiming principal.
const initiatorPrincipal = makeKeyPair('initiator-principal-key')
const claimKey = makeClaimKey('responder-principal-key')
const DELEGATION = signPrincipalDelegation(responderFx, {
  principalPartyId: RESPONDER_PARTY,
  ssoEmail: RESPONDER_EMAIL,
  principalPub: claimKey.principal_pub,
})

function makeCapsule(overrides: Partial<Parameters<typeof buildPendingCapsule>[0]> = {}) {
  return buildPendingCapsule({
    initiator: initiatorFx,
    initiatorPrincipal: { partyId: 'party-1', email: 'sales@publisher.test', key: initiatorPrincipal },
    recipient: { partyId: RESPONDER_PARTY, email: RESPONDER_EMAIL, encryptionPub: responderFx.encryption.pub },
    capsuleId: 'cap-001',
    requestInstanceId: 'req-1',
    expiresAt: NOW + 3600,
    ...overrides,
  })
}

function envelopeFor(capsule: WrcPendingCapsule): WrcRelayEnvelope {
  return {
    type: 'wrc/relay-envelope',
    capsule_id: capsule.capsule_id,
    publisher_part: INITIATOR,
    entry_key: C_ENTRY_KEY,
    recipient: {
      party_id: RESPONDER_PARTY,
      publisher_part: RESPONDER,
      principal_key_fingerprint: principalKeyFingerprint(claimKey.principal_pub),
    },
    expires_at: NOW + 3600,
    status: 'available',
    capsule: capsule as unknown as Record<string, unknown>,
  }
}

let relay: WrcRelayClient
let useLimits: WrcUseLimitStore
let deps: WrCodeGateDeps

function buildDeps(admissionOverrides: Parameters<typeof createWrcGateDeps>[1]['admission'] = {}) {
  const transport = createMultiFixtureTransport([initiatorFx, responderFx, otherOrgFx])
  const client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: INGEST.pub,
    now: () => NOW,
  })
  const directory = new WrcDirectoryClient({
    transport,
    operator: { kid: OPERATOR.kid, pub: OPERATOR.pub },
    now: () => NOW,
  })
  relay = createMemoryRelay({
    directoryKeys: async (part) => {
      const r = await directory.getVerifiedRecord(part)
      return r.ok ? r.record.keys : null
    },
    now: () => NOW,
  })
  useLimits = createMemoryUseLimitStore()
  deps = createWrcGateDeps(client, {
    now: () => NOW,
    directory,
    relay,
    useLimits,
    claimIdentity: {
      principal_pub: claimKey.principal_pub,
      delegation: DELEGATION,
      sign: claimKey.sign,
    },
    admission: {
      decryptKey: responderFx.encryption.privateKey,
      ...admissionOverrides,
    },
  })
}

beforeEach(() => buildDeps())

async function expectAdmissionRefusal(detailFragment: string, requestInstanceId?: string) {
  const r = await runWrCodeGatePipeline(
    { raw: C_REF, receiver: RECEIVER, requestInstanceId: requestInstanceId ?? null },
    deps,
  )
  expect(r.ok).toBe(false)
  if (r.ok) throw new Error('expected refusal')
  expect(r.gate).toBe(6)
  expect(r.reason).toBe('admission_refused')
  expect(r.detail).toContain(detailFragment)
  return r
}

describe('capsule admission through the pipeline [XVI.7.6 gate 6]', () => {
  it('a fully valid capsule admits after all six gates', async () => {
    relay.deposit(envelopeFor(makeCapsule().capsule))
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, deps)
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
    if (!r.ok) return
    expect(r.gatesPassed).toEqual([
      'syntax',
      'namespace',
      'entry',
      'self_match',
      'relay_release',
      'capsule_admission',
    ])
  })

  it('a capsule naming another initiator refuses: equality with the trusted value', async () => {
    // Signed by OTHER_ORG's chain but deposited under the C entry of INITIATOR.
    const foreign = buildPendingCapsule({
      initiator: otherOrgFx,
      initiatorPrincipal: { partyId: 'party-1', email: 'sales@other.test', key: initiatorPrincipal },
      recipient: { partyId: RESPONDER_PARTY, email: RESPONDER_EMAIL, encryptionPub: responderFx.encryption.pub },
      capsuleId: 'cap-001',
      requestInstanceId: 'req-1',
      expiresAt: NOW + 3600,
    })
    relay.deposit(envelopeFor(foreign.capsule))
    await expectAdmissionRefusal('initiator_mismatch')
  })

  it('a capsule bound to a different recipient refuses', async () => {
    relay.deposit(
      envelopeFor(
        makeCapsule({
          recipient: { partyId: 'party-8', email: 'other@responder.test', encryptionPub: responderFx.encryption.pub },
        }).capsule,
      ),
    )
    await expectAdmissionRefusal('recipient_binding_mismatch')
  })

  it('a tampered capsule signature refuses', async () => {
    const { capsule } = makeCapsule()
    const tampered = { ...capsule, scope: ['handshake', 'escalated'] }
    relay.deposit(envelopeFor(tampered as WrcPendingCapsule))
    await expectAdmissionRefusal('capsule_sig_invalid')
  })

  it('a delegation without initiate scope refuses', async () => {
    relay.deposit(
      envelopeFor(
        makeCapsule({
          delegation: signPrincipalDelegation(initiatorFx, {
            principalPartyId: 'party-1',
            ssoEmail: 'sales@publisher.test',
            principalPub: initiatorPrincipal.pub,
            scope: ['accept'],
          }),
        }).capsule,
      ),
    )
    await expectAdmissionRefusal('initiate scope')
  })

  it('an initiating principal whose SSO email is outside the DNS-verified domain refuses', async () => {
    relay.deposit(
      envelopeFor(
        makeCapsule({
          initiatorPrincipal: { partyId: 'party-1', email: 'sales@elsewhere.example', key: initiatorPrincipal },
        }).capsule,
      ),
    )
    await expectAdmissionRefusal('initiator_sso_domain_mismatch')
  })

  it('a signed capsule whose nonce does not hash to H(nonce_I) refuses', async () => {
    // The initiator SIGNS a capsule carrying a wrong H(nonce_I): signature
    // valid, hash binding broken — the nonce leg must catch it.
    const { capsule } = makeCapsule()
    const lyingBody = { ...(capsule as unknown as Record<string, unknown>), nonce_i_hash: 'f'.repeat(64) }
    const resigned = signObject(lyingBody, initiatorPrincipal) as unknown as WrcPendingCapsule
    relay.deposit(envelopeFor(resigned))
    await expectAdmissionRefusal('nonce_hash_mismatch')
  })

  it('a sealed nonce the receiver cannot open refuses (sealed to another key)', async () => {
    relay.deposit(
      envelopeFor(
        makeCapsule({
          recipient: {
            partyId: RESPONDER_PARTY,
            email: RESPONDER_EMAIL,
            // Sealed to OTHER_ORG's encryption key: responder cannot open it.
            encryptionPub: otherOrgFx.encryption.pub,
          },
        }).capsule,
      ),
    )
    await expectAdmissionRefusal('nonce_unverifiable')
  })

  it('an expired capsule refuses at admission', async () => {
    relay.deposit(envelopeFor(makeCapsule({ expiresAt: NOW - 1 }).capsule))
    // The relay envelope itself is still valid — the CAPSULE is expired.
    await expectAdmissionRefusal('capsule_expired')
  })

  it('a capsule issued in the future refuses as not fresh', async () => {
    relay.deposit(envelopeFor(makeCapsule({ issuedAt: NOW + 3600 }).capsule))
    await expectAdmissionRefusal('capsule_not_fresh')
  })

  it('a replayed request_instance_id bound to a DIFFERENT capsule refuses; same capsule is idempotent', async () => {
    relay.deposit(envelopeFor(makeCapsule().capsule))
    const first = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, deps)
    expect(first.ok).toBe(true)

    // Same request id, same capsule: existing state surfaced (idempotent).
    const again = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, deps)
    expect(again.ok).toBe(true)

    // Same request id smuggled into a DIFFERENT capsule: replay, refused.
    relay.deposit(envelopeFor(makeCapsule({ capsuleId: 'cap-002' }).capsule))
    await expectAdmissionRefusal('request_replayed')
  })

  it('a scope the receiver/tenant policy does not admit refuses', async () => {
    buildDeps({
      decryptKey: responderFx.encryption.privateKey,
      scopeAdmissible: (scope) => scope.every((s) => s === 'handshake'),
    })
    relay.deposit(envelopeFor(makeCapsule({ scope: ['handshake', 'automation'] }).capsule))
    await expectAdmissionRefusal('scope_inadmissible')
  })

  it('without a recipient decryption key nothing admits (fail closed)', async () => {
    buildDeps({ decryptKey: null })
    relay.deposit(envelopeFor(makeCapsule().capsule))
    await expectAdmissionRefusal('nonce_unverifiable')
  })
})

describe('consumption ordering across gates 5/6 [XVI.8.4]', () => {
  it('a Gate-6 failure after the Gate-5 claim releases the claim', async () => {
    useLimits.declare(INITIATOR, C_ENTRY_KEY, defaultUseLimitProfile(1))
    relay.deposit(envelopeFor(makeCapsule({ expiresAt: NOW - 1 }).capsule))

    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(6)
    // The claim reverted: a failed verification never consumes a use.
    expect(useLimits.read(INITIATOR, C_ENTRY_KEY)?.state).toBe('active')
  })

  it('successful admission holds the claim; explicit acceptance consumes exactly once', async () => {
    useLimits.declare(INITIATOR, C_ENTRY_KEY, defaultUseLimitProfile(1))
    relay.deposit(envelopeFor(makeCapsule().capsule))

    const r = await runWrCodeGatePipeline(
      { raw: C_REF, receiver: RECEIVER, requestInstanceId: 'req-1' },
      deps,
    )
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
    // consume_at = acceptance: admission does NOT consume.
    expect(useLimits.read(INITIATOR, C_ENTRY_KEY)?.state).toBe('claimed')

    // The user's explicit acceptance spends the use — once.
    const consumed = useLimits.consume(INITIATOR, C_ENTRY_KEY, RESPONDER_PARTY, 'req-1', NOW)
    expect(consumed.ok).toBe(true)
    const second = useLimits.consume(INITIATOR, C_ENTRY_KEY, RESPONDER_PARTY, 'req-2', NOW)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toBe('CONSUMED')
  })

  it('two racing full-pipeline admissions cannot double-spend the use', async () => {
    useLimits.declare(INITIATOR, C_ENTRY_KEY, defaultUseLimitProfile(1))
    relay.deposit(envelopeFor(makeCapsule().capsule))

    const [a, b] = await Promise.all([
      runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER, requestInstanceId: 'race-a' }, deps),
      runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER, requestInstanceId: 'race-b' }, deps),
    ])
    // The same party's live reservation makes retries idempotent (§XVI.8.4) —
    // both runs may admit, but the USE is single: one acceptance succeeds.
    expect(a.ok || b.ok).toBe(true)
    const c1 = useLimits.consume(INITIATOR, C_ENTRY_KEY, RESPONDER_PARTY, 'race-a', NOW)
    const c2 = useLimits.consume(INITIATOR, C_ENTRY_KEY, RESPONDER_PARTY, 'race-b', NOW)
    expect([c1.ok, c2.ok].filter(Boolean)).toHaveLength(1)
    expect(useLimits.read(INITIATOR, C_ENTRY_KEY)?.state).toBe('consumed')
  })
})

describe('sealed-box primitive [XVI.7.5.2]', () => {
  it('seals to the recipient key and opens only with it, bound to context', () => {
    const { capsule, nonce } = makeCapsule()
    const opened = openSealed(responderFx.encryption.privateKey, capsule.nonce_i_sealed, capsule.capsule_id)
    expect(opened?.equals(nonce)).toBe(true)

    // Wrong key: nothing opens.
    expect(openSealed(otherOrgFx.encryption.privateKey, capsule.nonce_i_sealed, capsule.capsule_id)).toBeNull()
    // Wrong context (transplanted to another capsule): nothing opens.
    expect(openSealed(responderFx.encryption.privateKey, capsule.nonce_i_sealed, 'cap-999')).toBeNull()
  })
})
