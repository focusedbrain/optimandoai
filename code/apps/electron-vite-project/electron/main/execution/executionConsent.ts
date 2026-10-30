/**
 * Per-tap execution consent (Phase 5 — V4) [VII.10.1, VII.2.6, IX.19.2]
 *
 * Execution grants are DELETED. There is no standing set of granted tools,
 * no ACTIVE-handshake blanket authorization, no auto-accept, no bypass API,
 * and no batch-approve-without-visible-set [VII.10.5.5]. Every execution is
 * a distinct human consent tap:
 *
 *   1. `prepareExecutionConsent` renders the consent preview from the bound
 *      request definition (client-generated, canonical) and computes the
 *      INTENT HASH — the canonical hash over the preview exactly as
 *      presented, under a domain-separation tag.
 *   2. `confirmExecutionConsent` records the human tap, binding actor +
 *      intent hash into a single-use consent record.
 *   3. `verifyConsentForExecution` (called by the one execution entry point)
 *      recomputes the intent hash from the request ABOUT TO EXECUTE.
 *      Divergence between executed and presented action invalidates the
 *      consent record and is a deviation [IX.19.2].
 *   4. The consent record is consumed exactly once; the execution's PoAE
 *      record carries the intent hash and the consent reference.
 *
 * Feature gate (risk register hard coupling): the consent-tap flow ships in
 * the same release as the grant deletion. `WRDESK_EXECUTION_CONSENT_TAP=0`
 * is a fail-closed KILL SWITCH — it refuses all execution; it never restores
 * a consent-free path.
 */

import { createHash, randomUUID } from 'node:crypto'
import { canonicalJsonString, domainTag, type CanonicalJsonValue } from '@repo/ingestion-core'
import type { ToolRequest } from './types'

// ── Feature gate (fail-closed kill switch, never a bypass) ──────────────────

export function isConsentTapExecutionEnabled(): boolean {
  return process.env.WRDESK_EXECUTION_CONSENT_TAP !== '0'
}

// ── Schema ────────────────────────────────────────────────────────────────────

export function ensureExecutionConsentSchema(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wr_execution_consents (
      consent_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      handshake_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      preview_json TEXT NOT NULL,
      params_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
      consented_at TEXT,
      actor_wrdesk_user_id TEXT,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wr_exec_consents_request ON wr_execution_consents (request_id);
  `)
}

// ── Intent Hash ───────────────────────────────────────────────────────────────

const INTENT_DOMAIN = 'wr.execution.intent'

export function paramsDigest(parameters: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(parameters ?? {}), 'utf8')
    .digest('hex')
}

/**
 * The consent preview — client-generated from the bound request definition,
 * never counterparty free text. Canonically hashable at presentation time.
 * Parameters enter as a digest: the preview names the action and its exact
 * parameter bytes without embedding content.
 */
export function buildExecutionPreview(req: {
  request_id: string
  handshake_id: string
  tool_name: string
  scope_id?: string
  purpose_id?: string
  parameters: Record<string, unknown>
  origin: string
}): Record<string, CanonicalJsonValue> {
  return {
    request_id: req.request_id,
    handshake_id: req.handshake_id,
    tool_name: req.tool_name,
    scope: req.scope_id ?? '*',
    purpose: req.purpose_id ?? 'general',
    params_digest: paramsDigest(req.parameters),
    origin: req.origin,
  }
}

/** Intent Hash = domain-tagged canonical hash of the preview as presented. */
export function computeIntentHash(preview: Record<string, CanonicalJsonValue>): string {
  return createHash('sha256')
    .update(domainTag(INTENT_DOMAIN, 1))
    .update(canonicalJsonString(preview), 'utf8')
    .digest('hex')
}

// ── Consent lifecycle ─────────────────────────────────────────────────────────

export interface ExecutionConsentRow {
  consent_id: string
  request_id: string
  handshake_id: string
  tool_name: string
  intent_hash: string
  preview_json: string
  params_digest: string
  created_at: string
  consented_at: string | null
  actor_wrdesk_user_id: string | null
  consumed_at: string | null
}

/**
 * Step 1 — render the consent screen material for ONE request. The returned
 * preview is exactly what the consent record pins; the UI must present it
 * unmodified.
 */
export function prepareExecutionConsent(
  db: any,
  req: Pick<ToolRequest, 'request_id' | 'tool_name' | 'parameters' | 'origin'> & {
    handshake_id: string
    scope_id?: string
    purpose_id?: string
  },
  now: Date = new Date(),
): { consent_id: string; intent_hash: string; preview: Record<string, CanonicalJsonValue> } {
  ensureExecutionConsentSchema(db)
  const preview = buildExecutionPreview(req)
  const intentHash = computeIntentHash(preview)
  const consentId = randomUUID()
  db.prepare(
    `INSERT INTO wr_execution_consents
       (consent_id, request_id, handshake_id, tool_name, intent_hash, preview_json, params_digest, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    consentId,
    req.request_id,
    req.handshake_id,
    req.tool_name,
    intentHash,
    canonicalJsonString(preview),
    paramsDigest(req.parameters),
    now.toISOString(),
  )
  return { consent_id: consentId, intent_hash: intentHash, preview }
}

/** Step 2 — the human tap. Binds the actor; without it, execution refuses. */
export function confirmExecutionConsent(
  db: any,
  consentId: string,
  actorWrdeskUserId: string,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: 'not_found' | 'already_consumed' } {
  ensureExecutionConsentSchema(db)
  const row = db
    .prepare(`SELECT consent_id, consumed_at FROM wr_execution_consents WHERE consent_id = ?`)
    .get(consentId) as { consent_id: string; consumed_at: string | null } | undefined
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.consumed_at) return { ok: false, reason: 'already_consumed' }
  db.prepare(
    `UPDATE wr_execution_consents SET consented_at = ?, actor_wrdesk_user_id = ? WHERE consent_id = ?`,
  ).run(now.toISOString(), actorWrdeskUserId, consentId)
  return { ok: true }
}

export type ConsentVerification =
  | { ok: true; consent: ExecutionConsentRow }
  | {
      ok: false
      reason:
        | 'CONSENT_NOT_FOUND'
        | 'CONSENT_NOT_TAPPED'
        | 'CONSENT_CONSUMED'
        | 'INTENT_HASH_MISMATCH'
    }

/**
 * Step 3 — gate check at the execution entry point. Recomputes the intent
 * hash from the request about to execute; divergence from the presented
 * preview invalidates the consent record [IX.19.2]. Single-use.
 */
export function verifyConsentForExecution(
  db: any,
  consentId: string,
  req: Parameters<typeof buildExecutionPreview>[0],
): ConsentVerification {
  ensureExecutionConsentSchema(db)
  const row = db
    .prepare(`SELECT * FROM wr_execution_consents WHERE consent_id = ?`)
    .get(consentId) as ExecutionConsentRow | undefined
  if (!row) return { ok: false, reason: 'CONSENT_NOT_FOUND' }
  if (row.consumed_at) return { ok: false, reason: 'CONSENT_CONSUMED' }
  if (!row.consented_at || !row.actor_wrdesk_user_id) {
    return { ok: false, reason: 'CONSENT_NOT_TAPPED' }
  }
  const executedIntentHash = computeIntentHash(buildExecutionPreview(req))
  if (executedIntentHash !== row.intent_hash) {
    return { ok: false, reason: 'INTENT_HASH_MISMATCH' }
  }
  return { ok: true, consent: row }
}

/** Step 4 — consume exactly once (called by the execution entry point). */
export function consumeExecutionConsent(db: any, consentId: string, now: Date = new Date()): void {
  ensureExecutionConsentSchema(db)
  db.prepare(`UPDATE wr_execution_consents SET consumed_at = ? WHERE consent_id = ? AND consumed_at IS NULL`).run(
    now.toISOString(),
    consentId,
  )
}
