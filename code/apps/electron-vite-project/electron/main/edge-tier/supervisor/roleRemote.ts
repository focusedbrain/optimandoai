/**
 * Invoke role admin HTTP APIs on a REMOTE_EDGE VM over SSH (P5.4).
 *
 * Uses `podman exec` + in-container fetch; POD_AUTH_SECRET is read from the
 * container environment (never persisted on desktop).
 */

import { shellQuote } from '../ssh/deploy.js'
import type { ReplicaActionSshRunner } from '../replicaActions.js'
import type { RemoteEdgeContainerSpec } from './containers.js'

export interface RoleRemoteResponse {
  readonly status: number
  readonly json: Record<string, unknown>
}

function buildNodeFetchScript(method: string, port: number, path: string, bodyBase64: string | null): string {
  const bodyPart =
    bodyBase64 === null
      ? 'undefined'
      : `JSON.parse(Buffer.from(${JSON.stringify(bodyBase64)}, 'base64').toString('utf8'))`
  return `
fetch('http://127.0.0.1:${port}${path}', {
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

export async function roleRemoteRequest(
  ssh: ReplicaActionSshRunner,
  containerName: string,
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<RoleRemoteResponse> {
  const bodyBase64 =
    body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8').toString('base64')
  const script = buildNodeFetchScript(method, port, path, bodyBase64)
  const cmd = `podman exec ${containerName} node -e ${shellQuote(script)}`
  const result = await ssh.run(cmd)
  const line = result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()
  if (!line) {
    return {
      status: result.code === 0 ? 502 : 0,
      json: { error: result.stderr.trim() || 'empty role response' },
    }
  }
  try {
    const parsed = JSON.parse(line) as { status?: number; json?: Record<string, unknown> }
    return {
      status: typeof parsed.status === 'number' ? parsed.status : 0,
      json: parsed.json ?? { error: 'invalid role response' },
    }
  } catch {
    return { status: 0, json: { error: `unparseable role output: ${line.slice(0, 200)}` } }
  }
}

export async function postRoleRestore(
  ssh: ReplicaActionSshRunner,
  spec: RemoteEdgeContainerSpec,
  queuePosition: number,
): Promise<RoleRemoteResponse> {
  return roleRemoteRequest(ssh, spec.containerName, spec.port, 'POST', '/restore', {
    queue_position: queuePosition,
  })
}
