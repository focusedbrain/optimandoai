/**
 * Entry lifecycle model — §XVI.8.1 status effects, §XVI.8.3 invitation
 * lifecycle, §XVI.8.4 use-limited states, and the binding of all three into
 * the §XVI.7.6 Entry gate.
 *
 * The transition tests pin the TABLE (which moves exist at all), the
 * evaluator tests pin the EFFECTS (what each state means for a request), and
 * the pipeline tests prove Gate 3 actually consults this substrate rather
 * than carrying a private copy of it.
 */
import { describe, expect, it } from 'vitest'
import {
  WR_ENTRY_LIFECYCLE_TRANSITIONS,
  WR_ENTRY_TERMINAL_STATES,
  canTransitionEntryLifecycle,
  entryLifecycleFromCatalogStatus,
  evaluateEntryLifecycleForRequest,
  type WrEntryLifecycleStatus,
} from '../entryLifecycle'
import {
  runWrCodeGatePipeline,
  type WrCodeEntryMaterial,
  type WrCodeGateDeps,
} from '../gatePipeline'
import { buildPublisherFixture } from './wrcFixtures'

const ALL_STATES = Object.keys(WR_ENTRY_LIFECYCLE_TRANSITIONS) as WrEntryLifecycleStatus[]

// ── Transition table ──────────────────────────────────────────────────────────

describe('transition table [XVI.8.1, XVI.8.3, XVI.8.4]', () => {
  it('terminal states have NO outgoing transitions — identifiers are never reissued (P11)', () => {
    for (const s of WR_ENTRY_TERMINAL_STATES) {
      expect(WR_ENTRY_LIFECYCLE_TRANSITIONS[s], s).toEqual([])
    }
  })

  it('every non-terminal state has at least one move', () => {
    for (const s of ALL_STATES) {
      if (WR_ENTRY_TERMINAL_STATES.has(s)) continue
      expect(WR_ENTRY_LIFECYCLE_TRANSITIONS[s].length, s).toBeGreaterThan(0)
    }
  })

  it.each([
    // §XVI.8.1 — temporary withdrawal is reversible, permanent is not.
    ['active', 'inactive', true],
    ['inactive', 'active', true],
    ['active', 'revoked', true],
    ['revoked', 'active', false],
    ['superseded', 'active', false],
    // §XVI.8.4 — claim cycle: CAS to CLAIMED, revert on timeout/decline/gate
    // failure (also the n>1 decrement-and-return), consume on acceptance.
    ['active', 'claimed', true],
    ['claimed', 'active', true],
    ['claimed', 'consumed', true],
    ['consumed', 'active', false],
    ['consumed', 'claimed', false],
    // consume_at = resolution (bearer) takes the use without a claim window.
    ['active', 'consumed', true],
    // Automations exhaust; the governing handshake is elsewhere and unaffected.
    ['active', 'exhausted', true],
    ['exhausted', 'active', false],
    // A reserved entry is not immune to its publisher.
    ['claimed', 'revoked', true],
    // §XVI.8.3 — invitation lifecycle, states of ONE identifier.
    ['pending', 'claimed', true],
    ['claimed', 'established', true],
    ['claimed', 'pending', true],
    ['pending', 'withdrawn', true],
    ['pending', 'expired', true],
    ['expired', 'pending', false],
    ['established', 'revoked', true],
    ['established', 'active', false],
  ] as const)('%s → %s allowed=%s', (from, to, allowed) => {
    expect(canTransitionEntryLifecycle(from, to)).toBe(allowed)
  })
})

// ── Catalog correspondence ────────────────────────────────────────────────────

describe('catalog-status correspondence', () => {
  it('published/suspended/retired map to active/inactive/revoked', () => {
    expect(entryLifecycleFromCatalogStatus('published')).toBe('active')
    expect(entryLifecycleFromCatalogStatus('suspended')).toBe('inactive')
    expect(entryLifecycleFromCatalogStatus('retired')).toBe('revoked')
  })
})

// ── Request admission (the Gate-3 question) ───────────────────────────────────

describe('evaluateEntryLifecycleForRequest [XVI.7.6 Gate 3]', () => {
  it('an offering admits in ACTIVE, an invitation admits in PENDING — and not vice versa', () => {
    expect(evaluateEntryLifecycleForRequest({ lifecycle: 'active', kind: 'offering' }).admits).toBe(true)
    expect(evaluateEntryLifecycleForRequest({ lifecycle: 'pending', kind: 'invitation' }).admits).toBe(true)
    const crossA = evaluateEntryLifecycleForRequest({ lifecycle: 'pending', kind: 'offering' })
    const crossB = evaluateEntryLifecycleForRequest({ lifecycle: 'active', kind: 'invitation' })
    expect(crossA.admits).toBe(false)
    expect(crossB.admits).toBe(false)
    if (!crossA.admits) expect(crossA.reason).toBe('entry_not_admitting')
    if (!crossB.admits) expect(crossB.reason).toBe('entry_not_admitting')
  })

  it.each([
    ['inactive', 'entry_inactive'],
    ['revoked', 'entry_revoked'],
    ['declined', 'entry_declined'],
    ['withdrawn', 'entry_withdrawn'],
    ['expired', 'entry_expired'],
    ['exhausted', 'CONTEXT_EXHAUSTED'],
  ] as const)('%s rejects with the status as the reason: %s', (lifecycle, reason) => {
    const r = evaluateEntryLifecycleForRequest({ lifecycle, kind: 'offering' })
    expect(r.admits).toBe(false)
    if (!r.admits) expect(r.reason).toBe(reason)
  })

  it('SUPERSEDED surfaces its successor as data — surfaced, never followed [XVI.8.1]', () => {
    const r = evaluateEntryLifecycleForRequest({
      lifecycle: 'superseded',
      kind: 'offering',
      successorEntryId: 'NEW01',
    })
    expect(r.admits).toBe(false)
    if (r.admits) return
    expect(r.reason).toBe('entry_superseded')
    expect(r.successorEntryId).toBe('NEW01')
  })

  it('COMPROMISED and CONSUMED carry the unsuppressible warning class', () => {
    for (const lifecycle of ['compromised', 'consumed'] as const) {
      const r = evaluateEntryLifecycleForRequest({ lifecycle, kind: 'offering' })
      expect(r.admits).toBe(false)
      if (!r.admits) expect(r.unsuppressibleWarning).toBe(true)
    }
  })

  it('CLAIMED admits only the claim holder; every other party gets CLAIMED_BY_OTHER [XVI.8.4]', () => {
    const mine = evaluateEntryLifecycleForRequest({
      lifecycle: 'claimed',
      kind: 'offering',
      claimedBy: 'party-1',
      selfClaimant: 'party-1',
    })
    expect(mine.admits).toBe(true)

    const other = evaluateEntryLifecycleForRequest({
      lifecycle: 'claimed',
      kind: 'offering',
      claimedBy: 'party-9',
      selfClaimant: 'party-1',
    })
    expect(other.admits).toBe(false)
    if (!other.admits) {
      expect(other.reason).toBe('CLAIMED_BY_OTHER')
      expect(other.detail).toBe('party-9')
    }

    // No self identity at all → fail closed, no material.
    const anonymous = evaluateEntryLifecycleForRequest({
      lifecycle: 'claimed',
      kind: 'offering',
      claimedBy: 'party-9',
    })
    expect(anonymous.admits).toBe(false)
  })
})

// ── Gate 3 consults THIS substrate ────────────────────────────────────────────

const FX = buildPublisherFixture()
const P_REF = 'PWR7X4K9B2M3C'

function depsWithLifecycle(patch: Partial<WrCodeEntryMaterial>): WrCodeGateDeps {
  const material: WrCodeEntryMaterial = {
    entry_id: FX.entryId,
    catalog_status: 'published',
    suspension: null,
    kind: 'offering',
    lifecycle: null,
    recipient_binding: null,
    use_limit: null,
    successor_entry_id: null,
    session: null,
    designation: null,
    entry: FX.entry,
    evp: FX.evp,
    ...patch,
  }
  return {
    verifyNamespace: async (part) => ({
      ok: true,
      record: {
        publisher_part: part,
        domain: FX.domain,
        status: 'active',
        dual_signature_verified: true,
        dns_verified: true,
        account_holder_verified: true,
        successor_publisher_part: null,
      },
    }),
    verifyEntry: async () => ({ ok: true, material }),
    releaseMaterial: async ({ material: m }) => ({ ok: true, released: { evp: m.evp, capsule: null } }),
    admitCapsule: async () => ({ ok: true }),
  }
}

describe('Gate 3 rejects with the lifecycle status as the reason', () => {
  it.each([
    ['inactive', 'entry_inactive'],
    ['revoked', 'entry_revoked'],
    ['compromised', 'entry_compromised'],
  ] as const)('lifecycle %s → gate 3, %s', async (lifecycle, reason) => {
    const r = await runWrCodeGatePipeline(
      { raw: P_REF, receiver: { party_id: 'party-1' } },
      depsWithLifecycle({ lifecycle }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe(reason)
  })

  it('a superseded entry surfaces its successor through the refusal', async () => {
    const r = await runWrCodeGatePipeline(
      { raw: P_REF, receiver: { party_id: 'party-1' } },
      depsWithLifecycle({ lifecycle: 'superseded', successor_entry_id: 'NEW01' }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('entry_superseded')
    expect(r.successorEntryId).toBe('NEW01')
  })

  it('an explicitly ACTIVE lifecycle still admits end to end', async () => {
    const r = await runWrCodeGatePipeline(
      { raw: P_REF, receiver: { party_id: 'party-1' } },
      depsWithLifecycle({ lifecycle: 'active' }),
    )
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
  })
})
