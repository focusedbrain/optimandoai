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
  DepackageEmailJobResult,
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
    // The two email-pipeline depackage workers run in the microVM: `depackage`
    // (B1, bare SafeText) and `depackage-email` (B2, the typed plain|carrier|mixed
    // union). `decrypt-qbeap` is the other genuinely microVM-capable kind (its
    // INV-6 venue is a LOCAL per-action microVM with per-job key provisioning) but
    // is RESERVED and unimplemented in B1, so it is not advertised here.
    return kind === 'depackage' || kind === 'depackage-email'
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
    if (spec.kind === 'depackage-email') {
      return this.runDepackageEmail(spec as CriticalJobSpec<'depackage-email'>) as Promise<
        CriticalJobResult<K>
      >
    }
    if (spec.kind !== 'depackage') {
      throw new CriticalJobError(
        'E_UNSUPPORTED_KIND',
        `MicroVMExecutor supports only "depackage"/"depackage-email" in this build, not "${spec.kind}"`,
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

    const job = (await this.provider.runJob(jobSpec)) as JobResult
    const result = depackageJobResultToCriticalResult(job)
    // The provider nukes the ephemeral overlay after every job — truthfully
    // per-action flushable.
    return {
      ...result,
      meta: { executorId: this.id, flushed: 'per-action', durationMs: 0 },
    } as CriticalJobResult<K>
  }

  private async runDepackageEmail(
    spec: CriticalJobSpec<'depackage-email'>,
  ): Promise<CriticalJobResult<'depackage-email'>> {
    if (!spec.custodyPubKeyB64) {
      throw new CriticalJobError(
        'E_EXECUTION_ERROR',
        'depackage-email requires custodyPubKeyB64 (sandbox X25519 public key)',
      )
    }
    const jobSpec: JobSpec = {
      jobId: spec.jobId,
      kind: 'depackage-email',
      inputBytes: spec.input.inputBytes,
      sandboxPeerX25519PubB64: spec.custodyPubKeyB64,
      inputForm: spec.input.inputForm,
      provider: spec.input.provider,
      limits: {
        maxWallClockMs: spec.limits.maxWallClockMs,
        maxInputBytes: spec.input.maxInputBytes ?? spec.limits.maxInputBytes,
      },
    }

    const job = (await this.provider.runJob(jobSpec)) as DepackageEmailJobResult
    const meta = { executorId: this.id, flushed: 'per-action' as const, durationMs: 0 }
    // A transport-level failure (non-JSON / bad signature / provider throw) is a
    // dispatch error → fail closed. A worker VERDICT failure (`result.ok===false`,
    // validly signed) is a legitimate quarantine output; pass it through with the
    // signature so the dispatcher centrally verifies + the consumer quarantines.
    if (job.error) {
      return {
        jobId: spec.jobId,
        ok: false,
        error: { code: 'E_EXECUTION_ERROR', message: job.error },
        meta,
      }
    }
    return {
      jobId: spec.jobId,
      ok: true,
      output: job.result,
      result_signing_pub_b64: job.result_signing_pub_b64,
      result_signature_b64: job.result_signature_b64,
      meta,
    }
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
