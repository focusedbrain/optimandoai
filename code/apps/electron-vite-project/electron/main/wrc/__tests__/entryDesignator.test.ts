/**
 * Canonical Entry Designator — §XVI.5.10/§XVI.5.11 derivation and key
 * (Run 3). Table-driven: vectors are built with the Run-1 grammar builder so
 * every reference in here is a real, check-valid v1.95 reference.
 *
 * Two families of assertions:
 *  1. DERIVATION — the class-fixed rules (ordered pair with normative roles,
 *     combination constituents, parent classes) with the Run-3 reason codes.
 *  2. IDENTITY — equivalent references collapse to one key; non-equivalent
 *     references (class, role order, receiving party, parent) never alias.
 */
import { describe, expect, it } from 'vitest'
import { buildWrCodeReference, captureWrCodeReference, type WrCodeReference } from '@repo/ingestion-core'
import {
  deriveEntryDesignator,
  designatorKey,
  useLimitEntryKey,
  type WrCodeDesignationClaim,
} from '../entryDesignator'

const PUB = 'WR7X4K' // initiator / publisher / tenant namespace
const RSP = 'RCVPBX' // responder publisher id
const COMB = 'M3K9B2' // combination block
const ENTRY = 'ENTR01' // expanded entry constituent

function ref(cls: 'P' | 'I' | 'C' | 'SP' | 'SI' | 'SC' | 'SE', blocks: string[]): WrCodeReference {
  const r = buildWrCodeReference(cls, blocks)
  if (!r.ok) throw new Error(`vector build failed: ${r.reason}`)
  return r
}

const P_REF = ref('P', [PUB, '9B2M3'])
const C_REF = ref('C', [PUB, RSP])
const C_REVERSED = ref('C', [RSP, PUB])
const I_REF = ref('I', [PUB, COMB])
const SP_REF = ref('SP', [PUB, COMB])
const SI_REF = ref('SI', [PUB, COMB])
const SC_REF = ref('SC', [PUB, COMB])
const SE_REF = ref('SE', [PUB, COMB])

const C_CLAIM: WrCodeDesignationClaim = { cls: 'C', initiator_part: PUB, counterparty_part: RSP }

function combClaim(
  cls: string,
  patch: Partial<WrCodeDesignationClaim> = {},
): WrCodeDesignationClaim {
  return {
    cls,
    combination: COMB,
    receiving_party: { kind: 'principal', id: 'party-1' },
    ...patch,
  }
}

const P_PARENT = { cls: 'P', publisher_part: PUB }
const I_PARENT = { cls: 'I', publisher_part: PUB }
const C_PARENT = { cls: 'C', publisher_part: PUB, counterparty_part: RSP }

// ── Derivation: passing vectors ───────────────────────────────────────────────

describe('derivation — every class reaches a full designator [XVI.5.10]', () => {
  it('P: local block, no claim needed', () => {
    const r = deriveEntryDesignator(P_REF, null, '9B2M3')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.designator).toMatchObject({
      cls: 'P',
      publisher_part: PUB,
      entry_id: '9B2M3',
      counterparty_part: null,
      parent: null,
    })
  })

  it('C: the ordered pair with matching registered roles', () => {
    const r = deriveEntryDesignator(C_REF, C_CLAIM, 'ignored-repo-id')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.designator).toMatchObject({
      cls: 'C',
      publisher_part: PUB,
      entry_id: null,
      counterparty_part: RSP,
    })
  })

  it('I: expanded combination, receiving party, no parent', () => {
    const r = deriveEntryDesignator(I_REF, combClaim('I'), ENTRY)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.designator).toMatchObject({
      cls: 'I',
      entry_id: ENTRY,
      receiving_party: { kind: 'principal', id: 'party-1' },
      parent: null,
    })
  })

  it.each([
    ['SP beneath P', SP_REF, combClaim('SP', { parent: P_PARENT })],
    ['SI beneath I', SI_REF, combClaim('SI', { parent: I_PARENT })],
    [
      'SC beneath C, responder as receiving party',
      SC_REF,
      combClaim('SC', { parent: C_PARENT, receiving_party: { kind: 'publisher', id: RSP } }),
    ],
    ['SE beneath P', SE_REF, combClaim('SE', { parent: P_PARENT })],
    ['SE beneath C', SE_REF, combClaim('SE', { parent: C_PARENT })],
    ['SE beneath SI', SE_REF, combClaim('SE', { parent: { cls: 'SI', publisher_part: PUB } })],
  ] as const)('%s', (_n, reference, claim) => {
    const r = deriveEntryDesignator(reference, claim, ENTRY)
    expect(r.ok, r.ok ? '' : `${r.reason}: ${r.detail}`).toBe(true)
    if (!r.ok) return
    expect(r.designator.entry_id).toBe(ENTRY)
    expect(r.designator.parent?.cls).toBe(claim.parent!.cls)
  })
})

// ── Derivation: failing vectors, precise reasons ──────────────────────────────

describe('derivation — fail-closed reason codes [Run-3 vocabulary]', () => {
  it('C reversed ordered pair → invalid_role_ordering (roles are never sorted)', () => {
    // The repository registered PUB→RSP; the reference names RSP→PUB.
    const r = deriveEntryDesignator(C_REVERSED, C_CLAIM, 'x')
    expect(r).toMatchObject({ ok: false, reason: 'invalid_role_ordering' })
  })

  it('C with a different registered pair → designation_mismatch', () => {
    const r = deriveEntryDesignator(C_REF, { cls: 'C', initiator_part: PUB, counterparty_part: 'ZZPUBQ' }, 'x')
    expect(r).toMatchObject({ ok: false, reason: 'designation_mismatch' })
  })

  it('C with a missing role → missing_pair_component; no claim at all → designation_mismatch', () => {
    expect(deriveEntryDesignator(C_REF, { cls: 'C', initiator_part: PUB }, 'x')).toMatchObject({
      ok: false,
      reason: 'missing_pair_component',
    })
    expect(deriveEntryDesignator(C_REF, null, 'x')).toMatchObject({
      ok: false,
      reason: 'designation_mismatch',
    })
  })

  it('combination expansion answering another block → designation_mismatch', () => {
    const r = deriveEntryDesignator(I_REF, combClaim('I', { combination: 'AAAAAA' }), ENTRY)
    expect(r).toMatchObject({ ok: false, reason: 'designation_mismatch' })
  })

  it('expansion without a receiving party → missing_pair_component', () => {
    const r = deriveEntryDesignator(I_REF, combClaim('I', { receiving_party: null }), ENTRY)
    expect(r).toMatchObject({ ok: false, reason: 'missing_pair_component' })
  })

  it('expansion without an entry constituent → missing_pair_component', () => {
    const r = deriveEntryDesignator(I_REF, combClaim('I'), '')
    expect(r).toMatchObject({ ok: false, reason: 'missing_pair_component' })
  })

  it('unknown receiving-party kind → unsupported_combination', () => {
    const r = deriveEntryDesignator(I_REF, combClaim('I', { receiving_party: { kind: 'robot', id: 'x' } }), ENTRY)
    expect(r).toMatchObject({ ok: false, reason: 'unsupported_combination' })
  })

  it.each([
    ['SP beneath I', SP_REF, combClaim('SP', { parent: I_PARENT })],
    ['SP beneath C', SP_REF, combClaim('SP', { parent: C_PARENT })],
    ['SI beneath P', SI_REF, combClaim('SI', { parent: P_PARENT })],
    ['SC beneath P', SC_REF, combClaim('SC', { parent: P_PARENT })],
    ['SC beneath I', SC_REF, combClaim('SC', { parent: I_PARENT })],
    ['SE beneath SE', SE_REF, combClaim('SE', { parent: { cls: 'SE', publisher_part: PUB } })],
  ] as const)('invalid parent class: %s → invalid_parent_class', (_n, reference, claim) => {
    const r = deriveEntryDesignator(reference, claim, ENTRY)
    expect(r).toMatchObject({ ok: false, reason: 'invalid_parent_class' })
  })

  it('a sub-handshake without any parent → invalid_parent_class', () => {
    const r = deriveEntryDesignator(SP_REF, combClaim('SP'), ENTRY)
    expect(r).toMatchObject({ ok: false, reason: 'invalid_parent_class' })
  })

  it('an I umbrella or a C pair claiming a parent → invalid_parent_class', () => {
    expect(deriveEntryDesignator(I_REF, combClaim('I', { parent: P_PARENT }), ENTRY)).toMatchObject({
      ok: false,
      reason: 'invalid_parent_class',
    })
    expect(deriveEntryDesignator(C_REF, { ...C_CLAIM, parent: P_PARENT }, 'x')).toMatchObject({
      ok: false,
      reason: 'invalid_parent_class',
    })
  })

  it('a parent in a foreign namespace → designation_mismatch [XVI.5.10]', () => {
    const r = deriveEntryDesignator(
      SP_REF,
      combClaim('SP', { parent: { cls: 'P', publisher_part: 'ZZPUBQ' } }),
      ENTRY,
    )
    expect(r).toMatchObject({ ok: false, reason: 'designation_mismatch' })
  })

  it('SC parent pair without its responder → missing_pair_component', () => {
    const r = deriveEntryDesignator(
      SC_REF,
      combClaim('SC', { parent: { cls: 'C', publisher_part: PUB } }),
      ENTRY,
    )
    expect(r).toMatchObject({ ok: false, reason: 'missing_pair_component' })
  })

  it('SC receiving organization must be the responder of the governing pair', () => {
    const r = deriveEntryDesignator(
      SC_REF,
      combClaim('SC', { parent: C_PARENT, receiving_party: { kind: 'publisher', id: 'ZZPUBQ' } }),
      ENTRY,
    )
    expect(r).toMatchObject({ ok: false, reason: 'designation_mismatch' })
  })

  it('resolver answering with the wrong class → designation_mismatch (no cross-class fallthrough)', () => {
    const r = deriveEntryDesignator(I_REF, combClaim('SP', { parent: P_PARENT }), ENTRY)
    expect(r).toMatchObject({ ok: false, reason: 'designation_mismatch' })
  })
})

// ── Identity: keys collapse equivalents, never alias distinctions ─────────────

describe('canonical key — deterministic, collision-resistant [XVI.5.11]', () => {
  const derive = (reference: WrCodeReference, claim: WrCodeDesignationClaim | null, id: string) => {
    const r = deriveEntryDesignator(reference, claim, id)
    if (!r.ok) throw new Error(`${r.reason}: ${r.detail}`)
    return r.designator
  }

  it('equivalent references collapse: grouped/ungrouped/lowercase P captures share one key', () => {
    const forms = ['PWR7X4K9B2M3C', 'P-WR7X4K-9B2M3C', ' p-wr7x4k-9b2m3c ']
    const keys = forms.map((raw) => {
      const cap = captureWrCodeReference(raw)
      if (!cap.ok) throw new Error(cap.reason)
      const d = deriveEntryDesignator(cap, null, cap.local!)
      if (!d.ok) throw new Error(d.reason)
      return designatorKey(d.designator)
    })
    expect(new Set(keys).size).toBe(1)
  })

  it('the C pair and its reverse are two distinct identities', () => {
    const ab = derive(C_REF, C_CLAIM, 'x')
    const ba = derive(C_REVERSED, { cls: 'C', initiator_part: RSP, counterparty_part: PUB }, 'x')
    expect(designatorKey(ab)).not.toBe(designatorKey(ba))
  })

  it('no aliasing between C, I, and S* even with identical blocks', () => {
    const i = derive(I_REF, combClaim('I'), ENTRY)
    const sp = derive(SP_REF, combClaim('SP', { parent: P_PARENT }), ENTRY)
    const si = derive(SI_REF, combClaim('SI', { parent: I_PARENT }), ENTRY)
    const keys = [designatorKey(i), designatorKey(sp), designatorKey(si)]
    expect(new Set(keys).size).toBe(3)
  })

  it('the same child-local identifier beneath two distinct parents is two entries', () => {
    const underP = derive(SE_REF, combClaim('SE', { parent: P_PARENT }), ENTRY)
    const underC = derive(SE_REF, combClaim('SE', { parent: C_PARENT }), ENTRY)
    expect(underP.entry_id).toBe(underC.entry_id)
    expect(designatorKey(underP)).not.toBe(designatorKey(underC))
  })

  it('same entry toward different receiving parties is two identities', () => {
    const toA = derive(I_REF, combClaim('I', { receiving_party: { kind: 'principal', id: 'party-A' } }), ENTRY)
    const toB = derive(I_REF, combClaim('I', { receiving_party: { kind: 'principal', id: 'party-B' } }), ENTRY)
    expect(designatorKey(toA)).not.toBe(designatorKey(toB))
  })

  it('party ids cannot forge separators: escaping keeps crafted ids apart', () => {
    const crafted = derive(
      I_REF,
      combClaim('I', { receiving_party: { kind: 'principal', id: 'x|p:P/WR7X4K/' } }),
      ENTRY,
    )
    const plain = derive(
      SP_REF,
      combClaim('SP', { parent: P_PARENT, receiving_party: { kind: 'principal', id: 'x' } }),
      ENTRY,
    )
    expect(designatorKey(crafted)).not.toBe(designatorKey(plain))
    expect(designatorKey(crafted)).toContain(encodeURIComponent('x|p:P/WR7X4K/'))
  })

  it('use-limit keys: P keeps the bare Run-2 local id; nothing else can collide with it', () => {
    const p = derive(P_REF, null, '9B2M3')
    expect(useLimitEntryKey(p)).toBe('9B2M3')
    // An SP whose expanded entry id equals the P local still gets a full key.
    const sp = derive(SP_REF, combClaim('SP', { parent: P_PARENT }), '9B2M3')
    expect(useLimitEntryKey(sp)).not.toBe('9B2M3')
    expect(useLimitEntryKey(sp).startsWith('wrd1|')).toBe(true)
  })
})
