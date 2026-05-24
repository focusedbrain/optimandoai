/**
 * AES-256-GCM credential bundle encryption (strategy §11.5).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptedCredentialBundleWire } from '../types.js';
import { CredentialDecryptError } from '../types.js';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

export function parseAccountKeyHex(hex: string): Buffer {
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new CredentialDecryptError('account_key must be 32 bytes (64 hex chars)');
  }
  return Buffer.from(trimmed, 'hex');
}

export function encryptCredentialBundle(plaintextJson: string, accountKey: Buffer): EncryptedCredentialBundleWire {
  if (accountKey.length !== 32) {
    throw new Error('account_key must be 32 bytes');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, accountKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextJson, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };
}

export function decryptCredentialBundle(
  wire: EncryptedCredentialBundleWire,
  accountKey: Buffer,
): string {
  if (accountKey.length !== 32) {
    throw new CredentialDecryptError('account_key must be 32 bytes');
  }
  try {
    const iv = Buffer.from(wire.iv, 'hex');
    const tag = Buffer.from(wire.tag, 'hex');
    const ciphertext = Buffer.from(wire.ciphertext, 'hex');
    const decipher = createDecipheriv(ALGO, accountKey, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    throw new CredentialDecryptError('encrypted_bundle decryption failed (tampered or wrong key)');
  }
}

export function parseEncryptedBundle(input: string | EncryptedCredentialBundleWire): EncryptedCredentialBundleWire {
  if (typeof input === 'object' && input !== null && 'iv' in input && 'tag' in input && 'ciphertext' in input) {
    return input;
  }
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as EncryptedCredentialBundleWire;
      if (parsed.iv && parsed.tag && parsed.ciphertext) return parsed;
    } catch {
      /* fall through */
    }
  }
  throw new CredentialDecryptError('encrypted_bundle is not valid JSON wire format');
}

export function zeroizeBuffer(buf: Buffer): void {
  buf.fill(0);
}
