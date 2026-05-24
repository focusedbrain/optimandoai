/**
 * Quarantine Blob Storage — Phase B, PR B-3
 *
 * Manages encrypted quarantine blobs on disk.
 *
 * Layout:
 *   <userData>/inbox-quarantine-blobs/<storage_id>
 *
 * Each file is a JSON document containing the hybrid-encrypted original
 * email bytes (X25519 + HKDF + AES-256-GCM, keyed to the sandbox's public
 * key).  The plaintext is never written to disk; only the ciphertext lands
 * here.  Only the paired sandbox orchestrator can decrypt it.
 *
 * per Phase B Architecture, Amendment 1 to B-3 (Decision E — quarantine flow),
 * Amendment 2 to B-3 (Decision A — key reuse).
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { createHash, randomUUID } from 'crypto'

// ── Types ──

/**
 * The on-disk representation of a quarantine blob.
 * This JSON is written to disk exactly as produced by `encryptForQuarantine`.
 */
export interface QuarantineBlobFile {
  /** Schema version for forward-compatibility. */
  version: 'quarantine-v1'
  /** Base64 sender (host) ephemeral X25519 public key (32 bytes). */
  sender_ephemeral_x25519_pub_b64: string
  /** Base64 random HKDF salt (16 bytes). */
  salt_b64: string
  /** Base64 AES-256-GCM nonce (12 bytes). */
  nonce_b64: string
  /** Base64 AES-256-GCM ciphertext (plaintext || 16-byte auth tag). */
  ciphertext_b64: string
}

// ── Storage path ──

function getQuarantineBlobsBasePath(): string {
  return path.join(app.getPath('userData'), 'inbox-quarantine-blobs')
}

// ── Write ──

export interface QuarantineWriteResult {
  storage_id: string
  storage_path: string
  blob_sha256: string
  blob_size_bytes: number
}

/**
 * Write a `QuarantineBlobFile` to disk and return the storage metadata
 * needed to populate a `quarantine_messages` row.
 *
 * The caller is responsible for constructing the blob via `encryptForQuarantine`.
 * This function is purely I/O.
 */
export function writeQuarantineBlob(blob: QuarantineBlobFile): QuarantineWriteResult {
  const basePath = getQuarantineBlobsBasePath()
  fs.mkdirSync(basePath, { recursive: true })

  const storage_id = randomUUID()
  const storage_path = path.join(basePath, storage_id)
  const content = JSON.stringify(blob)
  fs.writeFileSync(storage_path, content, 'utf-8')

  const blob_sha256 = createHash('sha256').update(content, 'utf-8').digest('hex')
  const blob_size_bytes = Buffer.byteLength(content, 'utf-8')

  return { storage_id, storage_path, blob_sha256, blob_size_bytes }
}

// ── Read ──

export type QuarantineReadResult =
  | { ok: true; blob: QuarantineBlobFile }
  | { ok: false; error: string }

/**
 * Read and parse a quarantine blob from disk.
 * Returns `{ ok: false }` on any I/O or parse error.
 */
export function readQuarantineBlob(storage_id: string): QuarantineReadResult {
  const storage_path = path.join(getQuarantineBlobsBasePath(), storage_id)
  try {
    const raw = fs.readFileSync(storage_path, 'utf-8')
    const parsed = JSON.parse(raw) as QuarantineBlobFile
    if (parsed.version !== 'quarantine-v1') {
      return { ok: false, error: `unsupported blob version: ${parsed.version}` }
    }
    return { ok: true, blob: parsed }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

// ── Delete ──

/**
 * Delete a quarantine blob from disk.  Non-fatal — logs on error.
 * Used when a quarantine row is deleted by the user.
 */
export function deleteQuarantineBlob(storage_id: string): void {
  const storage_path = path.join(getQuarantineBlobsBasePath(), storage_id)
  try {
    fs.unlinkSync(storage_path)
  } catch (err: unknown) {
    console.warn('[QuarantineBlob] deleteQuarantineBlob failed for', storage_id, '—', err)
  }
}
