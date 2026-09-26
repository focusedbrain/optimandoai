/**
 * Capability-token schema (Phase 5 — T4, Q13) [XII.12.6 annex-number-provisional]
 *
 *  - Preserve-unknown-optional parsing: unknown fields (incl. context_scope /
 *    delegation_chain refinements) round-trip byte-preserved; no validation.
 *  - Limit-extension criticality [VII.10.8.3]: present-but-not-understood →
 *    token refused, never accepted as unlimited.
 *  - No `execute` token type exists or is accepted.
 */

import { describe, it, expect } from 'vitest'
import {
  parseCapabilityToken,
  serializeCapabilityToken,
  buildCapabilityTokenWire,
  CAPABILITY_TOKEN_TYPES,
  UNDERSTOOD_LIMIT_EXTENSIONS,
} from '../src/capabilityToken'

const BASE = {
  schema: 'wr.capability_token',
  schema_version: 1,
  token_id: 'tok-1',
  token_type: 'delivery',
  grant_id: 'grant-1',
  handshake_id: 'hs-1',
  scopes: ['availability'],
}

describe('capability token — forward compatibility (T4)', () => {
  it('unknown optional fields (incl. context_scope / delegation_chain) round-trip byte-preserved', () => {
    // Deliberately odd formatting + unknown fields: bytes must survive exactly.
    const wire = `{
      "schema": "wr.capability_token", "schema_version": 1,
      "token_id": "tok-cc", "token_type": "delivery",
      "grant_id": "g-cc", "handshake_id": "hs-cc",
      "scopes": ["a", "b"],
      "context_scope": { "future": ["cc-field"], "depth": 3 },
      "delegation_chain": [ { "delegate": "x", "sig": "unvalidated" } ],
      "some_future_field": { "nested": [1, 2, 3] },
      "another_unknown": "kept"
    }`
    const parsed = parseCapabilityToken(wire)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // Byte-identical round trip; unknown fields reported, never stripped.
    expect(serializeCapabilityToken(parsed)).toBe(wire)
    expect(parsed.unknown_fields).toEqual(['some_future_field', 'another_unknown'])

    // Carriage only: delegation_chain is carried, no validation triggered.
    expect(parsed.token.delegation_chain).toEqual([{ delegate: 'x', sig: 'unvalidated' }])
    expect(parsed.token.context_scope).toEqual({ future: ['cc-field'], depth: 3 })
  })

  it('delegable defaults to false and grants nothing', () => {
    const parsed = parseCapabilityToken(JSON.stringify(BASE))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.token.delegable).toBe(false)
  })
})

describe('capability token — limit-extension criticality [VII.10.8.3]', () => {
  it('understood limit extensions parse', () => {
    const wire = JSON.stringify({
      ...BASE,
      limit_extensions: [
        { ns: 'optirando.grant.single_use' },
        { ns: 'optirando.grant.ttl', payload: { expires_at: '2027-01-01T00:00:00Z' } },
      ],
    })
    const parsed = parseCapabilityToken(wire)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.token.limit_extensions?.length).toBe(2)
  })

  it('present-but-not-understood limit extension → REFUSED naming the namespace (never unlimited)', () => {
    const wire = JSON.stringify({
      ...BASE,
      limit_extensions: [{ ns: 'optirando.grant.max_invocations', payload: { n: 5 } }],
    })
    const parsed = parseCapabilityToken(wire)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.reason).toBe('ununderstood_limit_extension')
      expect(parsed.detail).toBe('optirando.grant.max_invocations')
    }
  })

  it('absence of limit extensions = unlimited-until-revoke ground state', () => {
    const parsed = parseCapabilityToken(JSON.stringify(BASE))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.token.limit_extensions).toBeUndefined()
  })

  it('the understood set is exactly single_use + ttl', () => {
    expect([...UNDERSTOOD_LIMIT_EXTENSIONS].sort()).toEqual([
      'optirando.grant.single_use',
      'optirando.grant.ttl',
    ])
  })
})

describe('capability token — no execute variant [VII.10.1]', () => {
  it('token types are exactly delivery + preparation', () => {
    expect([...CAPABILITY_TOKEN_TYPES].sort()).toEqual(['delivery', 'preparation'])
  })

  it("an 'execute' token type is refused", () => {
    const parsed = parseCapabilityToken(JSON.stringify({ ...BASE, token_type: 'execute' }))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toBe('invalid_token_type')
  })

  it('fail-closed basics: wrong schema / version / missing fields refused', () => {
    expect(parseCapabilityToken('not json').ok).toBe(false)
    expect(parseCapabilityToken(JSON.stringify({ ...BASE, schema: 'other' })).ok).toBe(false)
    expect(parseCapabilityToken(JSON.stringify({ ...BASE, schema_version: 2 })).ok).toBe(false)
    expect(parseCapabilityToken(JSON.stringify({ ...BASE, token_id: '' })).ok).toBe(false)
    expect(parseCapabilityToken(JSON.stringify({ ...BASE, scopes: 'not-an-array' })).ok).toBe(false)
  })

  it('buildCapabilityTokenWire produces a parseable canonical token', () => {
    const wire = buildCapabilityTokenWire({
      token_id: 'tok-new',
      token_type: 'preparation',
      grant_id: 'g-new',
      handshake_id: 'hs-new',
      scopes: [],
      delegable: false,
    })
    const parsed = parseCapabilityToken(wire)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.token.token_type).toBe('preparation')
  })
})
