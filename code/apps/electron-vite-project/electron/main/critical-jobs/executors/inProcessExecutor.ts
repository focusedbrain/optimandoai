/**
 * InProcessExecutor — runs a critical job's pure logic directly in the current
 * orchestrator process (Build A, Deliverable 2).
 *
 * INV-1 (the in-process rule): in-process execution is permitted ONLY when the
 * process runs inside an isolation boundary — role `sandbox` (the sandbox VM or
 * bare-metal sandbox hardware) or `appliance` (dedicated appliance hardware). It
 * is NEVER permitted under role `workstation`. This executor enforces that
 * itself (throws `E_ROLE_FORBIDDEN`), independent of the resolution table, as
 * defense in depth against a misconfigured table.
 *
 * This is NOT the "no in-process fallback" that `crosvmProvider.ts` forbids:
 * that rule says the *provider* never silently degrades to parsing untrusted
 * bytes. InProcessExecutor is a separate, deliberately chosen executor selected
 * by configuration — not a fallback hidden inside the provider.
 *
 * Wrapped logic (existing, unchanged functions):
 *   - depackage               → the pure `runDepackagingJob` worker (signs result).
 *   - validate-decrypted-beap → the existing `validatorOrchestrator` subprocess
 *                               (host-side fork; today's proven path — not inlined).
 *   - validate-native-beap    → the pure `validateCapsule`.
 *   - open-link / view-attachment → unsupported in this build.
 *   - decrypt-qbeap           → RESERVED, unimplemented (Amendment 1): a
 *                               key-requiring native-BEAP-pipeline job; supports()
 *                               is false until the INV-6 local-microVM build.
 */

import { runDepackagingJob } from '../../depackaging-microvm/depackagingWorker'
import { validateCapsule } from '@repo/ingestion-core'
import { depackageJobResultToCriticalResult } from '../verify'
import type { CriticalJobExecutor } from '../executor'
import {
  CriticalJobError,
  TRANSITIONAL_INPROCESS_KINDS,
  type CriticalJobKind,
  type CriticalJobResult,
  type CriticalJobSpec,
  type Role,
} from '../types'

const SUPPORTED: ReadonlySet<CriticalJobKind> = new Set<CriticalJobKind>([
  'depackage',
  'validate-decrypted-beap',
  'validate-native-beap',
  // 'decrypt-qbeap' is intentionally absent — RESERVED/unimplemented (Amendment 1).
])

export class InProcessExecutor implements CriticalJobExecutor {
  readonly id = 'in-process' as const

  constructor(private readonly role: Role) {}

  supports(kind: CriticalJobKind): boolean {
    return SUPPORTED.has(kind)
  }

  /** The current process is always "available"; readiness of wrapped services
   *  (e.g. the validator subprocess) surfaces per-call as E_EXECUTION_ERROR. */
  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }

  async run<K extends CriticalJobKind>(spec: CriticalJobSpec<K>): Promise<CriticalJobResult<K>> {
    // INV-1 (refined, Q5): in-process on the workstation is ABSOLUTELY forbidden
    // for untrusted-content kinds, and permitted ONLY for the transitional
    // validate kinds — the host-side validators (forked subprocess / pure
    // validateCapsule) that already run on the workstation today. This mirrors
    // the transitional rule the table validator enforces, so a workstation
    // single-box can run the B1 validation cutover without overstating isolation.
    if (this.role === 'workstation' && !TRANSITIONAL_INPROCESS_KINDS.has(spec.kind)) {
      throw new CriticalJobError(
        'E_ROLE_FORBIDDEN',
        `in-process execution of kind "${spec.kind}" is forbidden on role=workstation (INV-1)`,
      )
    }

    switch (spec.kind) {
      case 'depackage':
        return this.runDepackage(spec as CriticalJobSpec<'depackage'>) as Promise<
          CriticalJobResult<K>
        >
      case 'validate-decrypted-beap':
        return this.runValidateDecryptedBeap(
          spec as CriticalJobSpec<'validate-decrypted-beap'>,
        ) as Promise<CriticalJobResult<K>>
      case 'validate-native-beap':
        return this.runValidateNativeBeap(
          spec as CriticalJobSpec<'validate-native-beap'>,
        ) as Promise<CriticalJobResult<K>>
      default:
        throw new CriticalJobError(
          'E_UNSUPPORTED_KIND',
          `InProcessExecutor does not support kind "${spec.kind}"`,
        )
    }
  }

  private async runDepackage(
    spec: CriticalJobSpec<'depackage'>,
  ): Promise<CriticalJobResult<'depackage'>> {
    if (!spec.custodyPubKeyB64) {
      throw new CriticalJobError(
        'E_EXECUTION_ERROR',
        'depackage requires custodyPubKeyB64 (sandbox X25519 public key)',
      )
    }
    const job = runDepackagingJob({
      jobId: spec.jobId,
      kind: 'depackage',
      inputBytes: spec.input.inputBytes,
      sandboxPeerX25519PubB64: spec.custodyPubKeyB64,
      limits: { maxWallClockMs: spec.limits.maxWallClockMs, maxInputBytes: spec.limits.maxInputBytes },
    })
    const result = depackageJobResultToCriticalResult(job)
    // Flush story: an in-process job shares the (resettable) VM/hardware boundary
    // it runs inside; it is not independently per-action flushable.
    return { ...result, meta: { executorId: this.id, flushed: 'none', durationMs: 0 } }
  }

  private async runValidateDecryptedBeap(
    spec: CriticalJobSpec<'validate-decrypted-beap'>,
  ): Promise<CriticalJobResult<'validate-decrypted-beap'>> {
    // Dynamic import so the depackage path does not pull the vault/validator
    // dependency graph at module load. This wraps the existing host-side
    // subprocess fork (INV-2: the seal key stays in that local subprocess).
    const { validatorOrchestrator } = await import('../../validator-process/orchestrator')
    try {
      const response = await validatorOrchestrator.validate(spec.input)
      return {
        jobId: spec.jobId,
        ok: true,
        output: response,
        meta: { executorId: this.id, flushed: 'none', durationMs: 0 },
      }
    } catch (err) {
      return {
        jobId: spec.jobId,
        ok: false,
        error: {
          code: 'E_EXECUTION_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
        meta: { executorId: this.id, flushed: 'none', durationMs: 0 },
      }
    }
  }

  private async runValidateNativeBeap(
    spec: CriticalJobSpec<'validate-native-beap'>,
  ): Promise<CriticalJobResult<'validate-native-beap'>> {
    const result = validateCapsule(spec.input.candidate)
    return {
      jobId: spec.jobId,
      ok: true,
      output: result,
      meta: { executorId: this.id, flushed: 'none', durationMs: 0 },
    }
  }
}
