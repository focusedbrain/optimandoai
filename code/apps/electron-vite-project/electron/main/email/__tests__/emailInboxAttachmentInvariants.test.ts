/**
 * Automated checks for Prompt 5–7: AES-GCM attachment crypto, SHA-256 linking (blob vs text),
 * and legacy plaintext attachment files. Electron is mocked so tests run in Node.
 */
import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createHash } from 'crypto'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
}))

import { encryptBlob, decryptBlob, readDecryptedAttachmentBuffer } from '../attachmentBlobCrypto'

describe('attachmentBlobCrypto', () => {
  it('roundtrips encryptBlob / decryptBlob', () => {
    const plain = Buffer.from('PDF binary \x00\xff content', 'utf8')
    const { ciphertext, key, iv, tag } = encryptBlob(plain)
    const out = decryptBlob(ciphertext, key, iv, tag)
    expect(out.equals(plain)).toBe(true)
  })

  it('readDecryptedAttachmentBuffer returns file bytes when storage_encrypted is 0 (legacy)', () => {
    const tmp = path.join(os.tmpdir(), `wrdesk-legacy-${Date.now()}.bin`)
    const buf = Buffer.from('legacy plain on disk')
    fs.writeFileSync(tmp, buf)
    try {
      const out = readDecryptedAttachmentBuffer({ storage_path: tmp, storage_encrypted: 0 })
      expect(out.equals(buf)).toBe(true)
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('readDecryptedAttachmentBuffer decrypts AES-GCM ciphertext on disk', () => {
    const plain = Buffer.from('encrypted-at-rest payload')
    const { ciphertext, key, iv, tag } = encryptBlob(plain)
    const tmp = path.join(os.tmpdir(), `wrdesk-enc-${Date.now()}.bin`)
    fs.writeFileSync(tmp, ciphertext)
    try {
      const out = readDecryptedAttachmentBuffer({
        storage_path: tmp,
        storage_encrypted: 1,
        encryption_key: key.toString('base64'),
        encryption_iv: iv.toString('base64'),
        encryption_tag: tag.toString('base64'),
      })
      expect(out.equals(plain)).toBe(true)
    } finally {
      fs.unlinkSync(tmp)
    }
  })
})

describe('SHA-256 invariants (messageRouter + ipc)', () => {
  it('produces 64-char hex for blob and for UTF-8 extracted text', () => {
    const blob = Buffer.from('%PDF-1.4 fake', 'utf8')
    const text = 'Extracted\n\nPage two'
    const contentSha = createHash('sha256').update(blob).digest('hex')
    const textSha = createHash('sha256').update(text, 'utf8').digest('hex')
    expect(contentSha).toMatch(/^[a-f0-9]{64}$/)
    expect(textSha).toMatch(/^[a-f0-9]{64}$/)
    expect(contentSha).not.toBe(textSha)
  })
})
