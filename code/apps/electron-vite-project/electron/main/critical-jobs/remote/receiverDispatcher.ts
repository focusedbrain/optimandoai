/**
 * Builds the dispatcher a node uses to RE-DISPATCH an inbound remote critical job
 * (Build C, spec 0017 §2.4). It is the node's own local dispatcher: its real
 * role/tier/table and the standard local executors.
 *
 * Deliberately registers NO `remote-handshake` executor: a receiver never
 * re-delegates a remote job onward. If a node whose table routes a kind to
 * `remote-handshake` (e.g. a mis-linked workstation) somehow receives that kind,
 * the unregistered executor yields `E_NO_EXECUTOR` (fail closed) rather than a
 * delegation loop. Local kinds resolve to `in-process` (microVM wiring is added
 * at rig-gated sites, exactly as the live cutover adapters do).
 */

import { CriticalJobDispatcher } from '../dispatcher'
import { DEFAULT_RESOLUTION_TABLE } from '../resolution'
import { buildResolutionContext } from '../context'
import { InProcessExecutor } from '../executors/inProcessExecutor'
import type { ResolutionContext } from '../resolution'

export function buildReceiverDispatcher(ctx: ResolutionContext = buildResolutionContext()): CriticalJobDispatcher {
  return new CriticalJobDispatcher(
    {
      'in-process': new InProcessExecutor(ctx.role),
      // No 'remote-handshake': receivers execute locally or fail closed.
    },
    DEFAULT_RESOLUTION_TABLE,
    ctx,
  )
}
