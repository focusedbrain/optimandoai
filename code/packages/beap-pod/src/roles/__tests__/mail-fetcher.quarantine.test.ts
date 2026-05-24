/**
 * Mail-fetcher quarantine behavior (P5.5).
 */

import { describe, test, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  encryptCredentialBundle,
  parseAccountKeyHex,
  AccessTokenCache,
  type FetchedRfc822Message,
  type MailFetcherCredentialPayload,
} from '@repo/email-fetch';
import { createMailFetcherServer } from '../mail-fetcher/supervisor.js';
import { AccountRegistry } from '../mail-fetcher/accountRegistry.js';
import { CredentialStore } from '../mail-fetcher/credentialStore.js';
import { createIngestClient, type IngestClient } from '../mail-fetcher/ingestClient.js';
import { startAccountLoop } from '../mail-fetcher/accountLoop.js';
import {
  QuarantineStore,
  setQuarantineKeyFromHex,
  clearQuarantineKeyForTests,
} from '../../shared/quarantine/index.js';
import { QuarantineSkipStore } from '../mail-fetcher/quarantineSkipStore.js';
import http from 'node:http';

const TEST_SECRET = 'mail-fetcher-quarantine-secret!!';
const ACCOUNT_KEY = parseAccountKeyHex('cc'.repeat(32));
const QUARANTINE_KEY = 'dd'.repeat(32);

const SAMPLE_CREDS: MailFetcherCredentialPayload = {
  provider: 'google',
  email: 'user@example.com',
  refresh_token: 'refresh-token-value',
  oauth_client_id: 'client-id',
  oauth_client_secret: 'client-secret',
  imap: { host: 'imap.gmail.com', port: 993, security: 'ssl' },
};

function encryptSampleBundle(): string {
  return JSON.stringify(encryptCredentialBundle(JSON.stringify(SAMPLE_CREDS), ACCOUNT_KEY));
}

async function listen(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers: {
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': String(Buffer.byteLength(payload)),
              }
            : {}),
          'X-Pod-Auth': TEST_SECRET,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            json: JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('mail-fetcher quarantine (P5.5)', () => {
  let tmpDir: string;
  let quarantineDir: string;
  let skipDir: string;
  let server: http.Server;

  afterEach(async () => {
    if (server) await stopServer(server);
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    clearQuarantineKeyForTests();
    vi.restoreAllMocks();
  });

  test('ingest failure quarantines message and processes next UNSEEN', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mf-quarantine-'));
    quarantineDir = join(tmpDir, 'quarantine');
    skipDir = join(tmpDir, 'quarantine_skip');
    setQuarantineKeyFromHex(QUARANTINE_KEY);

    const msg1: FetchedRfc822Message = {
      uid: 100,
      messageId: '<crash@example.com>',
      from: 'crash@example.com',
      rfc822: Buffer.from('From: crash@example.com\r\nSubject: crash\r\n\r\none'),
    };
    const msg2: FetchedRfc822Message = {
      uid: 101,
      messageId: '<ok@example.com>',
      from: 'ok@example.com',
      rfc822: Buffer.from('From: ok@example.com\r\nSubject: ok\r\n\r\ntwo'),
    };

    let fetchCall = 0;
    const ingestPosts: string[] = [];
    const ingest: IngestClient = {
      async postMessage(input) {
        ingestPosts.push(input.messageId);
        return { ok: input.messageId.includes('crash') ? false : true, status: input.messageId.includes('crash') ? 502 : 200 };
      },
    };

    const markSeen = vi.fn(async () => undefined);
    const quarantineStore = new QuarantineStore(quarantineDir);
    const skipStore = new QuarantineSkipStore(skipDir);
    const store = new CredentialStore(tmpDir);

    server = createMailFetcherServer({
      podAuthSecret: TEST_SECRET,
      credentialsDir: tmpDir,
      registry: new AccountRegistry({
        store,
        ingest,
        tokenCache: {
          clear: vi.fn(),
          getAccessToken: vi.fn(async () => 'token'),
        } as unknown as AccessTokenCache,
        quarantineStore,
        skipStore,
        loopFactory: (deps) =>
          startAccountLoop({
            ...deps,
            pollIntervalMs: 20,
            fetchUnseen: async () => {
              fetchCall += 1;
              if (fetchCall === 1) return [msg1, msg2];
              return [];
            },
            markSeen,
          }),
      }),
    });
    await listen(server);

    await request(server, 'POST', '/quarantine/deliver_key', { quarantine_key: QUARANTINE_KEY });
    await request(server, 'POST', '/accounts/start', {
      account_id: 'acct-q',
      provider: 'google',
      encrypted_bundle: encryptSampleBundle(),
      wrapped_account_key: 'wrapped',
    });
    await request(server, 'POST', '/accounts/deliver_key', {
      account_id: 'acct-q',
      account_key: ACCOUNT_KEY.toString('hex'),
    });

    await new Promise((r) => setTimeout(r, 120));

    expect(ingestPosts).toEqual(['<crash@example.com>', '<ok@example.com>']);
    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(markSeen).toHaveBeenCalledWith(expect.anything(), 101);

    const skipRecord = JSON.parse(await readFile(join(skipDir, 'acct-q.json'), 'utf8')) as {
      skipped_uids: number[];
    };
    expect(skipRecord.skipped_uids).toContain(100);

    const hashes = await quarantineStore.listHashes();
    expect(hashes.length).toBe(1);
  });

  test('/quarantine/deliver_key accepts replica quarantine key', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mf-quarantine-key-'));
    server = createMailFetcherServer({
      podAuthSecret: TEST_SECRET,
      credentialsDir: tmpDir,
    });
    await listen(server);

    const res = await request(server, 'POST', '/quarantine/deliver_key', {
      quarantine_key: QUARANTINE_KEY,
    });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
  });
});
