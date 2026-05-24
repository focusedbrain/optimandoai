/**
 * Decrypt locally stored quarantine raw_bytes (P5.6).
 *
 * Wire format matches packages/beap-pod shared/quarantine crypto (AES-256-GCM).
 */

import { createDecipheriv } from 'node:crypto'
import { zeroizeBuffer } from '../security/zeroize.js'

export interface EncryptedQuarantineWire {
  iv: string
  tag: string
  ciphertext: string
}

export function parseEncryptedQuarantineWire(raw: string): EncryptedQuarantineWire | null {
  try {
    const wire = JSON.parse(raw) as EncryptedQuarantineWire
    if (
      typeof wire.iv !== 'string' ||
      typeof wire.tag !== 'string' ||
      typeof wire.ciphertext !== 'string'
    ) {
      return null
    }
    return wire
  } catch {
    return null
  }
}

function parseQuarantineKeyHex(hex: string): Buffer {
  const trimmed = hex.trim()
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error('quarantine_key must be 32 bytes (64 hex chars)')
  }
  return Buffer.from(trimmed, 'hex')
}

/** Decrypt quarantine bytes; caller must zeroize returned buffer when done. */
export function decryptLocalQuarantinePlaintext(
  wireRaw: string,
  quarantineKeyHex: string,
): Buffer {
  const wire = parseEncryptedQuarantineWire(wireRaw)
  if (!wire) {
    throw new Error('Invalid quarantine raw_bytes wire format')
  }
  const key = parseQuarantineKeyHex(quarantineKeyHex)
  try {
    const iv = Buffer.from(wire.iv, 'hex')
    const tag = Buffer.from(wire.tag, 'hex')
    const ciphertext = Buffer.from(wire.ciphertext, 'hex')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } finally {
    zeroizeBuffer(key)
  }
}

/** Lossy UTF-8 decode for sandbox plain-text display. */
export function quarantinePlaintextToSandboxText(plaintext: Buffer): string {
  return plaintext.toString('utf8').replace(/\u0000/g, '')
}
