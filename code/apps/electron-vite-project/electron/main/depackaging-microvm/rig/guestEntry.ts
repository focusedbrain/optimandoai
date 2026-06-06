/**
 * Guest entrypoint — the process the golden image runs INSIDE the crosvm guest.
 *
 * Build 2a scope: this is the worker's execution shim, NOT CrosvmProvider
 * lifecycle logic (that's Build 2b). It reads ONE job, runs the Build-1
 * depackaging worker, and writes ONE result. No network, no filesystem sharing.
 *
 * I/O CONTRACT (what Build 2b's host side must speak):
 *   IN  (one JSON object):
 *     { "jobId": string,
 *       "inputBytes_b64": string,            // untrusted bytes, base64
 *       "sandboxPeerX25519PubB64": string }  // sandbox PUBLIC key (custody target)
 *   OUT (one JSON object): the JobResult
 *     { jobId, ok, safeText?, artifacts?[], result_signing_pub_b64?, result_signature_b64?, error? }
 *
 * TRANSPORT:
 *   - ON THE RIG (Build 2b): the job arrives/returns over **virtio-vsock** — a
 *     host<->guest socket with NO shared filesystem (the WSL2 leak surface is
 *     rejected). The vsock framing is exactly the IN/OUT JSON above, one object
 *     per connection.
 *   - HERE / FALLBACK: read the IN object from stdin, write OUT to stdout. This
 *     lets the SAME bundle be validated under bare Node off-rig (no crosvm),
 *     proving the guest payload runs on a plain Node runtime — which is all the
 *     golden image must provide.
 *
 * The vsock wiring itself is added in Build 2b against the channel §4 confirms;
 * keeping stdin/stdout here means the bundle is transport-agnostic and testable.
 */

import { runDepackagingJob } from '../depackagingWorker'
import { runDepackageEmailJob } from '../emailDepackage'
import type { JobSpec } from '../hypervisorProvider'

interface GuestJobInput {
  jobId: string
  /** Defaults to B1 `'depackage'`. `'depackage-email'` runs the B2 worker. */
  kind?: 'depackage' | 'depackage-email'
  inputBytes_b64: string
  sandboxPeerX25519PubB64: string
  /** B2 email cutover: which guest parser to run (default rfc822). */
  inputForm?: 'rfc822' | 'provider-structured-json'
  /** schema adapter for the structured-json walker (default outlook). */
  provider?: string
  /** C4 spec ceiling honored in-guest. */
  maxInputBytes?: number
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', (c) => chunks.push(Buffer.from(c)))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

async function main(): Promise<void> {
  const raw = await readStdin()
  let parsed: GuestJobInput
  try {
    parsed = JSON.parse(raw) as GuestJobInput
  } catch (err) {
    process.stdout.write(
      JSON.stringify({ jobId: 'unknown', ok: false, error: `bad job input json: ${String(err)}` }),
    )
    process.exitCode = 1
    return
  }

  const inputBytes = Buffer.from(parsed.inputBytes_b64 ?? '', 'base64')

  // B2 (Phase 1 uplift + D4): the email worker runs INSIDE this same bundle and
  // SIGNS its typed result (transport integrity), exactly like the B1 path below.
  if (parsed.kind === 'depackage-email') {
    const signed = runDepackageEmailJob({
      jobId: parsed.jobId,
      inputBytes,
      sandboxPeerX25519PubB64: parsed.sandboxPeerX25519PubB64,
      inputForm: parsed.inputForm,
      provider: parsed.provider,
      maxInputBytes: parsed.maxInputBytes,
    })
    process.stdout.write(JSON.stringify(signed))
    return
  }

  const spec: JobSpec = {
    jobId: parsed.jobId,
    kind: 'depackage',
    inputBytes,
    sandboxPeerX25519PubB64: parsed.sandboxPeerX25519PubB64,
  }

  const result = runDepackagingJob(spec)
  process.stdout.write(JSON.stringify(result))
}

void main()
