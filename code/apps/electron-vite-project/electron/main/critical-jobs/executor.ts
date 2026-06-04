/**
 * CriticalJobExecutor — the pluggable backend interface for the routing seam
 * (Build A, Deliverable 1).
 *
 * Three implementations exist (or are stubbed): InProcessExecutor,
 * MicroVMExecutor, and RemoteHandshakeExecutor. The dispatcher resolves a job to
 * an executor id by pure configuration, then calls this interface only. No seam
 * code references a concrete hypervisor (INV-4) — that lives behind
 * `SandboxHypervisorProvider` inside `MicroVMExecutor`.
 */

import type { CriticalJobKind, CriticalJobResult, CriticalJobSpec, ExecutorId } from './types'

export interface CriticalJobExecutor {
  /** Stable id for resolution + metadata logging. */
  readonly id: ExecutorId
  /** True if this executor can run the given kind in this build. */
  supports(kind: CriticalJobKind): boolean
  /**
   * True if this executor can run right now (platform/binaries/links present).
   * MUST NOT throw — translate any probe failure to `false`.
   */
  isAvailable(): Promise<boolean>
  /**
   * Run a single job. May throw `CriticalJobError` (e.g. `E_ROLE_FORBIDDEN`);
   * the dispatcher catches and converts thrown errors into `ok:false` results.
   */
  run<K extends CriticalJobKind>(spec: CriticalJobSpec<K>): Promise<CriticalJobResult<K>>
}
