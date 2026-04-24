/**
 * Outbound Capsule Queue — P2P context-sync delivery with retry.
 *
 * All outbound sends go through this queue. Never send directly from accept handler.
 * Table: outbound_capsule_queue (created by handshake migration v6).
 *
 * When use_coordination: target = coordination_url/beap/capsule, auth = OIDC token.
 * When !use_coordination: target = relay URL from queue, auth = handshake Bearer token.
 */

import {
  sendCapsuleViaHttp,
  sendCapsuleViaCoordination,
  describeOutboundPayloadForLogs,
  type SendCapsuleResult,
  type OutboundRequestDebugSnapshot,
  type CoordinationRelayDelivery,
} from './p2pTransport'
import { mapSendResultToQueueOutcome } from './relayQueueTransportOutcome'

export { mapSendResultToQueueOutcome, type CoordinationQueueTransportOutcome } from './relayQueueTransportOutcome'
import { getHandshakeRecord } from './db'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { getP2PConfig } from '../p2p/p2pConfig'
import { registerHandshakeWithRelay } from '../p2p/relaySync'
import {
  setP2PHealthOutboundSuccess,
  setP2PHealthOutboundFailure,
  setP2PHealthQueueCounts,
  formatP2PErrorForUser,
} from '../p2p/p2pHealth'
import {
  parseCoordinationRelayErrorSnippet,
  terminalRelayIdentityInvariant,
  isCoordinationStaleRegistry403,
} from './relayOutboundClassification'
import {
  validateInternalCapsuleBeforeEnqueue,
  type EnqueueOutboundCapsuleResult,
} from './internalRelayOutboundGuards'

export type { EnqueueOutboundCapsuleResult } from './internalRelayOutboundGuards'

const INITIAL_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 5 * 60 * 1000 // 5 minutes

/** Grep: `[Coordination][hs-trace]` — internal-handshake coordination outbound only (logging). */
function logInternalHsTraceOutbound(
  db: any,
  handshakeId: string,
  capsule: object,
  decision: string,
): void {
  try {
    const rec = getHandshakeRecord(db, handshakeId)
    if (rec?.handshake_type !== 'internal') return
    const cap = capsule as Record<string, unknown>
    let localDev = ''
    try {
      localDev = getInstanceId()?.trim() ?? ''
    } catch {
      /* non-Electron */
    }
    const localUser =
      rec.local_role === 'initiator'
        ? rec.initiator.wrdesk_user_id
        : (rec.acceptor?.wrdesk_user_id ?? '')
    console.log(
      '[Coordination][hs-trace]',
      JSON.stringify({
        trace: 'outbound_coordination_send',
        ts: new Date().toISOString(),
        handshake_id: handshakeId,
        handshake_type: rec.handshake_type,
        capsule_type: typeof cap.capsule_type === 'string' ? cap.capsule_type : null,
        sender_wrdesk_user_id:
          typeof cap.sender_wrdesk_user_id === 'string' ? cap.sender_wrdesk_user_id : null,
        local_wrdesk_user_id: localUser,
        sender_device_id: localDev || null,
        local_device_id: localDev || null,
        decision,
        local_role: rec.local_role,
      }),
    )
  } catch {
    /* non-fatal */
  }
}

function backoffDelay(retryCount: number): number {
  const delay = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, retryCount), MAX_BACKOFF_MS)
  return delay
}

/** Stable codes for IPC/diagnostics (additive; optional on each path). */
export type OutboundQueueCode =
  | 'BACKOFF_WAIT'
  /** Coordination: HTTP 200, recipient had a live matching WS and capsule was pushed. */
  | 'DELIVERED_LIVE'
  /**
   * Coordination: HTTP 202 — relay stored the capsule; recipient did not have a matching live WS
   * (not peer delivery). `relayTransportAccepted` is still true; local queue row is cleared.
   */
  | 'QUEUED_RECIPIENT_OFFLINE'
  /**
   * @deprecated Prefer `DELIVERED_LIVE` or `QUEUED_RECIPIENT_OFFLINE` for coordination; direct HTTP 200
   * uses `DELIVERED_LIVE`. Kept for legacy log greps.
   */
  | 'DELIVERED'
  | 'PREFLIGHT_FAILED'
  | 'TRANSPORT_FAILED'
  | 'AUTH_REQUIRED'
  | 'FAILED_MAX_RETRIES'
  /** Generic HTTP 400 — non-retryable client/request/payload rejection */
  | 'REQUEST_INVALID'
  /** HTTP 400 — relay rejected capsule_type (e.g. initiate or unknown); terminal */
  | 'RELAY_TYPE_NOT_ALLOWED'
  /** HTTP 400 / preflight — not a message package and not an allowed relay capsule_type; terminal */
  | 'OUT_OF_BAND_REQUIRED'
  /** HTTP 422 / 413 — payload or body too large for relay; reduce attachments or rely on canon inner chunking */
  | 'PAYLOAD_TOO_LARGE'

/** Classified failure for self-healing policy (best-effort). */
export type FailureClass =
  | 'AUTH_RECOVERABLE'
  | 'TRANSIENT_TRANSPORT'
  | 'THROTTLED'
  | 'STALE_ROUTE'
  | 'CONFIG_PERMANENT'
  | 'PAYLOAD_PERMANENT'
  /** HTTP 400 schema / contract mismatch (coordination envelope, missing routing fields) */
  | 'SCHEMA_PERMANENT'
  /** Size / limit at relay or validator — may be mitigated by smaller wire package or canon limits */
  | 'SIZE_RECOVERABLE'
  /** Deterministic handshake-bound protocol mismatch (ERR_HANDSHAKE_LOCAL_KEY_MISMATCH etc).
   *  Cannot self-heal — handshake must be re-established. Never retry automatically. */
  | 'PROTOCOL_PERMANENT'
  /** Stale-registry re-register already consumed for this queue row (403 RELAY_SENDER_UNAUTHORIZED path) */
  | 'COORD_REREG_ATTEMPTED'

export type HealingStatus =
  | 'idle'
  | 'scheduled'
  | 'auth_refreshing'
  | 'route_refreshing'
  | 'terminal_non_recoverable'
  /** HTTP 400 / contract mismatch — fix payload or config before retrying */
  | 'STOPPED_REQUIRES_FIX'
  /** Payload over limit — reduce attachments or send smaller package; no blind backoff retry */
  | 'RETRY_WITH_CHUNKING'
  /** Handshake-bound protocol mismatch — re-establish handshake, no retry possible */
  | 'STOPPED_PROTOCOL_MISMATCH'

/** Result of attempting to process one pending outbound capsule (oldest first). */
export interface ProcessOutboundQueueResult {
  delivered: boolean
  error?: string
  /** False when the row is marked failed (max retries); true when still pending / may retry */
  queued?: boolean
  code?: OutboundQueueCode
  /** Last persisted failure on the queue row (`outbound_capsule_queue.error`). */
  last_queue_error?: string | null
  retry_count?: number
  max_retries?: number
  /** ms until this row is eligible for the next attempt (backoff path only). */
  remaining_ms?: number
  /** ISO timestamp when the next automatic drain may succeed (backoff path). */
  next_retry_at?: string
  failure_class?: FailureClass
  healing_status?: HealingStatus
  /** Present when the last transport attempt returned this HTTP status (e.g. terminal 400). */
  http_status?: number
  /** Sanitized server error body fragment when available (no secrets). */
  response_body_snippet?: string
  /** Sanitized outbound POST diagnostics (when transport captured them). */
  outbound_debug?: OutboundRequestDebugSnapshot
  /** When relay returns capsule_type_not_allowed — derived type from DEBUG if present. */
  derived_outgoing_relay_capsule_type?: string | null
  /** Coordination relay: live WebSocket push vs stored while recipient offline. */
  coordinationRelayDelivery?: CoordinationRelayDelivery
  /**
   * True when the transport request succeeded and the local outbound row was marked `sent` (HTTP 2xx
   * to relay or 200 to direct P2P). **Includes HTTP 202** (recipient offline queue) — not peer live delivery.
   */
  relayTransportAccepted?: boolean
}

function jitterMs(max = 400): number {
  return Math.floor(Math.random() * max)
}

function classifySendFailure(
  statusCode: number | undefined,
  rawError: string,
  context: { noToken?: boolean; noCoordUrl?: boolean; invalidTarget?: boolean },
): FailureClass {
  if (context.noCoordUrl) return 'CONFIG_PERMANENT'
  if (context.noToken) return 'AUTH_RECOVERABLE'
  if (context.invalidTarget) return 'CONFIG_PERMANENT'
  if (statusCode === 401) return 'AUTH_RECOVERABLE'
  if (statusCode === 429) return 'THROTTLED'
  if (statusCode === 400) return 'PAYLOAD_PERMANENT'
  if (statusCode != null && statusCode >= 400 && statusCode < 500) return 'PAYLOAD_PERMANENT'
  const e = (rawError || '').toLowerCase()
  if (e.includes('econnrefused') || e.includes('enotfound') || e.includes('getaddrinfo')) return 'STALE_ROUTE'
  if (e.includes('timeout') || e.includes('aborted') || e.includes('fetch failed')) return 'TRANSIENT_TRANSPORT'
  if (statusCode != null && statusCode >= 500) return 'TRANSIENT_TRANSPORT'
  return 'TRANSIENT_TRANSPORT'
}

function shouldAutodrainOnBackoff(lastError: string | null, fc?: FailureClass): boolean {
  if (
    fc === 'CONFIG_PERMANENT' ||
    fc === 'PAYLOAD_PERMANENT' ||
    fc === 'SCHEMA_PERMANENT' ||
    fc === 'SIZE_RECOVERABLE' ||
    fc === 'PROTOCOL_PERMANENT'
  )
    return false
  if (!lastError) return true
  if (/^HTTP 400\b/i.test(lastError)) return false
  if (/Coordination URL not configured/i.test(lastError)) return false
  if (/Invalid package/i.test(lastError)) return false
  return true
}

/** Optional: call from main with `() => ensureSession()` so 401 coordination sends can refresh once. */
let _refreshSession: (() => Promise<void>) | undefined
export function setOutboundQueueAuthRefresh(fn?: (() => Promise<void>) | undefined): void {
  _refreshSession = fn
}

let _autoDrainTimer: ReturnType<typeof setTimeout> | null = null

/** @internal tests */
export function clearOutboundAutoDrainTimer(): void {
  if (_autoDrainTimer) {
    clearTimeout(_autoDrainTimer)
    _autoDrainTimer = null
  }
}

function scheduleAutoDrain(
  db: any,
  getOidcToken: (() => Promise<string | null>) | undefined,
  delayMs: number,
  meta: Record<string, unknown>,
): void {
  clearOutboundAutoDrainTimer()
  const total = Math.max(0, delayMs) + jitterMs(400)
  console.info('[P2P-QUEUE]', JSON.stringify({ event: 'backoff_autodrain_scheduled', delay_ms: total, ...meta }))
  _autoDrainTimer = setTimeout(() => {
    _autoDrainTimer = null
    console.info('[P2P-QUEUE]', JSON.stringify({ event: 'retry_attempt_started', trigger: 'auto', ...meta }))
    processOutboundQueue(db, getOidcToken).catch((e) =>
      console.warn('[P2P-QUEUE]', JSON.stringify({ event: 'autodrain_error', error: String(e) })),
    )
  }, total)
}

let _drainChain: Promise<unknown> = Promise.resolve()

export function enqueueOutboundCapsule(
  db: any,
  handshakeId: string,
  targetEndpoint: string,
  capsule: object,
): EnqueueOutboundCapsuleResult {
  if (!db) {
    return {
      enqueued: false,
      phase: 'enqueue_guard',
      invariant: 'INTERNAL_ENDPOINT_INCOMPLETE',
      message: 'Database unavailable',
      missing_fields: [],
    }
  }
  const guard = validateInternalCapsuleBeforeEnqueue(db, handshakeId, capsule)
  if (!guard.enqueued) {
    console.warn(
      '[P2P-QUEUE]',
      JSON.stringify({
        event: 'enqueue_blocked_internal_relay',
        handshake_id: handshakeId,
        phase: guard.phase,
        invariant: guard.invariant,
        message: guard.message,
        missing_fields: guard.missing_fields,
      }),
    )
    return guard
  }
  const now = new Date().toISOString()
  try {
    db.prepare(
      `INSERT INTO outbound_capsule_queue
       (handshake_id, target_endpoint, capsule_json, status, retry_count, max_retries, created_at)
       VALUES (?, ?, ?, 'pending', 0, 10, ?)`,
    ).run(handshakeId, targetEndpoint, JSON.stringify(capsule), now)
    console.log('[HANDSHAKE-DEBUG] enqueueOutboundCapsule persisted', handshakeId, 'target:', targetEndpoint)
    return { enqueued: true }
  } catch (err: any) {
    console.warn('[P2P] enqueueOutboundCapsule failed:', err?.message)
    return {
      enqueued: false,
      phase: 'enqueue_guard',
      invariant: 'ENQUEUE_DB_ERROR',
      message: err?.message ?? 'enqueue insert failed',
      missing_fields: [],
    }
  }
}

function getQueueCountsInternal(db: any): { pending: number; failed: number } {
  if (!db) return { pending: 0, failed: 0 }
  try {
    const rows = db.prepare(
      `SELECT status, COUNT(*) as cnt FROM outbound_capsule_queue GROUP BY status`,
    ).all() as Array<{ status: string; cnt: number }>
    let pending = 0
    let failed = 0
    for (const r of rows) {
      if (r.status === 'pending') pending = r.cnt
      else if (r.status === 'failed') failed = r.cnt
    }
    return { pending, failed }
  } catch {
    return { pending: 0, failed: 0 }
  }
}

/** Coordination path blocked before HTTP (no OIDC / no URL) — record attempt so rows are not stuck silent. */
function recordCoordinationPreflightFailure(
  db: any,
  row: { id: number; retry_count: number; max_retries: number },
  now: string,
  errorMsg: string,
  fc: FailureClass,
  getOidcToken?: () => Promise<string | null>,
): ProcessOutboundQueueResult {
  setP2PHealthOutboundFailure(errorMsg)
  const newRetry = row.retry_count + 1
  db.prepare(
    `UPDATE outbound_capsule_queue SET error = ?, last_attempt_at = ?, retry_count = ?, failure_class = ? WHERE id = ?`,
  ).run(errorMsg, now, newRetry, fc, row.id)
  if (newRetry >= row.max_retries) {
    db.prepare(`UPDATE outbound_capsule_queue SET status = 'failed' WHERE id = ?`).run(row.id)
  }
  const counts = getQueueCountsInternal(db)
  setP2PHealthQueueCounts(counts.pending, counts.failed)
  const failedMax = newRetry >= row.max_retries
  if (!failedMax && getOidcToken && shouldAutodrainOnBackoff(errorMsg, fc)) {
    scheduleAutoDrain(db, getOidcToken, backoffDelay(newRetry - 1), {
      queue_row_id: row.id,
      failure_class: fc,
      source: 'preflight',
    })
  }
  return {
    delivered: false,
    error: errorMsg,
    queued: !failedMax,
    code: failedMax ? 'FAILED_MAX_RETRIES' : 'PREFLIGHT_FAILED',
    last_queue_error: errorMsg,
    retry_count: newRetry,
    max_retries: row.max_retries,
    failure_class: fc,
    healing_status: failedMax ? 'terminal_non_recoverable' : 'idle',
  }
}

function logCoordination403Policy(extra: Record<string, unknown>): void {
  console.warn('[P2P-QUEUE]', JSON.stringify({ event: 'coordination_http_403_policy', ...extra }))
}

/**
 * Coordination 403: structured relay errors drive policy.
 * - Terminal identity invariants → fail row immediately (no re-register).
 * - Generic 403 without RELAY_SENDER_UNAUTHORIZED → terminal (no infinite re-register loop).
 * - Stale registry → one re-register + immediate resend; second stale403 or failed resend 403 → terminal.
 */
async function handleCoordinationOutbound403(
  db: any,
  row: {
    id: number
    handshake_id: string
    retry_count: number
    max_retries: number
    capsule_json: string
    failure_class: string | null
  },
  now: string,
  transportResult: SendCapsuleResult,
  coordinationUrl: string,
  getOidcToken: () => Promise<string | null>,
): Promise<
  | { done: true; result: ProcessOutboundQueueResult }
  | { done: false; nextResult: SendCapsuleResult }
> {
  const snip403 = (transportResult.responseBodySnippet ?? '').trim()
  const parsed403 = parseCoordinationRelayErrorSnippet(snip403)
  const invariant403 = terminalRelayIdentityInvariant(snip403, parsed403)

  const markSchemaTerminal = (
    persistedError: string,
    meta: Record<string, unknown>,
  ): ProcessOutboundQueueResult => {
    setP2PHealthOutboundFailure(persistedError)
    const n = row.retry_count + 1
    db.prepare(
      `UPDATE outbound_capsule_queue SET status = 'failed', retry_count = ?, last_attempt_at = ?, error = ?, failure_class = ?, retry_after_ms = NULL WHERE id = ?`,
    ).run(n, now, persistedError, 'SCHEMA_PERMANENT', row.id)
    const c = getQueueCountsInternal(db)
    setP2PHealthQueueCounts(c.pending, c.failed)
    logCoordination403Policy({
      queue_row_id: row.id,
      handshake_id: row.handshake_id,
      http_status: 403,
      terminal: true,
      ...meta,
    })
    return {
      delivered: false,
      error: persistedError,
      queued: false,
      code: 'REQUEST_INVALID',
      last_queue_error: persistedError,
      retry_count: n,
      max_retries: row.max_retries,
      failure_class: 'SCHEMA_PERMANENT',
      healing_status: 'STOPPED_REQUIRES_FIX',
      http_status: 403,
      ...(snip403.length > 0 && { response_body_snippet: snip403 }),
      ...(transportResult.outboundDebug && { outbound_debug: transportResult.outboundDebug }),
    }
  }

  if (invariant403) {
    const persistedError = `HTTP 403 — ${snip403 || invariant403}`
    return {
      done: true,
      result: markSchemaTerminal(persistedError, {
        retry_allowed: false,
        blocked_reason: 'terminal_relay_identity_invariant',
        invariant_code: invariant403,
        relay_error_code: parsed403.code,
        relay_error_field: parsed403.error,
      }),
    }
  }

  const stale403 = isCoordinationStaleRegistry403(snip403, parsed403)

  if (!stale403) {
    const persistedError = `HTTP 403 — ${snip403 || 'relay forbidden (no stale-registry signal); not re-registering'}`
    return {
      done: true,
      result: markSchemaTerminal(persistedError, {
        retry_allowed: false,
        blocked_reason: 'generic_forbidden_not_stale_registry',
        invariant_code: null,
        policy_note: 'Re-register is only allowed when body indicates RELAY_SENDER_UNAUTHORIZED',
      }),
    }
  }

  if (row.failure_class === 'COORD_REREG_ATTEMPTED') {
    const persistedError = `HTTP 403 — ${snip403 || 'RELAY_SENDER_UNAUTHORIZED after coordination re-register (exhausted)'}`
    return {
      done: true,
      result: markSchemaTerminal(persistedError, {
        retry_allowed: false,
        blocked_reason: 'stale_registry_reregister_exhausted',
        invariant_code: null,
      }),
    }
  }

  console.warn(
    '[P2P-QUEUE]',
    JSON.stringify({
      event: 'relay_403_reregister_attempt',
      queue_row_id: row.id,
      handshake_id: row.handshake_id,
      retry_allowed: true,
      blocked_reason: null,
      policy: 'stale_registry_one_shot',
    }),
  )

  const record = getHandshakeRecord(db, row.handshake_id)
  const freshToken = await getOidcToken()
  let reRegSucceeded = false
  if (record && freshToken?.trim()) {
    const initiatorId = record.initiator?.sub ?? record.initiator?.wrdesk_user_id ?? ''
    const acceptorId = record.acceptor?.sub ?? record.acceptor?.wrdesk_user_id ?? ''
    const initiatorEmail = record.initiator?.email ?? ''
    const acceptorEmail = record.acceptor?.email ?? ''
    try {
      const reReg = await registerHandshakeWithRelay(db, row.handshake_id, '', '', getOidcToken, {
        initiator_user_id: initiatorId,
        acceptor_user_id: acceptorId,
        initiator_email: initiatorEmail,
        acceptor_email: acceptorEmail,
        handshake_type: record.handshake_type === 'internal' ? 'internal' : undefined,
        ...(record.initiator_coordination_device_id?.trim()
          ? { initiator_device_id: record.initiator_coordination_device_id.trim() }
          : {}),
        ...(record.acceptor_coordination_device_id?.trim()
          ? { acceptor_device_id: record.acceptor_coordination_device_id.trim() }
          : {}),
      })
      if (reReg.success) {
        db.prepare(`UPDATE outbound_capsule_queue SET failure_class = ? WHERE id = ?`).run('COORD_REREG_ATTEMPTED', row.id)
        /* Trigger: stale-registry 403 recovery re-registered this handshake with relay — retry deferred initial context_sync for this id. */
        try {
          const { retryDeferredInitialContextSyncForInternalHandshake } = await import('./contextSyncEnqueue')
          const { getCurrentSession } = await import('./ipc')
          retryDeferredInitialContextSyncForInternalHandshake(
            db,
            row.handshake_id,
            getCurrentSession() ?? null,
            getOidcToken,
          )
        } catch (e: any) {
          console.warn('[P2P-QUEUE] retryDeferredInitialContextSync after re-register:', e?.message ?? e)
        }
        let capRetry: object
        try {
          capRetry = JSON.parse(row.capsule_json) as object
        } catch {
          const persistedError = 'HTTP 403 — invalid capsule_json in outbound queue after re-register'
          setP2PHealthOutboundFailure(persistedError)
          const n = row.retry_count + 1
          db.prepare(
            `UPDATE outbound_capsule_queue SET status = 'failed', retry_count = ?, last_attempt_at = ?, error = ?, failure_class = ?, retry_after_ms = NULL WHERE id = ?`,
          ).run(n, now, persistedError, 'SCHEMA_PERMANENT', row.id)
          const c = getQueueCountsInternal(db)
          setP2PHealthQueueCounts(c.pending, c.failed)
          logCoordination403Policy({
            queue_row_id: row.id,
            handshake_id: row.handshake_id,
            terminal: true,
            retry_allowed: false,
            blocked_reason: 'invalid_queue_capsule_json_after_reregister',
            invariant_code: null,
          })
          return {
            done: true,
            result: {
              delivered: false,
              error: persistedError,
              queued: false,
              code: 'REQUEST_INVALID',
              last_queue_error: persistedError,
              retry_count: n,
              max_retries: row.max_retries,
              failure_class: 'SCHEMA_PERMANENT',
              healing_status: 'STOPPED_REQUIRES_FIX',
              http_status: 403,
            },
          }
        }
        reRegSucceeded = true
        console.info(
          '[P2P-QUEUE]',
          JSON.stringify({ event: 'relay_403_reregister_success', queue_row_id: row.id, handshake_id: row.handshake_id }),
        )
        logInternalHsTraceOutbound(db, row.handshake_id, capRetry, 'send_after_403_reregister')
        const retryResult = await sendCapsuleViaCoordination(
          capRetry,
          coordinationUrl,
          freshToken,
          row.handshake_id,
          db,
        )
        if (retryResult.success) {
          setP2PHealthOutboundSuccess()
          db.prepare(
            `UPDATE outbound_capsule_queue SET status = 'sent', last_attempt_at = ?, retry_after_ms = NULL, failure_class = NULL WHERE id = ?`,
          ).run(now, row.id)
          const countsOk = getQueueCountsInternal(db)
          setP2PHealthQueueCounts(countsOk.pending, countsOk.failed)
          const outcome403 = mapSendResultToQueueOutcome(retryResult)
          console.info(
            '[P2P-QUEUE]',
            JSON.stringify({
              event: 'relay_403_retry_succeeded',
              queue_row_id: row.id,
              handshake_id: row.handshake_id,
              code: outcome403.code,
              delivered_peer_live: outcome403.delivered,
              relay_transport_ok: outcome403.relayTransportAccepted,
            }),
          )
          return {
            done: true,
            result: {
              ...outcome403,
              healing_status: 'idle',
            },
          }
        }
        if (retryResult.localRelayValidationFailed) {
          const persistedError = retryResult.error ?? 'LOCAL_INTERNAL_RELAY_VALIDATION_FAILED'
          setP2PHealthOutboundFailure(persistedError)
          const nLoc = row.retry_count + 1
          db.prepare(
            `UPDATE outbound_capsule_queue SET status = 'failed', retry_count = ?, last_attempt_at = ?, error = ?, failure_class = ?, retry_after_ms = NULL WHERE id = ?`,
          ).run(nLoc, now, persistedError, 'SCHEMA_PERMANENT', row.id)
          const cLoc = getQueueCountsInternal(db)
          setP2PHealthQueueCounts(cLoc.pending, cLoc.failed)
          return {
            done: true,
            result: {
              delivered: false,
              error: persistedError,
              queued: false,
              code: 'REQUEST_INVALID',
              last_queue_error: persistedError,
              retry_count: nLoc,
              max_retries: row.max_retries,
              failure_class: 'SCHEMA_PERMANENT',
              healing_status: 'STOPPED_REQUIRES_FIX',
              ...(retryResult.outboundDebug && { outbound_debug: retryResult.outboundDebug }),
            },
          }
        }
        const retrySnip = (retryResult.responseBodySnippet ?? '').trim()
        const retryParsed = parseCoordinationRelayErrorSnippet(retrySnip)
        const retryInv = terminalRelayIdentityInvariant(retrySnip, retryParsed)
        if (retryInv || retryResult.statusCode === 403) {
          const persistedError = `HTTP ${retryResult.statusCode ?? 403} — ${retrySnip || retryInv || 'forbidden after re-register'}`
          setP2PHealthOutboundFailure(persistedError)
          const n403 = row.retry_count + 1
          db.prepare(
            `UPDATE outbound_capsule_queue SET status = 'failed', retry_count = ?, last_attempt_at = ?, error = ?, failure_class = ?, retry_after_ms = NULL WHERE id = ?`,
          ).run(n403, now, persistedError, 'SCHEMA_PERMANENT', row.id)
          const c403 = getQueueCountsInternal(db)
          setP2PHealthQueueCounts(c403.pending, c403.failed)
          logCoordination403Policy({
            queue_row_id: row.id,
            handshake_id: row.handshake_id,
            http_status: retryResult.statusCode ?? 403,
            terminal: true,
            retry_allowed: false,
            blocked_reason: retryInv ? 'terminal_invariant_after_reregister' : 'forbidden_status_after_reregister',
            invariant_code: retryInv,
          })
          return {
            done: true,
            result: {
              delivered: false,
              error: persistedError,
              queued: false,
              code: 'REQUEST_INVALID',
              last_queue_error: persistedError,
              retry_count: n403,
              max_retries: row.max_retries,
              failure_class: 'SCHEMA_PERMANENT',
              healing_status: 'STOPPED_REQUIRES_FIX',
              http_status: retryResult.statusCode ?? 403,
              ...(retrySnip.length > 0 && { response_body_snippet: retrySnip }),
              ...(retryResult.outboundDebug && { outbound_debug: retryResult.outboundDebug }),
            },
          }
        }
        return { done: false, nextResult: retryResult }
      } else {
        console.error(
          '[P2P-QUEUE]',
          JSON.stringify({
            event: 'relay_403_reregister_failed',
            queue_row_id: row.id,
            handshake_id: row.handshake_id,
            error: reReg.error,
          }),
        )
      }
    } catch (reRegErr: any) {
      console.error(
        '[P2P-QUEUE]',
        JSON.stringify({
          event: 'relay_403_reregister_threw',
          queue_row_id: row.id,
          handshake_id: row.handshake_id,
          error: String(reRegErr?.message ?? reRegErr),
        }),
      )
    }
  } else {
    console.warn(
      '[P2P-QUEUE]',
      JSON.stringify({
        event: 'relay_403_reregister_skipped',
        queue_row_id: row.id,
        handshake_id: row.handshake_id,
        has_record: !!record,
        has_token: !!freshToken?.trim(),
      }),
    )
  }

  if (!reRegSucceeded) {
    const persistedError = 'HTTP 403 — relay rejected sender: handshake not registered. Re-registration failed.'
    setP2PHealthOutboundFailure(persistedError)
    const newRetry403 = row.retry_count + 1
    db.prepare(
      `UPDATE outbound_capsule_queue SET status = 'failed', retry_count = ?, last_attempt_at = ?, error = ?, failure_class = ?, retry_after_ms = NULL WHERE id = ?`,
    ).run(newRetry403, now, persistedError, 'PAYLOAD_PERMANENT', row.id)
    const counts403 = getQueueCountsInternal(db)
    setP2PHealthQueueCounts(counts403.pending, counts403.failed)
    logCoordination403Policy({
      queue_row_id: row.id,
      handshake_id: row.handshake_id,
      retry_allowed: false,
      blocked_reason: 're_register_failed_or_skipped',
      terminal: true,
    })
    return {
      done: true,
      result: {
        delivered: false,
        error: persistedError,
        queued: false,
        code: 'TRANSPORT_FAILED',
        last_queue_error: persistedError,
        retry_count: newRetry403,
        max_retries: row.max_retries,
        failure_class: 'PAYLOAD_PERMANENT',
        healing_status: 'terminal_non_recoverable',
        http_status: 403,
      },
    }
  }

  throw new Error('coordination 403 policy: unexpected fallthrough')
}

export async function processOutboundQueue(
  db: any,
  getOidcToken?: () => Promise<string | null>,
): Promise<ProcessOutboundQueueResult> {
  const run = _drainChain.then(() => processOutboundQueueInner(db, getOidcToken))
  _drainChain = run.then(() => {}).catch(() => {})
  return run as Promise<ProcessOutboundQueueResult>
}

async function processOutboundQueueInner(
  db: any,
  getOidcToken?: () => Promise<string | null>,
): Promise<ProcessOutboundQueueResult> {
  if (!db) return { delivered: false, error: 'Database unavailable', queued: false }
  try {
    const queueSize = getQueueCountsInternal(db).pending
    console.log('[HANDSHAKE-DEBUG] Processing outbound queue, items:', queueSize)
    const row = db.prepare(
      `SELECT id, handshake_id, target_endpoint, capsule_json, retry_count, max_retries, error,
              IFNULL(retry_after_ms, 0) AS retry_after_ms, failure_class
       FROM outbound_capsule_queue
       WHERE status = 'pending'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    ).get() as {
      id: number
      handshake_id: string
      target_endpoint: string
      capsule_json: string
      retry_count: number
      max_retries: number
      error: string | null
      retry_after_ms: number
      failure_class: string | null
    } | undefined

    if (!row) return { delivered: false, error: 'No pending capsule to process', queued: false }

    const now = new Date().toISOString()

    // Exponential backoff: skip if not enough time since last attempt
    const lastAttempt = db.prepare('SELECT last_attempt_at FROM outbound_capsule_queue WHERE id = ?').get(row.id) as { last_attempt_at: string | null } | undefined
    if (lastAttempt?.last_attempt_at && row.retry_count > 0) {
      const elapsed = Date.now() - Date.parse(lastAttempt.last_attempt_at)
      const baseBackoff = backoffDelay(row.retry_count - 1)
      const throttleExtra = row.retry_after_ms > 0 ? row.retry_after_ms : 0
      const required = Math.max(baseBackoff, throttleExtra)
      if (elapsed < required) {
        const remaining_ms = Math.max(0, required - elapsed)
        const last_queue_error = row.error ?? null
        const p2pCfg = getP2PConfig(db)
        const preview =
          last_queue_error && last_queue_error.length > 0
            ? last_queue_error.slice(0, 120)
            : null
        const last_queue_error_log =
          last_queue_error && last_queue_error.length > 512
            ? `${last_queue_error.slice(0, 512)}…`
            : last_queue_error
        const fc = (row.failure_class as FailureClass | undefined) || undefined
        console.info(
          '[P2P-QUEUE]',
          JSON.stringify({
            event: 'outbound_backoff',
            code: 'BACKOFF_WAIT',
            queue_row_id: row.id,
            handshake_id: row.handshake_id,
            retry_count: row.retry_count,
            max_retries: row.max_retries,
            required_ms: required,
            base_backoff_ms: baseBackoff,
            throttle_extra_ms: throttleExtra,
            elapsed_ms: elapsed,
            remaining_ms,
            last_queue_error: last_queue_error_log,
            last_error_preview: preview,
            last_error_len: last_queue_error?.length ?? 0,
            failure_class: fc ?? null,
            use_coordination: p2pCfg.use_coordination,
          }),
        )
        const next_retry_at = new Date(Date.now() + remaining_ms).toISOString()
        const healing_status: HealingStatus = 'scheduled'
        if (shouldAutodrainOnBackoff(last_queue_error, fc)) {
          scheduleAutoDrain(db, getOidcToken, remaining_ms, {
            queue_row_id: row.id,
            handshake_id: row.handshake_id,
            failure_class: fc,
          })
        }
        return {
          delivered: false,
          error: 'Delivery is waiting before retry — try again shortly',
          queued: true,
          code: 'BACKOFF_WAIT',
          last_queue_error,
          retry_count: row.retry_count,
          max_retries: row.max_retries,
          remaining_ms,
          next_retry_at,
          failure_class: fc,
          healing_status,
        }
      }
    }

    const capsule = JSON.parse(row.capsule_json) as object
    const config = getP2PConfig(db)
    console.log(
      `[P2P-QUEUE] Processing row ${row.id}, handshake ${row.handshake_id}, attempt ${row.retry_count + 1}`,
    )
    console.log(
      `[P2P-QUEUE] Config: use_coordination=${config.use_coordination}, coordination_url=${config.coordination_url}`,
    )
    let result: SendCapsuleResult

    if (config.use_coordination && getOidcToken) {
      const token = await getOidcToken()
      const targetUrl = config.coordination_url?.trim() ?? ''
      if (!token?.trim()) {
        console.warn(`[P2P-QUEUE] Early return: No OIDC token for row ${row.id}`)
        console.info(
          '[P2P-QUEUE]',
          JSON.stringify({ event: 'auth_refresh_attempt', reason: 'missing_token', queue_row_id: row.id }),
        )
        if (_refreshSession) {
          try {
            await _refreshSession()
            console.info('[P2P-QUEUE]', JSON.stringify({ event: 'auth_refresh_success', reason: 'missing_token', queue_row_id: row.id }))
          } catch (e: any) {
            console.warn(
              '[P2P-QUEUE]',
              JSON.stringify({ event: 'auth_refresh_failure', reason: 'missing_token', error: String(e?.message ?? e), queue_row_id: row.id }),
            )
          }
        }
        const token2 = await getOidcToken()
        if (token2?.trim() && targetUrl) {
          logInternalHsTraceOutbound(db, row.handshake_id, capsule, 'send_after_token_refresh')
          result = await sendCapsuleViaCoordination(capsule, targetUrl, token2, row.handshake_id, db)
        } else {
          return recordCoordinationPreflightFailure(
            db,
            row,
            now,
            'No OIDC token — please log in',
            'AUTH_RECOVERABLE',
            getOidcToken,
          )
        }
      } else if (!targetUrl) {
        console.warn(`[P2P-QUEUE] Early return: No coordination URL for row ${row.id}`)
        return recordCoordinationPreflightFailure(
          db,
          row,
          now,
          'Coordination URL not configured',
          'CONFIG_PERMANENT',
          getOidcToken,
        )
      } else {
        logInternalHsTraceOutbound(db, row.handshake_id, capsule, 'send_with_session_token')
        result = await sendCapsuleViaCoordination(capsule, targetUrl, token!, row.handshake_id, db)
      }

      if (targetUrl && result && !result.success && result.statusCode === 401 && _refreshSession) {
        console.info('[P2P-QUEUE]', JSON.stringify({ event: 'auth_refresh_attempt', reason: 'http_401', queue_row_id: row.id }))
        try {
          await _refreshSession()
          console.info('[P2P-QUEUE]', JSON.stringify({ event: 'auth_refresh_success', queue_row_id: row.id }))
        } catch (e: any) {
          console.warn(
            '[P2P-QUEUE]',
            JSON.stringify({ event: 'auth_refresh_failure', error: String(e?.message ?? e), queue_row_id: row.id }),
          )
        }
        const token3 = await getOidcToken()
        if (token3?.trim()) {
          logInternalHsTraceOutbound(db, row.handshake_id, capsule, 'send_after_401_refresh')
          result = await sendCapsuleViaCoordination(capsule, targetUrl, token3, row.handshake_id, db)
          console.info(
            '[P2P-QUEUE]',
            JSON.stringify({
              event: 'retry_attempt_started',
              trigger: 'auth_401_retry',
              queue_row_id: row.id,
              success: result.success,
            }),
          )
        }
      }
    } else {
      const record = getHandshakeRecord(db, row.handshake_id)
      // P2P Bearer auth is transport-only; renew tokens via handshake-refresh / delivery retry without changing handshake trust state.
      const bearerToken = record?.counterparty_p2p_token ?? null
      let endpoint = row.target_endpoint
      result = await sendCapsuleViaHttp(capsule, endpoint, row.handshake_id, bearerToken)
      const freshEp = record?.p2p_endpoint?.trim()
      const errText = (result.error ?? '').toLowerCase()
      if (
        !result.success &&
        freshEp &&
        freshEp !== endpoint.trim() &&
        /connection refused|econnrefused|enotfound|getaddrinfo|could not resolve/.test(errText)
      ) {
        console.info(
          '[P2P-QUEUE]',
          JSON.stringify({
            event: 'route_refresh_attempt',
            queue_row_id: row.id,
            handshake_id: row.handshake_id,
            old_endpoint: endpoint,
            new_endpoint: freshEp,
          }),
        )
        db.prepare(`UPDATE outbound_capsule_queue SET target_endpoint = ? WHERE id = ?`).run(freshEp, row.id)
        endpoint = freshEp
        result = await sendCapsuleViaHttp(capsule, endpoint, row.handshake_id, bearerToken)
        console.info(
          '[P2P-QUEUE]',
          JSON.stringify({
            event: result.success ? 'route_refresh_success' : 'route_refresh_failure',
            queue_row_id: row.id,
          }),
        )
      }
    }

    console.log(`[P2P-QUEUE] Transport result for row ${row.id}: ${JSON.stringify(result)}`)

    if (result.success) {
      setP2PHealthOutboundSuccess()
      // status 'sent' means the relay (or direct endpoint) accepted the payload — not that the peer live-received it (202 = queued for recipient WS).
      db.prepare(
        `UPDATE outbound_capsule_queue SET status = 'sent', last_attempt_at = ?, retry_after_ms = NULL, failure_class = NULL WHERE id = ?`,
      ).run(now, row.id)
      const counts = getQueueCountsInternal(db)
      setP2PHealthQueueCounts(counts.pending, counts.failed)
      const outcome = mapSendResultToQueueOutcome(result)
      console.info(
        '[P2P-QUEUE]',
        JSON.stringify({
          event: 'retry_attempt_succeeded',
          queue_row_id: row.id,
          handshake_id: row.handshake_id,
          code: outcome.code,
          delivered_peer_live: outcome.delivered,
          relay_transport_ok: outcome.relayTransportAccepted,
          coordination_relay: outcome.coordinationRelayDelivery ?? null,
        }),
      )
      return {
        ...outcome,
        healing_status: 'idle',
      }
    }

    if (!result.success && result.localRelayValidationFailed) {
      const persistedError = result.error ?? 'LOCAL_INTERNAL_RELAY_VALIDATION_FAILED'
      setP2PHealthOutboundFailure(persistedError)
      const nlv = row.retry_count + 1
      db.prepare(
        `UPDATE outbound_capsule_queue SET status = 'failed', retry_count = ?, last_attempt_at = ?, error = ?, failure_class = ?, retry_after_ms = NULL WHERE id = ?`,
      ).run(nlv, now, persistedError, 'SCHEMA_PERMANENT', row.id)
      const cLv = getQueueCountsInternal(db)
      setP2PHealthQueueCounts(cLv.pending, cLv.failed)
      console.warn(
        '[P2P-QUEUE]',
        JSON.stringify({
          event: 'local_relay_validation_terminal',
          queue_row_id: row.id,
          handshake_id: row.handshake_id,
          ...result.localRelayValidation,
        }),
      )
      return {
        delivered: false,
        error: persistedError,
        queued: false,
        code: 'REQUEST_INVALID',
        last_queue_error: persistedError,
        retry_count: nlv,
        max_retries: row.max_retries,
        failure_class: 'SCHEMA_PERMANENT',
        healing_status: 'STOPPED_REQUIRES_FIX',
        ...(result.outboundDebug && { outbound_debug: result.outboundDebug }),
      }
    }

    // HTTP 413 — request body too large for relay
    if (result.statusCode === 413) {
      const snippet = (result.responseBodySnippet ?? '').trim()
      const persistedError =
        snippet.length > 0 ? `HTTP 413 — ${snippet}` : 'HTTP 413 — request body too large for coordination relay.'
      setP2PHealthOutboundFailure(persistedError)
      const newRetry = row.retry_count + 1
      db.prepare(
        `UPDATE outbound_capsule_queue SET status = 'failed', retry_count = ?, last_attempt_at = ?, error = ?, failure_class = ?, retry_after_ms = NULL WHERE id = ?`,
      ).run(newRetry, now, persistedError, 'SIZE_RECOVERABLE', row.id)
      const counts413 = getQueueCountsInternal(db)
      setP2PHealthQueueCounts(counts413.pending, counts413.failed)
      return {
        delivered: false,
        error: persistedError,
        queued: false,
        code: 'PAYLOAD_TOO_LARGE',
        last_queue_error: persistedError,
        retry_count: newRetry,
        max_retries: row.max_retries,
        failure_class: 'SIZE_RECOVERABLE',
        healing_status: 'RETRY_WITH_CHUNKING',
        http_status: 413,
        ...(snippet.length > 0 && { response_body_snippet: snippet }),
        ...(result.outboundDebug && { outbound_debug: result.outboundDebug }),
      }
    }

    // HTTP 422 — structural / size validation at relay (ingestion-core)
    if (result.statusCode === 422) {
      const snippet = (result.responseBodySnippet ?? '').trim()
      const sizeHint = /PAYLOAD_SIZE|exceeds|size/i.test(snippet)
      const persistedError =
        snippet.length > 0
          ? `HTTP 422 — ${snippet}`
          : 'HTTP 422 — capsule rejected by relay validation (check size and schema).'
      setP2PHealthOutboundFailure(persistedError)
      const newRetry = row.retry_count + 1
      const fc: FailureClass = sizeHint ? 'SIZE_RECOVERABLE' : 'SCHEMA_PERMANENT'
      db.prepare(
        `UPDATE outbound_capsule_queue SET status = 'failed', retry_count = ?, last_attempt_at = ?, error = ?, failure_class = ?, retry_after_ms = NULL WHERE id = ?`,
      ).run(newRetry, now, persistedError, fc, row.id)
      const counts422 = getQueueCountsInternal(db)
      setP2PHealthQueueCounts(counts422.pending, counts422.failed)
      return {
        delivered: false,
        error: persistedError,
        queued: false,
        code: sizeHint ? 'PAYLOAD_TOO_LARGE' : 'REQUEST_INVALID',
        last_queue_error: persistedError,
        retry_count: newRetry,
        max_retries: row.max_retries,
        failure_class: fc,
        healing_status: sizeHint ? 'RETRY_WITH_CHUNKING' : 'STOPPED_REQUIRES_FIX',
        http_status: 422,
        ...(snippet.length > 0 && { response_body_snippet: snippet }),
        ...(result.outboundDebug && { outbound_debug: result.outboundDebug }),
      }
    }

    // HTTP 400 — bad request / validation: terminal, no backoff, no automatic retries
    if (result.statusCode === 400) {
      const snippet = (result.responseBodySnippet ?? '').trim()
      const identityInvariant400 = terminalRelayIdentityInvariant(snippet)
      const failureClass: FailureClass = 'SCHEMA_PERMANENT'
      const relayTypeNotAllowed =
        snippet.includes('capsule_type_not_allowed') || /"capsule_type_not_allowed"/.test(snippet)
      const outOfBandContract =
        snippet.includes('relay_coordination_contract_violation') ||
        /"relay_coordination_contract_violation"/.test(snippet)
      const queueCode: OutboundQueueCode = relayTypeNotAllowed
        ? 'RELAY_TYPE_NOT_ALLOWED'
        : outOfBandContract
          ? 'OUT_OF_BAND_REQUIRED'
          : 'REQUEST_INVALID'
      const persistedError =
        snippet.length > 0
          ? `HTTP 400 — ${snippet}`
          : 'HTTP 400 — Bad Request: the server rejected this request. Fix capsule content or handshake settings.'
      const userMessage = persistedError
      setP2PHealthOutboundFailure(userMessage)
      const newRetry = row.retry_count + 1
      db.prepare(
        `UPDATE outbound_capsule_queue SET status = 'failed', retry_count = ?, last_attempt_at = ?, error = ?, failure_class = ?, retry_after_ms = NULL WHERE id = ?`,
      ).run(newRetry, now, persistedError, failureClass, row.id)
      const counts400 = getQueueCountsInternal(db)
      setP2PHealthQueueCounts(counts400.pending, counts400.failed)
      let request_shape: ReturnType<typeof describeOutboundPayloadForLogs> | undefined
      try {
        request_shape = describeOutboundPayloadForLogs(JSON.parse(row.capsule_json) as object)
      } catch {
        request_shape = undefined
      }
      const derivedType =
        result.outboundDebug?.derived_relay_capsule_type !== undefined
          ? result.outboundDebug.derived_relay_capsule_type
          : undefined
      console.warn(
        '[P2P-QUEUE]',
        JSON.stringify({
          event: 'terminal_http_400',
          queue_row_id: row.id,
          handshake_id: row.handshake_id,
          statusCode: 400,
          failure_class: failureClass,
          terminal: true,
          response_body_snippet: snippet || undefined,
          request_shape,
          queue_code: queueCode,
          relay_type_not_allowed: relayTypeNotAllowed,
          retry_allowed: false,
          ...(identityInvariant400
            ? {
                blocked_reason: 'terminal_relay_identity_invariant',
                invariant_code: identityInvariant400,
              }
            : { blocked_reason: 'relay_validation_or_contract', invariant_code: null }),
        }),
      )
      return {
        delivered: false,
        error: userMessage,
        queued: false,
        code: queueCode,
        last_queue_error: persistedError,
        retry_count: newRetry,
        max_retries: row.max_retries,
        failure_class: failureClass,
        healing_status: 'STOPPED_REQUIRES_FIX',
        http_status: 400,
        ...(snippet.length > 0 && { response_body_snippet: snippet }),
        ...(result.outboundDebug && { outbound_debug: result.outboundDebug }),
        ...(derivedType !== undefined && { derived_outgoing_relay_capsule_type: derivedType }),
      }
    }

    // HTTP 403 — coordination: structured body classifies terminal identity vs one-shot stale-registry re-register.
    if (result.statusCode === 403 && config.use_coordination && getOidcToken) {
      const coordUrl = config.coordination_url?.trim() ?? ''
      if (coordUrl) {
        const r403 = await handleCoordinationOutbound403(db, row, now, result, coordUrl, getOidcToken)
        if (r403.done) return r403.result
        result = r403.nextResult
      }
    }

    const is401 = result.statusCode === 401
    const userError = is401
      ? 'Authentication failed — please log in again'
      : formatP2PErrorForUser(result.error ?? 'Unknown', row.target_endpoint)
    setP2PHealthOutboundFailure(userError)
    let queued = true

    const noCoordUrl =
      config.use_coordination && (!config.coordination_url?.trim() || config.coordination_url.trim().length === 0)
    const failureClass = classifySendFailure(result.statusCode, result.error ?? '', {
      noCoordUrl,
      noToken: false,
      invalidTarget: !row.target_endpoint?.trim(),
    })
    const throttleMs =
      result.statusCode === 429 && result.retryAfterSec != null && result.retryAfterSec >= 0
        ? Math.round(result.retryAfterSec * 1000)
        : null

    // 401 = auth issue — do not increment retry; leave pending for retry after re-auth
    if (is401) {
      db.prepare(
        `UPDATE outbound_capsule_queue SET last_attempt_at = ?, error = ?, failure_class = ?, retry_after_ms = NULL WHERE id = ?`,
      ).run(now, userError, 'AUTH_RECOVERABLE', row.id)
      const counts401 = getQueueCountsInternal(db)
      setP2PHealthQueueCounts(counts401.pending, counts401.failed)
      return {
        delivered: false,
        error: userError,
        queued: true,
        code: 'AUTH_REQUIRED',
        last_queue_error: userError,
        retry_count: row.retry_count,
        max_retries: row.max_retries,
        failure_class: 'AUTH_RECOVERABLE',
        healing_status: 'idle',
        ...(result.outboundDebug && { outbound_debug: result.outboundDebug }),
      }
    }

    const postTransportSnippet = (result.responseBodySnippet ?? '').trim()
    const postTransportParsed = parseCoordinationRelayErrorSnippet(postTransportSnippet)
    const postTransportInvariant = terminalRelayIdentityInvariant(postTransportSnippet, postTransportParsed)

    const newRetry = row.retry_count + 1
    const isFailed = newRetry >= row.max_retries
    const autodrainOk = !isFailed && shouldAutodrainOnBackoff(userError, failureClass)

    console.info(
      '[P2P-QUEUE]',
      JSON.stringify({
        event: 'retry_attempt_failed',
        queue_row_id: row.id,
        handshake_id: row.handshake_id,
        status_code: result.statusCode ?? null,
        failure_class: failureClass,
        persisted_queue_failure_class: row.failure_class ?? null,
        relay_identity_invariant_code: postTransportInvariant,
        relay_error_code: postTransportParsed.code,
        relay_error_field: postTransportParsed.error,
        retry_allowed_next: !isFailed,
        autodrain_scheduled_next: autodrainOk,
        blocked_reason: isFailed
          ? 'max_retries_exhausted'
          : !autodrainOk
            ? 'backoff_autodrain_suppressed'
            : null,
      }),
    )

    if (isFailed) {
      queued = false
      console.warn(
        '[P2P-QUEUE]',
        JSON.stringify({
          event: 'terminal_non_recoverable',
          queue_row_id: row.id,
          handshake_id: row.handshake_id,
          reason: 'max_retries',
          failure_class: failureClass,
        }),
      )
      console.warn('[P2P] Outbound capsule failed after max retries', {
        handshake_id: row.handshake_id,
        retries: newRetry,
        error: result.error,
      })
      db.prepare(
        `UPDATE outbound_capsule_queue SET status = 'failed', retry_count = ?, last_attempt_at = ?, error = ?, failure_class = ?, retry_after_ms = ? WHERE id = ?`,
      ).run(newRetry, now, userError, failureClass, throttleMs, row.id)
    } else {
      db.prepare(
        `UPDATE outbound_capsule_queue SET retry_count = ?, last_attempt_at = ?, error = ?, failure_class = ?, retry_after_ms = ? WHERE id = ?`,
      ).run(newRetry, now, userError, failureClass, throttleMs, row.id)
    }

    const counts = getQueueCountsInternal(db)
    setP2PHealthQueueCounts(counts.pending, counts.failed)
    const failedMax = !queued
    const updatedRetryCount = newRetry
    const healing_status: HealingStatus = failedMax
      ? 'terminal_non_recoverable'
      : failureClass === 'CONFIG_PERMANENT' || failureClass === 'PAYLOAD_PERMANENT'
        ? 'terminal_non_recoverable'
        : 'scheduled'

    if (!failedMax && shouldAutodrainOnBackoff(userError, failureClass)) {
      scheduleAutoDrain(db, getOidcToken, backoffDelay(updatedRetryCount - 1), {
        queue_row_id: row.id,
        handshake_id: row.handshake_id,
        failure_class: failureClass,
        source: 'post_transport',
      })
    }

    return {
      delivered: false,
      error: userError,
      queued,
      code: failedMax ? 'FAILED_MAX_RETRIES' : 'TRANSPORT_FAILED',
      last_queue_error: userError,
      retry_count: updatedRetryCount,
      max_retries: row.max_retries,
      failure_class: failureClass,
      healing_status,
      ...(result.outboundDebug && { outbound_debug: result.outboundDebug }),
      ...(throttleMs != null && throttleMs > 0
        ? {
            next_retry_at: new Date(Date.now() + Math.max(backoffDelay(updatedRetryCount - 1), throttleMs)).toISOString(),
          }
        : {}),
    }
  } catch (err: any) {
    console.warn('[P2P] processOutboundQueue error:', err?.message)
    setP2PHealthOutboundFailure(err?.message ?? 'Unknown error')
    const msg = err?.message ?? 'Unknown error'
    return {
      delivered: false,
      error: msg,
      queued: true,
      code: 'TRANSPORT_FAILED',
      last_queue_error: msg,
    }
  }
}

export function getQueueStatus(db: any, handshakeId: string): { pending: number; sent: number; failed: number } {
  if (!db) return { pending: 0, sent: 0, failed: 0 }
  try {
    const rows = db.prepare(
      `SELECT status, COUNT(*) as cnt FROM outbound_capsule_queue WHERE handshake_id = ? GROUP BY status`,
    ).all(handshakeId) as Array<{ status: string; cnt: number }>
    const out = { pending: 0, sent: 0, failed: 0 }
    for (const r of rows) {
      if (r.status === 'pending') out.pending = r.cnt
      else if (r.status === 'sent') out.sent = r.cnt
      else if (r.status === 'failed') out.failed = r.cnt
    }
    return out
  } catch {
    return { pending: 0, sent: 0, failed: 0 }
  }
}

export interface QueueEntry {
  id: number
  handshake_id: string
  status: 'pending' | 'sent' | 'failed'
  retry_count: number
  error: string | null
  last_attempt_at: string | null
}

export function getQueueEntries(db: any, handshakeId: string): QueueEntry[] {
  if (!db) return []
  try {
    const rows = db.prepare(
      `SELECT id, handshake_id, status, retry_count, error, last_attempt_at
       FROM outbound_capsule_queue WHERE handshake_id = ?
       ORDER BY created_at DESC`,
    ).all(handshakeId) as Array<{ id: number; handshake_id: string; status: string; retry_count: number; error: string | null; last_attempt_at: string | null }>
    return rows.map((r) => ({
      id: r.id,
      handshake_id: r.handshake_id,
      status: r.status as 'pending' | 'sent' | 'failed',
      retry_count: r.retry_count,
      error: r.error,
      last_attempt_at: r.last_attempt_at,
    }))
  } catch {
    return []
  }
}
