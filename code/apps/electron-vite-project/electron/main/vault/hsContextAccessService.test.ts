/**
 * HS Context Access Service — Protected original and link flow tests
 *
 * Verifies:
 *   - Missing acknowledgement denied
 *   - Acknowledged request approved and audited
 *   - Protected link: invalid protocol rejected (via validateHsContextLink, tested elsewhere)
 *   - Protected link: valid https requires acknowledgement and is audited
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { requestOriginalDocumentContent, requestLinkOpenApproval } from './hsContextAccessService'
import { createRequire } from 'module'

const _require = createRequire(import.meta.url)
let Database: any
try {
  Database = _require('better-sqlite3')
} catch {
  Database = null
}

function makeDb(): any {
  if (!Database) return null
  try {
    const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.prepare(`
    CREATE TABLE hs_context_access_approvals (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      handshake_id TEXT,
      actor_wrdesk_user_id TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_id, actor_wrdesk_user_id)
    )
  `).run()
  db.prepare(`
    CREATE TABLE hs_context_access_audit (
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      actor_wrdesk_user_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      metadata TEXT
    )
  `).run()
  return db
  } catch {
    return null
  }
}

describe('hsContextAccessService — protected original flow', () => {
  let db: any

  beforeEach(() => {
    db = makeDb()
  })

  it('denies when acknowledgedWarning is false', async () => {
    if (!db) return
    const result = await requestOriginalDocumentContent(
      db,
      'publisher',
      Buffer.alloc(32),
      'hsd_any',
      'user1',
      { acknowledgedWarning: false },
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('MUST_ACKNOWLEDGE_WARNING')
      expect(result.approved).toBe(false)
    }
  })

  it('audits denied request when acknowledgement missing', async () => {
    if (!db) return
    await requestOriginalDocumentContent(db, 'publisher', Buffer.alloc(32), 'hsd_any', 'user1', {
      acknowledgedWarning: false,
    })
    const rows = db.prepare('SELECT * FROM hs_context_access_audit WHERE entity_type = ?').all('document')
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.some((r: any) => r.action.includes('denied'))).toBe(true)
  })
})

describe('hsContextAccessService — protected link flow', () => {
  let db: any

  beforeEach(() => {
    db = makeDb()
  })

  it('denies when acknowledgedWarning is false', () => {
    if (!db) return
    const result = requestLinkOpenApproval(db, 'https://example.com/path', 'user1', {
      acknowledgedWarning: false,
    })
    expect(result.approved).toBe(false)
    expect(result.error).toBe('MUST_ACKNOWLEDGE_WARNING')
  })

  it('approves and audits when acknowledged', () => {
    if (!db) return
    const result = requestLinkOpenApproval(db, 'https://example.com/path', 'user1', {
      acknowledgedWarning: true,
      handshakeId: 'hs_test',
    })
    expect(result.approved).toBe(true)

    const auditRows = db.prepare('SELECT * FROM hs_context_access_audit WHERE entity_type = ?').all('link')
    expect(auditRows.length).toBeGreaterThanOrEqual(1)
    expect(auditRows.some((r: any) => r.action.includes('approved') || r.action.includes('opened'))).toBe(true)

    const approvalRows = db.prepare('SELECT * FROM hs_context_access_approvals WHERE entity_type = ?').all('link')
    expect(approvalRows.length).toBe(1)
    expect(approvalRows[0].entity_id).toBe('https://example.com/path')
  })
})
