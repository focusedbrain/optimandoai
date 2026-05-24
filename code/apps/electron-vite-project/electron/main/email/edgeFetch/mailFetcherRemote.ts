/**
 * Invoke mail-fetcher supervisor API on a REMOTE_EDGE VM over SSH.
 *
 * Uses `podman exec` into the mail-fetcher container; POD_AUTH_SECRET is read from
 * the container environment (never persisted on desktop).
 */

import { shellQuote } from '../../edge-tier/ssh/deploy.js'
import type { ReplicaActionSshRunner } from '../../edge-tier/replicaActions.js'
import type { MailFetcherAccountStatusWire } from './types.js'

export const MAIL_FETCHER_CONTAINER = 'beap-pod-remote-edge-mail-fetcher'
export const MAIL_FETCHER_PORT = 18106

export interface MailFetcherRemoteResponse {
  readonly status: number
  readonly json: Record<string, unknown>
}

function buildNodeFetchScript(method: string, path: string, bodyBase64: string | null): string {
  const bodyPart =
    bodyBase64 === null
      ? 'undefined'
      : `JSON.parse(Buffer.from(${JSON.stringify(bodyBase64)}, 'base64').toString('utf8'))`
  return `
fetch('http://127.0.0.1:${MAIL_FETCHER_PORT}${path}', {
  method: ${JSON.stringify(method)},
  headers: {
    'Content-Type': 'application/json',
    'X-Pod-Auth': process.env.POD_AUTH_SECRET || '',
  },
  body: ${bodyPart === 'undefined' ? 'undefined' : `JSON.stringify(${bodyPart})`},
})
  .then(async (r) => {
    const text = await r.text();
    let parsed = {};
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    console.log(JSON.stringify({ status: r.status, json: parsed }));
  })
  .catch((e) => {
    console.log(JSON.stringify({ status: 0, json: { error: String(e?.message || e) } }));
    process.exit(1);
  });
`.trim()
}

export async function mailFetcherRemoteRequest(
  ssh: ReplicaActionSshRunner,
  method: string,
  path: string,
  body?: unknown,
): Promise<MailFetcherRemoteResponse> {
  const bodyBase64 =
    body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8').toString('base64')
  const script = buildNodeFetchScript(method, path, bodyBase64)
  const cmd = `podman exec ${MAIL_FETCHER_CONTAINER} node -e ${shellQuote(script)}`
  const result = await ssh.run(cmd)
  const line = result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()
  if (!line) {
    return {
      status: result.code === 0 ? 502 : 0,
      json: { error: result.stderr.trim() || 'empty mail-fetcher response' },
    }
  }
  try {
    const parsed = JSON.parse(line) as { status?: number; json?: Record<string, unknown> }
    return {
      status: typeof parsed.status === 'number' ? parsed.status : 0,
      json: parsed.json ?? { error: 'invalid mail-fetcher response' },
    }
  } catch {
    return { status: 0, json: { error: `unparseable mail-fetcher output: ${line.slice(0, 200)}` } }
  }
}

export async function mailFetcherGetAccountStatus(
  ssh: ReplicaActionSshRunner,
): Promise<MailFetcherAccountStatusWire[]> {
  const res = await mailFetcherRemoteRequest(ssh, 'GET', '/accounts/status')
  if (res.status !== 200) {
    throw new Error(String(res.json.error ?? `mail-fetcher status HTTP ${res.status}`))
  }
  const accounts = res.json.accounts
  if (!Array.isArray(accounts)) return []
  return accounts as MailFetcherAccountStatusWire[]
}
