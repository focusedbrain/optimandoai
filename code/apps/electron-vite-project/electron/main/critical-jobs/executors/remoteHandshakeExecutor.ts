/**
 * RemoteHandshakeExecutor — typed STUB (Build A).
 *
 * The real implementation (routing a `CriticalJobSpec` over the internal
 * handshake to a linked sandbox/appliance that re-dispatches locally, modeled on
 * the existing `internal_inference_request/result` plumbing) ships in Build C.
 *
 * For now it exists so the resolution table can already declare remote rows
 * (e.g. every workstation row) and so the table validator can prove structurally
 * that workstation never resolves to in-process. `isAvailable()` returns false,
 * so any job that resolves here with no declared fallback fails closed with
 * `E_NO_EXECUTOR` (INV-3) — never a silent degrade to in-process.
 */

import type { CriticalJobExecutor } from '../executor'
import {
  CriticalJobError,
  type CriticalJobKind,
  type CriticalJobResult,
  type CriticalJobSpec,
} from '../types'

export class RemoteHandshakeExecutor implements CriticalJobExecutor {
  readonly id = 'remote-handshake' as const

  /**
   * Declares intent to carry every kind EXCEPT the key-requiring `decrypt-qbeap`:
   * INV-6 (key-locality) forbids routing a key-requiring job to any node, so the
   * remote executor must never advertise support for it. Actual routing of the
   * other kinds is Build C.
   */
  supports(kind: CriticalJobKind): boolean {
    return kind !== 'decrypt-qbeap'
  }

  /** Not implemented in this build — always unavailable. */
  isAvailable(): Promise<boolean> {
    return Promise.resolve(false)
  }

  run<K extends CriticalJobKind>(_spec: CriticalJobSpec<K>): Promise<CriticalJobResult<K>> {
    throw new CriticalJobError(
      'E_EXECUTOR_UNAVAILABLE',
      'RemoteHandshakeExecutor is not implemented in this build (Build C)',
    )
  }
}
