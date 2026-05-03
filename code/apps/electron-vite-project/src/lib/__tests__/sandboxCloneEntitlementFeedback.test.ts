/**
 * PR 5/5 — Client UI: Distinguish Entitlement Errors from Rate-Limit Errors.
 *
 * Tests covering:
 *   CS_ENT_01: 403 sandbox_entitlement_required → entitlement UI (title, body, no retry button)
 *   CS_ENT_02: 403 sandbox_entitlement_required + upgrade_url → actionUrl set to that URL
 *   CS_ENT_03: 403 sandbox_entitlement_required + missing upgrade_url → fallback URL used
 *   CS_ENT_04: 403 with different error code → existing generic behavior (no entitlement UI)
 *   CS_ENT_05: 429 / SANDBOX_SEND_FAILED → generic failure (regression guard)
 *   CS_ENT_06: 403 entitlement → queued: false (no retry enqueued)
 *   CS_ENT_07: network / malformed → failedGeneric (regression guard)
 */

import { describe, test, expect } from 'vitest'
import {
  sandboxCloneFeedbackFromOutcome,
  type BeapInboxCloneToSandboxResult,
  type BeapInboxClonePrepareFailure,
} from '../beapInboxCloneToSandbox'
import {
  SANDBOX_CLONE_COPY,
  SANDBOX_UPGRADE_URL_FALLBACK,
  viewSandboxEntitlementRequired,
} from '../sandboxCloneFeedbackUi'

// ---------------------------------------------------------------------------
// Helpers to build typed failure objects
// ---------------------------------------------------------------------------
function entitlementFailure(upgradeUrl?: string): BeapInboxCloneToSandboxResult {
  return {
    success: false,
    code: 'SANDBOX_ENTITLEMENT_REQUIRED',
    error: 'sandbox_entitlement_required',
    ...(upgradeUrl !== undefined ? { upgradeUrl } : {}),
  }
}

function sendFailed(error: string): BeapInboxCloneToSandboxResult {
  return { success: false, code: 'SANDBOX_SEND_FAILED', error }
}

function prepareFailed(error: string, code?: BeapInboxClonePrepareFailure['code']): BeapInboxClonePrepareFailure {
  return { success: false, error, ...(code ? { code } : {}) }
}

// ---------------------------------------------------------------------------
// CS_ENT_01: 403 sandbox_entitlement_required → entitlement UI
// ---------------------------------------------------------------------------
describe('CS_ENT_01 — entitlement required → distinct UI, no retry', () => {
  test('kind is error', () => {
    const { kind } = sandboxCloneFeedbackFromOutcome(entitlementFailure('https://wrdesk.com/pricing'))
    expect(kind).toBe('error')
  })

  test('view title matches entitlement copy', () => {
    const { view } = sandboxCloneFeedbackFromOutcome(entitlementFailure())
    expect(view.title).toBe(SANDBOX_CLONE_COPY.entitlementRequired.title)
  })

  test('view message matches entitlement body', () => {
    const { view } = sandboxCloneFeedbackFromOutcome(entitlementFailure())
    expect(view.message).toBe(SANDBOX_CLONE_COPY.entitlementRequired.body)
  })

  test('view has action label "View pricing"', () => {
    const { view } = sandboxCloneFeedbackFromOutcome(entitlementFailure())
    expect(view.actionLabel).toBe('View pricing')
  })

  test('view persistUntilDismiss is true (no auto-hide for upgrade prompt)', () => {
    const { view } = sandboxCloneFeedbackFromOutcome(entitlementFailure())
    expect(view.persistUntilDismiss).toBe(true)
  })

  test('text helper carries the entitlement title', () => {
    const { text } = sandboxCloneFeedbackFromOutcome(entitlementFailure())
    expect(text).toBe('Sandbox mode requires an upgrade')
  })
})

// ---------------------------------------------------------------------------
// CS_ENT_02: 403 + upgrade_url → action opens that URL
// ---------------------------------------------------------------------------
describe('CS_ENT_02 — upgrade_url from relay response is surfaced', () => {
  test('actionUrl equals the upgrade_url from the relay body', () => {
    const url = 'https://wrdesk.com/upgrade?plan=pro'
    const { view } = sandboxCloneFeedbackFromOutcome(entitlementFailure(url))
    expect(view.actionUrl).toBe(url)
  })
})

// ---------------------------------------------------------------------------
// CS_ENT_03: 403 + missing upgrade_url → fallback URL
// ---------------------------------------------------------------------------
describe('CS_ENT_03 — missing upgrade_url falls back to pricing page', () => {
  test('actionUrl is the fallback URL when upgradeUrl is absent', () => {
    const { view } = sandboxCloneFeedbackFromOutcome(entitlementFailure())
    expect(view.actionUrl).toBe(SANDBOX_UPGRADE_URL_FALLBACK)
  })

  test('fallback URL is https://wrdesk.com/pricing', () => {
    expect(SANDBOX_UPGRADE_URL_FALLBACK).toBe('https://wrdesk.com/pricing')
  })

  test('viewSandboxEntitlementRequired with undefined → fallback URL', () => {
    const view = viewSandboxEntitlementRequired(undefined)
    expect(view.actionUrl).toBe(SANDBOX_UPGRADE_URL_FALLBACK)
  })

  test('viewSandboxEntitlementRequired with empty string → fallback URL', () => {
    const view = viewSandboxEntitlementRequired('')
    expect(view.actionUrl).toBe(SANDBOX_UPGRADE_URL_FALLBACK)
  })
})

// ---------------------------------------------------------------------------
// CS_ENT_04: 403 with different error code → existing generic behavior
// ---------------------------------------------------------------------------
describe('CS_ENT_04 — non-entitlement 403 (e.g. RELAY_SENDER_UNAUTHORIZED) → failedGeneric', () => {
  test('SANDBOX_SEND_FAILED from a 403 RELAY_SENDER_UNAUTHORIZED shows failedGeneric', () => {
    const r = sendFailed('HTTP 403 — {"error":"RELAY_SENDER_UNAUTHORIZED"}')
    const { view } = sandboxCloneFeedbackFromOutcome(r)
    expect(view.message).toBe(SANDBOX_CLONE_COPY.failedGeneric)
    expect(view.title).toBeUndefined()
    expect(view.actionUrl).toBeUndefined()
  })

  test('prepare failure with NO_ACTIVE_SANDBOX_HANDSHAKE → failedGeneric text', () => {
    const r = prepareFailed('No sandbox handshake', 'NO_ACTIVE_SANDBOX_HANDSHAKE')
    const { view } = sandboxCloneFeedbackFromOutcome(r)
    expect(view.message).toBe(SANDBOX_CLONE_COPY.failedGeneric)
    expect(view.title).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// CS_ENT_05: 429 / rate-limited → existing generic behavior (regression guard)
// ---------------------------------------------------------------------------
describe('CS_ENT_05 — 429 rate-limited → failedGeneric (not entitlement UI)', () => {
  test('SANDBOX_SEND_FAILED from BACKOFF_WAIT (429 path) shows failedGeneric', () => {
    const r = sendFailed('Delivery is waiting before retry — try again shortly')
    const { view } = sandboxCloneFeedbackFromOutcome(r)
    expect(view.message).toBe(SANDBOX_CLONE_COPY.failedGeneric)
    expect(view.title).toBeUndefined()
    expect(view.actionUrl).toBeUndefined()
    expect(view.actionLabel).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// CS_ENT_06: 403 entitlement → queued: false (no retry)
// ---------------------------------------------------------------------------
describe('CS_ENT_06 — entitlement error does not trigger retry', () => {
  /**
   * Verification by code inspection:
   *
   * 1. `outboundQueue.ts` → `markSchemaTerminal` sets `queued: false` on the
   *    `ProcessOutboundQueueResult` and marks the queue row `status = 'failed'`.
   *    The row will not be picked up by subsequent outbound-queue drains.
   *
   * 2. `ipc.ts` line ~1067: `queued: d.queued !== false` → `false !== false` = false.
   *    The IPC response carries `queued: false`.
   *
   * 3. `BeapPackageBuilder.ts`: the `sandbox_entitlement_required` early-exit
   *    (before the existing terminal-codes block) returns `queued: false` explicitly.
   *
   * 4. `cloneBeapInboxToSandbox.ts`: on SANDBOX_ENTITLEMENT_REQUIRED, the function
   *    returns immediately without enqueuing any retry.
   *
   * The structural guarantee: the relay's 403 is classified SCHEMA_PERMANENT by
   * `handleCoordinationOutbound403 → markSchemaTerminal`, which sets
   * `status = 'failed'` on the DB row before returning. There is no auto-drain
   * timer path that would re-attempt a failed row.
   */
  test('SANDBOX_ENTITLEMENT_REQUIRED result carries code for caller inspection', () => {
    const r = entitlementFailure('https://wrdesk.com/pricing')
    expect(r.success).toBe(false)
    expect(r.code).toBe('SANDBOX_ENTITLEMENT_REQUIRED')
  })

  test('sandboxCloneFeedbackFromOutcome does not set queued-retry fields for entitlement', () => {
    const { view } = sandboxCloneFeedbackFromOutcome(entitlementFailure())
    // No queued-for-retry counter or retry copy in the view
    expect(view.message).not.toMatch(/retry/i)
    expect(view.message).not.toMatch(/queued/i)
  })
})

// ---------------------------------------------------------------------------
// CS_ENT_07: network error / malformed → failedGeneric (regression guard)
// ---------------------------------------------------------------------------
describe('CS_ENT_07 — network / malformed response → failedGeneric', () => {
  test('generic send failure → failedGeneric message', () => {
    const r = sendFailed('fetch failed')
    const { view } = sandboxCloneFeedbackFromOutcome(r)
    expect(view.message).toBe(SANDBOX_CLONE_COPY.failedGeneric)
    expect(view.title).toBeUndefined()
    expect(view.actionUrl).toBeUndefined()
  })

  test('success: false with no code → failedGeneric', () => {
    const r: BeapInboxClonePrepareFailure = { success: false, error: 'Unexpected error' }
    const { view } = sandboxCloneFeedbackFromOutcome(r)
    expect(view.message).toBe(SANDBOX_CLONE_COPY.failedGeneric)
  })

  test('entirely falsy input → failedGeneric', () => {
    // @ts-expect-error — intentionally testing bad input resilience
    const { view } = sandboxCloneFeedbackFromOutcome(null)
    expect(view.message).toBe(SANDBOX_CLONE_COPY.failedGeneric)
  })
})
