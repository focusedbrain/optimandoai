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
import {
  listReadScopedAccountIds,
  loadRoleScopedTokens,
  type RoleScopedTokenRecord,
} from './roleScopedTokenStore'
import { resolveIngestionOwnershipWithLedger, type IngestionOwnership } from './ingestionOwnership'

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
  fetchOpaque?: (accountId: string, tokenRecord: RoleScopedTokenRecord) => Promise<SandboxFetchedMessage[]>
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
    readAccountId: string,
    msg: SandboxFetchedMessage,
    outcome: DepackageDispatchOutcome,
  ) => Promise<SandboxDeliveryResult>
  /** Resolve the read token. Default: `roleScopedTokenStore` role='read'. */
  loadReadToken?: (accountId: string) => RoleScopedTokenRecord | null
  /** List account ids with local read tokens (diagnostics). Default: `listReadScopedAccountIds`. */
  listReadScopedAccountIds?: () => string[]
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
  /** Host trigger send-account id — correlation/logging only; NOT used to select which sandbox read accounts to poll. */
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

function mergePollResults(into: SandboxIngestionResult, partial: SandboxIngestionResult): void {
  into.fetched += partial.fetched
  into.depackaged += partial.depackaged
  into.delivered += partial.delivered
  into.held += partial.held
  into.errors.push(...partial.errors)
  into.inboxMessageIds.push(...partial.inboxMessageIds)
}

function finalizeAggregatedPollStatus(partials: SandboxIngestionResult[]): Pick<SandboxIngestionResult, 'ok' | 'status'> {
  if (partials.length === 0) {
    return { ok: false, status: 'held_read_consent_missing' }
  }
  if (partials.every((p) => p.status === 'held_fetch_failed')) {
    return { ok: false, status: 'held_fetch_failed' }
  }
  return { ok: true, status: 'ok' }
}

/** Poll one sandbox read account (consent already verified for this id). */
async function pollOneSandboxReadAccount(
  readAccountId: string,
  triggerAccountId: string,
  deps: SandboxIngestionDeps,
  custodyPubKeyB64: string,
): Promise<SandboxIngestionResult> {
  const loadReadToken = deps.loadReadToken ?? ((id: string) => loadRoleScopedTokens(id, 'read'))
  const tokenRecord = loadReadToken(readAccountId)
  if (!tokenRecord) {
    sandboxLog(
      `skip read account=${readAccountId} — token missing mid-poll. trigger_account=${triggerAccountId}`,
    )
    return emptyResult('held_read_consent_missing', false)
  }

  const fetchOpaque = deps.fetchOpaque ?? defaultFetchOpaque
  const depackage =
    deps.depackage ??
    ((bytes: Buffer, key: string, form?: DepackageInputForm) =>
      dispatchDepackageEmail(bytes, key, undefined, form ?? {}))
  const deliverToHost = deps.deliverToHost ?? defaultDeliverToHost

  let fetched: SandboxFetchedMessage[]
  try {
    fetched = await fetchOpaque(readAccountId, tokenRecord)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    sandboxLog(
      `HELD — read fetch failed for account=${readAccountId} (fail closed; host does NOT fall back). trigger_account=${triggerAccountId} err=${msg}`,
    )
    return { ...emptyResult('held_fetch_failed', false), errors: [msg] }
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
  sandboxLog(
    `fetched ${fetched.length} message(s) with READ client. read_account=${readAccountId} trigger_account=${triggerAccountId}`,
  )

  for (const msg of fetched) {
    try {
      const outcome = await depackage(msg.opaqueBytes, custodyPubKeyB64, msg.form)
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

      const delivery = await deliverToHost(readAccountId, msg, outcome)
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
    `read account done read_account=${readAccountId} trigger_account=${triggerAccountId} fetched=${result.fetched} depackaged=${result.depackaged} delivered=${result.delivered} held=${result.held}`,
  )
  return result
}

/**
 * Run ONE sandbox-side ingestion poll for an account. Safe to call on any node:
 * it no-ops unless THIS node is the sandbox that owns ingestion. Never throws for
 * expected failure modes — it returns a typed HELD status (fail closed, INV-3).
 *
 * `options.accountId` is the host trigger send-account id (correlation/logging only).
 * The sandbox polls ALL of its own read-enabled accounts — send and receive ids differ
 * by design. TODO(option-b): map trigger_account → specific sandbox read account.
 */
export async function runSandboxIngestionPoll(
  options: SandboxIngestionOptions,
): Promise<SandboxIngestionResult> {
  const triggerAccountId = options.accountId
  const deps = options.deps ?? {}
  const ownership = deps.ownership ?? await resolveIngestionOwnershipWithLedger()

  if (!ownership.sandboxShouldReadPoll) {
    sandboxLog(
      `poll skipped — not the ingestion owner. trigger_account=${triggerAccountId} role=${ownership.thisNodeRole} owner=${ownership.owner}`,
    )
    return emptyResult('not_owner', true)
  }

  const loadReadToken = deps.loadReadToken ?? ((id: string) => loadRoleScopedTokens(id, 'read'))
  const listReadAccounts = deps.listReadScopedAccountIds ?? listReadScopedAccountIds
  const availableReadAccounts = listReadAccounts()
  // TODO(option-b): map trigger_account -> specific sandbox read account; MVP polls all read-enabled.
  const readAccountIds = availableReadAccounts.filter((id) => loadReadToken(id) != null)

  sandboxLog(
    `read-token lookup: trigger_account=${triggerAccountId} (correlation only) ` +
      `available_read_accounts=[${availableReadAccounts.join(',')}] ` +
      `read_enabled_accounts=[${readAccountIds.join(',')}] count=${readAccountIds.length}`,
  )

  if (readAccountIds.length === 0) {
    sandboxLog(
      `HELD — read consent missing (no read-enabled sandbox accounts). trigger_account=${triggerAccountId}`,
    )
    const r = emptyResult('held_read_consent_missing', false)
    _lastPollOutcomes.set(triggerAccountId, { result: r, at: Date.now() })
    return r
  }

  const custodyPubKeyB64 = deps.custodyPubKeyB64
  if (!custodyPubKeyB64) {
    sandboxLog(
      `HELD — no custody key (handshake local_x25519_public_key_b64 missing on sandbox). ` +
        `trigger_account=${triggerAccountId} action=re-pair host↔sandbox`,
    )
    const r = emptyResult('held_no_custody_key', false)
    _lastPollOutcomes.set(triggerAccountId, { result: r, at: Date.now() })
    return r
  }

  const partials: SandboxIngestionResult[] = []
  for (const readAccountId of readAccountIds) {
    sandboxLog(`polling read account=${readAccountId} trigger_account=${triggerAccountId}`)
    partials.push(await pollOneSandboxReadAccount(readAccountId, triggerAccountId, deps, custodyPubKeyB64))
  }

  const aggregated: SandboxIngestionResult = {
    ...emptyResult('ok', true),
    ...finalizeAggregatedPollStatus(partials),
  }
  for (const partial of partials) {
    mergePollResults(aggregated, partial)
  }

  sandboxLog(
    `poll done trigger_account=${triggerAccountId} read_accounts=${readAccountIds.length} ` +
      `fetched=${aggregated.fetched} depackaged=${aggregated.depackaged} delivered=${aggregated.delivered} held=${aggregated.held}`,
  )
  _lastPollOutcomes.set(triggerAccountId, { result: aggregated, at: Date.now() })
  for (let i = 0; i < readAccountIds.length; i++) {
    _lastPollOutcomes.set(readAccountIds[i], { result: partials[i], at: Date.now() })
  }
  return aggregated
}
