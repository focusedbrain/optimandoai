/**
 * CrosvmProvider — the ONLY hypervisor backend shipped for the depackaging
 * microVM (crosvm/Linux). Build 2b: REAL create -> run-over-vsock -> collect ->
 * verify -> nuke lifecycle, wrapping the flags/scripts proven on the rig in
 * Build 2a (see rig/README.md "RIG RESULTS").
 *
 * LIFECYCLE (per job, fire-and-forget):
 *   1. CREATE  — boot a microVM from the read-only golden base
 *      (`--block path=<golden>,ro=true,root=true`) plus a FRESH ephemeral
 *      writable overlay (`mktemp` + `mkfs` + `--block path=<overlay>`), with
 *      `--vsock cid=<CID>` and NO `--net` (zero egress; guest has only `lo`).
 *   2. RUN     — hand the untrusted bytes IN and get the signed JobResult OUT
 *      over **virtio-vsock** (NOT shared FS). The guest's static
 *      `vsock-job-server` wires the connection onto the worker's stdin/stdout,
 *      so the one-JSON-object-each-way contract is unchanged from 2a — only the
 *      transport moved from pipes to socket. The host side spawns the static
 *      `vsock-host-client` (the orchestrator is Node, which has no native
 *      AF_VSOCK; we refuse to add a native addon to the persistent process).
 *   3. COLLECT/VERIFY — verify the guest's Ed25519 result signature
 *      (`verifyJobResultSignature`) before trusting transport integrity.
 *   4. NUKE    — kill the VM (it powers itself off after the job) and discard
 *      the overlay. Nothing persists across jobs.
 *
 * HARD CONSTRAINT — NO IN-PROCESS FALLBACK (unchanged from Build 1):
 *   If the crosvm path is unavailable (off-Linux, no /dev/kvm, no vhost-vsock,
 *   binary/image missing), `isAvailable()` is false and `runJob` THROWS. The
 *   orchestrator must NEVER fall back to parsing untrusted bytes in-process.
 *
 * NOTE on trust: the guest result-signing key is per-job and NOT yet bound to an
 * attested VM identity (attestation is a later build). So signature verification
 * proves transport integrity only; the orchestrator MUST still re-validate
 * `safeText` against the closed schema (`validateSafeText`).
 */

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomInt, randomUUID } from 'crypto'
import {
  verifyJobResultSignature,
  verifyDepackageEmailResultSignature,
  type DepackageEmailJobResult,
  type JobResult,
  type JobSpec,
  type SandboxHypervisorProvider,
} from './hypervisorProvider'

export interface CrosvmProviderConfig {
  /** Path to the crosvm binary (built from source on the rig; lives in ~/build). */
  crosvmBin: string
  /** Read-only golden rootfs (ext4) carrying node + the worker bundle + vsock modules. */
  goldenRootfsPath: string
  /** Guest kernel (the reused host kernel, copied into ~/build). */
  kernelPath: string
  /** Directory for ephemeral overlays (each wiped after its job). */
  overlayDir: string
  /** Static host-side vsock client the provider spawns to speak AF_VSOCK. */
  vsockHostClientPath: string
  /** vsock port the guest `vsock-job-server` listens on (must match the init). */
  vsockPort?: number
  /** Host vhost-vsock device (default /dev/vhost-vsock). */
  vhostVsockDevice?: string
  /** Wall-clock ceiling for a single job. */
  defaultMaxWallClockMs?: number
  /** Guest memory (MiB) / vcpus. */
  memMib?: number
  cpus?: number
}

const DEFAULT_PORT = 5252
const DEFAULT_WALLCLOCK_MS = 60_000
const RESERVED_MAX_CID = 2 // 0,1,2 are reserved (HYPERVISOR/LOCAL/HOST)

/**
 * Build the exact crosvm argv for a depackaging job. Extracted + exported so the
 * zero-egress / RO-base / vsock invariants are deterministically testable
 * WITHOUT booting a VM: no `--net`/`--tap*` (zero egress), `ro=true,root=true`
 * (immutable base), a fresh overlay block, and `--vsock cid=...`.
 */
export function buildCrosvmArgs(
  cfg: CrosvmProviderConfig,
  cid: number,
  overlayPath: string,
): string[] {
  return [
    'run',
    '--disable-sandbox',
    '--mem', String(cfg.memMib ?? 1024),
    '--cpus', String(cfg.cpus ?? 2),
    '--block', `path=${cfg.goldenRootfsPath},ro=true,root=true`,
    '--block', `path=${overlayPath}`,
    '--vsock', `cid=${cid}`,
    // NO --net / --tap-* anywhere => zero egress (guest has only lo).
    '--serial', 'type=stdout,hardware=serial,num=1,console=true',
    '-p', 'root=/dev/vda ro console=ttyS0 init=/init',
    cfg.kernelPath,
  ]
}

export class CrosvmProvider implements SandboxHypervisorProvider {
  readonly backendId = 'crosvm'

  constructor(private readonly cfg: CrosvmProviderConfig) {}

  async isAvailable(): Promise<boolean> {
    if (os.platform() !== 'linux') return false
    const vhost = this.cfg.vhostVsockDevice ?? '/dev/vhost-vsock'
    try {
      // /dev/kvm + vhost-vsock must be openable, and all artifacts present.
      await fs.access('/dev/kvm')
      await fs.access(vhost)
      await fs.access(this.cfg.crosvmBin)
      await fs.access(this.cfg.goldenRootfsPath)
      await fs.access(this.cfg.kernelPath)
      await fs.access(this.cfg.vsockHostClientPath)
      return true
    } catch {
      return false
    }
  }

  async runJob(spec: JobSpec): Promise<JobResult | DepackageEmailJobResult> {
    if (!(await this.isAvailable())) {
      // Fail loud — NEVER fall back to in-process parsing of untrusted bytes.
      throw new Error(
        'CrosvmProvider unavailable on this host (crosvm/Linux + /dev/kvm + vhost-vsock required). ' +
          'Refusing to depackage untrusted bytes in the orchestrator process.',
      )
    }

    const port = this.cfg.vsockPort ?? DEFAULT_PORT
    const wallClockMs = spec.limits?.maxWallClockMs ?? this.cfg.defaultMaxWallClockMs ?? DEFAULT_WALLCLOCK_MS
    const cid = this.allocateCid()
    const overlayPath = path.join(this.cfg.overlayDir, `overlay-${spec.jobId}-${randomUUID()}.img`)

    let crosvm: ReturnType<typeof spawn> | undefined
    try {
      await fs.mkdir(this.cfg.overlayDir, { recursive: true })
      await this.createEphemeralOverlay(overlayPath)

      // CREATE: boot crosvm. RO golden base + ephemeral overlay, vsock, NO net.
      const args = buildCrosvmArgs(this.cfg, cid, overlayPath)
      let guestSerial = ''
      crosvm = spawn(this.cfg.crosvmBin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      crosvm.stdout?.on('data', (d) => { guestSerial += d.toString() })
      crosvm.stderr?.on('data', (d) => { guestSerial += d.toString() })

      // RUN: hand the untrusted bytes in / get the signed result out over vsock.
      // `kind`/`inputForm`/`provider` select the guest worker + parser; they are
      // routing discriminators, NOT a host-side parse of the untrusted content.
      const input = JSON.stringify({
        jobId: spec.jobId,
        kind: spec.kind,
        inputBytes_b64: spec.inputBytes.toString('base64'),
        sandboxPeerX25519PubB64: spec.sandboxPeerX25519PubB64,
        ...(spec.kind === 'depackage-email'
          ? {
              inputForm: spec.inputForm ?? 'rfc822',
              provider: spec.provider,
              maxInputBytes: spec.limits?.maxInputBytes,
            }
          : {}),
      })
      const rawResult = await this.runHostClient(input, cid, port, wallClockMs)

      // COLLECT/VERIFY: parse the kind-appropriate result, then check the guest's
      // transport-integrity signature before trusting it. The orchestrator still
      // re-validates safe-text downstream (the signature proves integrity only).
      if (spec.kind === 'depackage-email') {
        let emailResult: DepackageEmailJobResult
        try {
          emailResult = JSON.parse(rawResult) as DepackageEmailJobResult
        } catch {
          return {
            jobId: spec.jobId,
            kind: 'depackage-email',
            result: { ok: false, code: 'E_MALFORMED_MIME', message: 'guest returned non-JSON over vsock' },
            error: `guest returned non-JSON over vsock (serial tail: ${guestSerial.slice(-200)})`,
          }
        }
        if (!verifyDepackageEmailResultSignature(emailResult)) {
          return {
            jobId: spec.jobId,
            kind: 'depackage-email',
            result: { ok: false, code: 'E_MALFORMED_MIME', message: 'job result signature invalid' },
            error: 'job result signature invalid',
          }
        }
        return emailResult
      }

      let result: JobResult
      try {
        result = JSON.parse(rawResult) as JobResult
      } catch {
        return {
          jobId: spec.jobId,
          ok: false,
          error: `guest returned non-JSON over vsock (serial tail: ${guestSerial.slice(-200)})`,
        }
      }

      // COLLECT/VERIFY: transport-integrity signature check before trusting.
      if (!verifyJobResultSignature(result)) {
        return { jobId: spec.jobId, ok: false, error: 'job result signature invalid' }
      }
      return result
    } catch (err: unknown) {
      return { jobId: spec.jobId, ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      // NUKE: ensure the VM is gone and discard the overlay. Nothing persists.
      await this.terminate(crosvm, wallClockMs)
      await this.bestEffortUnlink(overlayPath)
    }
  }

  /** Random guest CID in [3, 2^31). Avoids the reserved 0/1/2. */
  private allocateCid(): number {
    return RESERVED_MAX_CID + 1 + randomInt(0x7fff_fff0)
  }

  private async createEphemeralOverlay(overlayPath: string): Promise<void> {
    // Fresh writable scratch disk per job, formatted ext4, discarded on nuke.
    await fs.writeFile(overlayPath, Buffer.alloc(0))
    await fs.truncate(overlayPath, 256 * 1024 * 1024)
    await this.runToCompletion('mkfs.ext4', ['-q', '-F', overlayPath], 30_000)
  }

  /** Spawn the static host vsock client, feed it the job, collect the result. */
  private runHostClient(input: string, cid: number, port: number, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeoutS = Math.max(1, Math.ceil(timeoutMs / 1000))
      const child = spawn(this.cfg.vsockHostClientPath, [String(cid), String(port), String(timeoutS)], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('vsock host client timed out'))
      }, timeoutMs)
      child.stdout.on('data', (d) => { out += d.toString() })
      child.stderr.on('data', (d) => { err += d.toString() })
      child.on('error', (e) => { clearTimeout(timer); reject(e) })
      child.on('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve(out)
        else reject(new Error(`vsock host client exited ${code}: ${err.trim()}`))
      })
      child.stdin.write(input)
      child.stdin.end()
    })
  }

  private runToCompletion(bin: string, args: string[], timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let err = ''
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${bin} timed out`)) }, timeoutMs)
      child.stderr?.on('data', (d) => { err += d.toString() })
      child.on('error', (e) => { clearTimeout(timer); reject(e) })
      child.on('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`${bin} exited ${code}: ${err.trim()}`))
      })
    })
  }

  /** Wait briefly for the VM to power itself off; SIGKILL if it overstays. */
  private terminate(child: ReturnType<typeof spawn> | undefined, timeoutMs: number): Promise<void> {
    if (!child || child.exitCode !== null || child.killed) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ } resolve() }, Math.min(timeoutMs, 5_000))
      child.on('exit', () => { clearTimeout(timer); resolve() })
    })
  }

  private async bestEffortUnlink(p: string): Promise<void> {
    try {
      await fs.rm(p, { force: true })
    } catch {
      /* ignore */
    }
  }
}
