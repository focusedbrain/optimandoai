/**
 * UX-1 — Email ingestion status (Deliverable 1).
 *
 * The typed enum the renderer consumes to surface correct guidance to the user:
 * "ACTION NEEDED — connect a read account on your sandbox", "Inbox paused",
 * "OK — your sandbox is fetching mail", etc.
 *
 * Every state maps 1:1 to a real, existing code reason:
 *
 *   OK_SINGLE_MACHINE          ← owner='host', hostShouldReadPoll=true
 *                                 (ingestionOwnership.ts:105–113)
 *   OK_SANDBOX_FETCHING        ← sandboxShouldReadPoll=true, last poll ok,
 *                                 delivered > 0 OR ok with 0 held
 *                                 (sandboxIngestion.ts status='ok')
 *   ACTION_NEEDED_READ_CONSENT ← sandboxShouldReadPoll=true, read consent
 *                                 absent (sandboxIngestion.ts:183–186,
 *                                 held_read_consent_missing)
 *   PAUSED_SANDBOX_UNREACHABLE ← sandbox owns, fetch/delivery failing
 *                                 (sandboxIngestion.ts:203–210 held_fetch_failed,
 *                                 or delivery errors with ok:false)
 *   PAUSED_HOST_DELEGATED      ← this node is host, host correctly not polling,
 *                                 sandbox not yet confirmed fetching
 *                                 (syncOrchestrator.ts:466 ingestion_delegated_to_sandbox)
 *   DEGRADED_HELD_MESSAGES     ← fetch ok, but per-message depackage/deliver
 *                                 failures (sandboxIngestion.ts held > 0, status='ok')
 *
 * INV-5: result carries reasons/counters only — never message content, tokens,
 * or any Annex I PII. Callers must not log IngestionAccountStatus.lastPollErrors.
 *
 * Surfacing only — this module reads ownership/token state but NEVER changes it.
 * If a logic gap is found, STOP and report (per UX-1 spec).
 */

import { resolveIngestionOwnershipWithLedger } from './ingestionOwnership'
import { hasRoleScopedTokens } from './roleScopedTokenStore'
import { getLastSandboxPollOutcomes } from './sandboxIngestion'
import { resolveSandboxTopologyKind, type SandboxTopologyKind } from '../handshake/sandboxTopologyKind'
import { getLastHostIngestionPollAcks } from './ingestionPollTrigger/hostAckStore'
import {
  hostAckIndicatesMissingReadProvider,
  hostAckIndicatesPollUnreachable,
  sandboxDedicatedMissingReadProvider,
} from './dedicatedSandboxReadProviderStatus'

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Six mutually exclusive ingestion states. One code is always returned; the
 * renderer switches on this to pick banner copy and CTA.
 */
export type IngestionStatusCode =
  | 'OK_SINGLE_MACHINE'
  | 'OK_SANDBOX_FETCHING'
  | 'ACTION_NEEDED_READ_CONSENT'
  | 'PAUSED_SANDBOX_UNREACHABLE'
  | 'PAUSED_HOST_DELEGATED'
  | 'DEGRADED_HELD_MESSAGES'

/** Per-account token + last-poll counters (INV-5: counts only, no content). */
export interface IngestionAccountStatus {
  accountId: string
  /** True iff a read-role token exists in roleScopedTokenStore for this account. */
  readConsentPresent: boolean
  /** sandboxIngestion.ts SandboxIngestionStatus code from last poll, if any ran. */
  lastPollStatus?: string
  lastPollFetched?: number
  lastPollDelivered?: number
  lastPollHeld?: number
  /** Number of per-message error strings from last poll (count only, no content). */
  lastPollErrorCount?: number
  /** Unix ms timestamp of last poll. */
  lastPollAt?: number
}

/**
 * Full ingestion-status snapshot. Returned by `resolveIngestionStatus()` and
 * by the `email:getIngestionStatus` IPC handler.
 */
export interface IngestionStatusResult {
  /** The primary state the renderer switches on. */
  code: IngestionStatusCode

  // Raw ownership fields for renderer introspection / debug
  owner: 'host' | 'sandbox'
  thisNodeRole: 'host' | 'sandbox'
  hostShouldReadPoll: boolean
  sandboxShouldReadPoll: boolean
  /** Human-readable ownership reason from ingestionOwnership.ts. */
  ownershipReason: string

  /** Per-account token + poll state (one entry per accountId passed in). */
  accounts: IngestionAccountStatus[]

  /** Unix ms when this snapshot was computed. */
  resolvedAt: number

  /** Dedicated vs single-machine vs unpaired (`resolveSandboxTopologyKind`). */
  sandboxTopologyKind: SandboxTopologyKind
}

// ── Resolver ─────────────────────────────────────────────────────────────────

let topologyKindOverrideForTests: SandboxTopologyKind | null = null

/** Test-only override for `resolveSandboxTopologyKind()`. */
export function _setIngestionStatusTopologyKindForTests(kind: SandboxTopologyKind | null): void {
  topologyKindOverrideForTests = kind
}

function readSandboxTopologyKind(): SandboxTopologyKind {
  return topologyKindOverrideForTests ?? resolveSandboxTopologyKind()
}

/**
 * Compute the ingestion status snapshot for the given account ids. Pure read —
 * never throws, never mutates state. Missing accountIds → empty `accounts[]`.
 *
 * @param accountIds  — email account ids to check token/poll state for. Pass
 *   the ids of all connected email accounts; the caller (IPC handler) obtains
 *   them from `emailGateway.listAccounts()`.
 */
export async function resolveIngestionStatus(accountIds: readonly string[]): Promise<IngestionStatusResult> {
  const ownership = await resolveIngestionOwnershipWithLedger()
  const lastPolls = getLastSandboxPollOutcomes()
  const sandboxTopologyKind = readSandboxTopologyKind()
  const hostTriggerAcks = getLastHostIngestionPollAcks()

  const accounts: IngestionAccountStatus[] = accountIds.map((accountId) => {
    const readConsentPresent = hasRoleScopedTokens(accountId, 'read')
    const lastPollRecord = lastPolls.get(accountId) ?? null
    const entry: IngestionAccountStatus = { accountId, readConsentPresent }
    if (lastPollRecord) {
      const r = lastPollRecord.result
      entry.lastPollStatus = r.status
      entry.lastPollFetched = r.fetched
      entry.lastPollDelivered = r.delivered
      entry.lastPollHeld = r.held
      entry.lastPollErrorCount = r.errors.length
      entry.lastPollAt = lastPollRecord.at
    }
    return entry
  })

  const base: Omit<IngestionStatusResult, 'code'> = {
    owner: ownership.owner,
    thisNodeRole: ownership.thisNodeRole,
    hostShouldReadPoll: ownership.hostShouldReadPoll,
    sandboxShouldReadPoll: ownership.sandboxShouldReadPoll,
    ownershipReason: ownership.reason,
    accounts,
    resolvedAt: Date.now(),
    sandboxTopologyKind,
  }

  // ── S1: single machine, host owns ingestion ──────────────────────────────
  if (ownership.owner === 'host' && ownership.hostShouldReadPoll) {
    return { ...base, code: 'OK_SINGLE_MACHINE' }
  }

  // ── Dedicated delegated host — learn sandbox state from trigger acks (PROMPT 4) ─
  if (ownership.thisNodeRole === 'host' && !ownership.hostShouldReadPoll) {
    if (hostAckIndicatesMissingReadProvider(hostTriggerAcks, accountIds)) {
      return { ...base, code: 'ACTION_NEEDED_READ_CONSENT' }
    }
    if (hostAckIndicatesPollUnreachable(hostTriggerAcks, accountIds)) {
      return { ...base, code: 'PAUSED_SANDBOX_UNREACHABLE' }
    }
    return { ...base, code: 'PAUSED_HOST_DELEGATED' }
  }

  // ── Sandbox path ─────────────────────────────────────────────────────────
  if (ownership.sandboxShouldReadPoll) {
    if (sandboxTopologyKind === 'dedicated' && sandboxDedicatedMissingReadProvider(accounts)) {
      return { ...base, code: 'ACTION_NEEDED_READ_CONSENT' }
    }

    // Single-machine inner-VM sandbox: no missing-provider warnings (PROMPT 4).
    if (sandboxTopologyKind === 'single_machine') {
      if (accounts.some((a) => !a.readConsentPresent)) {
        return { ...base, code: 'PAUSED_HOST_DELEGATED' }
      }
    } else if (sandboxTopologyKind !== 'dedicated') {
      if (accounts.some((a) => !a.readConsentPresent)) {
        return { ...base, code: 'ACTION_NEEDED_READ_CONSENT' }
      }
    }

    // No poll has run yet (consent just granted, first tick hasn't fired).
    const pollEntries = accounts.filter((a) => a.lastPollStatus !== undefined)
    if (pollEntries.length === 0) {
      // Treat as "host delegated / waiting" — not an error, just pending.
      return { ...base, code: 'PAUSED_HOST_DELEGATED' }
    }

    // PAUSED_SANDBOX_UNREACHABLE: any account's fetch failed.
    // sandboxIngestion.ts held_fetch_failed (fetch throw) or ok:false with errors.
    const anyFetchFailed = pollEntries.some((a) => a.lastPollStatus === 'held_fetch_failed')
    if (anyFetchFailed) {
      return { ...base, code: 'PAUSED_SANDBOX_UNREACHABLE' }
    }

    // DEGRADED_HELD_MESSAGES: fetched ok but individual messages are held
    // in depackage/deliver. sandboxIngestion.ts held counter > 0, status='ok'.
    const anyOk = pollEntries.some((a) => a.lastPollStatus === 'ok')
    const anyHeld = pollEntries.some((a) => (a.lastPollHeld ?? 0) > 0)
    if (anyOk && anyHeld) {
      return { ...base, code: 'DEGRADED_HELD_MESSAGES' }
    }

    if (anyOk) {
      return { ...base, code: 'OK_SANDBOX_FETCHING' }
    }

    // Poll ran but status isn't 'ok' or 'held_fetch_failed' — e.g.
    // held_no_custody_key. Treat as unreachable since user cannot act on it
    // via the email consent flow; it will resolve when custody key is set up.
    return { ...base, code: 'PAUSED_SANDBOX_UNREACHABLE' }
  }

  // Fallback: ownership says sandbox owns but sandboxShouldReadPoll is false
  // (this node is the host with a linked sandbox — PAUSED_HOST_DELEGATED).
  return { ...base, code: 'PAUSED_HOST_DELEGATED' }
}
