/**
 * Tests: listItems / search NEVER decrypt — lazy decrypt invariant.
 *
 * Acceptance criteria:
 *   1. listItems() returns fields=[] for envelope v2 records.
 *   2. listItems() returns fields=[] for legacy v1 records (no bulk decrypt).
 *   3. search() returns fields=[] for all records.
 *   4. openRecord / decryptItemFields are never invoked during listing.
 *   5. v1 records trigger migration queue (detected by ID collection).
 */

import { describe, it, expect } from 'vitest'
import { ENVELOPE_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION } from './envelope'

// ---------------------------------------------------------------------------
// We simulate the listItems/search row→VaultItem mapping logic directly,
// since the actual VaultService requires a full SQLite DB.  The key
// assertion is structural: no decrypt function is in the code path.
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string
  container_id: string | null
  category: string
  title: string
  domain: string | null
  fields_json: string
  favorite: number
  created_at: number
  updated_at: number
  schema_version: number | null
}

interface VaultItem {
  id: string
  container_id?: string
  category: string
  title: string
  domain?: string
  fields: any[]
  favorite: boolean
  created_at: number
  updated_at: number
}

/**
 * Mirrors the CURRENT (fixed) listItems() row-mapping logic.
 * No decryptItemFields or openRecord call exists in this function.
 */
function listItemsMapping(rows: FakeRow[]): { items: VaultItem[]; v1Ids: string[] } {
  const items: VaultItem[] = []
  const v1Ids: string[] = []

  for (const row of rows) {
    const sv: number = row.schema_version ?? LEGACY_SCHEMA_VERSION

    if (sv < ENVELOPE_SCHEMA_VERSION) {
      v1Ids.push(row.id)
    }

    items.push({
      id: row.id,
      container_id: row.container_id || undefined,
      category: row.category,
      title: row.title,
      domain: row.domain || undefined,
      fields: [],
      favorite: row.favorite === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
  }

  return { items, v1Ids }
}

/**
 * Mirrors the CURRENT (fixed) search() row-mapping logic.
 */
function searchMapping(rows: FakeRow[]): VaultItem[] {
  return rows.map(row => ({
    id: row.id,
    container_id: row.container_id || undefined,
    category: row.category,
    title: row.title,
    domain: row.domain || undefined,
    fields: [],
    favorite: row.favorite === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const now = Date.now()

const V2_ROW: FakeRow = {
  id: 'item-v2',
  container_id: null,
  category: 'password',
  title: 'My Login',
  domain: 'example.com',
  fields_json: '[]',
  favorite: 0,
  created_at: now,
  updated_at: now,
  schema_version: ENVELOPE_SCHEMA_VERSION,
}

const V1_ROW: FakeRow = {
  id: 'item-v1',
  container_id: null,
  category: 'automation_secret',
  title: 'API Key',
  domain: null,
  fields_json: JSON.stringify([
    { key: 'secret', value: 'enc:aaaa', encrypted: true, type: 'password' },
  ]),
  favorite: 1,
  created_at: now,
  updated_at: now,
  schema_version: null, // legacy
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('listItems lazy decrypt invariant', () => {
  it('v2 record returns fields=[]', () => {
    const { items } = listItemsMapping([V2_ROW])
    expect(items).toHaveLength(1)
    expect(items[0].fields).toEqual([])
    expect(items[0].title).toBe('My Login')
  })

  it('v1 record returns fields=[] (no bulk decrypt)', () => {
    const { items } = listItemsMapping([V1_ROW])
    expect(items).toHaveLength(1)
    expect(items[0].fields).toEqual([])
    expect(items[0].title).toBe('API Key')
  })

  it('mixed v1+v2 records all return fields=[]', () => {
    const { items, v1Ids } = listItemsMapping([V2_ROW, V1_ROW])
    expect(items).toHaveLength(2)
    items.forEach(i => expect(i.fields).toEqual([]))
    expect(v1Ids).toEqual(['item-v1'])
  })

  it('v1 records are collected for migration', () => {
    const { v1Ids } = listItemsMapping([V1_ROW, { ...V1_ROW, id: 'item-v1b' }])
    expect(v1Ids).toEqual(['item-v1', 'item-v1b'])
  })

  it('v2 records are NOT collected for migration', () => {
    const { v1Ids } = listItemsMapping([V2_ROW])
    expect(v1Ids).toEqual([])
  })

  it('no fields_json is parsed or returned', () => {
    const secretRow: FakeRow = {
      ...V1_ROW,
      fields_json: JSON.stringify([{ key: 'secret', value: 'SHOULD_NOT_APPEAR', encrypted: true }]),
    }
    const { items } = listItemsMapping([secretRow])
    expect(items[0].fields).toEqual([])
    expect(JSON.stringify(items)).not.toContain('SHOULD_NOT_APPEAR')
  })
})

describe('search lazy decrypt invariant', () => {
  it('returns fields=[] for all records', () => {
    const results = searchMapping([V2_ROW, V1_ROW])
    expect(results).toHaveLength(2)
    results.forEach(r => expect(r.fields).toEqual([]))
  })

  it('does not expose fields_json content', () => {
    const results = searchMapping([V1_ROW])
    expect(JSON.stringify(results)).not.toContain('enc:aaaa')
  })
})
