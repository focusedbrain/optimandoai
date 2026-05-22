import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  bindKeyProvider,
  unbindKeyProvider,
  computeSeal,
  clearTamperingEvents,
} from '../../sealed-storage'
import {
  createSealedStorageTestContext,
  type SealedStorageTestContext,
} from 'test/harness/sealed-storage'
import { filterInboxRowsWithVerifiedSeals, toDeferredInboxListRow } from '../inboxSealedRead'

describe('inboxSealedRead', () => {
  let ctx: SealedStorageTestContext

  beforeEach(() => {
    ctx = createSealedStorageTestContext()
    clearTamperingEvents()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  it('returns deferred list row when inner key is required but unavailable', () => {
    if (!ctx.db) return

    unbindKeyProvider('inner')
    unbindKeyProvider('outer')

    const msgId = randomUUID()
    const canonical = JSON.stringify({ id: msgId, body: 'secret body' })
    bindKeyProvider(ctx.keyProvider, 'inner')
    const { seal, seal_input_json } = computeSeal(canonical, msgId, 'inner')
    unbindKeyProvider('inner')

    ctx.db
      .prepare(
        `INSERT INTO inbox_messages
           (id, subject, from_address, depackaged_json, seal, seal_input_json, seal_key_source)
         VALUES (?, 'Test subject', 'sender@example.com', ?, ?, ?, 'vmk')`,
      )
      .run(msgId, canonical, seal, seal_input_json)

    const raw = ctx.db.prepare('SELECT * FROM inbox_messages WHERE id = ?').all(msgId) as Array<Record<string, unknown>>
    const filtered = filterInboxRowsWithVerifiedSeals(ctx.db, raw)

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.pending_reason_code).toBe('inner_vault_locked')
    expect(filtered[0]?.subject).toBe('Test subject')
    expect(filtered[0]?.depackaged_json).toBeNull()
  })

  it('returns verified row when the matching provider is available', () => {
    if (!ctx.db) return

    unbindKeyProvider('inner')
    unbindKeyProvider('outer')
    bindKeyProvider(ctx.keyProvider, 'inner')

    const msgId = randomUUID()
    const canonical = JSON.stringify({ id: msgId, body: 'verified body' })
    const { seal, seal_input_json } = computeSeal(canonical, msgId, 'inner')

    ctx.db
      .prepare(
        `INSERT INTO inbox_messages
           (id, depackaged_json, seal, seal_input_json, seal_key_source)
         VALUES (?, ?, ?, ?, 'vmk')`,
      )
      .run(msgId, canonical, seal, seal_input_json)

    const raw = ctx.db.prepare('SELECT * FROM inbox_messages WHERE id = ?').all(msgId) as Array<Record<string, unknown>>
    const filtered = filterInboxRowsWithVerifiedSeals(ctx.db, raw)

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.pending_reason_code).toBeFalsy()
    expect(filtered[0]?.depackaged_json).toBe(canonical)
  })

  it('toDeferredInboxListRow strips sealed plaintext fields', () => {
    const row = toDeferredInboxListRow(
      {
        id: 'x',
        subject: 'Hello',
        body_text: 'secret',
        depackaged_json: '{"x":1}',
      },
      'inner_vault_locked',
    )
    expect(row.pending_reason_code).toBe('inner_vault_locked')
    expect(row.subject).toBe('Hello')
    expect(row.body_text).toBeNull()
    expect(row.depackaged_json).toBeNull()
  })
})
