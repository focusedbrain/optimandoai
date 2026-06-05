/**
 * `critical_job_*` service-message family — wire types + discriminator + guards
 * (Build C, spec 0017 §2.1). Modeled verbatim on the `internal_inference_*`
 * family (`internalInference/types.ts` + `p2pServiceDispatch.ts`), whose host
 * request/result/error plumbing was verified SOUND in report 0016.
 *
 * Three message types, one new discriminator. Like internal inference, these are
 * a DIRECT service RPC over the per-handshake `/beap/ingest` endpoint (Bearer =
 * `counterparty_p2p_token`) — they are NEVER coordination-relay whitelisted (the
 * relay carries handshake signaling only; job bytes go direct). See
 * `remote/relayExclusion.test.ts` for the standing assertion.
 *
 * Transport model (Build C): synchronous request/response. The sender POSTs a
 * `critical_job_request`; the receiver runs the job through its OWN dispatcher and
 * returns a `critical_job_result` or `critical_job_error` as the HTTP 200 body.
 * `request_id` correlation is carried on the envelope for traceability and to
 * keep the door open for a future async / WebRTC-DC delivery (deviation noted in
 * 0018: internal inference delivers the result via a reverse POST; Build C uses a
 * single bounded round-trip to keep the off-rig proofs deterministic).
 */

import type { CriticalJobErrorCode, CriticalJobKind } from '../types'

/** Integer wire schema version for the critical-job service family. */
export const CRITICAL_JOB_SCHEMA_VERSION = 1

export type CriticalJobServiceMessageType =
  | 'critical_job_request'
  | 'critical_job_result'
  | 'critical_job_error'

/** Common envelope fields (mirror of `InternalServiceEnvelopeBase`). */
export interface CriticalJobServiceEnvelopeBase {
  type: CriticalJobServiceMessageType
  schema_version: number
  request_id: string
  handshake_id: string
  sender_device_id: string
  target_device_id: string
  created_at: string
}

/**
 * Serialized `CriticalJobSpec`. Buffers (e.g. `input.inputBytes`) are encoded by
 * the Buffer-aware codec (`serialize.ts`) so the structure survives JSON. The
 * spec structurally cannot carry key material (INV-2); a wire-level assertion in
 * `serialize.ts` enforces it again before send and again at the gate on receipt.
 */
export interface SerializedCriticalJobSpec {
  readonly jobId: string
  readonly kind: CriticalJobKind
  /** Buffer-aware-encoded `JobInputMap[kind]`. */
  readonly input: unknown
  readonly custodyPubKeyB64?: string
  readonly limits: { readonly maxWallClockMs: number; readonly maxInputBytes?: number }
  readonly flush: 'per-action' | 'per-vm' | 'session'
}

/** Buffer-aware-encoded `CriticalJobResult`. */
export type SerializedCriticalJobResult = unknown

export interface CriticalJobRequestWire extends CriticalJobServiceEnvelopeBase {
  type: 'critical_job_request'
  /** The serialized `CriticalJobSpec` (INV-2: no key material). */
  job: SerializedCriticalJobSpec
  /** ISO-8601; request invalid after this instant. */
  expires_at: string
}

export interface CriticalJobResultWire extends CriticalJobServiceEnvelopeBase {
  type: 'critical_job_result'
  /** The serialized `CriticalJobResult` (carries the existing job-result signature). */
  result: SerializedCriticalJobResult
}

export interface CriticalJobErrorWire extends CriticalJobServiceEnvelopeBase {
  type: 'critical_job_error'
  /** Stable code only — never plaintext/decrypted content (INV-5). */
  code: CriticalJobErrorCode
  message: string
}

export type CriticalJobServiceEnvelope =
  | CriticalJobRequestWire
  | CriticalJobResultWire
  | CriticalJobErrorWire

export function isCriticalJobServiceType(t: unknown): t is CriticalJobServiceMessageType {
  return t === 'critical_job_request' || t === 'critical_job_result' || t === 'critical_job_error'
}

/**
 * Pre-ingest shape probe (mirror of `isInternalServiceRpcShape`). Cheap, total,
 * never throws — used by the ingest server to branch a POST body to the
 * critical-job dispatch.
 */
export function isCriticalJobServiceRpcShape(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  return isCriticalJobServiceType((parsed as Record<string, unknown>).type)
}

/** Validate the common envelope fields (mirror of `isValidInternalServiceBaseEnvelope`). */
export function isValidCriticalJobBaseEnvelope(parsed: unknown): parsed is CriticalJobServiceEnvelopeBase {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const o = parsed as Record<string, unknown>
  return (
    isCriticalJobServiceType(o.type) &&
    typeof o.schema_version === 'number' &&
    Number.isFinite(o.schema_version) &&
    typeof o.request_id === 'string' &&
    o.request_id.trim().length > 0 &&
    typeof o.handshake_id === 'string' &&
    o.handshake_id.trim().length > 0 &&
    typeof o.sender_device_id === 'string' &&
    typeof o.target_device_id === 'string' &&
    typeof o.created_at === 'string'
  )
}
