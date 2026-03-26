/**
 * AES-256-GCM encryption for inbox attachment files at rest.
 * Per-file random key; key material is wrapped with Electron safeStorage when available.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { decryptValue, encryptValue } from './secure-storage'

export function encryptBlob(plaintext: Buffer): { ciphertext: Buffer; key: Buffer; iv: Buffer; tag: Buffer } {
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return { ciphertext: encrypted, key, iv, tag }
}

export function decryptBlob(ciphertext: Buffer, key: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment'
}

function getAttachmentsBasePath(): string {
  return path.join(app.getPath('userData'), 'inbox-attachments')
}

export interface EncryptedWriteResult {
  storagePath: string
  /** safeStorage-wrapped base64 key (or plain base64 if safeStorage unavailable). */
  encryptionKeyStored: string
  ivB64: string
  tagB64: string
}

/**
 * Encrypt `content`, write ciphertext to disk under inbox-attachments/{messageId}/.
 */
export function writeEncryptedAttachmentFile(
  messageId: string,
  attId: string,
  filename: string,
  content: Buffer,
): EncryptedWriteResult {
  const { ciphertext, key, iv, tag } = encryptBlob(content)
  const base = getAttachmentsBasePath()
  const dir = path.join(base, messageId)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const safeName = sanitizeFilename(filename) || 'attachment'
  const ext = path.extname(safeName) || ''
  const baseName = path.basename(safeName, ext) || 'file'
  /** Windows and cross-platform safe segment (attId may include ':' from legacy keys or delimiters). */
  const safeAttSegment = String(attId)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 180)
  const storagePath = path.join(dir, `${safeAttSegment}_${baseName}${ext}`)
  fs.writeFileSync(storagePath, ciphertext)
  const keyB64 = key.toString('base64')
  return {
    storagePath,
    encryptionKeyStored: encryptValue(keyB64),
    ivB64: iv.toString('base64'),
    tagB64: tag.toString('base64'),
  }
}

export type AttachmentRowCrypto = {
  storage_path?: string | null
  storage_encrypted?: number | null
  encryption_key?: string | null
  encryption_iv?: string | null
  encryption_tag?: string | null
}

/**
 * Read ciphertext from disk and return original plaintext bytes.
 * Legacy rows (`storage_encrypted` falsy) return file bytes as-is.
 */
export function readDecryptedAttachmentBuffer(row: AttachmentRowCrypto): Buffer {
  const p = row.storage_path
  if (!p || !fs.existsSync(p)) {
    throw new Error('Attachment file not found')
  }
  const fileBuf = fs.readFileSync(p)
  if (!row.storage_encrypted) {
    return fileBuf
  }
  const keyB64 = decryptValue(row.encryption_key)
  if (!keyB64) {
    throw new Error('Missing attachment key')
  }
  const key = Buffer.from(keyB64, 'base64')
  if (key.length !== 32) {
    throw new Error('Invalid attachment key material')
  }
  const iv = Buffer.from(row.encryption_iv ?? '', 'base64')
  const tag = Buffer.from(row.encryption_tag ?? '', 'base64')
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('Invalid attachment IV or tag')
  }
  return decryptBlob(fileBuf, key, iv, tag)
}
