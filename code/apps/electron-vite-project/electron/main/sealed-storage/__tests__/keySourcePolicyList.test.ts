/**
 * Seal-key-source policy unification (approved item ii).
 *
 * The defect: the extension's sealed inbox read routed from the row's
 * `seal_key_source` tag alone. A legacy inner-sealed NON-confidential row was
 * therefore filtered whenever the inner vault was locked — invisible in the
 * extension while the Electron inbox showed it — AND recorded as a tamper
 * event even though nothing about the row was tampered.
 *
 * False tamper telemetry for an untampered row is itself the regression to
 * prevent, so it gets its own assertions rather than riding along on the
 * visibility check.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { createHash, createHmac } from 'node:crypto'
import {
  bindKeyProvider,
  unbindKeyProvider,
  clearTamperingEvents,
  getTamperingEvents,
  sealedQuery,
  type KeySource,
} from '../index'

const _require = createRequire(import.meta.url)
let Database: any = null
try {
  Database = _require('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
} catch {
  Database = null
}

const INNER_KEY = Buffer.alloc(32, 7)
const OUTER_KEY = Buffer.alloc(32, 9)

const SELECT = `SELECT id, source_type, handshake_id, depackaged_json, seal, seal_input_json, seal_key_source
                FROM inbox_messages WHERE deleted = 0`

function makeDb(): any {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE inbox_messages (
    id TEXT PRIMARY KEY,
    source_type TEXT,
    handshake_id TEXT,
    depackaged_json TEXT,
    deleted INTEGER NOT NULL DEFAULT 0,
    seal TEXT,
    seal_input_json TEXT,
    seal_key_source TEXT
  )`)
  return db
}

/** Seal a row the way the writer would, with an explicit key. */
function insertRow(
  db: any,
  opts: { id: string; sourceType: string; handshakeId: string | null; tag: string; key: Buffer; corrupt?: boolean },
): void {
  const canonical = JSON.stringify({ body: { text: `content for ${opts.id}` } })
  const sealInput = JSON.stringify({
    row_id: opts.id,
    content_sha256: createHash('sha256').update(canonical, 'utf8').digest('hex'),
  })
  const seal = createHmac('sha256', opts.key).update(sealInput, 'utf8').digest('base64')
  db.prepare(
    `INSERT INTO inbox_messages (id, source_type, handshake_id, depackaged_json, seal, seal_input_json, seal_key_source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id,
    opts.sourceType,
    opts.handshakeId,
    canonical,
    opts.corrupt ? Buffer.from('not-the-right-mac').toString('base64') : seal,
    sealInput,
    opts.tag,
  )
}

/** The policy an extension inbox read applies: non-confidential may try both. */
const policy = (row: { source_type?: unknown; handshake_id?: unknown }): readonly KeySource[] => {
  const st = String(row.source_type ?? '')
  const isDepackagedEmail = st === 'email_plain' || st === 'email_beap'
  return isDepackagedEmail ? ['outer', 'inner'] : ['inner']
}

describe.skipIf(!Database)('sealedQuery — opt-in key-source list', () => {
  beforeEach(() => {
    unbindKeyProvider('inner')
    unbindKeyProvider('outer')
    clearTamperingEvents()
  })
  afterEach(() => {
    unbindKeyProvider('inner')
    unbindKeyProvider('outer')
    clearTamperingEvents()
  })

  it('DEFAULT behaviour is unchanged: a vmk row needs the inner provider', () => {
    const db = makeDb()
    try {
      insertRow(db, { id: 'r1', sourceType: 'email_plain', handshakeId: null, tag: 'vmk', key: INNER_KEY })
      bindKeyProvider(() => Buffer.from(OUTER_KEY), 'outer')

      // No options ⇒ historical routing ⇒ filtered, tamper recorded.
      const rows = sealedQuery(db, SELECT, [], 'depackaged_json')
      expect(rows).toHaveLength(0)
      expect(getTamperingEvents().length).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })

  it('THE FIX: a legacy inner-sealed non-confidential row becomes visible', () => {
    const db = makeDb()
    try {
      insertRow(db, { id: 'r1', sourceType: 'email_plain', handshakeId: null, tag: 'vmk', key: INNER_KEY })
      bindKeyProvider(() => Buffer.from(OUTER_KEY), 'outer')
      bindKeyProvider(() => Buffer.from(INNER_KEY), 'inner')

      const rows = sealedQuery(db, SELECT, [], 'depackaged_json', { keySources: policy })
      expect(rows).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  it('THE FIX: and emits ZERO tamper telemetry for that untampered row', () => {
    const db = makeDb()
    try {
      insertRow(db, { id: 'r1', sourceType: 'email_plain', handshakeId: null, tag: 'vmk', key: INNER_KEY })
      bindKeyProvider(() => Buffer.from(OUTER_KEY), 'outer')
      bindKeyProvider(() => Buffer.from(INNER_KEY), 'inner')

      const rows = sealedQuery(db, SELECT, [], 'depackaged_json', { keySources: policy })
      expect(rows).toHaveLength(1)
      // The outer key is tried FIRST and does not match. That is a candidate
      // miss, not evidence about the row, and must not be reported as tampering.
      expect(getTamperingEvents()).toEqual([])
    } finally {
      db.close()
    }
  })

  it('a genuinely tampered row still fails and DOES record tampering', () => {
    const db = makeDb()
    try {
      insertRow(db, {
        id: 'bad',
        sourceType: 'email_plain',
        handshakeId: null,
        tag: 'vmk',
        key: INNER_KEY,
        corrupt: true,
      })
      bindKeyProvider(() => Buffer.from(OUTER_KEY), 'outer')
      bindKeyProvider(() => Buffer.from(INNER_KEY), 'inner')

      const rows = sealedQuery(db, SELECT, [], 'depackaged_json', { keySources: policy })
      expect(rows).toHaveLength(0)
      expect(getTamperingEvents().map((e) => e.reason)).toContain('hmac_mismatch')
    } finally {
      db.close()
    }
  })

  it('the policy is PER ROW: a confidential row is never verified with the outer key', () => {
    const db = makeDb()
    try {
      // A confidential row sealed with the OUTER key would be a policy
      // violation; the resolver returns ['inner'] for it, so it must not pass
      // even though the outer provider is bound and the mac would match.
      insertRow(db, {
        id: 'conf',
        sourceType: 'direct_beap',
        handshakeId: 'hs-conf',
        tag: 'ledger',
        key: OUTER_KEY,
      })
      insertRow(db, {
        id: 'plain',
        sourceType: 'email_plain',
        handshakeId: null,
        tag: 'vmk',
        key: INNER_KEY,
      })
      bindKeyProvider(() => Buffer.from(OUTER_KEY), 'outer')
      bindKeyProvider(() => Buffer.from(INNER_KEY), 'inner')

      const rows = sealedQuery<{ id: string }>(db, SELECT, [], 'depackaged_json', {
        keySources: policy,
      })
      expect(rows.map((r) => r.id)).toEqual(['plain'])
    } finally {
      db.close()
    }
  })

  it('no usable provider in the list is still a filtered row', () => {
    const db = makeDb()
    try {
      insertRow(db, { id: 'r1', sourceType: 'email_plain', handshakeId: null, tag: 'vmk', key: INNER_KEY })
      bindKeyProvider(() => Buffer.from(OUTER_KEY), 'outer')
      // Only outer bound; policy allows outer+inner but neither verifies.
      const rows = sealedQuery(db, SELECT, [], 'depackaged_json', { keySources: policy })
      expect(rows).toHaveLength(0)
      // It failed against every permitted provider, so telemetry is warranted.
      expect(getTamperingEvents().length).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })

  it('an empty resolver result falls back to the historical routing', () => {
    const db = makeDb()
    try {
      insertRow(db, { id: 'r1', sourceType: 'email_plain', handshakeId: null, tag: 'vmk', key: INNER_KEY })
      bindKeyProvider(() => Buffer.from(INNER_KEY), 'inner')
      const rows = sealedQuery(db, SELECT, [], 'depackaged_json', { keySources: () => [] })
      expect(rows).toHaveLength(1) // vmk → inner, which is bound
    } finally {
      db.close()
    }
  })
})
