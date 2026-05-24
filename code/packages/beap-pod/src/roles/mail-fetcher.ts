/**
 * BEAP mail-fetcher role container (REMOTE_EDGE email-on-edge).
 *
 * Port: 127.0.0.1:18106 (or PORT env var)
 * UID:  10106 (pod manifest — extends 10100..10105 range from P1.1)
 */

export { createMailFetcherServer, startMailFetcherServer, ROLE, DEFAULT_PORT } from './mail-fetcher/supervisor.js';

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { startMailFetcherServer } from './mail-fetcher/supervisor.js';

const __filename = fileURLToPath(import.meta.url);
const _entry = process.argv[1] ? resolve(process.cwd(), process.argv[1]) : '';
if (_entry === __filename || process.argv[1]?.endsWith('roles/mail-fetcher.js')) {
  startMailFetcherServer();
}
