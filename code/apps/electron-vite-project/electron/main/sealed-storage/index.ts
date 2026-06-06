/**
 * Sealed Storage Gate — Phase B, PR B-2 (reject mode)
 *
 * Architectural reference: Phase B Sections 2.2, 2.4, 3.
 *
 * Key-access model (Decision 1 — Option 3a, Amendment to B-2):
 *   The gate holds a SealKeyProvider function registered at vault unlock.
 *   On each verification the provider is called, the returned key is used for
 *   one HMAC computation, then zeroized immediately.  No long-lived key copy
 *   exists in main-process memory.
 *
 * HMAC verification timing (Decision 2):
 *   Both write path (run()) and read path (sealedQuery()) verify seals.
 *
 * Mode: reject.  Writes without valid seals throw SealVerificationError and
 *   roll back the containing transaction.  Reads with invalid seals are
 *   filtered out and a TamperingEvent is recorded.
 *
 * There is NO environment flag, test mode, or bypass that disables rejection.
 * The gate is in reject mode in every environment, period.
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto'
import type { Database, Statement } from 'better-sqlite3'

// ─────────────────────────────────────────────────────────────────────────────
// Mode — PR B-2 flips this from 'log-only' to 'reject'
// ─────────────────────────────────────────────────────────────────────────────

export const SEALED_STORAGE_MODE: 'log-only' | 'reject' = 'reject'

// ─────────────────────────────────────────────────────────────────────────────
// Key Provider (Decision 1 — Option 3a)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synchronous function that derives the HMAC seal key on demand.
 * Returns the key or null if the vault is locked.
 * The gate calls this once per verification, uses the key, then zeroizes it.
 */
export type SealKeyProvider = () => Buffer | null

/**
 * Which key derivation path a sealed row uses.
 *
 * 'inner' — VMK-derived key (master-password vault, existing path).
 * 'outer' — Ledger-derived key (SSO session identity, new in W4-P9).
 *
 * The default across all APIs is 'inner' so that every existing caller
 * continues to work without modification.
 */
export type KeySource = 'inner' | 'outer'

interface SealProviderRegistry {
  inner: SealKeyProvider | null
  outer: SealKeyProvider | null
}

const _providers: SealProviderRegistry = {
  inner: null,
  outer: null,
}

/**
 * Thrown when a seal operation is attempted for a source whose provider is
 * not currently bound.  The `source` field lets consumers act on it
 * (e.g. capabilityBroker can distinguish inner vs. outer unavailability).
 */
export class SealKeyNotBoundError extends Error {
  readonly source: KeySource
  constructor(source: KeySource) {
    super(`Seal key provider for source '${source}' is not bound`)
    this.name = 'SealKeyNotBoundError'
    this.source = source
  }
}

/**
 * Register a key provider for the given source slot.
 *
 * 'inner' (default) — called by ValidatorOrchestrator after vault unlock.
 * 'outer'           — called by openLedger after SSO login.
 *
 * Both providers may be bound simultaneously (normal state when both vaults
 * are open).
 */
export function bindKeyProvider(fn: SealKeyProvider, source: KeySource = 'inner'): void {
  _providers[source] = fn
}

/**
 * Clear the provider for the given source slot.
 *
 * 'inner' (default) — called by ValidatorOrchestrator on stop().
 * 'outer'           — called by closeLedger on SSO logout.
 */
export function unbindKeyProvider(source: KeySource = 'inner'): void {
  _providers[source] = null
}

/** Returns true if the provider for the given source slot is currently bound. */
export function isKeyProviderBound(source: KeySource = 'inner'): boolean {
  return _providers[source] !== null
}

/** Bound and returns a non-empty key (guards stale inner binding after auto-lock). */
export function isKeyProviderUsable(source: KeySource = 'inner'): boolean {
  const p = _providers[source]
  if (p == null) return false
  const key = p()
  return key != null && key.length > 0
}

/**
 * Internal: invoke the provider for `source` and return the derived key,
 * or null if the slot is unbound or the provider returns null.
 */
function getKey(source: KeySource): Buffer | null {
  const p = _providers[source]
  if (p == null) return null
  return p()
}

/** Copy provider key for HMAC — callers must zeroize the copy, never the provider buffer. */
function sealKeyCopy(source: KeySource): Buffer | null {
  const key = getKey(source)
  if (key == null) return null
  return Buffer.from(key)
}

// ─────────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────────

export class SealVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SealVerificationError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tamper event log (structured; used by architecture tests for assertions)
// ─────────────────────────────────────────────────────────────────────────────

export type TamperReason =
  | 'missing_seal'
  | 'invalid_seal_input_json'
  | 'hmac_mismatch'
  | 'content_hash_mismatch'
  | 'row_id_mismatch'
  | 'no_canonical_column'
  | 'attachment_hash_mismatch'
  | 'metadata_hash_mismatch'

export interface TamperingEvent {
  readonly timestamp: string
  readonly reason: TamperReason
  readonly context: string
  readonly detail?: string
}

const _tamperingEvents: TamperingEvent[] = []

export function getTamperingEvents(): ReadonlyArray<TamperingEvent> {
  return _tamperingEvents
}

export function clearTamperingEvents(): void {
  _tamperingEvents.length = 0
}

function recordTamper(reason: TamperReason, context: string, detail?: string): void {
  _tamperingEvents.push({
    timestamp: new Date().toISOString(),
    reason,
    context,
    ...(detail ? { detail } : {}),
  })
  console.warn(
    `[SEALED_STORAGE] Tampering detected — reason=${reason} context="${context}"` +
    (detail ? ` detail="${detail}"` : ''),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal enforcement helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In reject mode: throw SealVerificationError with a clear message.
 * In log-only mode: log a warning (the write still proceeds).
 *
 * Returns true if the check passed (condition is true), false if it failed
 * in log-only mode (reject mode always throws on failure).
 */
function enforceOrWarn(condition: boolean, message: string): boolean {
  if (!condition) {
    if (SEALED_STORAGE_MODE === 'reject') {
      throw new SealVerificationError(`[SEALED_GATE] ${message}`)
    }
    console.warn(`[SEALED_STORAGE:log-only] ${message} — will REJECT when mode='reject'`)
    return false
  }
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal HMAC verification using the key provider
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify HMAC-SHA256 of sealInputJson against seal under the key returned by
 * the provider for `source`.  The key buffer is zeroized immediately in a
 * finally block.
 *
 * Throws SealVerificationError (reject mode) or logs warning (log-only mode)
 * if:
 *   - No key provider is bound for the given source
 *   - Provider returns null (vault locked)
 *   - HMAC does not match
 *
 * Returns true on success; false only in log-only mode on failure.
 */
function verifyHmacWithProvider(
  seal: string,
  sealInputJson: string,
  opContext: string,
  source: KeySource = 'inner',
): boolean {
  if (!_providers[source]) {
    return enforceOrWarn(
      false,
      `${opContext}: key provider not bound (source='${source}') — vault must be unlocked to perform sealed operations`,
    )
  }

  const key = sealKeyCopy(source)
  if (!key) {
    return enforceOrWarn(
      false,
      `${opContext}: key provider returned null (source='${source}') — vault is locked`,
    )
  }

  try {
    const recomputed = createHmac('sha256', key).update(sealInputJson, 'utf8').digest('base64')
    const a = Buffer.from(recomputed, 'base64')
    const b = Buffer.from(seal, 'base64')
    let valid = a.length === b.length
    if (valid) valid = timingSafeEqual(a, b) as boolean
    return enforceOrWarn(valid, `${opContext}: HMAC verification failed`)
  } finally {
    key.fill(0)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Write-path — SealBindParams and SealedStatement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Required parameters for every write through the gate.
 *
 * canonical_json: the exact content being written (for content_sha256 binding).
 * row_id: the target row's id (for row_id binding check — prevents replay).
 * seal: base64(HMAC-SHA256(seal_input_json, key)).
 * seal_input_json: the exact JSON that was HMAC'd by the validator subprocess.
 */
export interface SealBindParams {
  readonly seal: string
  readonly seal_input_json: string
  readonly canonical_json: string
  readonly row_id: string
}

export interface SealedRunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export class SealedStatement {
  private readonly _stmt: Statement
  private readonly _sql: string
  private readonly _operation: string

  constructor(stmt: Statement, sql: string, operation: string) {
    this._stmt = stmt
    this._sql = sql
    this._operation = operation
  }

  /**
   * Execute the sealed statement.  Verifies:
   *   1. All four seal parameters are present.
   *   2. seal_input_json.row_id === row_id (replay protection).
   *   3. sha256(canonical_json) === seal_input_json.content_sha256 (content binding).
   *   4. HMAC-SHA256(seal_input_json, key) === seal (forgery protection).
   *
   * @param source  Which key provider to use for HMAC verification.
   *                'inner' (default) — VMK-derived key (validator subprocess path).
   *                'outer'           — Ledger-derived key (SSO-only / non-confidential path).
   *
   * In reject mode any failure throws SealVerificationError and the
   * containing transaction rolls back.  In log-only mode failures are warned
   * and the write proceeds.
   */
  run(bindArgs: unknown[], sealParams: SealBindParams, source: KeySource = 'inner'): SealedRunResult {
    const ctx = `${this._operation} (${this._sql.slice(0, 60)})`

    // ── 1. Require key provider ──────────────────────────────────────────────
    if (!_providers[source]) {
      if (!enforceOrWarn(
        false,
        `${ctx}: key provider not bound (source='${source}') — vault must be unlocked for inbox writes`,
      )) {
        // log-only mode: proceed without verification
        return this._exec(bindArgs)
      }
    }

    // ── 2. Presence check ────────────────────────────────────────────────────
    const hasSeal = typeof sealParams?.seal === 'string' && sealParams.seal.length > 0
    const hasSealInput = typeof sealParams?.seal_input_json === 'string' && sealParams.seal_input_json.length > 0
    const hasCanonical = typeof sealParams?.canonical_json === 'string'
    const hasRowId = typeof sealParams?.row_id === 'string' && sealParams.row_id.length > 0

    if (!hasSeal || !hasSealInput || !hasCanonical || !hasRowId) {
      const missing = [
        !hasSeal && 'seal',
        !hasSealInput && 'seal_input_json',
        !hasCanonical && 'canonical_json',
        !hasRowId && 'row_id',
      ].filter(Boolean).join(', ')
      if (!enforceOrWarn(false, `${ctx}: missing required seal parameters: ${missing}`)) {
        return this._exec(bindArgs)
      }
      // reject mode: enforceOrWarn threw above
      return this._exec(bindArgs) // unreachable
    }

    // ── 3. Parse seal_input_json ─────────────────────────────────────────────
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(sealParams.seal_input_json) as Record<string, unknown>
    } catch {
      if (!enforceOrWarn(false, `${ctx}: seal_input_json is not valid JSON`)) {
        return this._exec(bindArgs)
      }
      return this._exec(bindArgs) // unreachable
    }

    // ── 4. Row ID binding check ──────────────────────────────────────────────
    if (!enforceOrWarn(
      parsed.row_id === sealParams.row_id,
      `${ctx}: row_id mismatch — seal binds "${String(parsed.row_id)}" but writing to "${sealParams.row_id}"`,
    ) && SEALED_STORAGE_MODE !== 'reject') {
      // log-only: warn issued; continue to next check
    }

    // ── 5. Content hash binding check ────────────────────────────────────────
    const actualHash = createHash('sha256').update(sealParams.canonical_json, 'utf8').digest('hex')
    if (!enforceOrWarn(
      parsed.content_sha256 === actualHash,
      `${ctx}: content_sha256 mismatch — seal binds "${String(parsed.content_sha256).slice(0, 16)}…" actual="${actualHash.slice(0, 16)}…"`,
    ) && SEALED_STORAGE_MODE !== 'reject') {
      // log-only: continue
    }

    // ── 6. HMAC verification ─────────────────────────────────────────────────
    if (!verifyHmacWithProvider(sealParams.seal, sealParams.seal_input_json, ctx, source) &&
        SEALED_STORAGE_MODE !== 'reject') {
      // log-only: HMAC failed but mode allows proceeding
    }

    return this._exec(bindArgs)
  }

  private _exec(bindArgs: unknown[]): SealedRunResult {
    const result = (this._stmt as any).run(...bindArgs) as { changes: number; lastInsertRowid: number | bigint }
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a seal for a new inbox row in the main process using the key
 * provider for `source`.  Used by the non-confidential (outer/ledger-key)
 * BEAP ingestion path to seal rows without going through the validator
 * subprocess (which requires the inner vault / VMK to be unlocked).
 *
 * The returned `{seal, seal_input_json}` can be passed directly to
 * `SealedStatement.run(bindArgs, params, source)`.
 *
 * Throws `SealKeyNotBoundError` if the provider for `source` is not bound.
 */
export function computeSeal(
  canonicalJson: string,
  rowId: string,
  source: KeySource = 'inner',
  /**
   * Optional out-of-canonical metadata to bind tamper-evidently into the seal
   * (e.g. the explicit pBEAP trust verdict stored in `depackaged_metadata`).
   * When a non-empty string is supplied, its SHA-256 is folded into the HMAC'd
   * `seal_input_json` as `meta_sha256`; the read path (`sealedQuery`) then
   * rejects any row whose stored metadata no longer hashes to that value.
   * Omitted / null / empty → no `meta_sha256` field (legacy behaviour, and the
   * read-side check is skipped for such rows — fully backward compatible).
   */
  boundMetadataJson?: string | null,
): { seal: string; seal_input_json: string } {
  const key = sealKeyCopy(source)
  if (key == null) throw new SealKeyNotBoundError(source)

  const content_sha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  const sealInput: Record<string, unknown> = {
    row_id: rowId,
    content_sha256,
    seal_source: source,
    sealed_at: new Date().toISOString(),
  }
  if (typeof boundMetadataJson === 'string' && boundMetadataJson.length > 0) {
    sealInput.meta_sha256 = createHash('sha256').update(boundMetadataJson, 'utf8').digest('hex')
  }
  const seal_input_json = JSON.stringify(sealInput)

  let seal: string
  try {
    seal = createHmac('sha256', key).update(seal_input_json, 'utf8').digest('base64')
  } finally {
    key.fill(0)
  }

  return { seal, seal_input_json }
}

export function prepareSealedInsert(db: Database, sql: string): SealedStatement {
  const stmt = db.prepare(sql)
  return new SealedStatement(stmt, sql, 'INSERT')
}

export function prepareSealedUpdate(db: Database, sql: string): SealedStatement {
  const stmt = db.prepare(sql)
  return new SealedStatement(stmt, sql, 'UPDATE')
}

// ─────────────────────────────────────────────────────────────────────────────
// Att-2 sealed transaction helper — Phase B, PR B-3.1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Descriptor for a child row (e.g. `inbox_attachments`) whose integrity is
 * covered by the parent message's seal under the Att-2 pattern.
 *
 * Att-2 canonical property: the parent message's `canonical_json` (which the
 * seal binds) MUST include each child attachment's `content_sha256` field so
 * that any post-write tampering with the child row's stored content is
 * detectable at read time via the parent seal.
 *
 * Child rows carry NO independent `seal` or `seal_input_json` columns.  Their
 * integrity is transitively guaranteed by the parent row's seal, provided that
 * the parent's canonical_json includes the attachment SHA-256 hashes.
 *
 * Usage pattern:
 *
 * ```typescript
 * runSealedTransaction(db, () => {
 *   sealedInbox.run(bindArgs, sealParams)          // sealed parent INSERT
 *   insertAtt.run(...)                              // raw child INSERT (covered)
 *   updateAttSha.run(sha256, attId)                 // raw child UPDATE (covered)
 * })
 * ```
 *
 * per Phase B Architecture, PR B-3.1, Gap 1, Option Att-2.
 */
export interface ChildAttachmentDescriptor {
  /** Attachment UUID (matches `inbox_attachments.id`). */
  readonly attachment_id: string
  /** Attachment filename (from email). */
  readonly filename: string
  /** MIME type string. */
  readonly content_type: string
  /** Byte size of original content. */
  readonly size_bytes: number
  /** SHA-256 hex digest of the raw attachment bytes. Null if no content. */
  readonly content_sha256: string | null
  /** SHA-256 hex digest of the extracted text. Null if not extracted. */
  readonly extracted_text_sha256?: string | null
}

/**
 * Execute a sealed transaction: verifies the parent seal, then runs all
 * child writes inside the same `db.transaction()`.
 *
 * Callers supply:
 *   - `sealedInsert`: the `SealedStatement` for the parent row.
 *   - `parentBindArgs` / `sealParams`: forwarded to `sealedInsert.run()`.
 *   - `childWrites`: zero or more functions that issue raw `db.prepare().run()`
 *     calls for child rows (attachment INSERT / UPDATE statements).
 *
 * The gate verifies the seal before the transaction opens.  If verification
 * fails in reject mode, `SealVerificationError` is thrown before any write
 * is attempted.  The db.transaction ensures all-or-nothing atomicity.
 *
 * Security guarantee: the parent's `canonical_json` (which the seal binds) must
 * include each child's `content_sha256`; otherwise child-row tampering is
 * undetectable.  Enforcing this is the caller's responsibility (the gate cannot
 * inspect the canonical_json structure at transaction time).
 */
export function runSealedTransaction(
  db: Database,
  sealedInsert: SealedStatement,
  parentBindArgs: unknown[],
  sealParams: SealBindParams,
  childWrites: ReadonlyArray<() => void>,
  source: KeySource = 'inner',
): SealedRunResult {
  let result: SealedRunResult | undefined
  const txn = (db as any).transaction(() => {
    result = sealedInsert.run(parentBindArgs, sealParams, source)
    for (const write of childWrites) {
      write()
    }
  })
  txn()
  return result!
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-path — sealedQuery
// ─────────────────────────────────────────────────────────────────────────────

export type SealedRow = Record<string, unknown> & {
  seal?: string | null
  seal_input_json?: string | null
  /**
   * Which key provider sealed this row. Written by the ingestion path at insert
   * time; read here to pick the correct provider at verification time.
   * 'vmk'    → inner (VMK-derived, master-password vault)
   * 'ledger' → outer (ledger-derived, SSO session identity)
   * undefined/null → treated as 'vmk' (defensive default for legacy rows).
   */
  seal_key_source?: string | null
}

/**
 * Map a row's `seal_key_source` to the corresponding KeySource for the
 * provider registry.  Defensive: NULL or any unknown value falls back to
 * 'inner' (the legacy behaviour, matching all rows written before W4-P10).
 */
function rowKeySource(row: SealedRow): KeySource {
  return row.seal_key_source === 'ledger' ? 'outer' : 'inner'
}

/**
 * Execute a SELECT and verify each row's seal.
 *
 * The SealVerifyContext parameter is REMOVED (vs PR B-1).  The gate uses the
 * module-level key provider for all verification.  There is no path to query
 * inbox-bound rows without verification in reject mode.
 *
 * In reject mode:
 *   - If no key provider is bound, throws SealVerificationError.
 *   - Rows with missing seals are filtered out (tamper event recorded).
 *   - Rows with invalid seals are filtered out (tamper event recorded).
 *   - Only rows with valid seals are returned.
 *
 * In log-only mode:
 *   - If no key provider is bound, rows are returned with a warning.
 *   - Rows with invalid seals trigger a warning but are returned.
 *
 * canonicalJsonColumn: the column name holding the content whose hash is
 * bound in the seal.  For inbox_messages this is 'depackaged_json'.
 */
export function sealedQuery<T extends SealedRow>(
  db: Database,
  sql: string,
  bindArgs: unknown[],
  canonicalJsonColumn: string,
  options?: { forceKeySource?: KeySource },
): T[] {
  const ctx = `sealedQuery (${sql.slice(0, 60)})`
  const innerProviderBound = _providers.inner != null
  const outerProviderBound = _providers.outer != null

  console.log(
    `[SEALED_QUERY] entry_gate mode=${SEALED_STORAGE_MODE} innerProviderBound=${innerProviderBound} outerProviderBound=${outerProviderBound} context=${ctx}`,
  )

  // Reject mode: at least one key provider must be bound (W4-P10 per-row source selection).
  if (SEALED_STORAGE_MODE === 'reject' && !innerProviderBound && !outerProviderBound) {
    throw new SealVerificationError(
      `${ctx}: no seal key provider bound (inner=false outer=false) — unlock vault or sign in for sealed reads`,
    )
  }

  const stmt = db.prepare(sql)
  const rows = (stmt as any).all(...bindArgs) as T[]

  if (!rows.length) return rows

  // ── Attachment query statement (PR B-7.3) ────────────────────────────────
  // Prepared once per sealedQuery call; used for rows that have
  // attachments_canonical in their canonical content.  Wrapped in try/catch
  // so that DBs without an inbox_attachments table (legacy, test) degrade
  // gracefully: attachment verification is skipped for those queries.
  let attQueryStmt: { all: (id: unknown) => Array<{ attachment_id: string; content_sha256: string | null }> } | null = null
  try {
    attQueryStmt = (db as any).prepare(
      'SELECT attachment_id, content_sha256 FROM inbox_attachments WHERE message_id = ?',
    ) as typeof attQueryStmt
  } catch {
    // inbox_attachments table not present — attachment verification disabled for this call.
  }

  const verified: T[] = []

  for (const row of rows) {
    const hasSeal = typeof row.seal === 'string' && row.seal.length > 0
    const hasSealInput = typeof row.seal_input_json === 'string' && row.seal_input_json.length > 0

    // ── Missing seal ─────────────────────────────────────────────────────────
    if (!hasSeal || !hasSealInput) {
      recordTamper('missing_seal', ctx)
      if (SEALED_STORAGE_MODE === 'reject') continue
      verified.push(row)
      continue
    }

    // ── Determine which key source this row uses ─────────────────────────────
    const source = options?.forceKeySource ?? rowKeySource(row)

    // ── No key provider for this row's seal_key_source ───────────────────────
    if (!_providers[source]) {
      recordTamper('missing_seal', ctx, `no_key_provider source='${source}'`)
      if (SEALED_STORAGE_MODE === 'reject') continue
      console.warn(`[SEALED_STORAGE:log-only] ${ctx}: no key provider bound (source='${source}'), skipping seal verification`)
      verified.push(row)
      continue
    }

    // ── Check canonical JSON column ──────────────────────────────────────────
    const canonicalJson = row[canonicalJsonColumn]
    if (typeof canonicalJson !== 'string') {
      recordTamper('no_canonical_column', ctx, `column="${canonicalJsonColumn}"`)
      if (SEALED_STORAGE_MODE === 'reject') continue
      verified.push(row)
      continue
    }

    // ── Parse seal_input_json ─────────────────────────────────────────────────
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(row.seal_input_json!) as Record<string, unknown>
    } catch {
      recordTamper('invalid_seal_input_json', ctx)
      if (SEALED_STORAGE_MODE === 'reject') continue
      verified.push(row)
      continue
    }

    // ── Content hash check ───────────────────────────────────────────────────
    const actualHash = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
    if (typeof parsed.content_sha256 !== 'string' || parsed.content_sha256 !== actualHash) {
      recordTamper('content_hash_mismatch', ctx, `stored="${String(parsed.content_sha256).slice(0, 16)}…"`)
      if (SEALED_STORAGE_MODE === 'reject') continue
      // log-only: fall through to HMAC check
    }

    // ── HMAC check ───────────────────────────────────────────────────────────
    const key = sealKeyCopy(source)
    if (!key) {
      recordTamper('missing_seal', ctx, `key_provider_null source='${source}'`)
      if (SEALED_STORAGE_MODE === 'reject') continue
      console.warn(`[SEALED_STORAGE:log-only] ${ctx}: vault locked (source='${source}'), skipping HMAC check`)
      verified.push(row)
      continue
    }
    let hmacValid = false
    try {
      const recomputed = createHmac('sha256', key).update(row.seal_input_json!, 'utf8').digest('base64')
      const a = Buffer.from(recomputed, 'base64')
      const b = Buffer.from(row.seal!, 'base64')
      if (a.length === b.length) hmacValid = timingSafeEqual(a, b) as boolean
    } finally {
      key.fill(0)
    }

    if (!hmacValid) {
      recordTamper('hmac_mismatch', ctx)
      if (SEALED_STORAGE_MODE === 'reject') continue
    }

    // ── Bound out-of-canonical metadata verification ──────────────────────────
    // When a row's seal binds `meta_sha256` (e.g. the pBEAP trust verdict stored
    // in `depackaged_metadata`, written via computeSeal's boundMetadataJson), the
    // HMAC above already authenticated that hash. Now confirm the stored metadata
    // still hashes to it — any post-write edit to depackaged_metadata (e.g. an
    // attacker upgrading unverified_public → verified_bound) is detected here.
    // Rows without `meta_sha256` (legacy / non-bound) skip this check.
    if (typeof parsed.meta_sha256 === 'string') {
      const storedMeta = typeof row['depackaged_metadata'] === 'string' ? (row['depackaged_metadata'] as string) : ''
      const actualMetaHash = createHash('sha256').update(storedMeta, 'utf8').digest('hex')
      if (actualMetaHash !== parsed.meta_sha256) {
        recordTamper('metadata_hash_mismatch', ctx, `row_id=${String(row['id'])} stored="${String(parsed.meta_sha256).slice(0, 16)}…"`)
        if (SEALED_STORAGE_MODE === 'reject') continue
      }
    }

    // ── Attachment hash verification (PR B-7.3) ───────────────────────────────
    // The parent seal is verified above.  `canonicalJson` is authenticated.
    // Now verify every attachment's `content_sha256` in `inbox_attachments`
    // against the `attachments_canonical` array that was bound by the seal.
    //
    // This check runs unconditionally for rows whose canonical content contains
    // an `attachments_canonical` array (sealed by B-5 / B-3.1 paths).  Old-shape
    // rows that pre-date `attachments_canonical` pass through without extra work.
    //
    // Decisions A–C from PR B-7.3: stored-hash-to-stored-hash comparison only;
    // no byte-level hashing at read time; mismatches filtered (reject mode) or
    // logged (log-only mode); tampering events logged but never surfaced in UI.
    if (attQueryStmt !== null) {
      let attTampered = false
      try {
        const parsedCanonical = JSON.parse(canonicalJson) as Record<string, unknown>
        const attachmentsCanonical = parsedCanonical['attachments_canonical']

        if (Array.isArray(attachmentsCanonical)) {
          const rowId = typeof row['id'] === 'string' ? row['id'] : null
          if (rowId !== null) {
            const attRows = attQueryStmt.all(rowId)

            // Build lookup maps: O(1) per attachment.
            const canonicalMap = new Map<string, string | null>()
            for (const entry of attachmentsCanonical as Array<Record<string, unknown>>) {
              const attId = typeof entry['attachment_id'] === 'string' ? entry['attachment_id'] : null
              if (attId !== null) {
                canonicalMap.set(attId, (entry['content_sha256'] as string | null) ?? null)
              }
            }
            const tableMap = new Map<string, string | null>()
            for (const att of attRows) {
              tableMap.set(att.attachment_id, att.content_sha256 ?? null)
            }

            // Each canonical entry must have a matching table row with the same hash.
            let mismatchDetail: string | null = null
            for (const [attId, canonicalHash] of canonicalMap) {
              if (!tableMap.has(attId)) {
                mismatchDetail = `missing attachment row: attachment_id=${attId}`
                break
              }
              const tableHash = tableMap.get(attId) ?? null
              if (tableHash !== canonicalHash) {
                mismatchDetail = `hash mismatch: attachment_id=${attId} expected="${String(canonicalHash).slice(0, 16)}…" actual="${String(tableHash).slice(0, 16)}…"`
                break
              }
            }

            // Each table row must have a matching canonical entry (no extra attachments).
            if (mismatchDetail === null) {
              for (const attId of tableMap.keys()) {
                if (!canonicalMap.has(attId)) {
                  mismatchDetail = `extra attachment row not in canonical: attachment_id=${attId}`
                  break
                }
              }
            }

            if (mismatchDetail !== null) {
              recordTamper('attachment_hash_mismatch', ctx, `row_id=${rowId} — ${mismatchDetail}`)
              attTampered = true
            }
          }
        }
      } catch {
        // canonicalJson already hash-verified above; JSON.parse should succeed.
        // Any other failure (unexpected schema) is non-fatal: skip attachment check.
      }

      if (attTampered && SEALED_STORAGE_MODE === 'reject') continue
    }

    verified.push(row)
  }

  return verified
}

// ─────────────────────────────────────────────────────────────────────────────
// Public verification utility — for tests and assertion helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Low-level seal verification with an explicitly supplied key.
 * Used by tests and by the gate's own logic.  Does NOT use the key provider.
 * Caller is responsible for zeroizing the key.
 */
export function verifySealAndContent(
  sealInputJson: string,
  expectedSeal: string,
  canonicalJson: string,
  key: Buffer,
): { hmacValid: boolean; contentHashValid: boolean } {
  let hmacValid = false
  let contentHashValid = false

  try {
    const recomputed = createHmac('sha256', key).update(sealInputJson, 'utf8').digest('base64')
    const a = Buffer.from(recomputed, 'base64')
    const b = Buffer.from(expectedSeal, 'base64')
    if (a.length === b.length) hmacValid = timingSafeEqual(a, b) as boolean
  } catch {
    hmacValid = false
  }

  if (hmacValid) {
    try {
      const parsed = JSON.parse(sealInputJson) as Record<string, unknown>
      const storedHash = typeof parsed.content_sha256 === 'string' ? parsed.content_sha256 : null
      if (storedHash) {
        const actualHash = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
        contentHashValid = actualHash === storedHash
      }
    } catch {
      contentHashValid = false
    }
  }

  return { hmacValid, contentHashValid }
}

// ─────────────────────────────────────────────────────────────────────────────
// Operational-update gate — Phase B, PR B-7.1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard-coded allowlist of inbox-table columns classified as operational
 * (non-content).  The gate rejects any `prepareSealedOperationalUpdate` call
 * whose SET clause includes a column not in this list.
 *
 * Adding a column requires a code change here — this is a code-review
 * boundary.  Content columns (seal, seal_input_json, depackaged_json,
 * ai_analysis_json, body_text, body_html, subject, attachments_canonical,
 * beap_package_json) MUST NOT appear.  Use `prepareSealedUpdate` with a
 * validator-produced seal for any content write.
 *
 * Phase B Architecture, PR B-7.1, Decision A.
 */
export const OPERATIONAL_COLUMNS_ALLOWLIST = [
  // User-facing operational state
  'read_status',
  'starred',
  'archived',
  'sort_category',
  'sort_reason',
  'pending_delete',
  'pending_delete_at',
  'pending_review',
  'pending_review_at',
  'urgency_score',
  'needs_reply',

  // Autosort / classification operational metadata
  'last_autosort_session_id',
  'autosort_pending',

  // IMAP linkage and remote queue state
  'email_message_id',
  'imap_uid',
  'imap_folder',
  'imap_remote_mailbox',
  'remote_orchestrator_last_error',

  // Lifecycle state (not content)
  'lifecycle_status',
  'lifecycle_updated_at',
  'lifecycle_exited_review_utc',
  'lifecycle_final_delete_queued_utc',
  'lifecycle_remote_delete_skip_reason',
  'embedding_status',

  // Soft-delete and remote-delete state (not content)
  'deleted',
  'deleted_at',
  'purge_after',
  'remote_deleted',
  'remote_deleted_at',

  // inbox_attachments operational columns
  'text_extraction_status',
  'text_extraction_error',
  'encryption_key',
  'encryption_iv',
  'encryption_tag',
  'storage_encrypted',

  // Denormalized message-level counts (updated during attachment resolution)
  'has_attachments',
  'attachment_count',

  // Account linkage (used for account-merge / migration operations)
  'account_id',
] as const

export type OperationalColumn = (typeof OPERATIONAL_COLUMNS_ALLOWLIST)[number]

/**
 * Parse the SET clause of an UPDATE statement and return the column names on
 * the left-hand side of each assignment.
 *
 * Handles: `SET col = ?`, `SET col1 = ?, col2 = NULL`, function calls such as
 * `COALESCE(?, col1)`, and single-quoted string literals on the RHS.
 *
 * Rejects: dynamic column names (e.g. template-literal column identifiers).
 * If the parser cannot extract a valid identifier before the `=` of an
 * assignment, it throws `SealVerificationError`.
 *
 * Limitation: does not handle subqueries on the RHS or column aliases, but
 * these patterns do not appear in the current production SQL corpus.
 */
export function extractColumnsFromSetClause(sql: string): string[] {
  const normalized = sql.replace(/\s+/g, ' ').trim()

  // Extract everything between the SET keyword and the first WHERE / ORDER BY /
  // LIMIT / end-of-string (case-insensitive, may span multiple lines).
  const setMatch = normalized.match(/\bSET\s+([\s\S]+?)(?:\s+WHERE\b|\s+ORDER\s+BY\b|\s+LIMIT\b|$)/i)
  if (!setMatch?.[1]) {
    throw new SealVerificationError(
      `Operational gate: cannot locate SET clause in SQL: "${sql.slice(0, 120)}"`,
    )
  }

  const setClause = setMatch[1].trim()
  const assignments = splitAtTopLevelCommas(setClause)
  const columns: string[] = []

  for (const assignment of assignments) {
    const trimmed = assignment.trim()
    // Column identifier must be an unquoted or backtick-quoted name immediately
    // before '='.  Template-literal ${…} patterns are rejected by this regex.
    const match = trimmed.match(/^`?([a-zA-Z_][a-zA-Z0-9_]*)`?\s*=/)
    if (!match) {
      throw new SealVerificationError(
        `Operational gate: cannot parse column from assignment "${trimmed.slice(0, 80)}". ` +
          `Dynamic column names are not supported — use a static literal.`,
      )
    }
    columns.push(match[1])
  }

  return columns
}

/** Split a comma-separated list while respecting nested parentheses and single-quoted string literals. */
function splitAtTopLevelCommas(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let inString = false
  let stringChar = ''
  let start = 0

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (ch === stringChar && s[i - 1] !== '\\') inString = false
    } else if (ch === "'" || ch === '"') {
      inString = true
      stringChar = ch
    } else if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
    } else if (ch === ',' && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts
}

/** Thin wrapper returned by `prepareSealedOperationalUpdate`.  Mirrors the
 *  better-sqlite3 `Statement` `.run()` interface but carries evidence that the
 *  allowlist check has been performed. */
export class SealedOperationalStatement {
  private readonly _stmt: Statement
  private readonly _columns: ReadonlyArray<string>

  constructor(stmt: Statement, columns: ReadonlyArray<string>) {
    this._stmt = stmt
    this._columns = columns
  }

  get columns(): ReadonlyArray<string> {
    return this._columns
  }

  run(...bindArgs: unknown[]): SealedRunResult {
    const result = (this._stmt as any).run(...bindArgs) as {
      changes: number
      lastInsertRowid: number | bigint
    }
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }
}

/**
 * Prepare an operational UPDATE statement that sets only allowlisted,
 * non-content columns.  The SET clause is parsed at call time; every column
 * must appear in `OPERATIONAL_COLUMNS_ALLOWLIST`.  Any content column (or any
 * column absent from the allowlist) causes an immediate `SealVerificationError`
 * before `.run()` is ever called.
 *
 * Operational updates do NOT modify `seal` or `seal_input_json` — the existing
 * seal remains valid because it binds only the canonical content fields, which
 * this API is structurally prevented from touching.
 *
 * Phase B Architecture, PR B-7.1, Decision B.
 *
 * @param db  - Open better-sqlite3 database handle.
 * @param sql - Static UPDATE SQL whose SET clause references only allowlisted
 *              operational columns.  Dynamic WHERE clauses (e.g. `IN (?)`) are
 *              acceptable; dynamic SET columns are not.
 */
export function prepareSealedOperationalUpdate(
  db: Database,
  sql: string,
): SealedOperationalStatement {
  const columns = extractColumnsFromSetClause(sql)
  for (const col of columns) {
    if (!(OPERATIONAL_COLUMNS_ALLOWLIST as ReadonlyArray<string>).includes(col)) {
      throw new SealVerificationError(
        `Operational gate rejects column '${col}': not in OPERATIONAL_COLUMNS_ALLOWLIST. ` +
          `If '${col}' is a content column use prepareSealedUpdate with a validator-produced seal. ` +
          `If '${col}' is operational, add it to OPERATIONAL_COLUMNS_ALLOWLIST in sealed-storage/index.ts.`,
      )
    }
  }
  const stmt = db.prepare(sql)
  return new SealedOperationalStatement(stmt, columns)
}
