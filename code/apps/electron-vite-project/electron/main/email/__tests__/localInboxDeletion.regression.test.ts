/**
 * REGRESSION — local WRDesk inbox delete: soft-delete, no origin API, no re-pull resurrection.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../sealed-storage/index', () => ({
  prepareSealedOperationalUpdate: (db: { prepare: (sql: string) => unknown }, sql: string) =>
    db.prepare(sql),
}))

import {
  bulkDeleteMessagesLocal,
  deleteMessageLocal,
  LOCAL_WRDESK_DELETE_SKIP_REASON,
  isLocallyDeletedRow,
} from '../localInboxDeletion'
import { buildInboxMessagesWhereClause } from '../inboxWhereClause'

const deleteMessageMock = vi.fn()
vi.mock('../gateway', () => ({
  emailGateway: {
    deleteMessage: deleteMessageMock,
    getProviderSync: vi.fn(),
  },
}))

type Row = {
  id: string
  source_type?: string
  account_id?: string
  email_message_id?: string
  deleted?: number
  deleted_at?: string | null
  purge_after?: string | null
  lifecycle_remote_delete_skip_reason?: string | null
  archived?: number
  pending_delete?: number
  sort_category?: string | null
  pending_review_at?: string | null
  read_status?: number
  starred?: number
}

function makeMemoryDb(initial: Row[]) {
  const rows = new Map(initial.map((r) => [r.id, { ...r, deleted: r.deleted ?? 0 }]))
  const deletionQueue: Array<{ message_id: string }> = []

  const db = {
    deletionQueue,
    rows,
    prepare(sql: string) {
      return {
        get(...args: unknown[]) {
          if (sql.includes('SELECT id FROM inbox_messages WHERE id = ?')) {
            const id = args[0] as string
            return rows.has(id) ? { id } : undefined
          }
          if (sql.includes('SELECT * FROM inbox_messages WHERE id = ?')) {
            return rows.get(args[0] as string)
          }
          if (sql.includes('email_message_id FROM inbox_messages WHERE account_id')) {
            const accountId = args[0] as string
            return [...rows.values()]
              .filter((r) => r.account_id === accountId && r.email_message_id)
              .map((r) => ({ email_message_id: r.email_message_id }))
          }
          if (sql.includes('SELECT id FROM inbox_messages')) {
            const { where } = buildInboxMessagesWhereClause({ filter: 'all' })
            return [...rows.values()].filter((r) => r.deleted === 0).map((r) => ({ id: r.id }))
          }
          if (sql.includes('COUNT(*) as c FROM deletion_queue')) {
            return { c: deletionQueue.length }
          }
          return undefined
        },
        all(...args: unknown[]) {
          if (sql.includes('email_message_id FROM inbox_messages WHERE account_id')) {
            const accountId = args[0] as string
            return [...rows.values()]
              .filter((r) => r.account_id === accountId && r.email_message_id)
              .map((r) => ({ email_message_id: r.email_message_id }))
          }
          if (sql.includes('SELECT id FROM inbox_messages')) {
            return [...rows.values()].filter((r) => r.deleted === 0).map((r) => ({ id: r.id }))
          }
          return []
        },
        run(...args: unknown[]) {
          if (sql.includes('UPDATE inbox_messages SET deleted = 1')) {
            const messageId = args[2] as string
            const row = rows.get(messageId)
            if (row) {
              row.deleted = 1
              row.deleted_at = args[0] as string
              row.purge_after = null
              row.lifecycle_remote_delete_skip_reason = args[1] as string
            }
          }
          if (sql.includes('DELETE FROM deletion_queue')) {
            const messageId = args[0] as string
            for (let i = deletionQueue.length - 1; i >= 0; i--) {
              if (deletionQueue[i].message_id === messageId) deletionQueue.splice(i, 1)
            }
          }
        },
      }
    },
    transaction(fn: () => void) {
      return () => fn()
    },
  }
  return db
}

describe('REGRESSION — local inbox delete', () => {
  it('soft-deletes locally without deletion_queue or provider API', () => {
    deleteMessageMock.mockClear()
    const db = makeMemoryDb([
      { id: 'msg-1', email_message_id: 'gmail-abc', account_id: 'acct-1' },
    ])
    db.deletionQueue.push({ message_id: 'msg-1' })

    const r = deleteMessageLocal(db, 'msg-1')
    expect(r.ok).toBe(true)
    expect(deleteMessageMock).not.toHaveBeenCalled()

    const row = db.rows.get('msg-1')!
    expect(row.deleted).toBe(1)
    expect(row.lifecycle_remote_delete_skip_reason).toBe(LOCAL_WRDESK_DELETE_SKIP_REASON)
    expect(isLocallyDeletedRow(row)).toBe(true)
    expect(db.deletionQueue).toHaveLength(0)
  })

  it('bulk delete hides rows from main inbox (all filter)', () => {
    deleteMessageMock.mockClear()
    const db = makeMemoryDb([
      { id: 'a', email_message_id: 'e1', account_id: 'acct' },
      { id: 'b', email_message_id: 'e2', account_id: 'acct', source_type: 'direct_beap' },
      { id: 'c', email_message_id: 'e3', account_id: 'acct' },
    ])

    const r = bulkDeleteMessagesLocal(db, ['a', 'b'])
    expect(r.deleted).toBe(2)
    expect(deleteMessageMock).not.toHaveBeenCalled()

    const visible = [...db.rows.values()].filter((r) => r.deleted === 0).map((r) => r.id)
    expect(visible).toEqual(['c'])
  })

  it('re-pull dedupe: email_message_id remains after local delete (sync will skip re-insert)', () => {
    const db = makeMemoryDb([
      { id: 'msg-dup', email_message_id: 'provider-xyz', account_id: 'acct-9' },
    ])
    expect(deleteMessageLocal(db, 'msg-dup').ok).toBe(true)

    const existing = db
      .prepare(
        'SELECT email_message_id FROM inbox_messages WHERE account_id = ? AND email_message_id IS NOT NULL',
      )
      .all('acct-9') as Array<{ email_message_id: string }>
    expect(existing.map((r) => r.email_message_id)).toContain('provider-xyz')

    const visible = [...db.rows.values()].filter((r) => r.deleted === 0)
    expect(visible).toHaveLength(0)
  })

  it('sandbox clone delete is local-only (host copy unaffected — independent row)', () => {
    deleteMessageMock.mockClear()
    const db = makeMemoryDb([
      {
        id: 'clone-sbx',
        source_type: 'direct_beap',
        email_message_id: 'clone-prov-1',
        account_id: '__p2p_beap__',
      },
    ])
    expect(deleteMessageLocal(db, 'clone-sbx').ok).toBe(true)
    expect(db.rows.get('clone-sbx')?.deleted).toBe(1)
    expect(deleteMessageMock).not.toHaveBeenCalled()
  })

  it('buildInboxMessagesWhereClause excludes deleted rows from all tab', () => {
    const { where } = buildInboxMessagesWhereClause({ filter: 'all' })
    expect(where).toContain('deleted = 0')
  })
})
