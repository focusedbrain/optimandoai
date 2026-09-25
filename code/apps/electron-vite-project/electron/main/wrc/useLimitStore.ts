/**
 * §XVI.8.4 one-time-use state — use-limited entries, the claim cycle, and the
 * atomic compare-and-set.
 *
 * Authority: Annex XVI v1.95 (SHA256 064AAD6D…829F), §XVI.8.4. The profile
 * fields are the annex's own: `use_limit`, `use_scope`, `consume_at`,
 * `claim_timeout`, `require_live_resolution` (forced true for use-limited
 * entries — cached state may never present one). The declaration lives on the
 * ENTRY, never in the reference: a one-time WR Code is indistinguishable in
 * form from any other, and all carriers of the same entry share one counter.
 *
 * State machine (enforced against `entryLifecycle.ts`'s transition table):
 *
 *   ACTIVE ──claim (Gate 5, CAS)──▶ CLAIMED ──accept──▶ CONSUMED (limit hit)
 *     ▲                               │                  or, n > 1: decrement
 *     └── timeout / decline / any ────┘                  and return to ACTIVE
 *         post-claim gate failure
 *
 * The claim is atomic BY STATEMENT, not by caller discipline: one conditional
 * UPDATE whose WHERE clause is the compare, so two racing claimants can never
 * both see `changes = 1`. The loser reads the row back and receives the
 * deterministic CLAIMED_BY_OTHER (§XVI.8.4) with no material. Timeout release
 * is lazy — an expired reservation is claimable and reads as ACTIVE — so
 * there is no background timer whose failure would strand an entry.
 *
 * Idempotency (§XVI.8.4): a retry of the same claim or acceptance by the same
 * party (same `request_instance_id`) is not a second use.
 *
 * Terminal permanence (P11): CONSUMED and EXHAUSTED rows are never deleted or
 * reset; a code found later still tells the truth about itself.
 */

import { canTransitionEntryLifecycle } from './entryLifecycle'

// ── Profile (§XVI.8.4 declaration) ────────────────────────────────────────────

export type WrcUseScope = 'resolution' | 'context' | 'automation'
export type WrcConsumeAt = 'acceptance' | 'execution' | 'resolution'

export interface WrcUseLimitProfile {
  /** How many uses. Unbounded entries simply have NO declaration row. */
  use_limit: number
  use_scope: WrcUseScope
  consume_at: WrcConsumeAt
  /** How long a CLAIMED reservation holds before reverting to ACTIVE. */
  claim_timeout_s: number
  /** Forced for use-limited entries (§XVI.8.4): every capture resolves live. */
  require_live_resolution: true
}

/**
 * Pre-authorized operational default (§XVI.8.4 leaves the duration open):
 * conservative fail-closed 10 minutes — long enough for a consent dialog,
 * short enough that an abandoned reservation frees the entry the same
 * sitting. Configurable per deployment via `WRDESK_WRC_CLAIM_TIMEOUT_S`.
 */
export const WRC_DEFAULT_CLAIM_TIMEOUT_S = 600

export function defaultUseLimitProfile(useLimit = 1): WrcUseLimitProfile {
  const env = Number(process.env.WRDESK_WRC_CLAIM_TIMEOUT_S)
  return {
    use_limit: useLimit,
    use_scope: 'resolution',
    consume_at: 'acceptance',
    claim_timeout_s: Number.isFinite(env) && env > 0 ? env : WRC_DEFAULT_CLAIM_TIMEOUT_S,
    require_live_resolution: true,
  }
}

// ── Store contract ────────────────────────────────────────────────────────────

export type WrcUseState = 'active' | 'claimed' | 'consumed' | 'exhausted'

export interface WrcUseStateRow {
  publisher_part: string
  entry_id: string
  profile: WrcUseLimitProfile
  state: WrcUseState
  uses_taken: number
  claimed_by: string | null
  claimed_at_s: number | null
  claim_request_id: string | null
}

export type WrcClaimResult =
  | { ok: true; state: 'claimed' | 'consumed' }
  | {
      ok: false
      reason: 'CLAIMED_BY_OTHER' | 'CONSUMED' | 'CONTEXT_EXHAUSTED' | 'not_declared'
      claimedBy?: string | null
    }

export type WrcConsumeResult =
  | { ok: true; state: 'consumed' | 'exhausted' | 'active'; usesTaken: number }
  | { ok: false; reason: 'not_claimed_by_party' | 'CONSUMED' | 'CONTEXT_EXHAUSTED' | 'not_declared' }

export interface WrcUseLimitStore {
  /**
   * Issuer-side declaration. Idempotent on the profile; NEVER resets state or
   * counters — re-declaring a consumed entry does not resurrect it.
   */
  declare(publisherPart: string, entryId: string, profile: WrcUseLimitProfile): void
  /**
   * Gate-3 read: current posture with lazy timeout applied. Null when the
   * entry carries no declaration (unbounded default).
   */
  posture(
    publisherPart: string,
    entryId: string,
    nowS: number,
  ): { state: WrcUseState; claimed_by: string | null } | null
  /**
   * Gate-5 claim — the §XVI.8.4 atomic compare-and-set. Succeeds from ACTIVE
   * (or an EXPIRED reservation, or the same party's own live reservation);
   * a concurrent claimant receives CLAIMED_BY_OTHER and no material. For
   * `consume_at = resolution` (bearer) the claim consumes immediately.
   */
  claim(
    publisherPart: string,
    entryId: string,
    party: string,
    requestInstanceId: string | null,
    nowS: number,
  ): WrcClaimResult
  /**
   * Explicit acceptance (or execution, per `consume_at`): the use is taken.
   * `use_limit` reached → CONSUMED (resolution/context) or EXHAUSTED
   * (automation); for n > 1 the counter decrements and the entry returns to
   * ACTIVE. Idempotent per `request_instance_id`.
   */
  consume(
    publisherPart: string,
    entryId: string,
    party: string,
    requestInstanceId: string | null,
    nowS: number,
  ): WrcConsumeResult
  /**
   * Decline / post-claim gate failure / timeout housekeeping: the party's own
   * reservation reverts to ACTIVE. A failed verification never consumes a use.
   */
  release(publisherPart: string, entryId: string, party: string): void
  /** Test/inspection read of the raw row. */
  read(publisherPart: string, entryId: string): WrcUseStateRow | null
}

// ── Shared decision core ──────────────────────────────────────────────────────
//
// Both backends decide identically; what differs is only how the compare part
// of compare-and-set is made atomic (single SQL statement vs. the JS event
// loop's run-to-completion). Keeping the decision in one function keeps the
// two backends incapable of divergent semantics.

function claimExpired(row: WrcUseStateRow, nowS: number): boolean {
  return (
    row.state === 'claimed' &&
    row.claimed_at_s !== null &&
    row.claimed_at_s + row.profile.claim_timeout_s <= nowS
  )
}

/** Effective state with lazy timeout applied. */
function effectiveState(row: WrcUseStateRow, nowS: number): WrcUseState {
  return claimExpired(row, nowS) ? 'active' : row.state
}

function refusalFor(row: WrcUseStateRow, nowS: number): WrcClaimResult {
  const state = effectiveState(row, nowS)
  if (state === 'consumed') return { ok: false, reason: 'CONSUMED' }
  if (state === 'exhausted') return { ok: false, reason: 'CONTEXT_EXHAUSTED' }
  return { ok: false, reason: 'CLAIMED_BY_OTHER', claimedBy: row.claimed_by }
}

// ── In-memory backend ─────────────────────────────────────────────────────────

export function createMemoryUseLimitStore(): WrcUseLimitStore {
  const rows = new Map<string, WrcUseStateRow>()
  const keyOf = (p: string, e: string) => `${p}/${e}`

  return {
    declare(publisherPart, entryId, profile) {
      const key = keyOf(publisherPart, entryId)
      const existing = rows.get(key)
      if (existing) {
        existing.profile = { ...profile }
        return
      }
      rows.set(key, {
        publisher_part: publisherPart,
        entry_id: entryId,
        profile: { ...profile },
        state: 'active',
        uses_taken: 0,
        claimed_by: null,
        claimed_at_s: null,
        claim_request_id: null,
      })
    },

    posture(publisherPart, entryId, nowS) {
      const row = rows.get(keyOf(publisherPart, entryId))
      if (!row) return null
      const state = effectiveState(row, nowS)
      return { state, claimed_by: state === 'claimed' ? row.claimed_by : null }
    },

    claim(publisherPart, entryId, party, requestInstanceId, nowS) {
      const row = rows.get(keyOf(publisherPart, entryId))
      if (!row) return { ok: false, reason: 'not_declared' }

      const state = effectiveState(row, nowS)
      // Same party's live reservation: idempotent retry, not a second claim.
      if (row.state === 'claimed' && !claimExpired(row, nowS) && row.claimed_by === party) {
        return { ok: true, state: 'claimed' }
      }
      if (state !== 'active') return refusalFor(row, nowS)

      // The compare-and-set: under run-to-completion this block is atomic, and
      // it is the ONLY writer path from active → claimed.
      if (!canTransitionEntryLifecycle('active', 'claimed')) {
        return { ok: false, reason: 'not_declared' }
      }
      row.state = 'claimed'
      row.claimed_by = party
      row.claimed_at_s = nowS
      row.claim_request_id = requestInstanceId

      if (row.profile.consume_at === 'resolution') {
        // Bearer entries spend the use at resolution — deliberately not
        // recipient-bound; the trusted UI must mark them as bearer.
        return applyConsume(row, party, requestInstanceId)
      }
      return { ok: true, state: 'claimed' }
    },

    consume(publisherPart, entryId, party, requestInstanceId, nowS) {
      const row = rows.get(keyOf(publisherPart, entryId))
      if (!row) return { ok: false, reason: 'not_declared' }

      // Idempotent acceptance: the same completed use is not a second use.
      if (
        (row.state === 'consumed' || row.state === 'exhausted') &&
        requestInstanceId !== null &&
        row.claim_request_id === requestInstanceId
      ) {
        return { ok: true, state: row.state, usesTaken: row.uses_taken }
      }
      const state = effectiveState(row, nowS)
      if (state === 'consumed') return { ok: false, reason: 'CONSUMED' }
      if (state === 'exhausted') return { ok: false, reason: 'CONTEXT_EXHAUSTED' }
      if (state !== 'claimed' || row.claimed_by !== party) {
        return { ok: false, reason: 'not_claimed_by_party' }
      }
      const r = applyConsume(row, party, requestInstanceId)
      const settled: WrcUseState = row.state
      if (!r.ok || settled === 'claimed') return { ok: false, reason: 'not_claimed_by_party' }
      return { ok: true, state: settled, usesTaken: row.uses_taken }
    },

    release(publisherPart, entryId, party) {
      const row = rows.get(keyOf(publisherPart, entryId))
      if (!row) return
      if (row.state === 'claimed' && row.claimed_by === party) {
        // Revert, never consume: decline / gate failure / timeout path.
        row.state = 'active'
        row.claimed_by = null
        row.claimed_at_s = null
        row.claim_request_id = null
      }
    },

    read(publisherPart, entryId) {
      const row = rows.get(keyOf(publisherPart, entryId))
      return row ? { ...row, profile: { ...row.profile } } : null
    },
  }

  function applyConsume(
    row: WrcUseStateRow,
    party: string,
    requestInstanceId: string | null,
  ): WrcClaimResult {
    row.uses_taken += 1
    row.claim_request_id = requestInstanceId
    if (row.uses_taken >= row.profile.use_limit) {
      row.state = row.profile.use_scope === 'automation' ? 'exhausted' : 'consumed'
      row.claimed_by = party
      row.claimed_at_s = null
      return { ok: true, state: 'consumed' }
    }
    // n > 1: decrement and return to ACTIVE (§XVI.8.4).
    row.state = 'active'
    row.claimed_by = null
    row.claimed_at_s = null
    return { ok: true, state: 'consumed' }
  }
}

// ── Native-DB backend ─────────────────────────────────────────────────────────

/** Minimal shape so tests can pass a bare better-sqlite3 handle. */
export interface UseLimitDb {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown
    run: (...args: unknown[]) => { changes: number }
  }
}

interface DbRow {
  publisher_part: string
  entry_id: string
  use_limit: number
  use_scope: string
  consume_at: string
  claim_timeout_s: number
  state: string
  uses_taken: number
  claimed_by: string | null
  claimed_at_s: number | null
  claim_request_id: string | null
}

function rowFromDb(r: DbRow): WrcUseStateRow {
  return {
    publisher_part: r.publisher_part,
    entry_id: r.entry_id,
    profile: {
      use_limit: r.use_limit,
      use_scope: r.use_scope as WrcUseScope,
      consume_at: r.consume_at as WrcConsumeAt,
      claim_timeout_s: r.claim_timeout_s,
      require_live_resolution: true,
    },
    state: r.state as WrcUseState,
    uses_taken: r.uses_taken,
    claimed_by: r.claimed_by,
    claimed_at_s: r.claimed_at_s,
    claim_request_id: r.claim_request_id,
  }
}

/**
 * Native-DB store. The claim is one conditional UPDATE — the WHERE clause IS
 * the compare of the compare-and-set, so atomicity is a property of the
 * statement (better-sqlite3 statements are serialized on the connection),
 * never of caller discipline.
 */
export function createDbUseLimitStore(db: UseLimitDb): WrcUseLimitStore {
  const readRow = (p: string, e: string): WrcUseStateRow | null => {
    const r = db
      .prepare('SELECT * FROM wrc_entry_use_state WHERE publisher_part = ? AND entry_id = ?')
      .get(p, e) as DbRow | undefined
    return r ? rowFromDb(r) : null
  }

  const consume: WrcUseLimitStore['consume'] = (
    publisherPart,
    entryId,
    party,
    requestInstanceId,
    nowS,
  ) => {
    const row = readRow(publisherPart, entryId)
    if (!row) return { ok: false, reason: 'not_declared' }

    if (
      (row.state === 'consumed' || row.state === 'exhausted') &&
      requestInstanceId !== null &&
      row.claim_request_id === requestInstanceId
    ) {
      return { ok: true, state: row.state, usesTaken: row.uses_taken }
    }
    const state = effectiveState(row, nowS)
    if (state === 'consumed') return { ok: false, reason: 'CONSUMED' }
    if (state === 'exhausted') return { ok: false, reason: 'CONTEXT_EXHAUSTED' }

    const terminal = row.profile.use_scope === 'automation' ? 'exhausted' : 'consumed'
    const willTerminate = row.uses_taken + 1 >= row.profile.use_limit
    // Conditional on the party still holding the reservation — the compare
    // again lives in the statement.
    const res = db
      .prepare(
        `UPDATE wrc_entry_use_state
            SET uses_taken = uses_taken + 1,
                state = CASE WHEN uses_taken + 1 >= use_limit THEN ? ELSE 'active' END,
                claimed_by = CASE WHEN uses_taken + 1 >= use_limit THEN claimed_by ELSE NULL END,
                claimed_at_s = NULL,
                claim_request_id = ?,
                updated_at = ?
          WHERE publisher_part = ? AND entry_id = ?
            AND state = 'claimed' AND claimed_by = ?`,
      )
      .run(terminal, requestInstanceId, new Date().toISOString(), publisherPart, entryId, party)
    if (res.changes !== 1) return { ok: false, reason: 'not_claimed_by_party' }
    const after = readRow(publisherPart, entryId)!
    return {
      ok: true,
      state: willTerminate ? (terminal as 'consumed' | 'exhausted') : 'active',
      usesTaken: after.uses_taken,
    }
  }

  return {
    declare(publisherPart, entryId, profile) {
      // Profile upsert only — state and counters are untouched on conflict, so
      // a re-declaration can never resurrect a consumed identifier (P11).
      db.prepare(
        `INSERT INTO wrc_entry_use_state
           (publisher_part, entry_id, use_limit, use_scope, consume_at, claim_timeout_s,
            state, uses_taken, claimed_by, claimed_at_s, claim_request_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 0, NULL, NULL, NULL, ?)
         ON CONFLICT(publisher_part, entry_id) DO UPDATE SET
           use_limit = excluded.use_limit,
           use_scope = excluded.use_scope,
           consume_at = excluded.consume_at,
           claim_timeout_s = excluded.claim_timeout_s,
           updated_at = excluded.updated_at`,
      ).run(
        publisherPart,
        entryId,
        profile.use_limit,
        profile.use_scope,
        profile.consume_at,
        profile.claim_timeout_s,
        new Date().toISOString(),
      )
    },

    posture(publisherPart, entryId, nowS) {
      const row = readRow(publisherPart, entryId)
      if (!row) return null
      const state = effectiveState(row, nowS)
      return { state, claimed_by: state === 'claimed' ? row.claimed_by : null }
    },

    claim(publisherPart, entryId, party, requestInstanceId, nowS) {
      const row = readRow(publisherPart, entryId)
      if (!row) return { ok: false, reason: 'not_declared' }

      // Idempotent retry by the holder of a live reservation.
      if (row.state === 'claimed' && !claimExpired(row, nowS) && row.claimed_by === party) {
        return { ok: true, state: 'claimed' }
      }

      // THE compare-and-set: claimable ⇔ active, or a reservation whose
      // timeout has elapsed. Exactly one racing statement can match.
      const res = db
        .prepare(
          `UPDATE wrc_entry_use_state
              SET state = 'claimed', claimed_by = ?, claimed_at_s = ?, claim_request_id = ?,
                  updated_at = ?
            WHERE publisher_part = ? AND entry_id = ?
              AND (state = 'active'
                   OR (state = 'claimed' AND claimed_at_s + claim_timeout_s <= ?))`,
        )
        .run(
          party,
          nowS,
          requestInstanceId,
          new Date().toISOString(),
          publisherPart,
          entryId,
          nowS,
        )
      if (res.changes !== 1) {
        const lost = readRow(publisherPart, entryId)
        return lost ? refusalFor(lost, nowS) : { ok: false, reason: 'not_declared' }
      }

      if (row.profile.consume_at === 'resolution') {
        const consumed = consume(publisherPart, entryId, party, requestInstanceId, nowS)
        return consumed.ok
          ? { ok: true, state: 'consumed' }
          : { ok: false, reason: 'CONSUMED' }
      }
      return { ok: true, state: 'claimed' }
    },

    consume,

    release(publisherPart, entryId, party) {
      db.prepare(
        `UPDATE wrc_entry_use_state
            SET state = 'active', claimed_by = NULL, claimed_at_s = NULL,
                claim_request_id = NULL, updated_at = ?
          WHERE publisher_part = ? AND entry_id = ?
            AND state = 'claimed' AND claimed_by = ?`,
      ).run(new Date().toISOString(), publisherPart, entryId, party)
    },

    read(publisherPart, entryId) {
      return readRow(publisherPart, entryId)
    },
  }
}

/** True when the native table exists — used to fail loudly rather than silently. */
export function useLimitTablePresent(db: UseLimitDb): boolean {
  try {
    db.prepare('SELECT 1 FROM wrc_entry_use_state LIMIT 1').get()
    return true
  } catch {
    return false
  }
}
