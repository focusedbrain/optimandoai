/**
 * Phase 2 acceptance — canonical determinism (test 3) and container
 * semantics (test 2, parse level) [VII.3.4–3.6, VII.6.1.3].
 */

import { describe, test, expect } from 'vitest'
import {
  canonicalJsonString,
  canonicalJsonBytes,
  domainTag,
  signingBytes,
  CanonicalizationError,
  parseContainer,
  evaluateContainerCriticality,
  isReservedNamespace,
  parseCanonicalEnvelope,
} from '../src/index.js'
import type { CanonicalJsonValue, ContainerEntry } from '../src/index.js'

// ── Canonical determinism (acceptance test 3) ────────────────────────────────

describe('canonical serializer — determinism', () => {
  test('two independently constructed equal objects serialize byte-identically', () => {
    const a = { z: 1, a: 'x', nested: { b: [1, 2, 3], a: null }, flag: true }
    const b = { flag: true, nested: { a: null, b: [1, 2, 3] }, a: 'x', z: 1 }
    expect(canonicalJsonString(a)).toBe(canonicalJsonString(b))
    expect(Buffer.from(canonicalJsonBytes(a))).toEqual(Buffer.from(canonicalJsonBytes(b)))
  })

  test('serialize → parse → serialize is byte-identical across representative objects', () => {
    const representative: CanonicalJsonValue[] = [
      { capsule_type: 'initiate', seq: 0, nonce: 'ab'.repeat(32), nested: { deep: [{ x: 1 }, null, 'y'] } },
      [],
      {},
      { unicode: 'héllo → wörld ✓', escaped: '"quotes"\n\ttabs\\' },
      { negative: -42, zero: 0, big: Number.MAX_SAFE_INTEGER },
      { arr: [{ b: 2, a: 1 }, [true, false, null]] },
    ]
    for (const obj of representative) {
      const first = canonicalJsonString(obj)
      const second = canonicalJsonString(JSON.parse(first))
      expect(second).toBe(first)
    }
  })

  test('property: random key insertion order never changes bytes', () => {
    // Deterministic PRNG so failures are reproducible.
    let seed = 42
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    for (let round = 0; round < 200; round++) {
      const keys = Array.from({ length: 8 }, (_, i) => `k${i}`)
      const entries = keys.map((k, i) => [k, i % 3 === 0 ? { n: i } : i % 3 === 1 ? `v${i}` : [i, null]] as const)
      const shuffled = [...entries].sort(() => rand() - 0.5)
      const a = Object.fromEntries(entries) as CanonicalJsonValue
      const b = Object.fromEntries(shuffled) as CanonicalJsonValue
      expect(canonicalJsonString(a)).toBe(canonicalJsonString(b))
    }
  })

  test('undefined-valued properties are absent; null is significant', () => {
    expect(canonicalJsonString({ a: undefined, b: 1 } as never)).toBe('{"b":1}')
    expect(canonicalJsonString({ a: null, b: 1 })).toBe('{"a":null,"b":1}')
  })

  test('non-integers are rejected (integer-only representation)', () => {
    expect(() => canonicalJsonString({ x: 1.5 })).toThrow(CanonicalizationError)
    expect(() => canonicalJsonString({ x: Number.NaN })).toThrow(CanonicalizationError)
    expect(() => canonicalJsonString({ x: Infinity })).toThrow(CanonicalizationError)
    expect(() => canonicalJsonString({ x: 2 ** 53 })).toThrow(CanonicalizationError)
  })

  test('-0 normalizes to 0', () => {
    expect(canonicalJsonString({ x: -0 })).toBe('{"x":0}')
  })

  test('key sorting is by UTF-16 code units', () => {
    expect(canonicalJsonString({ b: 1, B: 2, a: 3, A: 4 })).toBe('{"A":4,"B":2,"a":3,"b":1}')
  })
})

// ── Domain separation ─────────────────────────────────────────────────────────

describe('domain-separation tags', () => {
  test('same object under different type/version tags produces different signing bytes', () => {
    const obj = { a: 1 }
    const t1 = Buffer.from(signingBytes('wr.handshake.core', 3, obj))
    const t2 = Buffer.from(signingBytes('wr.handshake.core', 4, obj))
    const t3 = Buffer.from(signingBytes('wr.other.object', 3, obj))
    expect(t1.equals(t2)).toBe(false)
    expect(t1.equals(t3)).toBe(false)
  })

  test('tag format is WRH1|<type>|v<version>|', () => {
    expect(Buffer.from(domainTag('wr.handshake.core', 3)).toString('utf-8')).toBe('WRH1|wr.handshake.core|v3|')
  })
})

// ── Container semantics (acceptance test 2, parse level) ─────────────────────

describe('containers — preserve-unknown + criticality [VII.3.5]', () => {
  const known: ContainerEntry = { ns: 'optirando.decl.capsule', version: 1, critical: true, payload: { x: 1 } }
  const unknownNonCritical: ContainerEntry = {
    ns: 'vendor.custom.thing',
    version: 2,
    payload: { anything: ['preserved', { deep: true }] },
    extra_key_never_stripped: 'survives',
  }
  const unknownCritical: ContainerEntry = { ns: 'vendor.mandatory.thing', version: 1, critical: true, payload: null }

  test('unknown non-critical entries are preserved BY REFERENCE (never stripped/reordered)', () => {
    const result = parseContainer([known, unknownNonCritical], 'declarations')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries[0]).toBe(known)
    expect(result.entries[1]).toBe(unknownNonCritical)
    expect((result.entries[1] as Record<string, unknown>).extra_key_never_stripped).toBe('survives')
  })

  test('container order and unknown entries survive a canonical round-trip byte-identically', () => {
    const container = [known, unknownNonCritical]
    const bytes1 = canonicalJsonString(container as unknown as CanonicalJsonValue)
    const parsed = parseContainer(JSON.parse(bytes1), 'declarations')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const bytes2 = canonicalJsonString(parsed.entries as unknown as CanonicalJsonValue)
    expect(bytes2).toBe(bytes1)
  })

  test('unknown non-critical → preserve and ignore; unknown critical → refusal naming the namespace', () => {
    const okVerdict = evaluateContainerCriticality([known, unknownNonCritical])
    expect(okVerdict.ok).toBe(true)
    if (okVerdict.ok) expect(okVerdict.ignoredNonCritical).toEqual(['vendor.custom.thing'])

    const refusal = evaluateContainerCriticality([known, unknownCritical])
    expect(refusal.ok).toBe(false)
    if (!refusal.ok) expect(refusal.refusedNamespace).toBe('vendor.mandatory.thing')
  })

  test('reserved namespaces are registered but refuse when critical (parse-level criticality only)', () => {
    expect(isReservedNamespace('optirando.handshake.prior_ref')).toBe(true)
    expect(isReservedNamespace('optirando.credential.attachment')).toBe(true)
    expect(isReservedNamespace('optirando.transport.routing')).toBe(true) // family wildcard
    expect(isReservedNamespace('optirando.grant.single_use')).toBe(true)
    expect(isReservedNamespace('optirando.grant.ttl')).toBe(true)
    expect(isReservedNamespace('optirando.ad.wr_ad')).toBe(true)
    expect(isReservedNamespace('optirando.invitation.targeted_bound')).toBe(true)
    expect(isReservedNamespace('optirando.decl.capability')).toBe(true)
    expect(isReservedNamespace('optirando.bridge.anything')).toBe(true)

    const criticalReserved = evaluateContainerCriticality([
      { ns: 'optirando.handshake.prior_ref', version: 1, critical: true, payload: {} },
    ])
    expect(criticalReserved.ok).toBe(false)
    if (!criticalReserved.ok) {
      expect(criticalReserved.refusedNamespace).toBe('optirando.handshake.prior_ref')
      expect(criticalReserved.reserved).toBe(true)
    }

    const nonCriticalReserved = evaluateContainerCriticality([
      { ns: 'optirando.handshake.prior_ref', version: 1, payload: {} },
    ])
    expect(nonCriticalReserved.ok).toBe(true)
  })

  test('malformed containers fail closed', () => {
    expect(parseContainer('not-a-list', 'declarations').ok).toBe(false)
    expect(parseContainer([{ version: 1, payload: {} }], 'declarations').ok).toBe(false) // missing ns
    expect(parseContainer([{ ns: 'a.b', version: 0, payload: {} }], 'declarations').ok).toBe(false)
    expect(parseContainer([{ ns: 'a.b', version: 1 }], 'declarations').ok).toBe(false) // missing payload
    expect(parseContainer([{ ns: 'a.b', version: 1, critical: 'yes', payload: {} }], 'declarations').ok).toBe(false)
  })
})

// ── Envelope structural parser ────────────────────────────────────────────────

describe('canonical envelope parser', () => {
  const validCore = {
    profile: { id: 'legacy_v0', version: 1 },
    initiator_id: { sub: 's1', iss: 'https://sso.example', email: 'a@example.com', wrdesk_user_id: 'u1' },
    responder_id: null,
    ingress_path: null,
    declarations: [{ ns: 'optirando.decl.capsule', version: 1, critical: true, payload: { seq: 0 } }],
    extensions: [],
    created_at: '2026-07-24T12:00:00.000Z',
    nonce: 'ab'.repeat(32),
  }
  const validSig = {
    signer: 'initiator',
    alg: 'ed25519',
    mode: 'canonical_bytes',
    public_key: 'cd'.repeat(32),
    sig: 'ef'.repeat(64),
  }

  test('valid envelope parses; core is returned by reference (byte-faithful)', () => {
    const envelope = { v: 3, core: validCore, signatures: [validSig] }
    const result = parseCanonicalEnvelope(envelope)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.envelope.core).toBe(validCore as never)
  })

  test('partial identity claims are rejected (full-claim binding [VII.3.8])', () => {
    const partial = { ...validCore, initiator_id: { sub: 's1', iss: 'https://sso.example' } }
    const result = parseCanonicalEnvelope({ v: 3, core: partial, signatures: [validSig] })
    expect(result.ok).toBe(false)
  })

  test('unsupported version and missing signatures are rejected', () => {
    expect(parseCanonicalEnvelope({ v: 4, core: validCore, signatures: [validSig] }).ok).toBe(false)
    expect(parseCanonicalEnvelope({ v: 3, core: validCore, signatures: [] }).ok).toBe(false)
  })
})
