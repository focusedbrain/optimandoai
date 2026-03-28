/**
 * Merge Stage-5 depackaged BEAP content from the Chromium extension into `inbox_messages`.
 * Keys rows by exact `beap_package_json` match (same string as `p2p_pending_beap` / coordination push).
 */

import { createHash, randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { writeEncryptedAttachmentFile } from './attachmentBlobCrypto'
import { makeInboxAttachmentStorageId } from './messageRouter'

/** Only BeapPackageBuilder user send paths set this (Electron renderer + extension). */
export const USER_PACKAGE_BUILDER_SEND_SOURCE = 'user_package_builder'

export interface MergeDepackagedAttachmentInput {
  content_id: string
  filename: string
  content_type: string
  size_bytes: number
  /** Raw file bytes from extension Stage-5 artefacts (original class). */
  base64?: string | null
}

export interface MergeExtensionDepackagedInput {
  beap_package_json: string
  /** Narrows fallback scan when JSON string equality differs by whitespace. */
  handshake_id?: string | null
  depackaged_json: string
  body_text?: string | null
  attachments?: MergeDepackagedAttachmentInput[]
}

function normalizePackageJson(s: string): string {
  const t = (s ?? '').trim()
  if (!t) return ''
  try {
    return JSON.stringify(JSON.parse(t))
  } catch {
    return t
  }
}

export function mergeExtensionDepackaged(
  db: any,
  input: MergeExtensionDepackagedInput,
): { ok: boolean; messageId?: string; handshakeId?: string | null; error?: string } {
  if (!db) return { ok: false, error: 'Database unavailable' }
  const rawPkg = typeof input.beap_package_json === 'string' ? input.beap_package_json.trim() : ''
  if (!rawPkg) return { ok: false, error: 'beap_package_json required' }
  const depackaged = typeof input.depackaged_json === 'string' ? input.depackaged_json.trim() : ''
  if (!depackaged) return { ok: false, error: 'depackaged_json required' }

  const norm = normalizePackageJson(rawPkg)

  let row = db.prepare('SELECT id, handshake_id FROM inbox_messages WHERE beap_package_json = ? LIMIT 1').get(rawPkg) as
    | { id: string; handshake_id: string | null }
    | undefined

  if (!row && norm !== rawPkg) {
    row = db.prepare('SELECT id, handshake_id FROM inbox_messages WHERE beap_package_json = ? LIMIT 1').get(norm) as
      | { id: string; handshake_id: string | null }
      | undefined
  }

  if (!row) {
    const hid = typeof input.handshake_id === 'string' && input.handshake_id.trim() ? input.handshake_id.trim() : null
    const candidates = hid
      ? (db
          .prepare(
            `SELECT id, handshake_id, beap_package_json FROM inbox_messages
             WHERE source_type = 'direct_beap' AND beap_package_json IS NOT NULL AND handshake_id = ?`,
          )
          .all(hid) as Array<{ id: string; handshake_id: string | null; beap_package_json: string }>)
      : (db
          .prepare(
            `SELECT id, handshake_id, beap_package_json FROM inbox_messages
             WHERE source_type = 'direct_beap' AND beap_package_json IS NOT NULL`,
          )
          .all() as Array<{ id: string; handshake_id: string | null; beap_package_json: string }>)
    for (const c of candidates) {
      if (normalizePackageJson(c.beap_package_json) === norm) {
        row = { id: c.id, handshake_id: c.handshake_id }
        break
      }
    }
  }

  if (!row) {
    return { ok: false, error: 'No inbox row matches this package (sync after main-process ingest?)' }
  }

  const bodyText =
    input.body_text != null && String(input.body_text).trim()
      ? String(input.body_text).trim().slice(0, 120_000)
      : null

  db.prepare(
    `UPDATE inbox_messages SET depackaged_json = ?, body_text = COALESCE(?, body_text), embedding_status = 'pending' WHERE id = ?`,
  ).run(depackaged, bodyText, row.id)

  const atts = Array.isArray(input.attachments) ? input.attachments : []
  if (atts.length > 0) {
    const insertAtt = db.prepare(`
      INSERT INTO inbox_attachments (id, message_id, filename, content_type, size_bytes, content_id, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const updateAttBlob = db.prepare(`
      UPDATE inbox_attachments SET filename = ?, content_type = ?, size_bytes = ?, storage_path = ?, content_id = ? WHERE id = ?
    `)
    const updateEnc = db.prepare(`
      UPDATE inbox_attachments SET encryption_key = ?, encryption_iv = ?, encryption_tag = ?, storage_encrypted = ? WHERE id = ?
    `)
    const updateSha = db.prepare(`UPDATE inbox_attachments SET content_sha256 = ? WHERE id = ?`)
    const now = new Date().toISOString()

    for (const a of atts) {
      const cid = typeof a.content_id === 'string' && a.content_id.trim() ? a.content_id.trim() : randomUUID()
      const attId = makeInboxAttachmentStorageId(row.id, cid)
      const fname = (a.filename || 'attachment').slice(0, 500)
      const ctype = (a.content_type || 'application/octet-stream').slice(0, 200)
      const sizeBytes = typeof a.size_bytes === 'number' && a.size_bytes >= 0 ? a.size_bytes : 0
      const existing = db.prepare('SELECT id FROM inbox_attachments WHERE id = ?').get(attId) as { id: string } | undefined

      if (a.base64 && typeof a.base64 === 'string' && a.base64.length > 0) {
        try {
          const buf = Buffer.from(a.base64, 'base64')
          if (buf.length > 0) {
            const w = writeEncryptedAttachmentFile(row.id, attId, fname, buf)
            if (existing) {
              updateAttBlob.run(fname, ctype, buf.length, w.storagePath, cid, attId)
            } else {
              insertAtt.run(attId, row.id, fname, ctype, buf.length, cid, w.storagePath, now)
            }
            updateEnc.run(w.encryptionKeyStored, w.ivB64, w.tagB64, 1, attId)
            updateSha.run(createHash('sha256').update(buf).digest('hex'), attId)
            continue
          }
        } catch (e) {
          console.warn('[mergeExtensionDepackaged] attachment write failed:', (e as Error)?.message)
        }
      }

      if (!existing) {
        insertAtt.run(attId, row.id, fname, ctype, sizeBytes, cid, null, now)
      }
    }

    db.prepare(`UPDATE inbox_messages SET has_attachments = 1, attachment_count = ? WHERE id = ?`).run(atts.length, row.id)
  }

  return { ok: true, messageId: row.id, handshakeId: row.handshake_id }
}

export function notifyInboxDepackagedMerged(handshakeId: string | null | undefined): void {
  const hid = handshakeId?.trim()
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('inbox:beapInboxUpdated', { handshakeId: hid ?? undefined, depackagedMerged: true })
    }
  } catch {
    /* non-fatal */
  }
}
