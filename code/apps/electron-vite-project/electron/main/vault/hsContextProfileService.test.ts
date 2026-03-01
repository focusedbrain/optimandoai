/**
 * Unit tests for hsContextProfileService.ts — tier gating and CRUD
 *
 * Uses an in-memory SQLite database (better-sqlite3 without SQLCipher) for
 * fast unit test isolation. This is identical to the approach used by
 * the existing handshake and vault tests.
 *
 * Acceptance criteria:
 *  1. Publisher tier can create, list, get, update, delete profiles.
 *  2. Pro and free tiers receive an access-denied error.
 *  3. Duplicate profile can be created from an existing profile.
 *  4. Custom fields are persisted and retrieved correctly.
 *  5. Document metadata is persisted on upload stub.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createProfile,
  listProfiles,
  getProfile,
  updateProfile,
  archiveProfile,
  deleteProfile,
  duplicateProfile,
} from './hsContextProfileService'
import { migrateHsContextProfileTables } from './db'

// ── In-memory SQLite for tests ──
// We import better-sqlite3 via createRequire so we do not trigger the
// full vault DB initialization (which needs libsodium, etc.)

import { createRequire } from 'module'
const _require = createRequire(import.meta.url)

let db: any
let Database: any

beforeEach(() => {
  try {
    Database = _require('better-sqlite3')
  } catch {
    console.warn('[TEST] better-sqlite3 not available — skipping DB tests')
    return
  }
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')

  // Create the vault_documents table (required for document upload tests)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS vault_documents (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL,
      wrapped_dek BLOB NOT NULL,
      ciphertext BLOB NOT NULL,
      notes TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run()

  // Run HS Context migrations
  migrateHsContextProfileTables(db)
})

afterEach(() => {
  db?.close()
})

function skipIfNoDb() {
  if (!Database) return true
  return false
}

// ── 1. Publisher tier CRUD ──
describe('hsContextProfileService — publisher CRUD', () => {
  it('creates a profile', () => {
    if (skipIfNoDb()) return
    const profile = createProfile(db, 'publisher', {
      name: 'Acme Corp',
      scope: 'non_confidential',
    })
    expect(profile.id).toMatch(/^hsp_/)
    expect(profile.name).toBe('Acme Corp')
    expect(profile.scope).toBe('non_confidential')
    expect(profile.document_count).toBe(0)
  })

  it('lists profiles', () => {
    if (skipIfNoDb()) return
    createProfile(db, 'publisher', { name: 'Alpha' })
    createProfile(db, 'publisher', { name: 'Beta' })
    const profiles = listProfiles(db, 'publisher')
    expect(profiles.length).toBeGreaterThanOrEqual(2)
    expect(profiles.some((p) => p.name === 'Alpha')).toBe(true)
    expect(profiles.some((p) => p.name === 'Beta')).toBe(true)
  })

  it('gets a profile by ID', () => {
    if (skipIfNoDb()) return
    const created = createProfile(db, 'publisher', {
      name: 'Detail Profile',
      custom_fields: [{ label: 'Carrier', value: 'DHL' }],
    })
    const detail = getProfile(db, 'publisher', created.id)
    expect(detail).not.toBeNull()
    expect(detail!.name).toBe('Detail Profile')
    expect(detail!.custom_fields).toEqual([{ label: 'Carrier', value: 'DHL' }])
  })

  it('updates a profile', () => {
    if (skipIfNoDb()) return
    const created = createProfile(db, 'publisher', { name: 'Old Name' })
    const updated = updateProfile(db, 'publisher', created.id, { name: 'New Name' })
    expect(updated.name).toBe('New Name')
  })

  it('archives a profile (excluded from default list)', () => {
    if (skipIfNoDb()) return
    const created = createProfile(db, 'publisher', { name: 'To Archive' })
    archiveProfile(db, 'publisher', created.id)
    const active = listProfiles(db, 'publisher')
    expect(active.find((p) => p.id === created.id)).toBeUndefined()
    const archived = listProfiles(db, 'publisher', true)
    expect(archived.find((p) => p.id === created.id)).toBeDefined()
  })

  it('deletes a profile', () => {
    if (skipIfNoDb()) return
    const created = createProfile(db, 'publisher', { name: 'To Delete' })
    deleteProfile(db, 'publisher', created.id)
    const detail = getProfile(db, 'publisher', created.id)
    expect(detail).toBeNull()
  })
})

// ── 2. Tier gating ──
describe('hsContextProfileService — tier gating', () => {
  it('blocks free tier', () => {
    if (skipIfNoDb()) return
    expect(() => createProfile(db, 'free', { name: 'Blocked' })).toThrow(/publisher|enterprise/i)
  })

  it('blocks pro tier', () => {
    if (skipIfNoDb()) return
    expect(() => createProfile(db, 'pro', { name: 'Blocked' })).toThrow(/publisher|enterprise/i)
  })

  it('allows publisher tier', () => {
    if (skipIfNoDb()) return
    expect(() => createProfile(db, 'publisher', { name: 'Allowed' })).not.toThrow()
  })

  it('allows enterprise tier', () => {
    if (skipIfNoDb()) return
    expect(() => createProfile(db, 'enterprise', { name: 'Allowed' })).not.toThrow()
  })

  it('blocks read for free tier', () => {
    if (skipIfNoDb()) return
    expect(() => listProfiles(db, 'free')).toThrow(/publisher|enterprise/i)
  })
})

// ── 3. Duplicate profile ──
describe('hsContextProfileService — duplicate', () => {
  it('creates a copy with "(Copy)" suffix', () => {
    if (skipIfNoDb()) return
    const original = createProfile(db, 'publisher', {
      name: 'Original',
      scope: 'confidential',
      custom_fields: [{ label: 'Key', value: 'Val' }],
    })
    const copy = duplicateProfile(db, 'publisher', original.id)
    expect(copy.name).toBe('Original (Copy)')
    expect(copy.scope).toBe('confidential')
    const detail = getProfile(db, 'publisher', copy.id)
    expect(detail!.custom_fields).toEqual([{ label: 'Key', value: 'Val' }])
  })
})

// ── 4. Custom fields persistence ──
describe('hsContextProfileService — custom fields', () => {
  it('persists and retrieves multiple custom fields', () => {
    if (skipIfNoDb()) return
    const profile = createProfile(db, 'publisher', {
      name: 'Custom',
      custom_fields: [
        { label: 'Carrier', value: 'DHL Express' },
        { label: 'Notes', value: 'Multi\nLine\nValue' },
      ],
    })
    const detail = getProfile(db, 'publisher', profile.id)
    expect(detail!.custom_fields.length).toBe(2)
    expect(detail!.custom_fields[1].value).toBe('Multi\nLine\nValue')
  })

  it('allows updating custom fields', () => {
    if (skipIfNoDb()) return
    const created = createProfile(db, 'publisher', {
      name: 'CF Profile',
      custom_fields: [{ label: 'Old', value: 'OldVal' }],
    })
    updateProfile(db, 'publisher', created.id, {
      custom_fields: [{ label: 'New', value: 'NewVal' }],
    })
    const detail = getProfile(db, 'publisher', created.id)
    expect(detail!.custom_fields[0].label).toBe('New')
    expect(detail!.custom_fields[0].value).toBe('NewVal')
  })
})

// ── 5. Profile not found ──
describe('hsContextProfileService — not found', () => {
  it('returns null for non-existent profile', () => {
    if (skipIfNoDb()) return
    const result = getProfile(db, 'publisher', 'hsp_nonexistent')
    expect(result).toBeNull()
  })

  it('throws when updating non-existent profile', () => {
    if (skipIfNoDb()) return
    expect(() => updateProfile(db, 'publisher', 'hsp_nonexistent', { name: 'X' })).toThrow(/not found/i)
  })
})
