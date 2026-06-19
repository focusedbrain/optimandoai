/**
 * UX-1 D2 — ipcSyncResultShape unit tests.
 *
 * Verifies that mapSkipReasonToIpcWarning:
 *   • returns isSkip:true for both skip reasons
 *   • always sets ok:false-compatible shape (msg + hint present)
 *   • returns isSkip:false for normal results (undefined / unknown values)
 *   • copy strings match the spec — never silent for delegated case
 *
 * These tests are the contract layer between syncOrchestrator.ts skip reasons
 * and what the renderer actually sees. Pin exact copy here so a refactor
 * can't silently lose the user-visible message.
 */
import { describe, it, expect } from 'vitest'
import {
  mapSkipReasonToIpcWarning,
  PAUSED_HINT,
  DELEGATED_HINT,
  TRIGGER_FAILED_HINT,
  TRIGGER_UNREACHABLE_HINT,
  TRIGGER_READ_CONSENT_MISSING_HINT,
  TRIGGER_FETCH_FAILED_HINT,
  formatIngestionPollTriggerPullHint,
  mapIngestionPollTriggerHostFeedback,
} from '../ipcSyncResultShape'

describe('mapSkipReasonToIpcWarning — skip reason routing', () => {
  it('processing_paused → isSkip:true, msg contains PAUSED_HINT', () => {
    const r = mapSkipReasonToIpcWarning('processing_paused')
    expect(r.isSkip).toBe(true)
    if (!r.isSkip) throw new Error('type narrowing')
    expect(r.hint).toBe(PAUSED_HINT)
    expect(r.msg).toContain(PAUSED_HINT)
    // Navigation hint present
    expect(r.msg).toContain('Resume')
  })

  it('ingestion_delegated_to_sandbox → isSkip:true, msg contains DELEGATED_HINT', () => {
    const r = mapSkipReasonToIpcWarning('ingestion_delegated_to_sandbox')
    expect(r.isSkip).toBe(true)
    if (!r.isSkip) throw new Error('type narrowing')
    expect(r.hint).toBe(DELEGATED_HINT)
    expect(r.msg).toContain(DELEGATED_HINT)
    // Navigation hint present
    expect(r.msg).toContain('sandbox machine')
  })

  it('undefined skipReason (normal sync) → isSkip:false', () => {
    const r = mapSkipReasonToIpcWarning(undefined)
    expect(r.isSkip).toBe(false)
  })

  it('unknown skip reason → isSkip:false (forward-compatible)', () => {
    const r = mapSkipReasonToIpcWarning('some_future_skip_reason')
    expect(r.isSkip).toBe(false)
  })
})

describe('mapSkipReasonToIpcWarning — delegated copy contract (UX-1 D2)', () => {
  it('DELEGATED_HINT names the sandbox device action (user must act on OTHER machine)', () => {
    expect(DELEGATED_HINT).toContain('sandbox device')
    expect(DELEGATED_HINT).toContain('Connect a read-only account')
  })

  it('delegated msg is not ok:true-compatible (must not be silent)', () => {
    const r = mapSkipReasonToIpcWarning('ingestion_delegated_to_sandbox')
    // The returned isSkip:true causes the IPC handler to return ok:false.
    // Verify it is NOT the silent empty-inbox path (which would return ok:true).
    expect(r.isSkip).toBe(true)
    if (!r.isSkip) throw new Error('type narrowing')
    // msg must be non-empty so syncWarnings[0] is actionable
    expect(r.msg.length).toBeGreaterThan(20)
  })

  it('both skip reasons produce different copy (no copy reuse)', () => {
    const paused = mapSkipReasonToIpcWarning('processing_paused')
    const delegated = mapSkipReasonToIpcWarning('ingestion_delegated_to_sandbox')
    if (!paused.isSkip || !delegated.isSkip) throw new Error('both must be skip')
    expect(paused.msg).not.toBe(delegated.msg)
    expect(paused.hint).not.toBe(delegated.hint)
  })

  it('hint is a prefix of msg (pullHint ⊂ syncWarnings[0])', () => {
    const r = mapSkipReasonToIpcWarning('ingestion_delegated_to_sandbox')
    if (!r.isSkip) throw new Error('type narrowing')
    expect(r.msg).toContain(r.hint)
  })

  it('hint is a prefix of msg for processing_paused too (symmetry)', () => {
    const r = mapSkipReasonToIpcWarning('processing_paused')
    if (!r.isSkip) throw new Error('type narrowing')
    expect(r.msg).toContain(r.hint)
  })
})

describe('mapSkipReasonToIpcWarning — dedicated host trigger', () => {
  it('ingestion_trigger_failed → loud unreachable copy', () => {
    const r = mapSkipReasonToIpcWarning('ingestion_trigger_failed')
    expect(r.isSkip).toBe(true)
    if (!r.isSkip) throw new Error('type narrowing')
    expect(r.hint).toBe(TRIGGER_FAILED_HINT)
    expect(r.msg).toContain('unreachable')
    expect(r.msg).toContain('mail was not synced')
  })

  it('ingestion_triggered_to_sandbox is not a skip (success path uses pullHint)', () => {
    expect(mapSkipReasonToIpcWarning('ingestion_triggered_to_sandbox').isSkip).toBe(false)
  })
})

describe('mapIngestionPollTriggerHostFeedback', () => {
  it('held_read_consent_missing → actionable host warning', () => {
    const r = mapIngestionPollTriggerHostFeedback({
      requestId: 'req-1',
      pollStatus: 'held_read_consent_missing',
      fetched: 0,
      depackaged: 0,
      delivered: 0,
      held: 0,
    })
    expect(r.ok).toBe(false)
    expect(r.syncWarnings[0]).toBe(TRIGGER_READ_CONSENT_MISSING_HINT)
    expect(r.syncWarnings[0]).toContain('no read account configured')
  })

  it('trigger_unreachable → loud unreachable copy distinct from fetch failed', () => {
    const unreachable = mapIngestionPollTriggerHostFeedback({
      requestId: 'req-2a',
      pollStatus: 'trigger_unreachable',
      fetched: 0,
      depackaged: 0,
      delivered: 0,
      held: 0,
    })
    const fetchFailed = mapIngestionPollTriggerHostFeedback({
      requestId: 'req-2b',
      pollStatus: 'held_fetch_failed',
      fetched: 0,
      depackaged: 0,
      delivered: 0,
      held: 0,
    })
    expect(unreachable.ok).toBe(false)
    expect(unreachable.syncWarnings[0]).toBe(TRIGGER_UNREACHABLE_HINT)
    expect(fetchFailed.syncWarnings[0]).toBe(TRIGGER_FETCH_FAILED_HINT)
    expect(unreachable.syncWarnings[0]).not.toBe(fetchFailed.syncWarnings[0])
  })

  it('held_fetch_failed → distinct fetch failure copy', () => {
    const missing = mapIngestionPollTriggerHostFeedback({
      requestId: 'req-1',
      pollStatus: 'held_read_consent_missing',
      fetched: 0,
      depackaged: 0,
      delivered: 0,
      held: 0,
    })
    const offline = mapIngestionPollTriggerHostFeedback({
      requestId: 'req-2',
      pollStatus: 'held_fetch_failed',
      fetched: 0,
      depackaged: 0,
      delivered: 0,
      held: 0,
    })
    expect(offline.ok).toBe(false)
    expect(offline.syncWarnings[0]).not.toBe(missing.syncWarnings[0])
    expect(offline.syncWarnings[0]).toContain('could not fetch mail')
  })

  it('ok poll → success feedback', () => {
    const r = mapIngestionPollTriggerHostFeedback({
      requestId: 'req-3',
      pollStatus: 'ok',
      fetched: 1,
      depackaged: 1,
      delivered: 1,
      held: 0,
    })
    expect(r.ok).toBe(true)
    expect(r.pullHint).toContain('Fetched 1')
  })
})
