/**
 * In-memory quarantine encryption key (delivered from desktop via supervisor API).
 */

import { parseQuarantineKeyHex } from './crypto.js';

let quarantineKey: Buffer | null = null;

export function setQuarantineKeyFromHex(hex: string): void {
  if (quarantineKey) {
    quarantineKey.fill(0);
  }
  quarantineKey = parseQuarantineKeyHex(hex);
}

export function getQuarantineKey(): Buffer | null {
  return quarantineKey;
}

export function hasQuarantineKey(): boolean {
  return quarantineKey !== null && quarantineKey.length === 32;
}

export function clearQuarantineKeyForTests(): void {
  if (quarantineKey) {
    quarantineKey.fill(0);
  }
  quarantineKey = null;
}
