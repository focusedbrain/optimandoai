/**
 * MicroVMExecutor — thin adapter from the seam onto the existing isolation
 * microVM (Build A, Deliverable 3).
 *
 * It maps `CriticalJobSpec` → `JobSpec`, calls `SandboxHypervisorProvider.runJob`
 * (the rig-proven crosvm create→run-over-vsock→verify→nuke lifecycle, unchanged),
 * and maps the `JobResult` back to a `CriticalJobResult`. Post-result signature
 * + safe-text verification is performed centrally by the dispatcher, not here.
 *
 * INV-4 (no hardcoded hypervisor): this class talks ONLY to the
 * `SandboxHypervisorProvider` interface. The sole reference to crosvm in the
 * whole seam is the provider construction in `createCrosvmMicroVmExecutor` below.
 *
 * Supported kinds: `'depackage'` ONLY in this build. Guest payloads for the
 * validators / link / attachment kinds do not exist yet and are NOT stubbed.
 */

import { CrosvmProvider, type CrosvmProviderConfig } from '../../depackaging-microvm/crosvmProvider'
import type {
  JobSpec,
  SandboxHypervisorProvider,
} from '../../depackaging-microvm/hypervisorProvider'
import { depackageJobResultToCriticalResult } from '../verify'
import type { CriticalJobExecutor } from '../executor'
import {
  CriticalJobError,
  type CriticalJobKind,
  type CriticalJobResult,
  type CriticalJobSpec,
} from '../types'

export class MicroVMExecutor implements CriticalJobExecutor {
  readonly id = 'microvm' as const

  constructor(private readonly provider: SandboxHypervisorProvider) {}

  supports(kind: CriticalJobKind): boolean {
    // Only the email-pipeline depackage worker exists today. `decrypt-qbeap` is
    // the other genuinely microVM-capable kind (its INV-6 venue is a LOCAL
    // per-action microVM with per-job key provisioning) but is RESERVED and
    // unimplemented in B1, so it is not advertised here (Amendment 1).
    return kind === 'depackage'
  }

  /** Probe without throwing — the provider's own availability check is
   *  boolean-returning, but we defensively translate any throw to false. */
  async isAvailable(): Promise<boolean> {
    try {
      return await this.provider.isAvailable()
    } catch {
      return false
    }
  }

  async run<K extends CriticalJobKind>(spec: CriticalJobSpec<K>): Promise<CriticalJobResult<K>> {
    if (spec.kind !== 'depackage') {
      throw new CriticalJobError(
        'E_UNSUPPORTED_KIND',
        `MicroVMExecutor supports only "depackage" in this build, not "${spec.kind}"`,
      )
    }
    const dspec = spec as CriticalJobSpec<'depackage'>
    if (!dspec.custodyPubKeyB64) {
      throw new CriticalJobError(
        'E_EXECUTION_ERROR',
        'depackage requires custodyPubKeyB64 (sandbox X25519 public key)',
      )
    }

    const jobSpec: JobSpec = {
      jobId: dspec.jobId,
      kind: 'depackage',
      inputBytes: dspec.input.inputBytes,
      sandboxPeerX25519PubB64: dspec.custodyPubKeyB64,
      limits: {
        maxWallClockMs: dspec.limits.maxWallClockMs,
        maxInputBytes: dspec.limits.maxInputBytes,
      },
    }

    const job = await this.provider.runJob(jobSpec)
    const result = depackageJobResultToCriticalResult(job)
    // The provider nukes the ephemeral overlay after every job — truthfully
    // per-action flushable.
    return {
      ...result,
      meta: { executorId: this.id, flushed: 'per-action', durationMs: 0 },
    } as CriticalJobResult<K>
  }
}

/**
 * The ONLY crosvm construction site in the seam (INV-4). Builds a
 * `MicroVMExecutor` backed by the real `CrosvmProvider`. Callers supply rig /
 * deployment paths exactly as the rig tests do.
 */
export function createCrosvmMicroVmExecutor(cfg: CrosvmProviderConfig): MicroVMExecutor {
  return new MicroVMExecutor(new CrosvmProvider(cfg))
}
