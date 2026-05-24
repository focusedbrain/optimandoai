/**
 * Mail-fetcher supervisor HTTP API (strategy §11.7).
 */

import http from 'node:http';
import { createPodAuthMiddleware, requirePodAuthSecret } from '../../shared/podAuth.js';
import { AccountRegistry } from './accountRegistry.js';
import { CredentialStore } from './credentialStore.js';
import { createIngestClient } from './ingestClient.js';
import type { DeliverKeyBody, StartAccountBody, StopAccountBody } from './types.js';
import { MAIL_FETCHER_EGRESS_NOTE } from './types.js';

export const ROLE = 'mail-fetcher';
export const DEFAULT_PORT = 18106;

export interface MailFetcherSupervisorConfig {
  readonly version?: string;
  readonly credentialsDir?: string;
  readonly ingestorBase?: string;
  readonly registry?: AccountRegistry;
  readonly podAuthSecret?: string;
}

const MAX_BODY_BYTES = 256 * 1024;

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

export function createMailFetcherServer(config: MailFetcherSupervisorConfig = {}): http.Server {
  const version = config.version ?? process.env['POD_VERSION'] ?? '1.0.0';
  const secret = config.podAuthSecret ?? requirePodAuthSecret();
  const auth = createPodAuthMiddleware(secret);
  const credentialsDir =
    config.credentialsDir ?? process.env['MAIL_FETCHER_CREDENTIALS_DIR'] ?? '/run/beap-mail-credentials';
  const ingestorBase = config.ingestorBase ?? process.env['INGESTOR_BASE'] ?? 'http://127.0.0.1:18100';

  const store = new CredentialStore(credentialsDir);
  const registry =
    config.registry ??
    new AccountRegistry({
      store,
      ingest: createIngestClient(ingestorBase),
    });

  void store.ensureRoot().then(() => registry.restoreFromTmpfs());

  const server = http.createServer((req, res) => {
    auth(req, res, () => {
      void handleAuthed(req, res);
    });
  });

  async function handleAuthed(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    if (method === 'GET' && url === '/health') {
      sendJson(res, 200, { status: 'ok', role: ROLE, version, egress: MAIL_FETCHER_EGRESS_NOTE });
      return;
    }

    if (method === 'GET' && url === '/accounts/status') {
      sendJson(res, 200, { accounts: registry.getStatus() });
      return;
    }

    if (method === 'POST' && url === '/accounts/start') {
      try {
        const body = (await readJsonBody(req)) as StartAccountBody;
        if (!body.account_id || !body.provider || !body.encrypted_bundle || !body.wrapped_account_key) {
          sendJson(res, 400, { error: 'missing required fields' });
          return;
        }
        await registry.startAccount(
          body.account_id,
          body.provider,
          body.encrypted_bundle,
          body.wrapped_account_key,
        );
        sendJson(res, 200, { ok: true, account_id: body.account_id, state: 'awaiting_key' });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (method === 'POST' && url === '/accounts/deliver_key') {
      let accountId: string | undefined;
      try {
        const body = (await readJsonBody(req)) as DeliverKeyBody;
        accountId = body.account_id;
        if (!body.account_id || !body.account_key) {
          sendJson(res, 400, { error: 'missing required fields' });
          return;
        }
        await registry.deliverKey(body.account_id, body.account_key);
        sendJson(res, 200, { ok: true, account_id: body.account_id, state: 'active' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes('decryption') ? 422 : 400;
        sendJson(res, status, { error: msg, account_id: accountId });
      }
      return;
    }

    if (method === 'POST' && url === '/accounts/stop') {
      try {
        const body = (await readJsonBody(req)) as StopAccountBody;
        if (!body.account_id) {
          sendJson(res, 400, { error: 'missing account_id' });
          return;
        }
        await registry.stopAccount(body.account_id);
        sendJson(res, 200, { ok: true, account_id: body.account_id, state: 'stopped' });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  }

  return server;
}

export function startMailFetcherServer(): void {
  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const host = process.env['MAIL_FETCHER_HOST'] ?? '127.0.0.1';
  const version = process.env['POD_VERSION'] ?? '1.0.0';
  const server = createMailFetcherServer();

  server.listen(port, host, () => {
    console.log(`role: ${ROLE} listening on ${host}:${port} (version ${version})`);
    console.log(`[${ROLE}] egress policy note: ${MAIL_FETCHER_EGRESS_NOTE}`);
  });

  process.on('SIGTERM', () => {
    console.log(`[${ROLE}] SIGTERM received — shutting down`);
    server.close(() => process.exit(0));
  });
}
