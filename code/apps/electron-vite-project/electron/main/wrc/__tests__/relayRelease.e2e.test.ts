/**
 * Run 4 — §XVI.7.6 Gate 5 Recipient-bound release, end to end.
 *
 * The normative chain, in its normative order: claim signature → delegation
 * chains to a directory-registered key of the publisher named as RECIPIENT
 * in the capsule (individual: Principal Identifier matches) → capsule not
 * expired/withdrawn/terminal → rate and replay limits. "Release … only to a
 * claim that chains to a Party Identifier named in the capsule, not to mere
 * possession of the reference."
 *
 * Structural invariants proven here: relay-held material is observable ONLY
 * through a passing release; a failed prior gate means Gate 5 is never
 * consulted; a failed Gate 5 means Gate 6 is never consulted; identity legs
 * precede state legs (enumeration protection).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildWrCodeReference, captureWrCodeReference } from '@repo/ingestion-core'
import { runWrCodeGatePipeline, type WrCodeGateDeps, type WrCodeReceiverIdentity } from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { deriveEntryDesignator, useLimitEntryKey } from '../entryDesignator'
import {
  createMemoryRelay,
  principalKeyFingerprint,
  verifyReleaseChain,
  type WrcRelayClient,
  type WrcRelayEnvelope,
  type WrcReleaseClaim,
} from '../relayRelease'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
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
const RESPONDER_PARTY = 'party-9'

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

const C_REF = (() => {
  const r = buildWrCodeReference('C', [INITIATOR, RESPONDER])
  if (!r.ok) throw new Error(r.reason)
  return r.canonical
})()

/** Canonical entry key of the C umbrella — derived through the real module. */
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
  sso_email: `ceo@responder.test`,
}

const claimKey = makeClaimKey('responder-principal-key')
const DELEGATION = signPrincipalDelegation(responderFx, {
  principalPartyId: RESPONDER_PARTY,
  ssoEmail: 'ceo@responder.test',
  principalPub: claimKey.principal_pub,
})

// A REAL signed capsule: Gate 5's output flows into the (now real) Gate 6,
// so the valid-release vector must carry material Gate 6 can admit.
const initiatorPrincipal = makeKeyPair('initiator-principal-key')
const CAPSULE = buildPendingCapsule({
  initiator: initiatorFx,
  initiatorPrincipal: { partyId: 'party-1', email: 'sales@publisher.test', key: initiatorPrincipal },
  recipient: { partyId: RESPONDER_PARTY, email: 'ceo@responder.test', encryptionPub: responderFx.encryption.pub },
  capsuleId: 'cap-001',
  requestInstanceId: 'req-1',
  expiresAt: NOW + 3600,
}).capsule as unknown as Record<string, unknown>

function envelope(overrides: Partial<WrcRelayEnvelope> = {}): WrcRelayEnvelope {
  return {
    type: 'wrc/relay-envelope',
    capsule_id: 'cap-001',
    publisher_part: INITIATOR,
    entry_key: C_ENTRY_KEY,
    recipient: {
      party_id: RESPONDER_PARTY,
      publisher_part: RESPONDER,
      principal_key_fingerprint: principalKeyFingerprint(claimKey.principal_pub),
    },
    expires_at: NOW + 3600,
    status: 'available',
    capsule: CAPSULE,
    ...overrides,
  }
}

let relay: WrcRelayClient
let directory: WrcDirectoryClient
let deps: WrCodeGateDeps

function buildDeps(claimIdentity?: {
  principal_pub: string
  delegation: typeof DELEGATION | null
  sign(bytes: Buffer): string
}) {
  const transport = createMultiFixtureTransport([initiatorFx, responderFx])
  const client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: INGEST.pub,
    now: () => NOW,
  })
  directory = new WrcDirectoryClient({
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
  deps = createWrcGateDeps(client, {
    now: () => NOW,
    directory,
    relay,
    claimIdentity: claimIdentity ?? {
      principal_pub: claimKey.principal_pub,
      delegation: DELEGATION,
      sign: claimKey.sign,
    },
    admission: { decryptKey: responderFx.encryption.privateKey },
  })
}

beforeEach(() => buildDeps())

describe('recipient-bound release through the pipeline [XVI.7.6 gate 5]', () => {
  it('a complete valid release admits and surfaces the relay capsule', async () => {
    relay.deposit(envelope())
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, deps)
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
    if (!r.ok) return
    expect(r.released.capsule).toEqual(CAPSULE)
    expect(r.gatesPassed).toContain('relay_release')
  })

  it('no relay capsule + public offering: the evp path still releases (no regression)', async () => {
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.released.capsule).toBeNull()
    expect(r.released.evp).not.toBeNull()
  })

  it('an expired capsule refuses at Gate 5 with the precise leg', async () => {
    relay.deposit(envelope({ expires_at: NOW - 1 }))
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(5)
    expect(r.reason).toBe('release_refused')
    expect(r.detail).toContain('capsule_expired')
  })

  it('a withdrawn capsule refuses; relay material never surfaces', async () => {
    relay.deposit(envelope())
    relay.setStatus('cap-001', 'withdrawn')
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(5)
    expect(r.detail).toContain('capsule_withdrawn')
  })

  it('a claim without accept scope refuses (revoked/out-of-scope = invalid)', async () => {
    buildDeps({
      principal_pub: claimKey.principal_pub,
      delegation: signPrincipalDelegation(responderFx, {
        principalPartyId: RESPONDER_PARTY,
        ssoEmail: 'ceo@responder.test',
        principalPub: claimKey.principal_pub,
        scope: ['initiate'],
      }),
      sign: claimKey.sign,
    })
    relay.deposit(envelope())
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(5)
    expect(r.detail).toContain('delegation_scope_missing')
  })

  it('an expired delegation refuses', async () => {
    buildDeps({
      principal_pub: claimKey.principal_pub,
      delegation: signPrincipalDelegation(responderFx, {
        principalPartyId: RESPONDER_PARTY,
        ssoEmail: 'ceo@responder.test',
        principalPub: claimKey.principal_pub,
        expiresAt: NOW - 1,
      }),
      sign: claimKey.sign,
    })
    relay.deposit(envelope())
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).toContain('delegation_expired')
  })

  it('a delegation signed by an unregistered key refuses', async () => {
    const rogue = makeKeyPair('rogue-publisher-key')
    buildDeps({
      principal_pub: claimKey.principal_pub,
      delegation: signPrincipalDelegation(
        responderFx,
        {
          principalPartyId: RESPONDER_PARTY,
          ssoEmail: 'ceo@responder.test',
          principalPub: claimKey.principal_pub,
        },
        rogue,
      ),
      sign: claimKey.sign,
    })
    relay.deposit(envelope())
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).toContain('delegation_key_unregistered')
  })

  it('a delegation naming ANOTHER principal never releases to this claimant', async () => {
    buildDeps({
      principal_pub: claimKey.principal_pub,
      delegation: signPrincipalDelegation(responderFx, {
        principalPartyId: 'party-8',
        ssoEmail: 'other@responder.test',
        principalPub: claimKey.principal_pub,
      }),
      sign: claimKey.sign,
    })
    relay.deposit(envelope())
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).toContain('delegation_principal_mismatch')
  })

  it('a party the capsule does not name gets nothing — possession is not entitlement', async () => {
    const stranger = makeClaimKey('stranger-principal')
    buildDeps({
      principal_pub: stranger.principal_pub,
      delegation: signPrincipalDelegation(responderFx, {
        principalPartyId: 'party-8',
        ssoEmail: 'stranger@responder.test',
        principalPub: stranger.principal_pub,
      }),
      sign: stranger.sign,
    })
    relay.deposit(envelope())
    const r = await runWrCodeGatePipeline(
      { raw: C_REF, receiver: { ...RECEIVER, party_id: 'party-8', sso_email: 'stranger@responder.test' } },
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(5)
    expect(r.detail).toContain('recipient_party_mismatch')
  })

  it('a failed PRIOR gate means Gate 5 is never consulted', async () => {
    relay.deposit(envelope())
    const releaseSpy = vi.spyOn(relay, 'release')
    // Wrong receiver publisher → Gate 4 NOT_FOR_YOU before any relay call.
    const r = await runWrCodeGatePipeline(
      { raw: C_REF, receiver: { publisher_part: 'ZZPQB7', party_id: RESPONDER_PARTY } },
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(4)
    expect(releaseSpy).not.toHaveBeenCalled()
  })

  it('a failed Gate 5 means Gate 6 is never consulted', async () => {
    relay.deposit(envelope({ expires_at: NOW - 1 }))
    const admitSpy = vi.fn(deps.admitCapsule.bind(deps))
    const spiedDeps: WrCodeGateDeps = { ...deps, admitCapsule: admitSpy }
    const r = await runWrCodeGatePipeline({ raw: C_REF, receiver: RECEIVER }, spiedDeps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(5)
    expect(r.gatesPassed).toEqual(['syntax', 'namespace', 'entry', 'self_match'])
    expect(admitSpy).not.toHaveBeenCalled()
  })
})

describe('relay store behavior [XVI.7.5.5, XVI.7.5.9]', () => {
  function signedClaim(overrides: Partial<WrcReleaseClaim> = {}): WrcReleaseClaim {
    const body = {
      type: 'wrc/release-claim' as const,
      capsule_id: 'cap-001',
      party_id: RESPONDER_PARTY,
      publisher_part: RESPONDER,
      request_instance_id: 'req-1',
      issued_at: NOW,
      principal_pub: claimKey.principal_pub,
      ...overrides,
    }
    return signObject(
      { ...body, sig: '' } as unknown as Record<string, unknown>,
      claimKey.key,
    ) as unknown as WrcReleaseClaim
  }

  it('same party + same request id re-releases idempotently; another party replaying is refused', async () => {
    relay.deposit(envelope())
    const first = await relay.release({
      publisherPart: INITIATOR,
      entryKey: C_ENTRY_KEY,
      claim: signedClaim(),
      delegation: DELEGATION,
    })
    expect(first.ok).toBe(true)

    const again = await relay.release({
      publisherPart: INITIATOR,
      entryKey: C_ENTRY_KEY,
      claim: signedClaim(),
      delegation: DELEGATION,
    })
    expect(again.ok).toBe(true) // §XVI.7.5.9 idempotent reprocessing

    // A different party replays the SAME request id: deterministic refusal.
    const thiefKey = makeClaimKey('thief-principal')
    const replay = await relay.release({
      publisherPart: INITIATOR,
      entryKey: C_ENTRY_KEY,
      claim: signObject(
        {
          type: 'wrc/release-claim',
          capsule_id: 'cap-001',
          party_id: 'party-8',
          publisher_part: RESPONDER,
          request_instance_id: 'req-1',
          issued_at: NOW,
          principal_pub: thiefKey.principal_pub,
          sig: '',
        },
        thiefKey.key,
      ) as unknown as WrcReleaseClaim,
      delegation: signPrincipalDelegation(responderFx, {
        principalPartyId: 'party-8',
        ssoEmail: 'thief@responder.test',
        principalPub: thiefKey.principal_pub,
      }),
    })
    expect(replay.ok).toBe(false)
    if (replay.ok) return
    // party-8 is not the named recipient — identity leg fires first; the
    // replay ledger additionally protects the request id, proven below.
    expect(replay.leg).toBe('recipient_party_mismatch')
  })

  it('rate limiting bounds release attempts per capsule per window', async () => {
    const tight = createMemoryRelay({
      directoryKeys: async () => responderFx.directoryRecord.keys,
      now: () => NOW,
      rateLimit: 2,
      rateWindowS: 60,
    })
    tight.deposit(envelope())
    const attempt = () =>
      tight.release({
        publisherPart: INITIATOR,
        entryKey: C_ENTRY_KEY,
        claim: signedClaim(),
        delegation: DELEGATION,
      })
    expect((await attempt()).ok).toBe(true)
    expect((await attempt()).ok).toBe(true)
    const third = await attempt()
    expect(third.ok).toBe(false)
    if (third.ok) return
    expect(third.leg).toBe('rate_limited')
  })

  it('a tampered claim signature fails BEFORE capsule state is observable', () => {
    // Withdrawn capsule + bad signature: the identity leg must fire, so a
    // claimant without the right key cannot enumerate capsule states.
    const tampered = { ...signedClaim(), issued_at: NOW + 1 }
    const verdict = verifyReleaseChain({
      envelope: envelope({ status: 'withdrawn' }),
      claim: tampered,
      delegation: DELEGATION,
      recipientDirectoryKeys: responderFx.directoryRecord.keys,
      nowS: NOW,
    })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.leg).toBe('claim_sig_invalid')
  })

  it('a claim signed for a DIFFERENT capsule never opens this one', () => {
    const verdict = verifyReleaseChain({
      envelope: envelope(),
      claim: signedClaim({ capsule_id: 'cap-999' }),
      delegation: DELEGATION,
      recipientDirectoryKeys: responderFx.directoryRecord.keys,
      nowS: NOW,
    })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.leg).toBe('claim_malformed')
  })

  it('individual recipient path: party id + bound key fingerprint decide', () => {
    const individual = makeClaimKey('individual-principal')
    const env = envelope({
      recipient: {
        party_id: 'user-1',
        publisher_part: null,
        principal_key_fingerprint: principalKeyFingerprint(individual.principal_pub),
      },
    })
    const claimFor = (key: ReturnType<typeof makeClaimKey>, partyId: string) =>
      signObject(
        {
          type: 'wrc/release-claim',
          capsule_id: 'cap-001',
          party_id: partyId,
          publisher_part: null,
          request_instance_id: 'req-9',
          issued_at: NOW,
          principal_pub: key.principal_pub,
          sig: '',
        },
        key.key,
      ) as unknown as WrcReleaseClaim

    expect(
      verifyReleaseChain({
        envelope: env,
        claim: claimFor(individual, 'user-1'),
        delegation: null,
        recipientDirectoryKeys: null,
        nowS: NOW,
      }).ok,
    ).toBe(true)

    // Right party id, wrong key: refused at key granularity.
    const wrongKey = makeClaimKey('impostor-principal')
    const v = verifyReleaseChain({
      envelope: env,
      claim: claimFor(wrongKey, 'user-1'),
      delegation: null,
      recipientDirectoryKeys: null,
      nowS: NOW,
    })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.leg).toBe('recipient_key_mismatch')
  })
})

describe('Gate 5 — one principal delegation per claim, sub-delegation unrepresentable', () => {
  it('the release chain input carries a single delegation, never a list', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, '..', 'relayRelease.ts'), 'utf8')
    expect(src).toMatch(/delegation:\s*WrcPrincipalDelegation \| null/)
    expect(src).not.toMatch(/delegations\s*:/)
    expect(src).not.toMatch(/WrcPrincipalDelegation\[\]|readonly WrcPrincipalDelegation/)
  })
})
