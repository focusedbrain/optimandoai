/**
 * Live-path adapter for the B1 validation cutover (B.2).
 *
 * This is the ONLY place the live email/ingestion paths talk to the seam. Each
 * call builds a dispatcher from the current `ResolutionContext` (so role/tier
 * env changes are honored) and routes a single validation job through it. The
 * InProcessExecutor reaches the SAME host-side validators the inline calls use
 * (`validatorOrchestrator.validate` for decrypted BEAP, the pure `validateCapsule`
 * for native BEAP), so flag-on parity is byte-identical by construction.
 *
 * Only the two validate kinds are wired here. The qBEAP/pBEAP decrypt blocks and
 * all MIME/raw-mail depackaging are out of B1 scope (decrypt-qbeap / B2).
 *
 * `dispatch*` NEVER throws: a dispatcher/executor failure surfaces as
 * `{ ok: false, code }` so the caller can fail closed (quarantine / retry) — it
 * never silently inserts unvalidated content.
 */

import { randomUUID } from 'crypto'
import type {
  ValidateRequest,
  ValidateResponse,
  ValidationResult,
  CandidateCapsuleEnvelope,
} from '@repo/ingestion-core'
import { CriticalJobDispatcher } from './dispatcher'
import { DEFAULT_RESOLUTION_TABLE } from './resolution'
import { buildResolutionContext } from './context'
import { InProcessExecutor } from './executors/inProcessExecutor'
import { RemoteHandshakeExecutor } from './executors/remoteHandshakeExecutor'
import type { CriticalJobErrorCode } from './types'

/**
 * Generous wall-clock ceiling. The inline calls have no timeout; the validator
 * subprocess answers quickly once ready, but cold readiness can take a moment,
 * so the ceiling is set high enough not to fail valid content (which would break
 * parity). It only guards against a truly hung executor.
 */
const VALIDATION_WALL_CLOCK_MS = 60_000

export type ValidationDispatchOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: CriticalJobErrorCode; readonly message: string }

function buildDispatcher(): CriticalJobDispatcher {
  const ctx = buildResolutionContext()
  // Only in-process + the remote stub are relevant to the validate kinds; the
  // microVM executor is never resolved for them in B1.
  return new CriticalJobDispatcher(
    {
      'in-process': new InProcessExecutor(ctx.role),
      'remote-handshake': new RemoteHandshakeExecutor(),
    },
    DEFAULT_RESOLUTION_TABLE,
    ctx,
  )
}

/**
 * Route a decrypted-BEAP-content validation through the seam. `ok:true` means the
 * job executed (the returned `ValidateResponse` still carries the validator's
 * accept/reject in `outcome.ok`); `ok:false` means the dispatch itself failed.
 */
export async function dispatchValidateDecryptedBeap(
  input: Omit<ValidateRequest, 'request_id'>,
): Promise<ValidationDispatchOutcome<ValidateResponse>> {
  const result = await buildDispatcher().dispatch({
    jobId: randomUUID(),
    kind: 'validate-decrypted-beap',
    input,
    limits: { maxWallClockMs: VALIDATION_WALL_CLOCK_MS },
    flush: 'session',
  })
  if (result.ok && result.output) return { ok: true, value: result.output }
  return {
    ok: false,
    code: result.error?.code ?? 'E_EXECUTION_ERROR',
    message: result.error?.message ?? 'validate-decrypted-beap dispatch failed',
  }
}

/** Route a native-BEAP structural validation through the seam. */
export async function dispatchValidateNativeBeap(
  candidate: CandidateCapsuleEnvelope,
): Promise<ValidationDispatchOutcome<ValidationResult>> {
  const result = await buildDispatcher().dispatch({
    jobId: randomUUID(),
    kind: 'validate-native-beap',
    input: { candidate },
    limits: { maxWallClockMs: VALIDATION_WALL_CLOCK_MS },
    flush: 'session',
  })
  if (result.ok && result.output) return { ok: true, value: result.output }
  return {
    ok: false,
    code: result.error?.code ?? 'E_EXECUTION_ERROR',
    message: result.error?.message ?? 'validate-native-beap dispatch failed',
  }
}
