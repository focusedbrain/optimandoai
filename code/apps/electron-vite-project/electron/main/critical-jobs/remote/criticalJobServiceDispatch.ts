/**
 * Inbound ingest dispatch for the `critical_job_*` family (Build C, spec 0017
 * §2.1 "ingest routing"). Mirror of `internalInference/p2pServiceDispatch.ts`.
 *
 * Wired from the shared ingest server (`p2p/p2pServer.ts`) AFTER the per-handshake
 * Bearer auth, alongside the internal-inference probe. Returns `true` once it has
 * owned the response (so ingest never falls through to the inbox for these
 * shapes), `false` if the body is not a critical-job service message.
 *
 * Build C delivers the result synchronously: a `critical_job_request` is run
 * through the receiver and the `critical_job_result` / `critical_job_error` wire
 * is written as the HTTP 200 body. Inbound `critical_job_result` / `_error` POSTs
 * are not part of the synchronous model and are rejected (400) — the door is left
 * open for a future async / WebRTC-DC delivery.
 */

import type * as http from 'http'
import { getHandshakeRecord } from '../../handshake/db'
import {
  CRITICAL_JOB_SCHEMA_VERSION,
  isValidCriticalJobBaseEnvelope,
  type CriticalJobRequestWire,
} from './wire'
import { handleCriticalJobRequest, type CriticalJobReceiverDeps } from './receiver'
import { buildReceiverDispatcher } from './receiverDispatcher'

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Factory for the receiver deps. Overridable for tests; production builds a
 * dispatcher from the node's own resolution context.
 */
export type CriticalJobReceiverDepsFactory = (db: unknown, handshakeId: string) => CriticalJobReceiverDeps

const defaultDepsFactory: CriticalJobReceiverDepsFactory = (db, _handshakeId) => ({
  getRecord: (hid: string) => getHandshakeRecord(db as never, hid),
  dispatcher: buildReceiverDispatcher(),
})

let depsFactory: CriticalJobReceiverDepsFactory = defaultDepsFactory

/** Test seam: override how receiver deps are built. */
export function _setCriticalJobReceiverDepsFactoryForTests(f: CriticalJobReceiverDepsFactory | null): void {
  depsFactory = f ?? defaultDepsFactory
}

export async function tryHandleCriticalJobServiceP2P(
  db: unknown,
  parsed: unknown,
  res: http.ServerResponse,
): Promise<boolean> {
  if (!isValidCriticalJobBaseEnvelope(parsed)) {
    // Shape probe said it looked like a critical-job message but the envelope is
    // invalid — own the response (fail closed) rather than leaking to the inbox.
    if (parsed && typeof parsed === 'object' && 'type' in (parsed as object)) {
      const t = (parsed as { type?: unknown }).type
      if (t === 'critical_job_request' || t === 'critical_job_result' || t === 'critical_job_error') {
        writeJson(res, 400, { type: 'critical_job_error', code: 'E_REMOTE_PROTOCOL', message: 'invalid envelope' })
        return true
      }
    }
    return false
  }

  if (parsed.schema_version !== CRITICAL_JOB_SCHEMA_VERSION) {
    writeJson(res, 400, {
      type: 'critical_job_error',
      code: 'E_REMOTE_PROTOCOL',
      message: `unsupported schema_version ${parsed.schema_version}`,
    })
    return true
  }

  if (parsed.type === 'critical_job_request') {
    const req = parsed as CriticalJobRequestWire
    const deps = depsFactory(db, req.handshake_id)
    // `target_device_id` is this node's coordination id (the workstation addressed
    // it); echo it as the response sender.
    const outcome = await handleCriticalJobRequest(req, req.target_device_id, deps)
    writeJson(res, 200, outcome)
    return true
  }

  // critical_job_result / critical_job_error inbound: not used in the synchronous
  // Build C model (they are response bodies, parsed by the sender directly).
  writeJson(res, 400, {
    type: 'critical_job_error',
    code: 'E_REMOTE_PROTOCOL',
    message: `inbound ${parsed.type} not supported (synchronous response-body model)`,
  })
  return true
}
