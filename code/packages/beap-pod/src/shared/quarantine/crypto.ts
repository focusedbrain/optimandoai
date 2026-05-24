/**
 * AES-256-GCM encryption for quarantined raw message bytes (§11.5 family).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { EncryptedQuarantineWire } from './types.js';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

export function parseQuarantineKeyHex(hex: string): Buffer {
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error('quarantine_key must be 32 bytes (64 hex chars)');
  }
  return Buffer.from(trimmed, 'hex');
}

export function encryptQuarantineBytes(data: Buffer, quarantineKey: Buffer): EncryptedQuarantineWire {
  if (quarantineKey.length !== 32) {
    throw new Error('quarantine_key must be 32 bytes');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, quarantineKey, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };
}

export function decryptQuarantineBytes(
  wire: EncryptedQuarantineWire,
  quarantineKey: Buffer,
): Buffer {
  if (quarantineKey.length !== 32) {
    throw new Error('quarantine_key must be 32 bytes');
  }
  const iv = Buffer.from(wire.iv, 'hex');
  const tag = Buffer.from(wire.tag, 'hex');
  const ciphertext = Buffer.from(wire.ciphertext, 'hex');
  const decipher = createDecipheriv(ALGO, quarantineKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
