/**
 * Remote orchestrator enqueue — mocked {@link ../gateway} so Electron is not loaded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../gateway', () => ({
  emailGateway: {
    getProviderSync: vi.fn(() => 'gmail'),
  },
}))

import { enqueueOrchestratorRemoteMutations } from '../inboxOrchestratorRemoteQueue'
import { emailGateway } from '../gateway'

describe('enqueueOrchestratorRemoteMutations', () => {
  beforeEach(() => {
    vi.mocked(emailGateway.getProviderSync).mockReturnValue('imap')
  })

  function makeDb(row: Record<string, unknown> | undefined) {
    const upsertRuns: unknown[][] = []
    const supersedeRuns: unknown[][] = []
    return {
      upsertRuns,
      supersedeRuns,
      db: {
        prepare: vi.fn((sql: string) => {
          if (sql.includes('SELECT id, account_id')) {
            return {
              get: (_id: string) => row,
            }
          }
          if (sql.includes('Superseded by newer classification')) {
            return {
              run: (...args: unknown[]) => {
                supersedeRuns.push(args)
              },
            }
          }
          if (sql.includes('INSERT INTO remote_orchestrator_mutation_queue')) {
            return {
              run: (...args: unknown[]) => {
                upsertRuns.push(args)
              },
            }
          }
          throw new Error(`Unexpected SQL in mock: ${sql.slice(0, 60)}`)
        }),
      },
    }
  }

  it('returns zeros for empty message id list', () => {
    const { db } = makeDb(undefined)
    expect(enqueueOrchestratorRemoteMutations(db, [], 'archive')).toEqual({ enqueued: 0, skipped: 0 })
  })

  it('skips when inbox row missing account_id or email_message_id', () => {
    const { db } = makeDb({ id: 'm1', account_id: null, email_message_id: 'em1', source_type: 'email_plain' })
    expect(enqueueOrchestratorRemoteMutations(db, ['m1'], 'pending_review')).toEqual({ enqueued: 0, skipped: 1 })
  })

  it('skips non-email-backed source_type', () => {
    const { db } = makeDb({
      id: 'm1',
      account_id: 'a1',
      email_message_id: 'em1',
      source_type: 'other',
    })
    expect(enqueueOrchestratorRemoteMutations(db, ['m1'], 'pending_delete')).toEqual({ enqueued: 0, skipped: 1 })
  })

  it('enqueues for email_plain row with provider from gateway', () => {
    const { db, upsertRuns, supersedeRuns } = makeDb({
      id: 'm1',
      account_id: 'a1',
      email_message_id: 'em1',
      source_type: 'email_plain',
    })
    const r = enqueueOrchestratorRemoteMutations(db, ['m1'], 'pending_review')
    expect(r).toEqual({ enqueued: 1, skipped: 0 })
    expect(supersedeRuns).toHaveLength(1)
    expect(supersedeRuns[0]).toContain('m1')
    expect(supersedeRuns[0]).toContain('pending_review')
    expect(upsertRuns).toHaveLength(1)
    expect(upsertRuns[0]).toContain('imap')
    expect(upsertRuns[0]).toContain('pending_review')
    expect(upsertRuns[0]).toContain('m1')
    expect(upsertRuns[0]).toContain('a1')
    expect(upsertRuns[0]).toContain('em1')
  })

  it('second enqueue same message+operation still runs upsert (SQL ON CONFLICT handles idempotency)', () => {
    const { db, upsertRuns } = makeDb({
      id: 'm1',
      account_id: 'a1',
      email_message_id: 'em1',
      source_type: 'email_plain',
    })
    enqueueOrchestratorRemoteMutations(db, ['m1'], 'archive')
    enqueueOrchestratorRemoteMutations(db, ['m1'], 'archive')
    expect(upsertRuns.length).toBe(2)
  })
})
