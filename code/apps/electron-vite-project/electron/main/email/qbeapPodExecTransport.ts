/**
 * Host→pod qBEAP/pBEAP depackage via `podman exec` into the ingestor netns.
 * Bypasses dead host→127.0.0.1:18100 TCP (wslrelay/pasta). In-pod script POSTs the
 * same /ingest envelope the HTTP pod-client used from the host.
 */

import { spawn } from 'node:child_process'

import { DEFAULT_POD_NAME } from '../local-pod/podConstants.js'
import { getActiveLocalPodName } from '../local-pod/index.js'
import { resolvePodmanCli } from '../local-pod/podExec.js'

/** Host-side wall clock — kill exec child if pod loopback chain does not respond. */
export const QBEAP_POD_EXEC_TIMEOUT_MS = 15_000

/** In-pod fetch to ingestor /ingest (must finish before host timeout). */
const IN_POD_INGEST_FETCH_TIMEOUT_MS = 12_000

/**
 * Runs inside beap-pod-ingestor: read ingest envelope JSON from stdin, POST to
 * local ingestor /ingest, write response body to stdout.
 */
export const IN_POD_P2P_INGEST_SCRIPT = [
  '(async()=>{',
  'const c=[];for await(const x of process.stdin)c.push(x);',
  'const raw=Buffer.concat(c).toString("utf8");',
  'if(!raw.trim()){process.stderr.write("empty_stdin");process.exit(2)}',
  'const s=process.env.POD_AUTH_SECRET;',
  'if(!s){process.stderr.write("missing_pod_auth_secret");process.exit(2)}',
  `const r=await fetch("http://127.0.0.1:18100/ingest",{method:"POST",headers:{"Content-Type":"application/json","X-Pod-Auth":s},body:raw,signal:AbortSignal.timeout(${IN_POD_INGEST_FETCH_TIMEOUT_MS})});`,
  'process.stdout.write(await r.text());',
  'process.exit(r.ok?0:1);',
  '})().catch(e=>{process.stderr.write(String(e&&e.message||e));process.exit(1)});',
].join('')

export function resolveIngestorContainerNameForQbeap(): string {
  const podName = getActiveLocalPodName() ?? DEFAULT_POD_NAME
  return `${podName}-ingestor`
}

export type QbeapPodExecOutcome =
  | { ok: true; stdout: string; stderr: string; exitCode: number }
  | { ok: false; reason: string; exitCode: number | null; stdout: string; stderr: string }

export type QbeapPodExecDeps = {
  containerName?: string
  timeoutMs?: number
  spawnImpl?: typeof spawn
  resolvePodman?: () => Promise<string>
}

/** Ingest envelope POST body — must match @repo/pod-client buildIngestEnvelope shape. */
export type QbeapIngestExecEnvelope = {
  body: string
  source_type: 'p2p'
  depackage_keys: {
    x25519_priv_b64: string
    mlkem_secret_b64?: string
  }
}

export async function runQbeapIngestViaPodmanExec(
  envelope: QbeapIngestExecEnvelope,
  deps?: QbeapPodExecDeps,
): Promise<QbeapPodExecOutcome> {
  const spawnFn = deps?.spawnImpl ?? spawn
  const timeoutMs = deps?.timeoutMs ?? QBEAP_POD_EXEC_TIMEOUT_MS
  const containerName = deps?.containerName ?? resolveIngestorContainerNameForQbeap()
  let podmanBin: string
  try {
    podmanBin = deps?.resolvePodman ? await deps.resolvePodman() : await resolvePodmanCli()
  } catch {
    return { ok: false, reason: 'podman_cli_unavailable', exitCode: null, stdout: '', stderr: '' }
  }

  const stdinBody = JSON.stringify(envelope)

  return new Promise((resolve) => {
    const child = spawnFn(
      podmanBin,
      ['exec', '-i', containerName, 'node', '-e', IN_POD_P2P_INGEST_SCRIPT],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (outcome: QbeapPodExecOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      finish({
        ok: false,
        reason: 'pod_ingest_unavailable',
        exitCode: null,
        stdout,
        stderr: stderr.trim() || 'exec_timeout',
      })
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      finish({
        ok: false,
        reason: 'pod_ingest_unavailable',
        exitCode: null,
        stdout,
        stderr: String(err.message ?? err),
      })
    })
    child.on('close', (code) => {
      const exitCode = code ?? 1
      const out = stdout.trim()
      const errOut = stderr.trim()
      // Channel succeeded when exec ran and ingestor returned a body (even HTTP 4xx/5xx JSON).
      if (out) {
        finish({ ok: true, stdout: out, stderr: errOut, exitCode })
        return
      }
      finish({
        ok: false,
        reason:
          exitCode === 125 || exitCode === 126 || exitCode === 127
            ? 'podman_exec_failed'
            : 'pod_ingest_unavailable',
        exitCode,
        stdout: out,
        stderr: errOut,
      })
    })

    try {
      child.stdin?.write(stdinBody)
      child.stdin?.end()
    } catch (err) {
      finish({
        ok: false,
        reason: 'pod_ingest_unavailable',
        exitCode: null,
        stdout,
        stderr: String((err as Error).message ?? err),
      })
    }
  })
}
