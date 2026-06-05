/**
 * Receiving side of the `critical_job_*` family (Build C, spec 0017 §2.3–§2.4).
 *
 * A linked node (sandbox/appliance) receives a `critical_job_request` from a
 * workstation and runs it through its OWN dispatcher against its OWN resolution
 * table and invariants (full local sovereignty / defense in depth). A remote
 * peer can NEVER force an executor choice:
 *
 *   - gate: internal + ACTIVE + same-principal (`assertRecordForServiceRpc`, the
 *     same gate verified SOUND for internal inference in 0016), payload size cap,
 *     and `jobId` replay dedupe;
 *   - admission: a `consumer-local` kind (`decrypt-qbeap`) or a
 *     `custody-holder-local` kind on a node without the custody key is refused
 *     with `E_KEY_LOCALITY` (INV-6) — never executed; a kind the receiver's table
 *     does not permit is refused with `E_REMOTE_KIND_REFUSED`;
 *   - execution: the local dispatcher enforces INV-1/INV-3/INV-7 exactly as for a
 *     local job — there is no degraded path a remote request can open.
 *
 * Refusals return a `critical_job_error` wire (typed code, no plaintext — INV-5).
 * A job that actually ran returns a `critical_job_result` wire carrying the
 * `CriticalJobResult` (including the existing job-result signature for depackage).
 */

import { KIND_METADATA, type CriticalJobErrorCode, type CriticalJobKind } from '../types'
import type { CriticalJobDispatcher } from '../dispatcher'
import type { HandshakeRecord } from '../../handshake/types'
import { assertRecordForServiceRpc } from '../../internalInference/policy'
import {
  CRITICAL_JOB_SCHEMA_VERSION,
  type CriticalJobErrorWire,
  type CriticalJobRequestWire,
  type CriticalJobResultWire,
} from './wire'
import { deserializeCriticalJobSpec, serializeCriticalJobResult } from './serialize'

/** Default receiving-side input ceiling (consistent with the depackage hard cap). */
export const RECEIVER_MAX_INPUT_BYTES = 8 * 1024 * 1024

export interface CriticalJobReceiverDeps {
  /** Resolve the handshake record for the request's `handshake_id`. */
  readonly getRecord: (handshakeId: string) => HandshakeRecord | null | undefined
  /** The receiver's OWN dispatcher (built from its own role/tier/table). */
  readonly dispatcher: CriticalJobDispatcher
  /** Receiving-side input ceiling. Defaults to {@link RECEIVER_MAX_INPUT_BYTES}. */
  readonly maxInputBytes?: number
  /**
   * Whether this node holds the custody key for a `custody-holder-local` kind
   * (`view-attachment`). Build C ships no custody-key plumbing, so the default is
   * `false` → such kinds are refused with `E_KEY_LOCALITY` until that lands.
   */
  readonly custodyHeld?: (input: unknown) => boolean
}

export type CriticalJobReceiveOutcome = CriticalJobResultWire | CriticalJobErrorWire

/** In-memory `jobId` replay guard. Bounded; reset for tests via `_resetReplayForTests`. */
const REPLAY_CAP = 4096
const seenJobIds = new Set<string>()

export function _resetReplayForTests(): void {
  seenJobIds.clear()
}

function markSeen(jobId: string): void {
  if (seenJobIds.size >= REPLAY_CAP) {
    // Drop oldest insertion (Set preserves insertion order).
    const first = seenJobIds.values().next().value
    if (first !== undefined) seenJobIds.delete(first)
  }
  seenJobIds.add(jobId)
}

function errorWire(
  req: CriticalJobRequestWire,
  thisDeviceId: string,
  code: CriticalJobErrorCode,
  message: string,
): CriticalJobErrorWire {
  return {
    type: 'critical_job_error',
    schema_version: CRITICAL_JOB_SCHEMA_VERSION,
    request_id: req.request_id,
    handshake_id: req.handshake_id,
    sender_device_id: thisDeviceId,
    target_device_id: req.sender_device_id,
    created_at: new Date().toISOString(),
    code,
    message,
  }
}

function inputBytesLength(input: unknown): number {
  if (input && typeof input === 'object') {
    const ib = (input as { inputBytes?: unknown }).inputBytes
    if (Buffer.isBuffer(ib)) return ib.length
  }
  return 0
}

/**
 * Handle one inbound `critical_job_request`. Never throws: every failure path
 * returns a typed `critical_job_error` wire. `thisDeviceId` is the local
 * coordination device id (echoed as the response sender).
 */
export async function handleCriticalJobRequest(
  req: CriticalJobRequestWire,
  thisDeviceId: string,
  deps: CriticalJobReceiverDeps,
): Promise<CriticalJobReceiveOutcome> {
  const fail = (code: CriticalJobErrorCode, message: string): CriticalJobErrorWire =>
    errorWire(req, thisDeviceId, code, message)

  // ── Gate: internal + ACTIVE + same-principal (the 0016-sound gate) ──────────
  const record = deps.getRecord(req.handshake_id)
  const gate = assertRecordForServiceRpc(record)
  if (!gate.ok) {
    return fail('E_REMOTE_HANDSHAKE_INACTIVE', `handshake gate failed: ${gate.code}`)
  }

  // ── Expiry ──────────────────────────────────────────────────────────────────
  const expMs = Date.parse(req.expires_at)
  if (Number.isFinite(expMs) && expMs < Date.now()) {
    return fail('E_REMOTE_PROTOCOL', 'request expired')
  }

  // ── Deserialize (re-asserts INV-2 no-key-material on the way in) ─────────────
  let spec
  try {
    spec = deserializeCriticalJobSpec(req.job)
  } catch (e) {
    return fail('E_REMOTE_PROTOCOL', (e as Error)?.message ?? 'malformed spec')
  }

  // ── Replay dedupe (jobId) ────────────────────────────────────────────────────
  if (seenJobIds.has(spec.jobId)) {
    return fail('E_REMOTE_REPLAY', `jobId already seen: ${spec.jobId}`)
  }
  markSeen(spec.jobId)

  // ── Payload size cap — rejected at the gate, never reaches a worker ──────────
  const cap = deps.maxInputBytes ?? RECEIVER_MAX_INPUT_BYTES
  if (inputBytesLength(spec.input) > cap) {
    return fail('E_REMOTE_PAYLOAD_TOO_LARGE', `input exceeds receiver cap (${cap} bytes)`)
  }

  // ── Key-locality admission (INV-6) ───────────────────────────────────────────
  const meta = KIND_METADATA[spec.kind as CriticalJobKind]
  if (!meta) {
    return fail('E_REMOTE_KIND_REFUSED', `unknown kind "${spec.kind}"`)
  }
  if (meta.keyLocality === 'consumer-local') {
    // decrypt-qbeap and any future consumer-local kind: handshake private keys are
    // local to the consumer; running it here would require shipping keys.
    return fail('E_KEY_LOCALITY', `kind "${spec.kind}" is consumer-local; cannot run remotely`)
  }
  if (meta.keyLocality === 'custody-holder-local') {
    const held = deps.custodyHeld?.(spec.input) ?? false
    if (!held) {
      return fail('E_KEY_LOCALITY', `kind "${spec.kind}" requires a custody key this node does not hold`)
    }
  }

  // ── Local table admission: the receiver's OWN table must permit the kind ─────
  if (deps.dispatcher.resolve(spec.kind as CriticalJobKind) === null) {
    return fail('E_REMOTE_KIND_REFUSED', `receiver table does not permit kind "${spec.kind}"`)
  }

  // ── Sovereign re-dispatch (local invariants apply unchanged) ─────────────────
  const result = await deps.dispatcher.dispatch(spec)
  const resultWire: CriticalJobResultWire = {
    type: 'critical_job_result',
    schema_version: CRITICAL_JOB_SCHEMA_VERSION,
    request_id: req.request_id,
    handshake_id: req.handshake_id,
    sender_device_id: thisDeviceId,
    target_device_id: req.sender_device_id,
    created_at: new Date().toISOString(),
    result: serializeCriticalJobResult(result),
  }
  return resultWire
}
