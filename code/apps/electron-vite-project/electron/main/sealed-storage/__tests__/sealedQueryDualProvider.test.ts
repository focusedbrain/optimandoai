/**
 * W4-P10 — sealedQuery dual key provider entry gate and per-row seal_key_source routing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  bindKeyProvider,
  unbindKeyProvider,
  isKeyProviderBound,
  sealedQuery,
  SealVerificationError,
  computeSeal,
  clearTamperingEvents,
} from '../index'
import { deriveLedgerSealKey } from '../ledgerSealKey'
import {
  createSealedStorageTestContext,
  type SealedStorageTestContext,
} from 'test/harness/sealed-storage'

const OUTER_SESSION = 'test-ledger-seal-session-stable'
const OUTER_KEY = deriveLedgerSealKey(OUTER_SESSION)

function bindOuterOnly(): void {
  unbindKeyProvider('inner')
  unbindKeyProvider('outer')
  bindKeyProvider(() => Buffer.from(OUTER_KEY), 'outer')
}

function bindInnerOnly(ctx: SealedStorageTestContext): void {
  unbindKeyProvider('outer')
  unbindKeyProvider('inner')
  bindKeyProvider(ctx.keyProvider, 'inner')
}

describe('sealedQuery — dual provider entry gate (W4-P10)', () => {
  let ctx: SealedStorageTestContext

  beforeEach(() => {
    ctx = createSealedStorageTestContext()
    clearTamperingEvents()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  it('outer provider only + ledger row succeeds verification', () => {
    if (!ctx.db) return

    bindOuterOnly()
    expect(isKeyProviderBound('outer')).toBe(true)
    expect(isKeyProviderBound('inner')).toBe(false)

    const msgId = randomUUID()
    const content = { id: msgId, body: 'ledger-sealed clone source' }
    const canonical = JSON.stringify(content)
    const { seal, seal_input_json } = computeSeal(canonical, msgId, 'outer')

    ctx.db
      .prepare(
        `INSERT INTO inbox_messages
           (id, depackaged_json, seal, seal_input_json, seal_key_source)
         VALUES (?, ?, ?, ?, 'ledger')`,
      )
      .run(msgId, canonical, seal, seal_input_json)

    const rows = sealedQuery(
      ctx.db,
      'SELECT id, depackaged_json, seal, seal_input_json, seal_key_source FROM inbox_messages WHERE id = ?',
      [msgId],
      'depackaged_json',
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.depackaged_json).toBe(canonical)
  })

  it('no providers bound throws SealVerificationError', () => {
    if (!ctx.db) return

    unbindKeyProvider('inner')
    unbindKeyProvider('outer')

    const msgId = randomUUID()
    ctx.db
      .prepare(
        `INSERT INTO inbox_messages (id, depackaged_json, seal, seal_input_json, seal_key_source)
         VALUES (?, '{}', 'x', '{}', 'ledger')`,
      )
      .run(msgId)

    expect(() =>
      sealedQuery(
        ctx.db,
        'SELECT id, depackaged_json, seal, seal_input_json, seal_key_source FROM inbox_messages WHERE id = ?',
        [msgId],
        'depackaged_json',
      ),
    ).toThrow(SealVerificationError)
  })

  it('outer provider only + vmk row returns no verified rows (no plaintext leak)', () => {
    if (!ctx.db) return

    bindOuterOnly()

    const msgId = randomUUID()
    const content = { id: msgId, body: 'vmk-sealed secret' }
    const { seal, seal_input_json, canonical_json } = ctx.buildValidSealForRowId(msgId, content)

    ctx.db
      .prepare(
        `INSERT INTO inbox_messages
           (id, depackaged_json, seal, seal_input_json, seal_key_source)
         VALUES (?, ?, ?, ?, 'vmk')`,
      )
      .run(msgId, canonical_json, seal, seal_input_json)

    const rows = sealedQuery(
      ctx.db,
      'SELECT id, depackaged_json, seal, seal_input_json, seal_key_source FROM inbox_messages WHERE id = ?',
      [msgId],
      'depackaged_json',
    )

    expect(rows).toHaveLength(0)
  })

  it('inner provider only + vmk row succeeds verification', () => {
    if (!ctx.db) return

    bindInnerOnly(ctx)

    const msgId = randomUUID()
    const content = { id: msgId, body: 'vmk ok' }
    const { seal, seal_input_json, canonical_json } = ctx.buildValidSealForRowId(msgId, content)

    ctx.db
      .prepare(
        `INSERT INTO inbox_messages
           (id, depackaged_json, seal, seal_input_json, seal_key_source)
         VALUES (?, ?, ?, ?, 'vmk')`,
      )
      .run(msgId, canonical_json, seal, seal_input_json)

    const rows = sealedQuery(
      ctx.db,
      'SELECT id, depackaged_json, seal, seal_input_json, seal_key_source FROM inbox_messages WHERE id = ?',
      [msgId],
      'depackaged_json',
    )

    expect(rows).toHaveLength(1)
  })
})
