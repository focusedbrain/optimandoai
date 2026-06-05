/**
 * Live-path adapter for the B2 email-depackage cutover (build spec 0007, Phase 3).
 *
 * This is the ONLY place the live email path talks to the seam for depackaging.
 * It builds a dispatcher from the current `ResolutionContext` (role/tier env
 * honored) and routes ONE `depackage-email` job through it. The orchestrator
 * hands in only opaque `inputBytes` (raw RFC822 or provider-structured-json) +
 * the public custody key (INV-2: a PUBLIC X25519 key only); it never parses the
 * bytes itself.
 *
 * INV-7 / INV-3: `dispatchDepackageEmail` NEVER throws and NEVER inline-parses.
 *   - dispatch-level failure  → { ok: false, code }            (quarantine)
 *   - worker typed failure    → { ok: true, result: {ok:false} } (quarantine)
 *   - worker success union    → { ok: true, result: plain|carrier|mixed }
 * The consumer maps every non-success to a quarantine reason; there is no
 * best-effort fallback while the flag is on.
 */

import { randomUUID } from 'crypto'
import { CriticalJobDispatcher } from './dispatcher'
import { DEFAULT_RESOLUTION_TABLE } from './resolution'
import { buildResolutionContext } from './context'
import { InProcessExecutor } from './executors/inProcessExecutor'
import { RemoteHandshakeExecutor } from './executors/remoteHandshakeExecutor'
import type { CriticalJobErrorCode } from './types'
import type { DepackageEmailResult } from '../depackaging-microvm/emailDepackage'

/**
 * Wall-clock ceiling for a single email depackage. Generous so it never fails
 * valid mail (which would break parity); it only guards a truly hung executor.
 */
const DEPACKAGE_WALL_CLOCK_MS = 60_000

/** Defense-in-depth input ceiling handed to the guest (guest also re-checks). */
const DEPACKAGE_MAX_INPUT_BYTES = 8 * 1024 * 1024

export type DepackageDispatchOutcome =
  | { readonly ok: true; readonly result: DepackageEmailResult }
  | { readonly ok: false; readonly code: CriticalJobErrorCode; readonly message: string }

function buildDispatcher(): CriticalJobDispatcher {
  const ctx = buildResolutionContext()
  // in-process (sandbox/appliance) + the remote stub. The microVM executor for
  // depackage-email is wired at the rig-gated cutover site with real provider
  // config; absent here, paid/appliance microVM routing fails closed (INV-7).
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
 * Route a single email payload through `dispatch({kind:'depackage-email'})`.
 *
 * @param inputBytes   the opaque provider payload (orchestrator never parses it)
 * @param custodyPubKeyB64 the paired sandbox PUBLIC X25519 key (sealing target)
 * @param maxInputBytes optional spec ceiling (wins over the guest default, C4)
 */
export async function dispatchDepackageEmail(
  inputBytes: Buffer,
  custodyPubKeyB64: string,
  maxInputBytes: number = DEPACKAGE_MAX_INPUT_BYTES,
): Promise<DepackageDispatchOutcome> {
  const result = await buildDispatcher().dispatch({
    jobId: randomUUID(),
    kind: 'depackage-email',
    input: { inputBytes, maxInputBytes },
    custodyPubKeyB64,
    limits: { maxWallClockMs: DEPACKAGE_WALL_CLOCK_MS, maxInputBytes },
    flush: 'per-action',
  })
  if (result.ok && result.output) return { ok: true, result: result.output }
  return {
    ok: false,
    code: result.error?.code ?? 'E_EXECUTION_ERROR',
    message: result.error?.message ?? 'depackage-email dispatch failed',
  }
}
