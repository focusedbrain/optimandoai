/**
 * Prompt 3 — SANDBOX-side email ingestion poll (A2 multi-machine relocation).
 *
 * On a multi-machine / appliance topology the SANDBOX node owns email ingestion
 * (see `ingestionOwnership.ts`): it runs this poll using its READ client
 * (Prompt 2's `connectReadClient` / `roleScopedTokenStore` role='read'), fetches
 * mail, depackages LOCALLY (it is INSIDE the isolation boundary, so parsing here
 * is allowed — free-tier in-process inside its VM, paid bare-metal per-action
 * microVM per the resolution table), and returns the resulting BEAP to the HOST
 * inbox over the proven `critical_job_result` / handshake channel. Raw untrusted
 * mail therefore never touches the host.
 *
 * INVARIANTS enforced here:
 *   - This runs ONLY on the sandbox node that owns ingestion. If this node is not
 *     the owner it does NOTHING (the host's own gate in `syncOrchestrator` keeps
 *     the host from read-polling). (single source of truth: `resolveIngestionOwnership`)
 *   - INV-2: the read token is used LOCALLY only; it is never serialized onto the
 *     handshake wire (the wire-assertion in `remote/serialize.ts` is the backstop).
 *   - INV-3 (fail closed, NEVER silent fallback to host parsing): if the read
 *     consent is missing, the sandbox is offline, or the provider errors, this
 *     poll HELDs with a typed status — it does NOT, and CANNOT, hand the work
 *     back to the host to read-poll/parse. The host gate stays closed regardless.
 *   - INV-5: only ids/codes/counts are logged, never plaintext message content.
 *
 * The default fetch/deliver dependencies fail closed when the real two-machine
 * wiring is not present (that real-VM / real-hardware leg is the rig proof in
 * Prompt 5). Unit/harness tests inject working fetch + deliver fakes to prove the
 * end-to-end shape (host never fetches; sandbox fetches+depackages; BEAP lands in
 * the host inbox).
 */

import { dispatchDepackageEmail, type DepackageDispatchOutcome, type DepackageInputForm } from '../critical-jobs/liveDepackageCutover'
import { loadRoleScopedTokens, type RoleScopedTokenRecord } from './roleScopedTokenStore'
import { resolveIngestionOwnership, type IngestionOwnership } from './ingestionOwnership'
import type { OAuthTokens } from './secure-storage'

/** One opaque message blob the sandbox read client fetched. Bytes are NEVER parsed by this module. */
export interface SandboxFetchedMessage {
  id: string
  /** Opaque provider payload (raw RFC822 / provider-structured-json). */
  opaqueBytes: Buffer
  /** Which guest parser to run (routing only; default rfc822). */
  form?: DepackageInputForm
  /** Provider-native bookkeeping (received date / folder) — never derived from the bytes. */
  receivedAt?: string
  folder?: string
}

/** Result of delivering one depackaged message to the host inbox over the channel. */
export interface SandboxDeliveryResult {
  delivered: boolean
  /** `inbox_messages.id` the host wrote (when known/local). */
  inboxMessageId?: string
}

export interface SandboxIngestionDeps {
  /**
   * Fetch opaque message blobs with the sandbox READ client/token. Default fails
   * closed (real read-fetch wiring is the Prompt 5 rig leg) so production without
   * the rig HELDs rather than silently doing nothing.
   */
  fetchOpaque?: (accountId: string, readToken: OAuthTokens) => Promise<SandboxFetchedMessage[]>
  /**
   * Depackage one opaque blob LOCALLY → typed union. Default: `dispatchDepackageEmail`
   * (sandbox role → in-process inside the VM; paid → microVM; fails closed with
   * E_NO_EXECUTOR when no executor is available — never an in-process leak on host).
   */
  depackage?: (
    bytes: Buffer,
    custodyPubKeyB64: string,
    form?: DepackageInputForm,
  ) => Promise<DepackageDispatchOutcome>
  /**
   * Deliver the produced BEAP/result to the HOST inbox over the proven
   * `critical_job_result` / handshake return path. Default fails closed (rig leg,
   * Prompt 5). The host writes inbox rows exactly as today.
   */
  deliverToHost?: (
    msg: SandboxFetchedMessage,
    outcome: DepackageDispatchOutcome,
  ) => Promise<SandboxDeliveryResult>
  /** Resolve the read token. Default: `roleScopedTokenStore` role='read'. */
  loadReadToken?: (accountId: string) => RoleScopedTokenRecord | null
  /** Sandbox's OWN custody public key (sealing target for depackage artifacts). */
  custodyPubKeyB64?: string
  /** Override the ownership decision (tests/fixtures). */
  ownership?: IngestionOwnership
}

export type SandboxIngestionStatus =
  | 'ok'
  | 'not_owner'
  | 'held_read_consent_missing'
  | 'held_no_custody_key'
  | 'held_fetch_failed'

export interface SandboxIngestionResult {
  /** True only when this node owned ingestion and the poll ran without a fail-closed HELD. */
  ok: boolean
  status: SandboxIngestionStatus
  fetched: number
  depackaged: number
  delivered: number
  /** Messages HELD this round (depackage/deliver failure) — retried next poll, never host-parsed. */
  held: number
  errors: string[]
  /** Host inbox row ids delivered this run (when locally known — harness/single-box). */
  inboxMessageIds: string[]
}

export interface SandboxIngestionOptions {
  accountId: string
  deps?: SandboxIngestionDeps
}

function sandboxLog(...args: unknown[]): void {
  // INV-5: ids/codes/counts only — never message bytes.
  console.log('[SandboxIngestion]', ...args)
}

const defaultFetchOpaque: NonNullable<SandboxIngestionDeps['fetchOpaque']> = async () => {
  // Real read-client fetch over the read scope is the Prompt 5 rig leg. Until then
  // the default fails closed so a misconfigured multi-machine deploy HELDs.
  throw new Error('sandbox read-fetch not wired in this build (rig leg — Prompt 5)')
}

const defaultDeliverToHost: NonNullable<SandboxIngestionDeps['deliverToHost']> = async () => {
  // The BEAP→host return over a live two-machine handshake is the Prompt 5 rig
  // leg. Default fails closed (no silent drop, no host parse).
  throw new Error('sandbox→host BEAP return channel not wired in this build (rig leg — Prompt 5)')
}

function emptyResult(status: SandboxIngestionStatus, ok: boolean): SandboxIngestionResult {
  return { ok, status, fetched: 0, depackaged: 0, delivered: 0, held: 0, errors: [], inboxMessageIds: [] }
}

// ── Last-poll outcome store ────────────────────────────────────────────────
// Keyed by accountId. Written by runSandboxIngestionPoll at the end of every
// poll (including HELD/not_owner). Read by email:getIngestionStatus IPC to
// give the renderer a real-code signal rather than a guess. INV-5: only
// status codes, counters, and error counts — never message content.

interface LastPollRecord {
  result: SandboxIngestionResult
  at: number
}

const _lastPollOutcomes = new Map<string, LastPollRecord>()

/** All recorded per-account outcomes (for the IPC status aggregator). */
export function getLastSandboxPollOutcomes(): ReadonlyMap<string, LastPollRecord> {
  return _lastPollOutcomes
}

/** Test-only: clear the last-poll store between test cases. */
export function __resetLastSandboxPollOutcomesForTests(): void {
  _lastPollOutcomes.clear()
}

/**
 * Run ONE sandbox-side ingestion poll for an account. Safe to call on any node:
 * it no-ops unless THIS node is the sandbox that owns ingestion. Never throws for
 * expected failure modes — it returns a typed HELD status (fail closed, INV-3).
 */
export async function runSandboxIngestionPoll(
  options: SandboxIngestionOptions,
): Promise<SandboxIngestionResult> {
  const { accountId } = options
  const deps = options.deps ?? {}
  const ownership = deps.ownership ?? resolveIngestionOwnership()

  // Only the sandbox owner polls. (The host gate keeps the host from read-polling;
  // a non-owner sandbox simply has no ingestion responsibility.)
  if (!ownership.sandboxShouldReadPoll) {
    sandboxLog(`poll skipped — not the ingestion owner. account=${accountId} role=${ownership.thisNodeRole} owner=${ownership.owner}`)
    return emptyResult('not_owner', true)
  }

  // Read consent must be present locally. Missing → fail closed (HELD). NEVER hand
  // back to the host to read-poll untrusted mail.
  const loadReadToken = deps.loadReadToken ?? ((id: string) => loadRoleScopedTokens(id, 'read'))
  const tokenRecord = loadReadToken(accountId)
  if (!tokenRecord) {
    sandboxLog(`HELD — read consent missing (sandbox owns ingestion). account=${accountId}`)
    const r = emptyResult('held_read_consent_missing', false)
    _lastPollOutcomes.set(accountId, { result: r, at: Date.now() })
    return r
  }

  const custodyPubKeyB64 = deps.custodyPubKeyB64
  if (!custodyPubKeyB64) {
    sandboxLog(`HELD — no custody key to seal depackage artifacts. account=${accountId}`)
    const r = emptyResult('held_no_custody_key', false)
    _lastPollOutcomes.set(accountId, { result: r, at: Date.now() })
    return r
  }

  const fetchOpaque = deps.fetchOpaque ?? defaultFetchOpaque
  const depackage = deps.depackage ?? ((bytes: Buffer, key: string, form?: DepackageInputForm) => dispatchDepackageEmail(bytes, key, undefined, form ?? {}))
  const deliverToHost = deps.deliverToHost ?? defaultDeliverToHost

  let fetched: SandboxFetchedMessage[]
  try {
    fetched = await fetchOpaque(accountId, tokenRecord.tokens)
  } catch (err: unknown) {
    // Sandbox offline / provider error → fail closed. Host does NOT read-parse.
    const msg = err instanceof Error ? err.message : String(err)
    sandboxLog(`HELD — read fetch failed (fail closed; host does NOT fall back). account=${accountId} err=${msg}`)
    const r = { ...emptyResult('held_fetch_failed', false), errors: [msg] }
    _lastPollOutcomes.set(accountId, { result: r, at: Date.now() })
    return r
  }

  const result: SandboxIngestionResult = {
    ok: true,
    status: 'ok',
    fetched: fetched.length,
    depackaged: 0,
    delivered: 0,
    held: 0,
    errors: [],
    inboxMessageIds: [],
  }
  sandboxLog(`fetched ${fetched.length} message(s) with READ client. account=${accountId}`)

  for (const msg of fetched) {
    try {
      const outcome = await depackage(msg.opaqueBytes, custodyPubKeyB64, msg.form)
      // A dispatch/worker failure is HELD per message (retry next poll) — never a
      // host parse, never a silent drop.
      if (!outcome.ok) {
        result.held++
        result.errors.push(`${msg.id}: depackage dispatch failed (${outcome.code})`)
        sandboxLog(`HELD message — depackage dispatch failed. id=${msg.id} code=${outcome.code}`)
        continue
      }
      if (!outcome.result.ok) {
        result.held++
        result.errors.push(`${msg.id}: depackage worker failure (${outcome.result.code})`)
        sandboxLog(`HELD message — depackage worker failure. id=${msg.id} code=${outcome.result.code}`)
        continue
      }
      result.depackaged++

      const delivery = await deliverToHost(msg, outcome)
      if (delivery.delivered) {
        result.delivered++
        if (delivery.inboxMessageId) result.inboxMessageIds.push(delivery.inboxMessageId)
      } else {
        result.held++
        result.errors.push(`${msg.id}: host delivery not confirmed`)
        sandboxLog(`HELD message — host delivery not confirmed. id=${msg.id}`)
      }
    } catch (err: unknown) {
      result.held++
      const m = err instanceof Error ? err.message : String(err)
      result.errors.push(`${msg.id}: ${m}`)
      sandboxLog(`HELD message — error during depackage/deliver. id=${msg.id} err=${m}`)
    }
  }

  sandboxLog(
    `poll done account=${accountId} fetched=${result.fetched} depackaged=${result.depackaged} delivered=${result.delivered} held=${result.held}`,
  )
  _lastPollOutcomes.set(accountId, { result, at: Date.now() })
  return result
}
