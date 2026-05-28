/**
 * Mail-fetcher supervisor API on local Podman (PR6) — mirrors SSH mailFetcherRemote.ts.
 */

import { runPodman } from './podman.js'

export const MAIL_FETCHER_CONTAINER = 'beap-pod-remote-edge-mail-fetcher'
export const MAIL_FETCHER_PORT = 18106

export interface MailFetcherLocalResponse {
  readonly status: number
  readonly json: Record<string, unknown>
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function buildNodeFetchScript(
  method: string,
  path: string,
  bodyBase64: string | null,
  podAuthSecret: string,
): string {
  const bodyPart =
    bodyBase64 === null
      ? 'undefined'
      : `JSON.parse(Buffer.from(${JSON.stringify(bodyBase64)}, 'base64').toString('utf8'))`
  return `
fetch('http://127.0.0.1:${MAIL_FETCHER_PORT}${path}', {
  method: ${JSON.stringify(method)},
  headers: {
    'Content-Type': 'application/json',
    'X-Pod-Auth': ${JSON.stringify(podAuthSecret)},
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

export async function mailFetcherLocalRequest(
  podAuthSecret: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<MailFetcherLocalResponse> {
  const bodyBase64 =
    body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8').toString('base64')
  const script = buildNodeFetchScript(method, path, bodyBase64, podAuthSecret)
  const result = await runPodman(
    ['exec', MAIL_FETCHER_CONTAINER, 'sh', '-c', `node -e ${shellQuote(script)}`],
    { timeoutMs: 60_000 },
  )
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
