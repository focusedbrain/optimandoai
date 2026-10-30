/**
 * Pure helpers for mapping syncAccountEmails skip reasons to IPC response
 * shape. Extracted so tests can verify copy strings and ok/warning/error
 * fields without pulling in Electron. ipc.ts delegates to these functions.
 *
 * INV-5: helpers here carry only UI copy and structured metadata — never
 * message content, token bytes, or any PII.
 */

// ── Copy strings ─────────────────────────────────────────────────────────────
// Exported so tests can pin the exact copy the renderer receives.

export const PAUSED_HINT =
  'Mail sync is paused for this account — no mail was fetched. Use Resume on the account card, then pull again.'

/**
 * UX-1 D2 — displayed when ingestion_delegated_to_sandbox surfaces through a
 * manual pull on the host. Must name the action the user needs to take on the
 * OTHER (sandbox) device, not on this one.
 */
export const DELEGATED_HINT =
  'Inbound mail is fetched on your sandbox device. Connect a read-only account there to resume receiving mail.'

/** Dedicated sandbox: inbound fetch is initiated by the paired host only (PROMPT 1). */
export const HOST_TRIGGERED_HINT =
  'Inbound mail sync waits for your host device to trigger a pull. Manual Sync and auto-sync are disabled on this dedicated sandbox.'

/** Dedicated delegated host: sandbox poll was triggered; counts only (INV-5). */
export const TRIGGER_SUCCESS_HINT =
  'Sandbox ingestion poll triggered on your paired sandbox device. New mail arrives via the normal delivery path.'

/** A3 sealed relay: trigger sent; async result pending on sandbox ack (A5). */
export const TRIGGER_PENDING_HINT =
  'Syncing with your paired sandbox device — waiting for the ingestion poll to complete.'

/** Transport / link-down before sandbox ack (E_INGESTION_POLL_LINK_DOWN). */
export const TRIGGER_FAILED_HINT =
  'Sandbox device unreachable — mail was not synced. Check the sandbox is on, logged in, and connected, then try Sync again.'

/** Host reached sandbox but auth/protocol rejected the trigger (E_INGESTION_POLL_PROTOCOL / 401). */
export const TRIGGER_REJECTED_HINT =
  'Sandbox rejected the sync request (authentication) — the device pairing may need refreshing.'

/** Sandbox ack: HTTP reached sandbox but poll_status = trigger_unreachable. */
export const TRIGGER_UNREACHABLE_HINT = TRIGGER_FAILED_HINT

/** Sandbox ack: read consent / read account missing on sandbox. */
export const TRIGGER_READ_CONSENT_MISSING_HINT =
  'Sandbox has no read account configured — set up a read-only email account on the sandbox device to receive mail.'

/** Sandbox ack: sandbox ran poll but provider fetch failed. */
export const TRIGGER_FETCH_FAILED_HINT =
  'Sandbox could not fetch mail — check the sandbox is online and the read account credentials are valid.'

/** Sandbox ack: mail fetched and unpacked on the sandbox, but not delivered to this host. */
export const TRIGGER_DELIVERY_FAILED_HINT =
  'Your sandbox fetched new mail but could not deliver it to this device. The mail stays on your mail server and is fetched again on the next Sync.'

/** Sandbox ack with any other non-ok status: never reported as success. */
export const TRIGGER_NOT_COMPLETED_HINT =
  'Your sandbox could not complete this sync — mail was not synced. Check the sandbox device.'

/** Sandbox ack: some mail could not be unpacked safely on the sandbox and was held there. */
export const TRIGGER_DEPACKAGE_HELD_HINT =
  'Some mail could not be unpacked safely on your sandbox device and was held there. It stays on your mail server.'

export interface IngestionPollTriggerCounts {
  requestId: string
  pollStatus: string
  fetched: number
  depackaged: number
  delivered: number
  held: number
}

/**
 * "Fetched" is not success, "delivered" is. A poll that delivered fewer messages than it
 * fetched is never reported as ok, whatever status the sandbox sent (older sandbox builds
 * report `ok` with held messages).
 */
export function effectiveIngestionPollStatus(trigger: Omit<IngestionPollTriggerCounts, 'requestId'>): string {
  if (trigger.pollStatus !== 'ok') return trigger.pollStatus
  if (trigger.depackaged > trigger.delivered) return 'held_delivery_failed'
  if (trigger.fetched > trigger.delivered) return 'held_depackage_failed'
  return 'ok'
}

export function formatIngestionPollTriggerPullHint(trigger: IngestionPollTriggerCounts): string {
  return `${TRIGGER_SUCCESS_HINT} Fetched ${trigger.fetched}, delivered ${trigger.delivered}, held ${trigger.held}.`
}

/** Host Sync feedback after a dedicated trigger ack (PROMPT 4). */
export function mapIngestionPollTriggerPendingFeedback(trigger: IngestionPollTriggerCounts): {
  ok: true
  pullHint: string
  syncWarnings: string[]
} {
  return {
    ok: true,
    pullHint: TRIGGER_PENDING_HINT,
    syncWarnings: [],
  }
}

export function mapIngestionPollTriggerHostFeedback(trigger: IngestionPollTriggerCounts): {
  ok: boolean
  pullHint: string
  syncWarnings: string[]
} {
  const pollStatus = effectiveIngestionPollStatus(trigger)
  if (pollStatus === 'pending') {
    return mapIngestionPollTriggerPendingFeedback(trigger)
  }
  const failureHint: Record<string, string> = {
    held_read_consent_missing: TRIGGER_READ_CONSENT_MISSING_HINT,
    trigger_unreachable: TRIGGER_UNREACHABLE_HINT,
    held_fetch_failed: TRIGGER_FETCH_FAILED_HINT,
    held_delivery_failed: TRIGGER_DELIVERY_FAILED_HINT,
    held_depackage_failed: TRIGGER_DEPACKAGE_HELD_HINT,
  }
  if (pollStatus !== 'ok') {
    const hint = failureHint[pollStatus] ?? `${TRIGGER_NOT_COMPLETED_HINT} (${pollStatus})`
    return { ok: false, pullHint: hint, syncWarnings: [hint] }
  }
  return {
    ok: true,
    pullHint: formatIngestionPollTriggerPullHint(trigger),
    syncWarnings: [],
  }
}

// ── Skip-reason mapping ───────────────────────────────────────────────────────

export interface SkipReasonIpcResult {
  /** Whether this skip reason needs an early-return warning (ok: false). */
  isSkip: true
  /** Short hint shown in the pull button tooltip / pullHint. */
  hint: string
  /** Full user-visible message including navigation hint, used as error + syncWarning. */
  msg: string
}

/**
 * Map a `SyncResult.skipReason` to the IPC response shape fields. Returns
 * `{ isSkip: false }` when the result should continue through normal processing.
 *
 * Both `processing_paused` and `ingestion_delegated_to_sandbox` return
 * `ok: false` — neither is a silent no-op. "ok: true with 0 messages" is
 * reserved for a genuine empty inbox.
 */
export function mapSkipReasonToIpcWarning(
  skipReason: string | undefined,
): SkipReasonIpcResult | { isSkip: false } {
  if (skipReason === 'processing_paused') {
    const hint = PAUSED_HINT
    return {
      isSkip: true,
      hint,
      msg: `${hint} (Connected Email Accounts → Resume.)`,
    }
  }
  if (skipReason === 'ingestion_delegated_to_sandbox') {
    const hint = DELEGATED_HINT
    return {
      isSkip: true,
      hint,
      msg: `${hint} (Settings → Email Accounts → add a read-only account on the sandbox machine.)`,
    }
  }
  if (skipReason === 'ingestion_host_triggered_only') {
    const hint = HOST_TRIGGERED_HINT
    return {
      isSkip: true,
      hint,
      msg: hint,
    }
  }
  if (skipReason === 'ingestion_trigger_unreachable' || skipReason === 'ingestion_trigger_failed') {
    const hint = TRIGGER_FAILED_HINT
    return {
      isSkip: true,
      hint,
      msg: hint,
    }
  }
  if (skipReason === 'ingestion_trigger_rejected') {
    const hint = TRIGGER_REJECTED_HINT
    return {
      isSkip: true,
      hint,
      msg: hint,
    }
  }
  if (skipReason === 'ingestion_trigger_pending') {
    return { isSkip: false }
  }
  return { isSkip: false }
}

/** Map host trigger transport error codes to IPC skip reasons for loud, accurate UI copy. */
export function mapIngestionTriggerFailureSkipReason(code: string): 'ingestion_trigger_unreachable' | 'ingestion_trigger_rejected' {
  if (code === 'E_INGESTION_POLL_PROTOCOL' || code === 'E_INGESTION_POLL_AUTH') {
    return 'ingestion_trigger_rejected'
  }
  if (code.startsWith('E_SEALED_RPC_')) {
    return 'ingestion_trigger_rejected'
  }
  return 'ingestion_trigger_unreachable'
}
