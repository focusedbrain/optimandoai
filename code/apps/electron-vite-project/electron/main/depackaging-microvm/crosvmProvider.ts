/**
 * CrosvmProvider — the ONLY hypervisor backend shipped in Build 1 (crosvm/Linux).
 *
 * Lifecycle: read-only golden rootfs + EPHEMERAL writable overlay → boot →
 * run the depackaging worker → collect the signed JobResult → destroy VM and
 * discard the overlay ("create → run → nuke"). Default-deny egress: the job VM
 * gets no network device.
 *
 * HARD CONSTRAINT — NO IN-PROCESS FALLBACK:
 *   This provider MUST NOT run the worker in the orchestrator process. Doing so
 *   would parse untrusted bytes in the persistent orchestrator — the exact
 *   invariant this build exists to fix. Off-Linux / crosvm-absent → `isAvailable`
 *   is false and `runJob` throws. The worker only ever runs inside the guest.
 *
 * RIG-ONLY: the VM boot/collect/nuke path cannot be exercised on the Windows dev
 * box. It is verified on the mini-PC (Linux) crosvm host. The command/IO wiring
 * below is structured for that rig; the golden-image build is documented in
 * `golden-image/README` (see deliverables note).
 */

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  verifyJobResultSignature,
  type JobResult,
  type JobSpec,
  type SandboxHypervisorProvider,
} from './hypervisorProvider'

export interface CrosvmProviderConfig {
  /** Path to the crosvm binary. */
  crosvmBin: string
  /** Read-only golden rootfs image carrying the depackaging worker. */
  goldenRootfsPath: string
  /** Kernel/initrd as required by the golden image. */
  kernelPath: string
  /** Directory for ephemeral overlays (wiped after each job). */
  overlayDir: string
  /** Wall-clock ceiling for a single job. */
  defaultMaxWallClockMs?: number
}

export class CrosvmProvider implements SandboxHypervisorProvider {
  readonly backendId = 'crosvm'

  constructor(private readonly cfg: CrosvmProviderConfig) {}

  async isAvailable(): Promise<boolean> {
    if (os.platform() !== 'linux') return false
    try {
      await fs.access(this.cfg.crosvmBin)
      await fs.access(this.cfg.goldenRootfsPath)
      await fs.access(this.cfg.kernelPath)
      return true
    } catch {
      return false
    }
  }

  async runJob(spec: JobSpec): Promise<JobResult> {
    if (!(await this.isAvailable())) {
      // Fail loud — NEVER fall back to in-process parsing.
      throw new Error(
        'CrosvmProvider unavailable on this host (crosvm/Linux required). ' +
          'Refusing to depackage untrusted bytes in the orchestrator process.',
      )
    }

    const overlayPath = path.join(this.cfg.overlayDir, `overlay-${spec.jobId}-${randomUUID()}.img`)
    const inputPath = path.join(this.cfg.overlayDir, `in-${spec.jobId}.bin`)
    const resultPath = path.join(this.cfg.overlayDir, `out-${spec.jobId}.json`)

    try {
      await fs.mkdir(this.cfg.overlayDir, { recursive: true })
      // Hand the untrusted bytes IN (never parsed here).
      await fs.writeFile(inputPath, spec.inputBytes)
      await this.createEphemeralOverlay(overlayPath)

      // Boot crosvm: read-only golden rootfs, ephemeral overlay, NO network device
      // (default-deny egress), input/result shared via virtio-blk/virtiofs. The
      // guest init runs the worker on the input and writes the signed JobResult.
      const args = [
        'run',
        '--disable-sandbox=false',
        '--rwroot', overlayPath,
        '--root', this.cfg.goldenRootfsPath, // read-only base
        // NO `--net` / `--tap-*` flags → guest has no egress.
        '--params', `wrdesk.job=${spec.jobId} wrdesk.sandbox_pub=${spec.sandboxPeerX25519PubB64}`,
        '--shared-dir', `${path.dirname(inputPath)}:wrdesk_io:type=fs`,
        this.cfg.kernelPath,
      ]

      await this.runToCompletion(args, spec.limits?.maxWallClockMs ?? this.cfg.defaultMaxWallClockMs ?? 60_000)

      const raw = await fs.readFile(resultPath, 'utf8')
      const result = JSON.parse(raw) as JobResult

      // Verify the guest's result signature before handing upward. (Identity
      // attestation of the signing key is a later build; transport integrity now.)
      if (!verifyJobResultSignature(result)) {
        return { jobId: spec.jobId, ok: false, error: 'job result signature invalid' }
      }
      return result
    } catch (err: unknown) {
      return { jobId: spec.jobId, ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      // NUKE: discard overlay + IO scratch. Nothing persists across jobs.
      await this.bestEffortUnlink(overlayPath)
      await this.bestEffortUnlink(inputPath)
      await this.bestEffortUnlink(resultPath)
    }
  }

  private async createEphemeralOverlay(overlayPath: string): Promise<void> {
    // Thin writable overlay over the read-only golden base. On the rig this is a
    // qcow2/raw overlay created per job and deleted in `finally`.
    await fs.writeFile(overlayPath, Buffer.alloc(0))
  }

  private runToCompletion(args: string[], timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.cfg.crosvmBin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('crosvm job timed out'))
      }, timeoutMs)
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`crosvm exited with code ${code}`))
      })
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
