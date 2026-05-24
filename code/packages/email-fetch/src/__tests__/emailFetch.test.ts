/**
 * @repo/email-fetch — unit tests
 */

import { describe, expect, it } from 'vitest';
import {
  decryptCredentialBundle,
  encryptCredentialBundle,
  parseAccountKeyHex,
  parseCredentialPayload,
  buildXoauth2Token,
} from '../index.js';

describe('credential bundle crypto', () => {
  const key = parseAccountKeyHex('aa'.repeat(32));
  const payload = JSON.stringify({
    provider: 'google',
    email: 'user@example.com',
    refresh_token: 'rt',
    oauth_client_id: 'cid',
    imap: { host: 'imap.gmail.com', port: 993, security: 'ssl' },
  });

  it('round-trips AES-256-GCM encryption', () => {
    const wire = encryptCredentialBundle(payload, key);
    const plain = decryptCredentialBundle(wire, key);
    expect(parseCredentialPayload(plain).email).toBe('user@example.com');
  });

  it('rejects tampered ciphertext', () => {
    const wire = encryptCredentialBundle(payload, key);
    const tampered = { ...wire, ciphertext: `${wire.ciphertext.slice(0, -2)}ff` };
    expect(() => decryptCredentialBundle(tampered, key)).toThrow(/decryption failed/);
  });
});

describe('xoauth2', () => {
  it('builds base64 token', () => {
    const t = buildXoauth2Token('a@b.com', 'tok');
    expect(typeof t).toBe('string');
    expect(t.length).toBeGreaterThan(10);
  });
});
