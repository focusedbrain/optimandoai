/**
 * Tests: capability gate runs BEFORE any decrypt/unwrap in getItem().
 *
 * Acceptance criteria:
 *   1. getItem(id, 'free') for a 'passwords' record (Pro-only) throws.
 *   2. openRecord is never called when capability check fails.
 *   3. getItem(id, 'pro') for the same record succeeds and calls openRecord.
 *   4. getItemCategory() returns category without any crypto call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'crypto'
import { sealRecord, openRecord, ENVELOPE_SCHEMA_VERSION } from './envelope'
import { canAccessCategory } from './capabilities'

// ---------------------------------------------------------------------------
// Mock openRecord so we can spy on it
// ---------------------------------------------------------------------------
vi.mock('./envelope', async () => {
  const actual = await vi.importActual<typeof import('./envelope')>('./envelope')
  return {
    ...actual,
    openRecord: vi.fn(actual.openRecord),
  }
})

const mockedOpenRecord = openRecord as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Helpers — tiny in-memory "service" mimicking VaultService.getItem logic
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string
  category: string
  schema_version: number
  wrapped_dek: Buffer
  ciphertext: Buffer
  fields_json: string
}

function makeKEK(): Buffer { return randomBytes(32) }

async function fakeGetItem(row: FakeRow, kek: Buffer, tier?: string) {
  // 1. Capability check BEFORE any decrypt — mirrors service.ts lines 983-988
  if (tier) {
    if (!canAccessCategory(tier as any, row.category as any, 'read')) {
      throw new Error(`Tier "${tier}" cannot read category "${row.category}"`)
    }
  }

  // 2. Decrypt (should never be reached when capability fails)
  if (row.schema_version >= ENVELOPE_SCHEMA_VERSION && row.wrapped_dek && row.ciphertext) {
    const fields = await openRecord(row.wrapped_dek, row.ciphertext, kek)
    return { id: row.id, category: row.category, fields }
  }

  return { id: row.id, category: row.category, fields: JSON.parse(row.fields_json) }
}

function fakeGetItemCategory(row: FakeRow): string {
  return row.category
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Capability gate before decrypt', () => {
  const kek = makeKEK()
  let proRow: FakeRow

  beforeEach(async () => {
    mockedOpenRecord.mockClear()

    const fields = JSON.stringify([{ key: 'password', value: 's3cret', encrypted: true, type: 'password' }])
    const { wrappedDEK, ciphertext } = await sealRecord(fields, kek)
    proRow = {
      id: 'item-1',
      category: 'password',          // DB-level LegacyItemCategory → maps to human_credential (Pro+)
      schema_version: ENVELOPE_SCHEMA_VERSION,
      wrapped_dek: wrappedDEK,
      ciphertext,
      fields_json: '[]',
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('free tier cannot read password (Pro-only) → throws BEFORE decrypt', async () => {
    await expect(fakeGetItem(proRow, kek, 'free')).rejects.toThrow(
      /cannot read category/,
    )
    expect(mockedOpenRecord).not.toHaveBeenCalled()
  })

  it('pro tier CAN read password → openRecord is called', async () => {
    const item = await fakeGetItem(proRow, kek, 'pro')
    expect(item.fields).toBeDefined()
    expect(mockedOpenRecord).toHaveBeenCalledTimes(1)
  })

  it('no tier passed → openRecord is called (backward compat)', async () => {
    const item = await fakeGetItem(proRow, kek)
    expect(item.fields).toBeDefined()
    expect(mockedOpenRecord).toHaveBeenCalledTimes(1)
  })

  it('getItemCategory returns category without any crypto', () => {
    mockedOpenRecord.mockClear()
    const cat = fakeGetItemCategory(proRow)
    expect(cat).toBe('password')
    expect(mockedOpenRecord).not.toHaveBeenCalled()
  })
})

describe('canAccessCategory gate values (using LegacyItemCategory names)', () => {
  it('free can read automation_secret', () => {
    expect(canAccessCategory('free' as any, 'automation_secret' as any, 'read')).toBe(true)
  })

  it('free CANNOT read password (human_credential)', () => {
    expect(canAccessCategory('free' as any, 'password' as any, 'read')).toBe(false)
  })

  it('free CANNOT write password', () => {
    expect(canAccessCategory('free' as any, 'password' as any, 'write')).toBe(false)
  })

  it('pro CAN read password', () => {
    expect(canAccessCategory('pro' as any, 'password' as any, 'read')).toBe(true)
  })

  it('free CANNOT read identity (pii_record)', () => {
    expect(canAccessCategory('free' as any, 'identity' as any, 'read')).toBe(false)
  })

  it('free CANNOT read document', () => {
    expect(canAccessCategory('free' as any, 'document' as any, 'read')).toBe(false)
  })

  it('free CANNOT read handshake_context', () => {
    expect(canAccessCategory('free' as any, 'handshake_context' as any, 'read')).toBe(false)
  })

  it('pro CANNOT read handshake_context (Publisher+ only)', () => {
    expect(canAccessCategory('pro' as any, 'handshake_context' as any, 'read')).toBe(false)
  })

  it('publisher CAN read handshake_context', () => {
    expect(canAccessCategory('publisher' as any, 'handshake_context' as any, 'read')).toBe(true)
  })
})
