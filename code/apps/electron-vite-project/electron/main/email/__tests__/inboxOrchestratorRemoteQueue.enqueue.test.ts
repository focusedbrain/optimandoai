/**
 * Remote orchestrator enqueue — mocked {@link ../gateway} so Electron is not loaded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../gateway', () => ({
  emailGateway: {
    getProviderSync: vi.fn(() => 'gmail'),
    getAccountConfig: vi.fn(() => ({
      provider: 'imap',
      email: 't@example.com',
      folders: { inbox: 'INBOX' },
    })),
  },
}))

import { enqueueOrchestratorRemoteMutations, enqueueRemoteOpsForLocalLifecycleState } from '../inboxOrchestratorRemoteQueue'
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

describe('enqueueRemoteOpsForLocalLifecycleState', () => {
  beforeEach(() => {
    vi.mocked(emailGateway.getProviderSync).mockReturnValue('imap')
  })

  function makeLifecycleDb(row: Record<string, unknown> | undefined) {
    const upsertRuns: unknown[][] = []
    const supersedeRuns: unknown[][] = []
    const clearWithKeepRuns: unknown[][] = []
    const clearAllRuns: unknown[][] = []
    return {
      upsertRuns,
      supersedeRuns,
      clearWithKeepRuns,
      clearAllRuns,
      db: {
        prepare: vi.fn((sql: string) => {
          if (sql.includes('FROM inbox_messages WHERE id = ?')) {
            return { get: (_id: string) => row }
          }
          if (sql.includes('operation != ?') && sql.includes('remote_orchestrator_mutation_queue')) {
            return {
              run: (...args: unknown[]) => {
                clearWithKeepRuns.push(args)
              },
            }
          }
          if (
            sql.includes("operation IN ('archive', 'pending_delete', 'pending_review')") &&
            sql.includes('remote_orchestrator_mutation_queue')
          ) {
            return {
              run: (...args: unknown[]) => {
                clearAllRuns.push(args)
              },
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
          throw new Error(`Unexpected SQL in lifecycle mock: ${sql.slice(0, 80)}`)
        }),
      },
    }
  }

  it('skips upsert when imap_remote_mailbox exactly equals configured archive mailbox name', () => {
    const { db, upsertRuns, clearWithKeepRuns } = makeLifecycleDb({
      id: 'm1',
      account_id: 'a1',
      email_message_id: '99',
      archived: 1,
      pending_delete: 0,
      sort_category: null,
      pending_review_at: null,
      /** Default resolved name from mailboxLifecycleMapping is `Archive` — must match exactly (not INBOX.Archive substring). */
      imap_remote_mailbox: 'Archive',
      source_type: 'email_plain',
    })
    const r = enqueueRemoteOpsForLocalLifecycleState(db, ['m1'])
    expect(r.enqueued).toBe(0)
    expect(r.skipped).toBe(1)
    expect(upsertRuns).toHaveLength(0)
    expect(clearWithKeepRuns.length).toBeGreaterThanOrEqual(1)
  })

  it('enqueues archive when local archived but remote column is INBOX', () => {
    const { db, upsertRuns } = makeLifecycleDb({
      id: 'm1',
      account_id: 'a1',
      email_message_id: '99',
      archived: 1,
      pending_delete: 0,
      sort_category: null,
      pending_review_at: null,
      imap_remote_mailbox: 'INBOX',
      source_type: 'email_plain',
    })
    const r = enqueueRemoteOpsForLocalLifecycleState(db, ['m1'])
    expect(r.enqueued).toBe(1)
    expect(upsertRuns).toHaveLength(1)
    expect(upsertRuns[0]).toContain('archive')
  })
})
