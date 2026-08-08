/**
 * Test kit for the Phase-4 Connect-offer consent gate [IX.3.1].
 *
 * Inbound `handshake-initiate` capsules no longer create relationship rows
 * directly — they stage a Connect offer, and only a consent event lets the
 * ONE formation pipeline create the record. Tests that exercise the
 * post-formation surface (accept / refresh / context_sync / revoke) use
 * `submitCapsuleThroughConsentGate` to walk the REAL staged → consent →
 * record path instead of the deleted auto-insert.
 *
 * This is NOT a bypass: the consent step goes through
 * `prepareFormationConsent` (hash-pinned consent record) and the second
 * ingest carries the `formationConsent` ref exactly like the production
 * `handshake.accept` / `handshake.consentToConnectOffer` flows.
 */

import Database from 'better-sqlite3'
import { setConnectOfferDbProvider, prepareFormationConsent } from '../formationPipeline'
import { handleIngestionRPC } from '../../ingestion/ipc'
import type { SSOSession } from '../types'

let stagingDb: InstanceType<typeof Database> | null = null

/** Point the Connect-offer staging store at a fresh in-memory DB (call in beforeEach). */
export function installInMemoryConnectOffers(): void {
  try {
    stagingDb?.close()
  } catch {
    /* noop */
  }
  stagingDb = new Database(':memory:')
  setConnectOfferDbProvider(() => stagingDb)
}

/** Restore the default provider (call in afterEach). */
export function uninstallInMemoryConnectOffers(): void {
  try {
    stagingDb?.close()
  } catch {
    /* noop */
  }
  stagingDb = null
  setConnectOfferDbProvider(null)
}

/**
 * Ingest a capsule. When an inbound initiate stages a Connect offer, consent
 * to it as the receiving session and re-run the ingest behind the consent
 * gate, returning the final (record-creating) result. All other capsule
 * types and every failure pass through unchanged.
 */
export async function submitCapsuleThroughConsentGate(
  capsuleJson: string,
  db: unknown,
  session: SSOSession,
  opts?: { sourceType?: string; channelId?: string },
): Promise<any> {
  const sourceType = opts?.sourceType ?? 'email'
  const ingestParams = {
    rawInput: { body: capsuleJson, mime_type: 'application/vnd.beap+json' },
    sourceType,
    transportMeta: {
      channel_id: opts?.channelId ?? 'test-consent-gate',
      mime_type: 'application/vnd.beap+json',
    },
  }
  const first = await handleIngestionRPC('ingestion.ingest', ingestParams, db, session)

  const staged = first?.handshake_result
  if (!first?.success || !staged || staged.staged !== true || !staged.offerId) {
    return first
  }

  let prep = prepareFormationConsent({
    offerId: staged.offerId,
    actorWrdeskUserId: session.wrdesk_user_id,
  })
  if (!prep.ok && prep.reason === 'OFFER_NOT_CONSENTABLE' && stagingDb) {
    // Two-party tests replay the same initiate into each party's relationship
    // DB while sharing ONE staging store (production gives each device its
    // own). Re-arm the consumed offer so the second party can consent too.
    stagingDb
      .prepare(
        `UPDATE wr_connect_offers SET consumed_at = NULL, consumed_action = NULL, consent_id = NULL WHERE offer_id = ?`,
      )
      .run(staged.offerId)
    prep = prepareFormationConsent({
      offerId: staged.offerId,
      actorWrdeskUserId: session.wrdesk_user_id,
    })
  }
  if (!prep.ok) {
    return {
      ...first,
      success: false,
      error: `Consent preparation failed: ${prep.reason}`,
      reason: prep.reason,
    }
  }

  return handleIngestionRPC(
    'ingestion.ingest',
    { ...ingestParams, formationConsent: prep.consentRef },
    db,
    session,
  )
}
