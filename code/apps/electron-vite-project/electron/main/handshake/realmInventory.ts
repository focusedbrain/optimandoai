/**
 * Realm-distribution inventory (Phase 1 risk register: "identity-guard
 * tightening breaks same-user multi-realm setups").
 *
 * Counts how existing handshake rows are distributed across identity realms
 * (OIDC issuers) BEFORE full-claim enforcement decides anything, so the phase
 * report can quantify how many rows would fall into the Q12
 * `mixed_realm_repair` class instead of matching cleanly.
 *
 * Metadata-only: the inventory carries counts and issuer host names, never
 * emails, subjects, or tokens.
 */

import { fullClaimIdentityMatch, samePrincipalFullClaim } from '@repo/ingestion-core'
import type { HandshakeRecord, PartyIdentity, SSOSession } from './types'
import { classifyPartyForSessionVisibility } from './handshakeAccountIsolation'

export interface RealmDistributionInventory {
  total_rows: number
  by_state: Record<string, number>
  internal_rows: number
  standard_rows: number
  /** Distinct issuer hosts seen on any party (hostname only, metadata). */
  distinct_issuer_hosts: string[]
  rows_initiator_iss_missing: number
  rows_acceptor_iss_missing: number
  /** Both parties carry an issuer and they differ (cross-realm relationship). */
  rows_cross_realm_pair: number
  /** Internal rows whose parties fail the same-principal full-claim check. */
  internal_rows_principal_mismatch: number
  /** Session-relative classification (only when a session is provided). */
  session_relative?: {
    match: number
    mixed_realm_repair: number
    foreign: number
  }
}

function issuerHost(party: PartyIdentity | null | undefined): string | null {
  const iss = (party?.iss ?? '').trim()
  if (!iss) return null
  try {
    return new URL(iss).host || iss
  } catch {
    return iss
  }
}

export function inventoryRealmDistribution(
  records: readonly HandshakeRecord[],
  session?: SSOSession | null,
): RealmDistributionInventory {
  const inv: RealmDistributionInventory = {
    total_rows: records.length,
    by_state: {},
    internal_rows: 0,
    standard_rows: 0,
    distinct_issuer_hosts: [],
    rows_initiator_iss_missing: 0,
    rows_acceptor_iss_missing: 0,
    rows_cross_realm_pair: 0,
    internal_rows_principal_mismatch: 0,
  }
  const hosts = new Set<string>()
  const sessionRelative = { match: 0, mixed_realm_repair: 0, foreign: 0 }

  for (const r of records) {
    inv.by_state[r.state] = (inv.by_state[r.state] ?? 0) + 1
    if (r.same_principal === true) inv.internal_rows++
    else inv.standard_rows++

    const hi = issuerHost(r.initiator)
    const ha = issuerHost(r.acceptor)
    if (hi) hosts.add(hi)
    if (ha) hosts.add(ha)
    if (!hi) inv.rows_initiator_iss_missing++
    if (r.acceptor && !ha) inv.rows_acceptor_iss_missing++
    if (hi && ha && hi !== ha) inv.rows_cross_realm_pair++

    if (r.same_principal === true && r.acceptor) {
      if (!samePrincipalFullClaim(r.initiator, r.acceptor).ok) {
        inv.internal_rows_principal_mismatch++
      }
    }

    if (session) {
      const vsInitiator = classifyPartyForSessionVisibility(session, r.initiator)
      const vsAcceptor = r.acceptor ? classifyPartyForSessionVisibility(session, r.acceptor) : 'foreign'
      if (vsInitiator === 'match' || vsAcceptor === 'match') sessionRelative.match++
      else if (vsInitiator === 'mixed_realm_repair' || vsAcceptor === 'mixed_realm_repair')
        sessionRelative.mixed_realm_repair++
      else sessionRelative.foreign++
    }
  }

  inv.distinct_issuer_hosts = [...hosts].sort()
  if (session) inv.session_relative = sessionRelative
  return inv
}

/** Convenience: read all rows from the ledger DB and log the inventory (metadata only). */
export function logRealmDistributionInventory(db: any, session?: SSOSession | null): RealmDistributionInventory {
  // Lazy import avoids a module cycle with db.ts consumers.
  const { listHandshakeRecords } = require('./db') as typeof import('./db')
  const records = listHandshakeRecords(db)
  const inv = inventoryRealmDistribution(records, session)
  console.log('[IDENTITY_GUARD] realm_distribution_inventory', JSON.stringify(inv))
  return inv
}
