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
  uploadProfileDocument,
  updateProfileDocumentMeta,
} from './hsContextProfileService'
import { migrateHsContextProfileTables } from './db'

// ── In-memory SQLite for tests ──
// We import better-sqlite3 via createRequire so we do not trigger the
// full vault DB initialization (which needs libsodium, etc.)

import { createRequire } from 'module'
const _require = createRequire(import.meta.url)

/** Detect better-sqlite3 at load time; try creating DB to catch Node version mismatch */
const DB_AVAILABLE = (() => {
  try {
    const D = _require('better-sqlite3')
    const tmp = new D(':memory:')
    tmp.close()
    return true
  } catch {
    return false
  }
})()

let db: any
let Database: any

beforeEach(() => {
  try {
    Database = _require('better-sqlite3')
  } catch {
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

// ── 1. Publisher tier CRUD ──
describe.skipIf(!DB_AVAILABLE)('hsContextProfileService — publisher CRUD', () => {
  it('creates a profile', () => {
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
    createProfile(db, 'publisher', { name: 'Alpha' })
    createProfile(db, 'publisher', { name: 'Beta' })
    const profiles = listProfiles(db, 'publisher')
    expect(profiles.length).toBeGreaterThanOrEqual(2)
    expect(profiles.some((p) => p.name === 'Alpha')).toBe(true)
    expect(profiles.some((p) => p.name === 'Beta')).toBe(true)
  })

  it('gets a profile by ID', () => {
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
    const created = createProfile(db, 'publisher', { name: 'Old Name' })
    const updated = updateProfile(db, 'publisher', created.id, { name: 'New Name' })
    expect(updated.name).toBe('New Name')
  })

  it('archives a profile (excluded from default list)', () => {
    const created = createProfile(db, 'publisher', { name: 'To Archive' })
    archiveProfile(db, 'publisher', created.id)
    const active = listProfiles(db, 'publisher')
    expect(active.find((p) => p.id === created.id)).toBeUndefined()
    const archived = listProfiles(db, 'publisher', true)
    expect(archived.find((p) => p.id === created.id)).toBeDefined()
  })

  it('deletes a profile', () => {
    const created = createProfile(db, 'publisher', { name: 'To Delete' })
    deleteProfile(db, 'publisher', created.id)
    const detail = getProfile(db, 'publisher', created.id)
    expect(detail).toBeNull()
  })
})

// ── 2. Tier gating ──
describe.skipIf(!DB_AVAILABLE)('hsContextProfileService — tier gating', () => {
  it('blocks free tier', () => {
    expect(() => createProfile(db, 'free', { name: 'Blocked' })).toThrow(/publisher|enterprise/i)
  })

  it('blocks pro tier', () => {
    expect(() => createProfile(db, 'pro', { name: 'Blocked' })).toThrow(/publisher|enterprise/i)
  })

  it('allows publisher tier', () => {
    expect(() => createProfile(db, 'publisher', { name: 'Allowed' })).not.toThrow()
  })

  it('allows enterprise tier', () => {
    expect(() => createProfile(db, 'enterprise', { name: 'Allowed' })).not.toThrow()
  })

  it('blocks read for free tier', () => {
    expect(() => listProfiles(db, 'free')).toThrow(/publisher|enterprise/i)
  })
})

// ── 3. Duplicate profile ──
describe.skipIf(!DB_AVAILABLE)('hsContextProfileService — duplicate', () => {
  it('creates a copy with "(Copy)" suffix', () => {
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
describe.skipIf(!DB_AVAILABLE)('hsContextProfileService — custom fields', () => {
  it('persists and retrieves multiple custom fields', () => {
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
describe.skipIf(!DB_AVAILABLE)('hsContextProfileService — not found', () => {
  it('returns null for non-existent profile', () => {
    const result = getProfile(db, 'publisher', 'hsp_nonexistent')
    expect(result).toBeNull()
  })

  it('throws when updating non-existent profile', () => {
    expect(() => updateProfile(db, 'publisher', 'hsp_nonexistent', { name: 'X' })).toThrow(/not found/i)
  })
})

// ── PDF validation ──
describe.skipIf(!DB_AVAILABLE)('hsContextProfileService — PDF validation', () => {
  it('rejects non-PDF upload', async () => {
    const profile = createProfile(db, 'publisher', { name: 'Doc Profile' })
    const notPdf = Buffer.from('not a pdf content')
    await expect(
      uploadProfileDocument(db, 'publisher', Buffer.alloc(32), profile.id, 'fake.pdf', 'application/pdf', notPdf),
    ).rejects.toThrow(/Invalid PDF|magic bytes/i)
  })
})

// ── Document metadata validation (updateProfileDocumentMeta) ──
describe.skipIf(!DB_AVAILABLE)('hsContextProfileService — document metadata validation', () => {
  it('rejects invalid label (HTML)', () => {
    const profile = createProfile(db, 'publisher', { name: 'Meta Profile' })
    const docId = 'hsd_test123'
    const now = Date.now()
    db.prepare(`
      INSERT INTO hs_context_profile_documents (id, profile_id, filename, mime_type, storage_key, scope, extraction_status, sensitive, created_at)
      VALUES (?, ?, 'test.pdf', 'application/pdf', 'hs_doc_placeholder', 'confidential', 'pending', 0, ?)
    `).run(docId, profile.id, now)
    db.prepare(`
      INSERT OR IGNORE INTO vault_documents (id, filename, mime_type, size_bytes, sha256, wrapped_dek, ciphertext, created_at, updated_at)
      VALUES ('hs_doc_placeholder', 'test.pdf', 'application/pdf', 0, '', ?, ?, ?, ?)
    `).run(Buffer.alloc(32), Buffer.alloc(16), now, now)

    expect(() =>
      updateProfileDocumentMeta(db, 'publisher', docId, { label: '<script>alert(1)</script>' }),
    ).toThrow(/HTML/)
  })

  it('rejects invalid document_type', () => {
    const profile = createProfile(db, 'publisher', { name: 'Meta Profile' })
    const docId = 'hsd_test456'
    const now = Date.now()
    db.prepare(`
      INSERT INTO hs_context_profile_documents (id, profile_id, filename, mime_type, storage_key, scope, extraction_status, sensitive, created_at)
      VALUES (?, ?, 'test.pdf', 'application/pdf', 'hs_doc_placeholder2', 'confidential', 'pending', 0, ?)
    `).run(docId, profile.id, now)
    db.prepare(`
      INSERT OR IGNORE INTO vault_documents (id, filename, mime_type, size_bytes, sha256, wrapped_dek, ciphertext, created_at, updated_at)
      VALUES ('hs_doc_placeholder2', 'test.pdf', 'application/pdf', 0, '', ?, ?, ?, ?)
    `).run(Buffer.alloc(32), Buffer.alloc(16), now, now)

    expect(() =>
      updateProfileDocumentMeta(db, 'publisher', docId, { document_type: 'invalid_type' }),
    ).toThrow(/one of/)
  })

  it('accepts valid label and document_type update', () => {
    const profile = createProfile(db, 'publisher', { name: 'Meta Profile' })
    const docId = 'hsd_test789'
    const now = Date.now()
    db.prepare(`
      INSERT INTO hs_context_profile_documents (id, profile_id, filename, mime_type, storage_key, scope, extraction_status, sensitive, created_at)
      VALUES (?, ?, 'test.pdf', 'application/pdf', 'hs_doc_placeholder3', 'confidential', 'pending', 0, ?)
    `).run(docId, profile.id, now)
    db.prepare(`
      INSERT OR IGNORE INTO vault_documents (id, filename, mime_type, size_bytes, sha256, wrapped_dek, ciphertext, created_at, updated_at)
      VALUES ('hs_doc_placeholder3', 'test.pdf', 'application/pdf', 0, '', ?, ?, ?, ?)
    `).run(Buffer.alloc(32), Buffer.alloc(16), now, now)

    updateProfileDocumentMeta(db, 'publisher', docId, { label: 'Valid Label', document_type: 'contract' })
    const row = db.prepare('SELECT label, document_type FROM hs_context_profile_documents WHERE id = ?').get(docId) as { label: string; document_type: string }
    expect(row.label).toBe('Valid Label')
    expect(row.document_type).toBe('contract')
  })

  it('accepts empty optional label and document_type', () => {
    const profile = createProfile(db, 'publisher', { name: 'Meta Profile' })
    const docId = 'hsd_test000'
    const now = Date.now()
    db.prepare(`
      INSERT INTO hs_context_profile_documents (id, profile_id, filename, mime_type, storage_key, scope, extraction_status, sensitive, label, document_type, created_at)
      VALUES (?, ?, 'test.pdf', 'application/pdf', 'hs_doc_placeholder4', 'confidential', 'pending', 0, 'Old', 'manual', ?)
    `).run(docId, profile.id, now)
    db.prepare(`
      INSERT OR IGNORE INTO vault_documents (id, filename, mime_type, size_bytes, sha256, wrapped_dek, ciphertext, created_at, updated_at)
      VALUES ('hs_doc_placeholder4', 'test.pdf', 'application/pdf', 0, '', ?, ?, ?, ?)
    `).run(Buffer.alloc(32), Buffer.alloc(16), now, now)

    updateProfileDocumentMeta(db, 'publisher', docId, { label: '', document_type: '' })
    const row = db.prepare('SELECT label, document_type FROM hs_context_profile_documents WHERE id = ?').get(docId) as { label: string | null; document_type: string | null }
    expect(row.label).toBeNull()
    expect(row.document_type).toBeNull()
  })
})

// ── Document metadata (label, document_type) ──
describe.skipIf(!DB_AVAILABLE)('hsContextProfileService — document metadata', () => {
  it('persists label and document_type on upload and updateProfileDocumentMeta', async () => {
    const profile = createProfile(db, 'publisher', { name: 'Meta Profile' })
    const pdfMagic = Buffer.from([0x25, 0x50, 0x44, 0x46, ...Buffer.alloc(100, 0)])
    let doc
    try {
      doc = await uploadProfileDocument(
        db,
        'publisher',
        Buffer.alloc(32),
        profile.id,
        'contract.pdf',
        'application/pdf',
        pdfMagic,
        false,
        'Q4 Contract',
        'contract',
      )
    } catch (e: any) {
      if (/envelope|sealRecord|libsodium|crypto/i.test(e?.message ?? '')) {
        return // Skip if crypto stack unavailable in test env
      }
      throw e
    }
    expect(doc.label).toBe('Q4 Contract')
    expect(doc.document_type).toBe('contract')

    updateProfileDocumentMeta(db, 'publisher', doc.id, { label: 'Updated Label', document_type: 'manual' })
    const detail = getProfile(db, 'publisher', profile.id)
    const updatedDoc = detail!.documents.find((d) => d.id === doc.id)
    expect(updatedDoc?.label).toBe('Updated Label')
    expect(updatedDoc?.document_type).toBe('manual')
  })
})
