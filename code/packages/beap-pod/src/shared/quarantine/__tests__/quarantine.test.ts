/**
 * Edge quarantine store tests (P5.5).
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  QuarantineStore,
  clearQuarantineKeyForTests,
  setQuarantineKeyFromHex,
} from '../index.js';

const TEST_KEY = 'aa'.repeat(32);

describe('QuarantineStore', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'quarantine-store-'));
    clearQuarantineKeyForTests();
    setQuarantineKeyFromHex(TEST_KEY);
  });

  afterEach(async () => {
    clearQuarantineKeyForTests();
    await rm(rootDir, { recursive: true, force: true });
  });

  test('writes encrypted raw_bytes and metadata.json', async () => {
    const store = new QuarantineStore(rootDir);
    const raw = Buffer.from('From: a@b.com\r\n\r\nhello');
    await store.writeEntry({
      hash: 'abc123',
      rawBytes: raw,
      envelopeFrom: 'a@b.com',
      envelopeTo: 'user@example.com',
      envelopeDate: '2026-05-24T00:00:00.000Z',
      envelopeSubject: 'test subject',
      failedContainerRole: 'depackager',
      failedStage: 'capsule_normalize',
    });

    expect(await store.hasEntry('abc123')).toBe(true);
    const meta = await store.readMetadata('abc123');
    expect(meta?.hash).toBe('abc123');
    expect(meta?.failed_container_role).toBe('depackager');
  });

  test('cleanupExpired removes aged entries', async () => {
    const store = new QuarantineStore(rootDir);
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    await store.writeEntry({
      hash: 'oldhash1',
      rawBytes: Buffer.from('old'),
      envelopeFrom: 'a@b.com',
      envelopeTo: 'user@example.com',
      envelopeDate: oldDate,
      envelopeSubject: 'old',
      failedContainerRole: 'mail-fetcher',
      failedStage: 'imap_fetch',
      quarantinedAt: oldDate,
    });

    await store.writeEntry({
      hash: 'newhash1',
      rawBytes: Buffer.from('new'),
      envelopeFrom: 'a@b.com',
      envelopeTo: 'user@example.com',
      envelopeDate: new Date().toISOString(),
      envelopeSubject: 'new',
      failedContainerRole: 'mail-fetcher',
      failedStage: 'imap_fetch',
    });

    const removed = await store.cleanupExpired(30);
    expect(removed).toContain('oldhash1');
    expect(await store.hasEntry('oldhash1')).toBe(false);
    expect(await store.hasEntry('newhash1')).toBe(true);
  });
});
