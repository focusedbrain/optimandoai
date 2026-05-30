/**
 * Host→pod PDF extract via `podman exec` into the ingestor netns (bypasses dead wslrelay publish).
 * In-pod script POSTs to http://127.0.0.1:18100/extract-pdf (ingestor proxy → depackager → pdf-parser).
 */

import { spawn } from 'node:child_process'

import { DEFAULT_POD_NAME } from '../local-pod/podConstants.js'
import { getActiveLocalPodName } from '../local-pod/index.js'
import { resolvePodmanCli } from '../local-pod/podExec.js'

/** Host-side wall clock — kill exec child if pod loopback chain does not respond. */
export const PDF_POD_EXEC_TIMEOUT_MS = 15_000

/** In-pod fetch to ingestor /extract-pdf (must finish before host timeout). */
const IN_POD_EXTRACT_FETCH_TIMEOUT_MS = 12_000

/**
 * Runs inside beap-pod-ingestor: read JSON stdin, POST to local ingestor entry, write response body to stdout.
 * Uses container POD_AUTH_SECRET (same as pod session); host never passes secret on CLI.
 */
export const IN_POD_EXTRACT_PDF_SCRIPT = [
  '(async()=>{',
  'const c=[];for await(const x of process.stdin)c.push(x);',
  'let b;try{b=JSON.parse(Buffer.concat(c).toString("utf8"))}catch{process.stderr.write("invalid_stdin_json");process.exit(2)}',
  'const s=process.env.POD_AUTH_SECRET;',
  'if(!s){process.stderr.write("missing_pod_auth_secret");process.exit(2)}',
  `const r=await fetch("http://127.0.0.1:18100/extract-pdf",{method:"POST",headers:{"Content-Type":"application/json","X-Pod-Auth":s},body:JSON.stringify({message_id:b.message_id,attachment_id:b.attachment_id,pdf_bytes_b64:b.pdf_bytes_b64}),signal:AbortSignal.timeout(${IN_POD_EXTRACT_FETCH_TIMEOUT_MS})});`,
  'process.stdout.write(await r.text());',
  'process.exit(r.ok?0:1);',
  '})().catch(e=>{process.stderr.write(String(e&&e.message||e));process.exit(1)});',
].join('')

export function resolveIngestorContainerName(): string {
  const podName = getActiveLocalPodName() ?? DEFAULT_POD_NAME
  return `${podName}-ingestor`
}

export type PdfPodExecOutcome =
  | { ok: true; stdout: string; stderr: string; exitCode: 0 }
  | { ok: false; reason: string; exitCode: number | null; stdout: string; stderr: string }

export type PdfPodExecDeps = {
  containerName?: string
  timeoutMs?: number
  spawnImpl?: typeof spawn
  resolvePodman?: () => Promise<string>
}

export async function runPdfExtractViaPodmanExec(
  payload: { message_id: string; attachment_id: string; pdf_bytes_b64: string },
  deps?: PdfPodExecDeps,
): Promise<PdfPodExecOutcome> {
  const spawnFn = deps?.spawnImpl ?? spawn
  const timeoutMs = deps?.timeoutMs ?? PDF_POD_EXEC_TIMEOUT_MS
  const containerName = deps?.containerName ?? resolveIngestorContainerName()
  let podmanBin: string
  try {
    podmanBin = deps?.resolvePodman ? await deps.resolvePodman() : await resolvePodmanCli()
  } catch {
    return { ok: false, reason: 'podman_cli_unavailable', exitCode: null, stdout: '', stderr: '' }
  }

  const stdinBody = JSON.stringify(payload)

  return new Promise((resolve) => {
    const child = spawnFn(
      podmanBin,
      ['exec', '-i', containerName, 'node', '-e', IN_POD_EXTRACT_PDF_SCRIPT],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (outcome: PdfPodExecOutcome) => {
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
        reason: 'pdf_parse_unavailable',
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
        reason: 'pdf_parse_unavailable',
        exitCode: null,
        stdout,
        stderr: String(err.message ?? err),
      })
    })
    child.on('close', (code) => {
      const exitCode = code ?? 1
      const out = stdout.trim()
      const errOut = stderr.trim()
      if (exitCode === 0 && out) {
        finish({ ok: true, stdout: out, stderr: errOut, exitCode: 0 })
        return
      }
      finish({
        ok: false,
        reason:
          exitCode === 125 || exitCode === 126 || exitCode === 127
            ? 'podman_exec_failed'
            : 'pdf_parse_unavailable',
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
        reason: 'pdf_parse_unavailable',
        exitCode: null,
        stdout,
        stderr: String((err as Error).message ?? err),
      })
    }
  })
}
