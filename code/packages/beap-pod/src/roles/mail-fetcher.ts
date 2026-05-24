/**
 * BEAP mail-fetcher role container (REMOTE_EDGE email-on-edge).
 *
 * Stub (P4.5.4): log role, listen on loopback, exit on SIGTERM.
 * Real IMAP/OAuth fetch logic lands in P4.5.5 / P4.5.6 (strategy §11.7).
 *
 * Port: 127.0.0.1:18106 (or PORT env var)
 * UID:  10106 (pod manifest — extends 10100..10105 range from P1.1)
 */

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROLE = 'mail-fetcher';
const DEFAULT_PORT = 18106;
const VERSION = process.env['POD_VERSION'] ?? '1.0.0';

export function createMailFetcherServer(): http.Server {
  return http.createServer((_req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ role: ROLE, status: 'stub', version: VERSION }));
  });
}

/** Start the mail-fetcher stub server (PORT / MAIL_FETCHER_HOST from env). */
export function startMailFetcherServer(): void {
  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const host = process.env['MAIL_FETCHER_HOST'] ?? '127.0.0.1';
  const server = createMailFetcherServer();

  server.listen(port, host, () => {
    console.log(`role: ${ROLE} listening on ${host}:${port} (version ${VERSION}) — stub`);
  });

  process.on('SIGTERM', () => {
    console.log(`[${ROLE}] SIGTERM received — shutting down`);
    server.close(() => process.exit(0));
  });
}

// ── Entrypoint detection ──────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const _entry = process.argv[1] ? resolve(process.cwd(), process.argv[1]) : '';
if (_entry === __filename || process.argv[1]?.endsWith('roles/mail-fetcher.js')) {
  startMailFetcherServer();
}
