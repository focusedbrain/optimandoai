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

/** Transport / link-down before sandbox ack (E_INGESTION_POLL_LINK_DOWN). */
export const TRIGGER_FAILED_HINT =
  'Sandbox device unreachable — mail was not synced. Check the sandbox is on, logged in, and connected, then try Sync again.'

/** Sandbox ack: HTTP reached sandbox but poll_status = trigger_unreachable. */
export const TRIGGER_UNREACHABLE_HINT = TRIGGER_FAILED_HINT

/** Sandbox ack: read consent / read account missing on sandbox. */
export const TRIGGER_READ_CONSENT_MISSING_HINT =
  'Sandbox has no read account configured — set up a read-only email account on the sandbox device to receive mail.'

/** Sandbox ack: sandbox ran poll but provider fetch failed. */
export const TRIGGER_FETCH_FAILED_HINT =
  'Sandbox could not fetch mail — check the sandbox is online and the read account credentials are valid.'

export interface IngestionPollTriggerCounts {
  requestId: string
  pollStatus: string
  fetched: number
  depackaged: number
  delivered: number
  held: number
}

export function formatIngestionPollTriggerPullHint(trigger: IngestionPollTriggerCounts): string {
  return `${TRIGGER_SUCCESS_HINT} Fetched ${trigger.fetched}, delivered ${trigger.delivered}, held ${trigger.held}.`
}

/** Host Sync feedback after a dedicated trigger ack (PROMPT 4). */
export function mapIngestionPollTriggerHostFeedback(trigger: IngestionPollTriggerCounts): {
  ok: boolean
  pullHint: string
  syncWarnings: string[]
} {
  if (trigger.pollStatus === 'held_read_consent_missing') {
    return {
      ok: false,
      pullHint: TRIGGER_READ_CONSENT_MISSING_HINT,
      syncWarnings: [TRIGGER_READ_CONSENT_MISSING_HINT],
    }
  }
  if (trigger.pollStatus === 'trigger_unreachable') {
    return {
      ok: false,
      pullHint: TRIGGER_UNREACHABLE_HINT,
      syncWarnings: [TRIGGER_UNREACHABLE_HINT],
    }
  }
  if (trigger.pollStatus === 'held_fetch_failed') {
    return {
      ok: false,
      pullHint: TRIGGER_FETCH_FAILED_HINT,
      syncWarnings: [TRIGGER_FETCH_FAILED_HINT],
    }
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
  if (skipReason === 'ingestion_trigger_failed') {
    const hint = TRIGGER_FAILED_HINT
    return {
      isSkip: true,
      hint,
      msg: hint,
    }
  }
  return { isSkip: false }
}
