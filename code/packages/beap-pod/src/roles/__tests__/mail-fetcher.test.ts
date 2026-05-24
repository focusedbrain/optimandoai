/**
 * Mail-fetcher role — supervisor API + account loop tests (P4.5.5).
 */

import { describe, test, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  encryptCredentialBundle,
  OAuthRefreshRejectedError,
  parseAccountKeyHex,
  AccessTokenCache,
  type FetchedRfc822Message,
  type MailFetcherCredentialPayload,
} from '@repo/email-fetch';
import { createMailFetcherServer } from '../mail-fetcher/supervisor.js';
import { AccountRegistry } from '../mail-fetcher/accountRegistry.js';
import { CredentialStore } from '../mail-fetcher/credentialStore.js';
import { createIngestClient, type IngestClient } from '../mail-fetcher/ingestClient.js';
import { startAccountLoop, type AccountLoopDeps } from '../mail-fetcher/accountLoop.js';
import { MAIL_FETCHER_ACCOUNT_EVENT } from '../mail-fetcher/types.js';

const TEST_SECRET = 'mail-fetcher-test-secret-32b!!!!';
const ACCOUNT_KEY = parseAccountKeyHex('bb'.repeat(32));

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

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (typeof (server as unknown as Record<string, unknown>)['closeAllConnections'] === 'function') {
      (server as unknown as { closeAllConnections: () => void }).closeAllConnections();
    }
    server.close(() => resolve());
  });
}

async function listen(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
  secret = TEST_SECRET,
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
          'X-Pod-Auth': secret,
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

describe('mail-fetcher supervisor API', () => {
  let tmpDir: string;
  let server: http.Server;
  let ingestPosts: IngestMessageCapture[];

  interface IngestMessageCapture {
    accountId: string;
    messageId: string;
  }

  afterEach(async () => {
    if (server) await stopServer(server);
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function setupServer(options?: {
    fetchUnseen?: AccountLoopDeps['fetchUnseen'];
    tokenRefreshError?: Error;
    ingestOk?: boolean;
  }) {
    tmpDir = await mkdtemp(join(tmpdir(), 'mail-fetcher-test-'));
    ingestPosts = [];

    const ingest: IngestClient = {
      async postMessage(input) {
        ingestPosts.push({ accountId: input.accountId, messageId: input.messageId });
        return { ok: options?.ingestOk ?? true, status: options?.ingestOk === false ? 502 : 200 };
      },
    };

    const mockMessages: FetchedRfc822Message[] = [
      {
        uid: 42,
        messageId: '<msg-1@example.com>',
        from: 'sender@example.com',
        rfc822: Buffer.from('From: sender@example.com\r\nSubject: hi\r\n\r\nbody'),
      },
    ];

    const fetchUnseen =
      options?.fetchUnseen ??
      (async () => {
        if (options?.tokenRefreshError) throw options.tokenRefreshError;
        return mockMessages;
      });

    const markSeen = vi.fn(async () => undefined);

    const tokenCache = {
      clear: vi.fn(),
      getAccessToken: vi.fn(async () => {
        if (options?.tokenRefreshError) throw options.tokenRefreshError;
        return 'fake-access-token';
      }),
    } as unknown as AccessTokenCache;

    const store = new CredentialStore(tmpDir);
    const loopStarted: string[] = [];
    const registry = new AccountRegistry({
      store,
      ingest,
      tokenCache,
      loopFactory: (deps) => {
        loopStarted.push(deps.accountId);
        return startAccountLoop({
          ...deps,
          pollIntervalMs: 20,
          fetchUnseen,
          markSeen,
        });
      },
    });

    server = createMailFetcherServer({
      podAuthSecret: TEST_SECRET,
      credentialsDir: tmpDir,
      registry,
    });
    await listen(server);
    return { loopStarted, markSeen };
  }

  test('/accounts/start stores tmpfs files, state is awaiting_key', async () => {
    await setupServer();
    const start = await request(server, 'POST', '/accounts/start', {
      account_id: 'acct-1',
      provider: 'google',
      encrypted_bundle: encryptSampleBundle(),
      wrapped_account_key: 'wrapped-opaque',
    });
    expect(start.status).toBe(200);
    expect(start.json.state).toBe('awaiting_key');

    const status = await request(server, 'GET', '/accounts/status');
    const accounts = status.json.accounts as Array<{ account_id: string; provider: string; state: string }>;
    expect(accounts[0]?.account_id).toBe('acct-1');
    expect(accounts[0]?.provider).toBe('google');
    expect(accounts[0]?.state).toBe('awaiting_key');
  });

  test('/accounts/deliver_key decrypts bundle, starts loop, state is active', async () => {
    const { loopStarted } = await setupServer();
    await request(server, 'POST', '/accounts/start', {
      account_id: 'acct-2',
      provider: 'google',
      encrypted_bundle: encryptSampleBundle(),
      wrapped_account_key: 'wrapped-opaque',
    });

    const deliver = await request(server, 'POST', '/accounts/deliver_key', {
      account_id: 'acct-2',
      account_key: ACCOUNT_KEY.toString('hex'),
    });
    expect(deliver.status).toBe(200);
    expect(loopStarted).toContain('acct-2');

    await new Promise((r) => setTimeout(r, 80));
    const status = await request(server, 'GET', '/accounts/status');
    const accounts = status.json.accounts as Array<{ state: string; last_fetch_at?: string }>;
    expect(accounts[0]?.state).toBe('active');
    expect(accounts[0]?.last_fetch_at).toBeTruthy();
    expect(ingestPosts.length).toBeGreaterThan(0);
  });

  test('tampered encrypted_bundle fails decryption and stays awaiting_key', async () => {
    await setupServer();
    let bundle = encryptSampleBundle();
    const parsed = JSON.parse(bundle) as { ciphertext: string };
    parsed.ciphertext = `${parsed.ciphertext.slice(0, -2)}ff`;
    bundle = JSON.stringify(parsed);

    await request(server, 'POST', '/accounts/start', {
      account_id: 'acct-bad',
      provider: 'google',
      encrypted_bundle: bundle,
      wrapped_account_key: 'wrapped-opaque',
    });

    const deliver = await request(server, 'POST', '/accounts/deliver_key', {
      account_id: 'acct-bad',
      account_key: ACCOUNT_KEY.toString('hex'),
    });
    expect(deliver.status).toBe(422);

    const status = await request(server, 'GET', '/accounts/status');
    const accounts = status.json.accounts as Array<{ state: string; last_error?: string }>;
    expect(accounts[0]?.state).toBe('awaiting_key');
    expect(accounts[0]?.last_error).toMatch(/decryption failed/);
  });

  test('/accounts/stop cleans up tmpfs and memory', async () => {
    await setupServer();
    const store = new CredentialStore(tmpDir);
    await request(server, 'POST', '/accounts/start', {
      account_id: 'acct-stop',
      provider: 'google',
      encrypted_bundle: encryptSampleBundle(),
      wrapped_account_key: 'wrapped-opaque',
    });
    await request(server, 'POST', '/accounts/deliver_key', {
      account_id: 'acct-stop',
      account_key: ACCOUNT_KEY.toString('hex'),
    });

    const stop = await request(server, 'POST', '/accounts/stop', { account_id: 'acct-stop' });
    expect(stop.status).toBe(200);

    expect(await store.hasTmpfsFiles('acct-stop')).toBe(false);
    const status = await request(server, 'GET', '/accounts/status');
    const accounts = status.json.accounts as Array<{ state: string }>;
    expect(accounts[0]?.state).toBe('stopped');
  });

  test('fetch loop hands new messages to mock ingestor', async () => {
    await setupServer();
    await request(server, 'POST', '/accounts/start', {
      account_id: 'acct-ingest',
      provider: 'google',
      encrypted_bundle: encryptSampleBundle(),
      wrapped_account_key: 'wrapped-opaque',
    });
    await request(server, 'POST', '/accounts/deliver_key', {
      account_id: 'acct-ingest',
      account_key: ACCOUNT_KEY.toString('hex'),
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(ingestPosts.some((p) => p.accountId === 'acct-ingest')).toBe(true);
  });

  test('refresh token rejected transitions to degraded', async () => {
    await setupServer({ tokenRefreshError: new OAuthRefreshRejectedError('invalid_grant') });
    await request(server, 'POST', '/accounts/start', {
      account_id: 'acct-degraded',
      provider: 'google',
      encrypted_bundle: encryptSampleBundle(),
      wrapped_account_key: 'wrapped-opaque',
    });
    await request(server, 'POST', '/accounts/deliver_key', {
      account_id: 'acct-degraded',
      account_key: ACCOUNT_KEY.toString('hex'),
    });

    await new Promise((r) => setTimeout(r, 100));
    const status = await request(server, 'GET', '/accounts/status');
    const accounts = status.json.accounts as Array<{ state: string; last_error?: string }>;
    expect(accounts[0]?.state).toBe('degraded');
    expect(accounts[0]?.last_error).toBe('refresh_token_rejected');
  });

  test('container restart retains tmpfs files but requires deliver_key again', async () => {
    await setupServer();
    await request(server, 'POST', '/accounts/start', {
      account_id: 'acct-restart',
      provider: 'google',
      encrypted_bundle: encryptSampleBundle(),
      wrapped_account_key: 'wrapped-opaque',
    });
    await request(server, 'POST', '/accounts/deliver_key', {
      account_id: 'acct-restart',
      account_key: ACCOUNT_KEY.toString('hex'),
    });

    await stopServer(server);

    const store = new CredentialStore(tmpDir);
    expect(await store.hasTmpfsFiles('acct-restart')).toBe(true);

    const registry2 = new AccountRegistry({ store, ingest: createIngestClient('http://127.0.0.1:9') });
    await registry2.restoreFromTmpfs();
    expect(registry2.getStatus()[0]?.state).toBe('awaiting_key');
    expect(registry2.hasDecryptedCreds('acct-restart')).toBe(false);
  });

  test('structured logs omit credential material', async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
      orig(...args);
    };

    try {
      await setupServer({ tokenRefreshError: new OAuthRefreshRejectedError('invalid_grant') });
      await request(server, 'POST', '/accounts/start', {
        account_id: 'acct-log',
        provider: 'google',
        encrypted_bundle: encryptSampleBundle(),
        wrapped_account_key: 'wrapped-opaque',
      });
      await request(server, 'POST', '/accounts/deliver_key', {
        account_id: 'acct-log',
        account_key: ACCOUNT_KEY.toString('hex'),
      });
      await new Promise((r) => setTimeout(r, 80));
    } finally {
      console.log = orig;
    }

    const joined = logs.join('\n');
    expect(joined).not.toMatch(/refresh-token-value/);
    expect(joined).not.toMatch(/client-secret/);
    expect(joined).toContain(MAIL_FETCHER_ACCOUNT_EVENT);
  });

  test('rejects missing X-Pod-Auth', async () => {
    await setupServer();
    const res = await request(server, 'GET', '/accounts/status', undefined, 'wrong-secret');
    expect(res.status).toBe(401);
  });
});
