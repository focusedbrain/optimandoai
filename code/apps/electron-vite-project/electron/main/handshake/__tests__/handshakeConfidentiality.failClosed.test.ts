/**
 * Roadmap item 0.16: handshake confidentiality fails closed.
 * - A locked or unavailable inner vault never lowers the mirrored scope.
 * - An unreadable linked profile counts as unknown, and unknown reads as confidential.
 * - Reads without a ledger, without a row, or on error read as confidential.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  unlocked: true,
  profiles: {} as Record<string, { scope: string } | Error>,
  ledger: null as unknown,
}

vi.mock('../../vault/service', () => ({
  vaultService: { getStatus: () => ({ isUnlocked: state.unlocked }) },
}))
vi.mock('../../vault/hsContextProfileService', () => ({
  getProfile: (_db: unknown, _role: string, id: string) => {
    const p = state.profiles[id]
    if (p instanceof Error) throw p
    return p ?? null
  },
}))
vi.mock('../ledger', () => ({ getLedgerDb: () => state.ledger }))

import {
  getHandshakeClassification,
  readHandshakeConfidentialityScope,
  syncHandshakeConfidentialityScope,
} from '../handshakeConfidentiality'

/** Minimal ledger: one handshakes row per id and a profile link table. */
function fakeLedger(initial: Record<string, string>, links: Record<string, string[]>) {
  const scopes = { ...initial }
  return {
    scopes,
    prepare(sql: string) {
      if (sql.startsWith('SELECT profile_id')) {
        return { all: (hid: string) => (links[hid] ?? []).map((profile_id) => ({ profile_id })) }
      }
      if (sql.startsWith('UPDATE handshakes')) {
        return { run: (scope: string, hid: string) => { scopes[hid] = scope } }
      }
      if (sql.startsWith('SELECT confidentiality_scope')) {
        return { get: (hid: string) => (hid in scopes ? { confidentiality_scope: scopes[hid] } : undefined) }
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
  }
}

const innerDb = {}

beforeEach(() => {
  state.unlocked = true
  state.profiles = {}
  state.ledger = null
})

describe('syncHandshakeConfidentialityScope — never lowers while the vault is locked', () => {
  it('a locked vault keeps a confidential handshake confidential', () => {
    const ledger = fakeLedger({ 'hs-1': 'confidential' }, { 'hs-1': ['p1'] })
    state.unlocked = false
    expect(syncHandshakeConfidentialityScope(ledger, 'hs-1', innerDb)).toBe('unknown')
    expect(ledger.scopes['hs-1']).toBe('confidential')
  })

  it('a missing inner vault DB is unknown, and the mirror is raised, not lowered', () => {
    const ledger = fakeLedger({ 'hs-1': 'non_confidential' }, { 'hs-1': ['p1'] })
    expect(syncHandshakeConfidentialityScope(ledger, 'hs-1', null)).toBe('unknown')
    expect(ledger.scopes['hs-1']).toBe('confidential')
  })

  it('an unreadable linked profile is unknown', () => {
    const ledger = fakeLedger({ 'hs-1': 'non_confidential' }, { 'hs-1': ['p1', 'p2'] })
    state.profiles = { p1: { scope: 'non_confidential' }, p2: new Error('tier mismatch') }
    expect(syncHandshakeConfidentialityScope(ledger, 'hs-1', innerDb)).toBe('unknown')
    expect(ledger.scopes['hs-1']).toBe('confidential')
  })

  it('an unlocked vault that reads every profile can store non_confidential', () => {
    const ledger = fakeLedger({ 'hs-1': 'confidential' }, { 'hs-1': ['p1'] })
    state.profiles = { p1: { scope: 'non_confidential' } }
    expect(syncHandshakeConfidentialityScope(ledger, 'hs-1', innerDb)).toBe('non_confidential')
    expect(ledger.scopes['hs-1']).toBe('non_confidential')
  })

  it('one confidential profile makes the handshake confidential', () => {
    const ledger = fakeLedger({ 'hs-1': 'non_confidential' }, { 'hs-1': ['p1', 'p2'] })
    state.profiles = { p1: { scope: 'non_confidential' }, p2: { scope: 'confidential' } }
    expect(syncHandshakeConfidentialityScope(ledger, 'hs-1', innerDb)).toBe('confidential')
    expect(ledger.scopes['hs-1']).toBe('confidential')
  })

  it('no linked profile is non_confidential, locked or not', () => {
    const ledger = fakeLedger({ 'hs-1': 'non_confidential' }, {})
    state.unlocked = false
    expect(syncHandshakeConfidentialityScope(ledger, 'hs-1', null)).toBe('non_confidential')
  })
})

describe('reads fail closed', () => {
  it('no ledger, no row, or a read error is unknown and classifies as confidential', () => {
    expect(readHandshakeConfidentialityScope(null, 'hs-1')).toBe('unknown')
    expect(getHandshakeClassification('hs-1')).toBe('confidential')

    state.ledger = fakeLedger({}, {})
    expect(readHandshakeConfidentialityScope(state.ledger, 'hs-missing')).toBe('unknown')
    expect(getHandshakeClassification('hs-missing')).toBe('confidential')

    const broken = { prepare: () => { throw new Error('no column') } }
    expect(readHandshakeConfidentialityScope(broken, 'hs-1')).toBe('unknown')
  })

  it('a stored non_confidential row still classifies as non_confidential', () => {
    state.ledger = fakeLedger({ 'hs-1': 'non_confidential' }, {})
    expect(getHandshakeClassification('hs-1')).toBe('non_confidential')
  })
})
