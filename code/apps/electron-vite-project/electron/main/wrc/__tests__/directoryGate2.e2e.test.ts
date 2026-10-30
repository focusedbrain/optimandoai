/**
 * Run 4 — §XVI.6.4/6.5 Namespace Directory behind Gate 2, end to end.
 *
 * The Run-2 interim anchor is gone: these vectors prove Gate 2 is decided by
 * the operator-signed, publisher-countersigned Directory Record under the
 * pinned operator trust anchor — dual signature, vetting attestation, DNS
 * part proof, generation, expiry, rollover — and that no later gate
 * compensates for a Gate-2 trust failure.
 */
import { sign as cryptoSign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { runWrCodeGatePipeline, type WrCodeReceiverIdentity } from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import {
  WRC_ROLLOVER_REFRESH_MIN_S,
  WrcDirectoryClient,
  decodeOperatorRolloverList,
  displayOriginOf,
  dnsRecordsNamePart,
  resolveOperatorKeys,
  transportRolloverSource,
} from '../namespaceDirectory'
import { wrcCanonicalBytes } from '../wrcCrypto'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import {
  buildOperatorRollover,
  buildPublisherFixture,
  createFixtureTransport,
  makeKeyPair,
  signDirectoryRecord,
  type FixtureTransportOverrides,
  type WrcPublisherFixture,
} from './wrcFixtures'
import type { WrcTransport, WrcTransportResult } from '../wrcTransport'

const NOW = 1_754_650_100
const P_REF = 'PWR7X4K9B2M3C'
const RECEIVER: WrCodeReceiverIdentity = { party_id: 'party-1' }

/** Unsigned base of a fixture's directory record, for crafting variants. */
function unsignedOf(fx: WrcPublisherFixture): Record<string, unknown> {
  const {
    operator_sig: _o,
    publisher_countersig: _p,
    ...base
  } = fx.directoryRecord as unknown as Record<string, unknown>
  return base
}

function depsFor(
  fx: WrcPublisherFixture,
  overrides: FixtureTransportOverrides = {},
  directoryOpts: { operator?: { kid: string; pub: string }; rollovers?: Parameters<typeof resolveOperatorKeys>[1] } = {},
  transport: WrcTransport = createFixtureTransport(fx, overrides),
) {
  const client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: fx.ingest.pub,
    now: () => NOW,
  })
  const directory = new WrcDirectoryClient({
    transport,
    operator: directoryOpts.operator ?? { kid: fx.operator.kid, pub: fx.operator.pub },
    rollovers: directoryOpts.rollovers,
    now: () => NOW,
  })
  return { deps: createWrcGateDeps(client, { directory }), directory }
}

async function refusalFor(
  fx: WrcPublisherFixture,
  overrides: FixtureTransportOverrides = {},
  receiver: WrCodeReceiverIdentity = RECEIVER,
) {
  const { deps } = depsFor(fx, overrides)
  const r = await runWrCodeGatePipeline({ raw: P_REF, receiver }, deps)
  expect(r.ok).toBe(false)
  if (r.ok) throw new Error('expected refusal')
  return r
}

// ── The valid chain, including operator rollover ──────────────────────────────

describe('valid directory trust chains [XVI.6.4]', () => {
  it('pinned operator → dual-signed record → DNS part proof admits end to end', async () => {
    const fx = buildPublisherFixture()
    const { deps } = depsFor(fx)
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
  })

  it('a record signed by a ROLLED-OVER operator key verifies via the dual-signed rollover', async () => {
    const oldOp = makeKeyPair('dir-op-old')
    const newOp = makeKeyPair('dir-op-new')
    const fx = buildPublisherFixture({ operatorKey: newOp })
    const { deps } = depsFor(fx, {}, {
      operator: { kid: oldOp.kid, pub: oldOp.pub },
      rollovers: [buildOperatorRollover(oldOp, newOp)],
    })
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
  })

  it('a rollover NOT signed by the currently trusted key extends nothing', async () => {
    const oldOp = makeKeyPair('dir-op-old')
    const rogue = makeKeyPair('dir-op-rogue')
    const newOp = makeKeyPair('dir-op-new')
    const fx = buildPublisherFixture({ operatorKey: newOp })
    // The rollover chains rogue → new, but the pinned anchor is old.
    const { deps } = depsFor(fx, {}, {
      operator: { kid: oldOp.kid, pub: oldOp.pub },
      rollovers: [buildOperatorRollover(rogue, newOp)],
    })
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(2)
    expect(r.reason).toBe('namespace_unverified')
    expect(r.detail).toContain('operator_key_unknown')
  })
})

// ── Signature and binding failures ────────────────────────────────────────────

describe('directory record verification failures stop at Gate 2 [XVI.6.4/6.5]', () => {
  it('a tampered record fails the operator signature', async () => {
    const fx = buildPublisherFixture()
    const tampered = { ...(fx.directoryRecord as unknown as Record<string, unknown>), generation: 9 }
    const r = await refusalFor(fx, { directoryRecord: { ok: true, value: tampered } })
    expect(r.gate).toBe(2)
    expect(r.reason).toBe('namespace_unverified')
    expect(r.detail).toContain('operator_sig_invalid')
  })

  it('a record without the publisher countersignature key fails the countersign leg', async () => {
    const fx = buildPublisherFixture()
    const wrongKey = makeKeyPair('not-the-publisher')
    const forged = signDirectoryRecord(unsignedOf(fx), fx.operator, wrongKey)
    const r = await refusalFor(fx, { directoryRecord: { ok: true, value: forged } })
    expect(r.gate).toBe(2)
    expect(r.detail).toContain('publisher_countersig_invalid')
  })

  it('substituting another publisher\'s VALID record fails the part binding (anti-replay)', async () => {
    const fx = buildPublisherFixture()
    const other = buildPublisherFixture({
      publisherPart: 'ZZPQB7',
      domain: 'other.test',
      operatorKey: fx.operator,
    })
    // other's record is perfectly valid — but it names ZZPQB7, not WR7X4K.
    const r = await refusalFor(fx, {
      directoryRecord: { ok: true, value: other.directoryRecord },
    })
    expect(r.gate).toBe(2)
    expect(r.detail).toContain('part_mismatch')
  })

  it('an expired record refuses regardless of signatures', async () => {
    const fx = buildPublisherFixture({ directoryOverrides: { expires_at: NOW - 10 } })
    const r = await refusalFor(fx)
    expect(r.gate).toBe(2)
    expect(r.detail).toContain('record_expired')
  })

  it('a generation ROLLBACK refuses as stale, even inside nominal expiry', async () => {
    const fx = buildPublisherFixture() // generation 3
    const overrides: FixtureTransportOverrides = {}
    const { deps } = depsFor(fx, overrides)

    const first = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(first.ok).toBe(true)

    // The directory now serves an OLDER, validly signed generation.
    const stale = signDirectoryRecord({ ...unsignedOf(fx), generation: 2 }, fx.operator, fx.root)
    overrides.directoryRecord = { ok: true, value: stale }
    const second = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.gate).toBe(2)
    expect(second.detail).toContain('generation_stale')
  })

  it('a record without the vetted-account-holder attestation refuses', async () => {
    const fx = buildPublisherFixture({ directoryOverrides: { account_holder_vetted: false } })
    const r = await refusalFor(fx)
    expect(r.gate).toBe(2)
    expect(r.detail).toContain('account_not_vetted')
  })

  it('a missing record is the uniform unknown-identifier capture error', async () => {
    const fx = buildPublisherFixture()
    const notFound = { ok: false as const, code: 'http_status' as const, message: 'HTTP 404', status: 404 }
    const r = await refusalFor(fx, { resolve: notFound, directoryRecord: notFound })
    expect(r.gate).toBe(2)
    expect(r.reason).toBe('namespace_unknown_identifier')
    expect(r.captureError).toBe(true)
  })

  it('a superseded namespace surfaces its successor, never a silent redirect', async () => {
    const fx = buildPublisherFixture({
      directoryOverrides: { status: 'superseded', successor_publisher_part: 'NEWPUB' },
    })
    const r = await refusalFor(fx)
    expect(r.gate).toBe(2)
    expect(r.reason).toBe('namespace_superseded')
    expect(r.successorPublisherPart).toBe('NEWPUB')
  })
})

// ── DNS proof (§XVI.6.5: record alone is NOT verification) ───────────────────

describe('DNS part proof is independently required [XVI.6.5]', () => {
  it('a valid record whose domain publishes NO part proof refuses', async () => {
    const fx = buildPublisherFixture()
    const r = await refusalFor(fx, {
      txt: { ok: true, records: [`v=wr1; root=deadbeef`] },
    })
    expect(r.gate).toBe(2)
    expect(r.detail).toContain('dns_part_mismatch')
  })

  it('a DNS proof naming a DIFFERENT Publisher Identifier refuses', async () => {
    const fx = buildPublisherFixture()
    const r = await refusalFor(fx, {
      txt: { ok: true, records: ['v=wr1; part=ZZPQB7'] },
    })
    expect(r.detail).toContain('dns_part_mismatch')
  })

  it('DNS unavailability is a refusal, never a downgraded pass', async () => {
    const fx = buildPublisherFixture()
    const r = await refusalFor(fx, {
      txt: { ok: false, code: 'dns_error', message: 'SERVFAIL' },
    })
    expect(r.gate).toBe(2)
    expect(r.detail).toContain('dns_unavailable')
  })

  it('dnsRecordsNamePart parses only the first well-formed wr1 part token', () => {
    expect(dnsRecordsNamePart(['v=wr1; part=WR7X4K'], 'WR7X4K')).toBe(true)
    expect(dnsRecordsNamePart(['junk', 'v=wr1; part=wr7x4k; root=ab'], 'WR7X4K')).toBe(true)
    expect(dnsRecordsNamePart(['v=wr1; part=ZZPQB7', 'v=wr1; part=WR7X4K'], 'WR7X4K')).toBe(false)
    expect(dnsRecordsNamePart(['v=wr1; root=ab'], 'WR7X4K')).toBe(false)
    expect(dnsRecordsNamePart([], 'WR7X4K')).toBe(false)
  })
})

// ── §XVI.6.5 publisher key binding for the entry chain ───────────────────────

describe('resolver chain keys must be directory-registered [XVI.6.5]', () => {
  it('an entry chain anchored on a key the directory does not register refuses at Gate 3', async () => {
    const fx = buildPublisherFixture()
    // A validly dual-signed record that registers a DIFFERENT publisher key.
    const otherKey = makeKeyPair('other-pub-key')
    const record = signDirectoryRecord(
      {
        ...unsignedOf(fx),
        keys: [{ kid: otherKey.kid, pub: otherKey.pub, generation: 1 }],
        publisher_kid: otherKey.kid,
      },
      fx.operator,
      otherKey,
    )
    const r = await refusalFor(fx, { directoryRecord: { ok: true, value: record } })
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('entry_unverified')
    expect(r.detail).toContain('not a directory-registered publisher key')
  })
})

// ── SSO / acting-principal binding (§XVI.6.5 email-domain agreement) ─────────

describe('acting principal SSO binding at Gate 2 [XVI.6.5, XVI.7.6]', () => {
  it('an SSO email inside the publisher\'s DNS-verified domain admits', async () => {
    const fx = buildPublisherFixture()
    const { deps } = depsFor(fx)
    const r = await runWrCodeGatePipeline(
      {
        raw: P_REF,
        receiver: { publisher_part: fx.publisherPart, party_id: 'party-1', sso_email: 'pat@publisher.test' },
      },
      deps,
    )
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
  })

  it('an SSO email OUTSIDE the publisher\'s domains cannot act for it', async () => {
    const fx = buildPublisherFixture()
    const r = await refusalFor(fx, {}, {
      publisher_part: fx.publisherPart,
      party_id: 'party-1',
      sso_email: 'pat@gmail.example',
    })
    expect(r.gate).toBe(2)
    expect(r.reason).toBe('sso_principal_mismatch')
    expect(r.gatesPassed).toEqual(['syntax'])
  })

  /** A fixture registering a second domain, with `_wr` TXT answered per domain. */
  function secondaryDomainSetup(brandTxt: string[] | null) {
    const fx = buildPublisherFixture({
      directoryOverrides: { domains: ['publisher.test', 'brand.test'] },
    })
    const base = createFixtureTransport(fx)
    const transport: WrcTransport = {
      ...base,
      async wrTxtRecords(domain) {
        if (domain === 'publisher.test') return { ok: true, records: fx.txtRecords }
        if (domain === 'brand.test' && brandTxt) return { ok: true, records: brandTxt }
        return { ok: false, code: 'dns_error', message: `ENOTFOUND _wr.${domain}` }
      },
    }
    return { fx, deps: depsFor(fx, {}, {}, transport).deps }
  }

  it('an SSO email in a registered secondary domain WITH its own DNS proof admits', async () => {
    const { fx, deps } = secondaryDomainSetup([`v=wr1; part=WR7X4K`])
    const r = await runWrCodeGatePipeline(
      {
        raw: P_REF,
        receiver: { publisher_part: fx.publisherPart, party_id: 'party-1', sso_email: 'pat@brand.test' },
      },
      deps,
    )
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
  })

  it.each([
    ['no _wr record', null],
    ['a _wr record naming another publisher', ['v=wr1; part=ZZPQB7']],
  ])('a registered secondary domain with %s cannot act for the publisher', async (_label, brandTxt) => {
    const { fx, deps } = secondaryDomainSetup(brandTxt)
    const r = await runWrCodeGatePipeline(
      {
        raw: P_REF,
        receiver: { publisher_part: fx.publisherPart, party_id: 'party-1', sso_email: 'pat@brand.test' },
      },
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(2)
    expect(r.reason).toBe('sso_principal_mismatch')
    expect(r.detail).toContain('no DNS proof')
  })

  it('an asserted SSO binding with NO verifier fails closed', async () => {
    // Deps without verifyActingPrincipal: a caller cannot self-certify.
    const fx = buildPublisherFixture()
    const { deps } = depsFor(fx)
    const gutted = { ...deps, verifyActingPrincipal: undefined }
    const r = await runWrCodeGatePipeline(
      {
        raw: P_REF,
        receiver: { publisher_part: fx.publisherPart, sso_email: 'pat@publisher.test' },
      },
      gutted,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(2)
    expect(r.reason).toBe('sso_principal_mismatch')
  })
})

// ── Operator key resolution unit vectors ──────────────────────────────────────

describe('resolveOperatorKeys folds only fully verified rollovers', () => {
  it('accepts a two-step verified chain and stops at the first broken link', () => {
    const a = makeKeyPair('op-a')
    const b = makeKeyPair('op-b')
    const c = makeKeyPair('op-c')
    const d = makeKeyPair('op-d')
    const good = resolveOperatorKeys(
      { kid: a.kid, pub: a.pub },
      [buildOperatorRollover(a, b), buildOperatorRollover(b, c)],
    )
    expect([...good.keys()].sort()).toEqual([a.kid, b.kid, c.kid].sort())

    // b → d is fine, but the a → b link is missing: nothing beyond a trusts.
    const broken = resolveOperatorKeys({ kid: a.kid, pub: a.pub }, [buildOperatorRollover(b, d)])
    expect([...broken.keys()]).toEqual([a.kid])
  })
})

// ── Operator rollover channel (C6) ────────────────────────────────────────────

describe('operator rollovers arrive over the directory channel [XVI.6.4, contract v2.0 Q24]', () => {
  const oldOp = makeKeyPair('dir-op-old')
  const newOp = makeKeyPair('dir-op-new')

  /** A directory client pinned to `oldOp`, over a transport whose channel serves `body`. */
  function channelSetup(body: WrcTransportResult, clock = { now: NOW }) {
    const fx = buildPublisherFixture({ operatorKey: newOp })
    let fetches = 0
    const transport = createFixtureTransport(fx, { operatorRollovers: body })
    const source = transportRolloverSource(transport)
    const directory = new WrcDirectoryClient({
      transport,
      operator: { kid: oldOp.kid, pub: oldOp.pub },
      now: () => clock.now,
      fetchRollovers: async () => {
        fetches++
        return source()
      },
    })
    return { fx, directory, fetches: () => fetches }
  }

  it('a record signed by the incoming key verifies once the channel serves the dual-signed link', async () => {
    const { fx, directory, fetches } = channelSetup({ ok: true, value: { rollovers: [buildOperatorRollover(oldOp, newOp)] } })
    const r = await directory.getVerifiedRecord(fx.publisherPart)
    expect(r.ok, r.ok ? '' : `${r.leg}: ${r.detail}`).toBe(true)
    expect(fetches()).toBe(1)
    // The key stays trusted; the next lookup needs no fetch.
    expect((await directory.getVerifiedRecord(fx.publisherPart)).ok).toBe(true)
    expect(fetches()).toBe(1)
  })

  it('a record signed by the pinned key needs no fetch', async () => {
    const fx = buildPublisherFixture({ operatorKey: oldOp })
    let fetches = 0
    const directory = new WrcDirectoryClient({
      transport: createFixtureTransport(fx),
      operator: { kid: oldOp.kid, pub: oldOp.pub },
      now: () => NOW,
      fetchRollovers: async () => {
        fetches++
        return []
      },
    })
    expect((await directory.getVerifiedRecord(fx.publisherPart)).ok).toBe(true)
    expect(fetches).toBe(0)
  })

  it.each([
    ['a link not signed by the trusted key', () => ({ ok: true, value: { rollovers: [buildOperatorRollover(makeKeyPair('dir-op-rogue'), newOp)] } })],
    ['a link carrying a field the client does not decode', () => ({ ok: true, value: { rollovers: [signedWithExtraField(oldOp, newOp)] } })],
    ['a body that is not { rollovers: [...] }', () => ({ ok: true, value: [buildOperatorRollover(oldOp, newOp)] })],
    ['a transport failure', () => ({ ok: false, code: 'http_status', message: 'HTTP 503', status: 503 })],
  ] as Array<[string, () => WrcTransportResult]>)('%s leaves the incoming key unknown', async (_label, body) => {
    const { fx, directory } = channelSetup(body())
    const r = await directory.getVerifiedRecord(fx.publisherPart)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.leg).toBe('operator_key_unknown')
  })

  it('refetches at most once per minute, and concurrent lookups share one fetch', async () => {
    const clock = { now: NOW }
    const { fx, directory, fetches } = channelSetup({ ok: true, value: { rollovers: [] } }, clock)
    await Promise.all([directory.getVerifiedRecord(fx.publisherPart), directory.getVerifiedRecord(fx.publisherPart)])
    expect(fetches()).toBe(1)
    clock.now += WRC_ROLLOVER_REFRESH_MIN_S - 1
    await directory.getVerifiedRecord(fx.publisherPart)
    expect(fetches()).toBe(1)
    clock.now += 1
    await directory.getVerifiedRecord(fx.publisherPart)
    expect(fetches()).toBe(2)
  })

  it('decodeOperatorRolloverList ends the list at the first link that does not decode', () => {
    const a = makeKeyPair('op-a')
    const b = makeKeyPair('op-b')
    const c = makeKeyPair('op-c')
    const list = decodeOperatorRolloverList({
      rollovers: [buildOperatorRollover(a, b), { type: 'wrc/operator-rollover' }, buildOperatorRollover(b, c)],
    })
    expect(list?.map((r) => r.incoming_kid)).toEqual([b.kid])
    expect(decodeOperatorRolloverList(null)).toBeNull()
    expect(decodeOperatorRolloverList({ rollovers: 'x' })).toBeNull()
  })
})

const signWith = (bytes: Buffer, key: ReturnType<typeof makeKeyPair>) =>
  cryptoSign(null, bytes, key.privateKey).toString('base64url')

/** A rollover dual-signed over an object with one extra field, as a sloppy signer would emit it. */
function signedWithExtraField(outgoing: ReturnType<typeof makeKeyPair>, incoming: ReturnType<typeof makeKeyPair>) {
  const unsigned = {
    type: 'wrc/operator-rollover',
    outgoing_kid: outgoing.kid,
    incoming_kid: incoming.kid,
    incoming_pub: incoming.pub,
    note: 'extra',
  }
  const bytes = wrcCanonicalBytes(unsigned)
  return { ...unsigned, sig_outgoing: signWith(bytes, outgoing), sig_incoming: signWith(bytes, incoming) }
}

// ── Contract v2.0 record content: connector (C4) and grammar (C5) ────────────

describe('directory record carries a connector and a grammar this client implements [XVI.6.4]', () => {
  /** A variant of the fixture record, validly signed by operator and publisher. */
  function signedVariant(fx: WrcPublisherFixture, change: (base: Record<string, unknown>) => Record<string, unknown>) {
    return signDirectoryRecord(change(unsignedOf(fx)), fx.operator, fx.root)
  }

  it('a record on a grammar this client does not implement refuses at Gate 2', async () => {
    const fx = buildPublisherFixture()
    const value = signedVariant(fx, (b) => ({ ...b, grammar_version: '1.95' }))
    const r = await refusalFor(fx, { directoryRecord: { ok: true, value } })
    expect(r.gate).toBe(2)
    expect(r.reason).toBe('namespace_unverified')
    expect(r.detail).toContain('grammar_unsupported')
  })

  it('a record without the connector field is malformed, even when validly signed', async () => {
    const fx = buildPublisherFixture()
    const value = signedVariant(fx, ({ connector: _c, ...rest }) => rest)
    const r = await refusalFor(fx, { directoryRecord: { ok: true, value } })
    expect(r.detail).toContain('record_malformed')
  })

  it.each([
    ['a code hash without the sha256 prefix', { script_version: '1', code_hash: 'ab'.repeat(32) }],
    ['an uppercase code hash', { script_version: '1', code_hash: `sha256:${'AB'.repeat(32)}` }],
    ['an empty script version', { script_version: '', code_hash: null }],
    ['a missing code hash', { script_version: '1' }],
  ])('a connector with %s is malformed', async (_label, connector) => {
    const fx = buildPublisherFixture()
    const value = signedVariant(fx, (b) => ({ ...b, connector }))
    const r = await refusalFor(fx, { directoryRecord: { ok: true, value } })
    expect(r.detail).toContain('record_malformed')
  })

  it('the record is closed: a connector key the client does not decode breaks the operator signature', async () => {
    const fx = buildPublisherFixture()
    const value = signedVariant(fx, (b) => ({ ...b, connector: { script_version: '1', code_hash: null, extra: 'x' } }))
    const r = await refusalFor(fx, { directoryRecord: { ok: true, value } })
    expect(r.detail).toContain('operator_sig_invalid')
  })

  it('a connector naming a signed script hash admits', async () => {
    const fx = buildPublisherFixture({
      directoryOverrides: { connector: { script_version: '2.1', code_hash: `sha256:${'0f'.repeat(32)}` } },
    })
    const { deps } = depsFor(fx)
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
  })
})

// ── Displayed Responsible Domain (C8) ─────────────────────────────────────────

describe('displayOriginOf renders only a normalized, registered domain [XVI.2, A.4.1]', () => {
  const record = (display_origin: string | null, domains = ['example.com', 'brand-example.de']) =>
    ({ ...buildPublisherFixture().directoryRecord, domains, display_origin })

  it('returns a registered lowercase domain', () => {
    expect(displayOriginOf(record('example.com'))).toBe('example.com')
    expect(displayOriginOf(record('brand-example.de'))).toBe('brand-example.de')
    expect(displayOriginOf(record('xn--mnchen-3ya.de', ['xn--mnchen-3ya.de']))).toBe('xn--mnchen-3ya.de')
  })

  // Each value is registered verbatim, so only the rule under test can refuse it.
  it.each([
    ['uppercase', 'Example.com'],
    ['a scheme', 'https://example.com'],
    ['a path', 'example.com/offers'],
    ['a port', 'example.com:443'],
    ['a trailing dot', 'example.com.'],
    ['a www label', 'www.example.com'],
    ['a single label', 'localhost'],
    ['an IPv4 address', '192.0.2.1'],
    ['a Unicode name instead of punycode', 'münchen.de'],
    ['a label starting with a hyphen', '-example.com'],
  ])('renders nothing for %s', (_label, origin) => {
    expect(displayOriginOf(record(origin, [origin]))).toBeNull()
  })

  it('renders nothing when no origin is set or it is not registered', () => {
    expect(displayOriginOf(record(null))).toBeNull()
    expect(displayOriginOf(record('other.com'))).toBeNull()
  })

  it('renders nothing for a subdomain of another registered domain', () => {
    expect(displayOriginOf(record('shop.example.com', ['example.com', 'shop.example.com']))).toBeNull()
  })

  it('the Gate-2 namespace verdict carries only the checked value', async () => {
    for (const [origin, expected] of [
      ['publisher.test', 'publisher.test'],
      ['Publisher.test', null],
      ['elsewhere.test', null],
    ] as const) {
      const fx = buildPublisherFixture({ directoryOverrides: { display_origin: origin } })
      const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, depsFor(fx).deps)
      expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
      if (!r.ok) return
      expect(r.namespaces[0]!.display_origin).toBe(expected)
    }
  })
})
