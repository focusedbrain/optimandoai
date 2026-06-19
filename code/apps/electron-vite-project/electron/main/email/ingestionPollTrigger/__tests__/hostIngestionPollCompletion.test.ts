/**
 * A5 — IPC async completion bridge for sealed-relay poll results.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  _resetHostIngestionPollCompletionForTests,
  finalizePendingIngestionPollSyncResult,
} from '../hostIngestionPollCompletion'
import type { HostIngestionPollAck } from '../hostAckStore'
import { mapIngestionPollTriggerHostFeedback } from '../../ipcSyncResultShape'

describe('finalizePendingIngestionPollSyncResult (A5)', () => {
  beforeEach(() => {
    _resetHostIngestionPollCompletionForTests()
  })

  it('passes through when not ingestion_trigger_pending', async () => {
    const input = { ok: true, skipReason: 'processing_paused' as const }
    await expect(finalizePendingIngestionPollSyncResult(input)).resolves.toBe(input)
  })

  it('waits for ack and maps to ingestion_triggered_to_sandbox with counts', async () => {
    const pending = {
      ok: true,
      skipReason: 'ingestion_trigger_pending' as const,
      ingestionPollTrigger: {
        requestId: 'req-ipc-1',
        pollStatus: 'pending',
        fetched: 0,
        depackaged: 0,
        delivered: 0,
        held: 0,
      },
    }
    const ack: HostIngestionPollAck = {
      accountId: 'acc-1',
      requestId: 'req-ipc-1',
      pollStatus: 'ok',
      fetched: 4,
      depackaged: 4,
      delivered: 3,
      held: 0,
      at: Date.now(),
    }

    const finalizedPromise = finalizePendingIngestionPollSyncResult(pending, {
      waitForResult: async () => ack,
    })
    const finalized = await finalizedPromise

    expect(finalized.skipReason).toBe('ingestion_triggered_to_sandbox')
    expect(finalized.ingestionPollTrigger).toMatchObject({
      requestId: 'req-ipc-1',
      pollStatus: 'ok',
      delivered: 3,
    })

    const ui = mapIngestionPollTriggerHostFeedback(finalized.ingestionPollTrigger!)
    expect(ui.ok).toBe(true)
    expect(ui.pullHint).toContain('delivered 3')
  })

  it('timeout maps to ingestion_trigger_unreachable loud failure', async () => {
    const pending = {
      ok: true,
      skipReason: 'ingestion_trigger_pending' as const,
      ingestionPollTrigger: {
        requestId: 'req-timeout',
        pollStatus: 'pending',
        fetched: 0,
        depackaged: 0,
        delivered: 0,
        held: 0,
      },
    }

    const finalized = await finalizePendingIngestionPollSyncResult(pending, {
      waitForResult: async () => {
        throw new Error('timed out')
      },
    })

    expect(finalized.ok).toBe(false)
    expect(finalized.skipReason).toBe('ingestion_trigger_unreachable')
    expect(finalized.ingestionPollTrigger?.pollStatus).toBe('trigger_unreachable')

    const ui = mapIngestionPollTriggerHostFeedback(finalized.ingestionPollTrigger!)
    expect(ui.ok).toBe(false)
  })

  it('HELD result surfaces distinct loud UI via host feedback mapper', async () => {
    const pending = {
      ok: true,
      skipReason: 'ingestion_trigger_pending' as const,
      ingestionPollTrigger: {
        requestId: 'req-held',
        pollStatus: 'pending',
        fetched: 0,
        depackaged: 0,
        delivered: 0,
        held: 0,
      },
    }
    const ack: HostIngestionPollAck = {
      accountId: 'acc-held',
      requestId: 'req-held',
      pollStatus: 'held_read_consent_missing',
      fetched: 0,
      depackaged: 0,
      delivered: 0,
      held: 1,
      at: Date.now(),
    }

    const finalized = await finalizePendingIngestionPollSyncResult(pending, {
      waitForResult: async () => ack,
    })

    const ui = mapIngestionPollTriggerHostFeedback(finalized.ingestionPollTrigger!)
    expect(ui.ok).toBe(false)
    expect(ui.syncWarnings[0]).toContain('read account')
  })
})
