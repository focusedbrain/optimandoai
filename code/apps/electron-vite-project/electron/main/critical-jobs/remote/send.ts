/**
 * Sender-side transport for the `critical_job_*` family (Build C, spec 0017 §3.2).
 *
 * Direct HTTP POST to the linked node's per-handshake `/beap/ingest` endpoint with
 * `Authorization: Bearer <counterparty_p2p_token>` and `X-BEAP-Handshake` — the
 * same direct channel internal inference uses; NEVER coordination relay. Build C
 * delivers synchronously: the `critical_job_result` / `critical_job_error` wire is
 * the HTTP response body. The request times out at `timeoutMs` (kept subordinate
 * to the dispatcher's `maxWallClockMs` by the executor) so a hung peer fails
 * closed within the wall clock.
 *
 * NOTE (deviation recorded in 0018): internal inference also supports a WebRTC
 * data-channel carriage and delivers results via a reverse POST. Build C uses a
 * single bounded HTTP round-trip to keep the off-rig proofs deterministic and
 * avoid a hand-rolled DC harness (spec §5.2); request_id correlation is on the
 * envelope so a future async/DC delivery can be added without a wire change.
 */

import { CriticalJobError, type CriticalJobErrorCode } from '../types'
import {
  isCriticalJobServiceRpcShape,
  isValidCriticalJobBaseEnvelope,
  type CriticalJobErrorWire,
  type CriticalJobRequestWire,
  type CriticalJobResultWire,
  type CriticalJobServiceEnvelope,
} from './wire'

export interface CriticalJobTransportArgs {
  readonly endpoint: string
  readonly bearer: string | null
  readonly wire: CriticalJobRequestWire
  readonly timeoutMs: number
}

export type CriticalJobTransportResult =
  | { readonly ok: true; readonly body: CriticalJobResultWire | CriticalJobErrorWire }
  | { readonly ok: false; readonly code: CriticalJobErrorCode; readonly message: string }

/** A pluggable transport (mocked in unit/round-trip tests; HTTP in production). */
export type CriticalJobTransport = (args: CriticalJobTransportArgs) => Promise<CriticalJobTransportResult>

function parseResponseBody(raw: unknown): CriticalJobResultWire | CriticalJobErrorWire | null {
  if (!isCriticalJobServiceRpcShape(raw) || !isValidCriticalJobBaseEnvelope(raw)) return null
  const t = (raw as { type: string }).type
  if (t === 'critical_job_result' || t === 'critical_job_error') {
    return raw as CriticalJobResultWire | CriticalJobErrorWire
  }
  return null
}

/** Production HTTP transport. */
export const httpCriticalJobTransport: CriticalJobTransport = async ({ endpoint, bearer, wire, timeoutMs }) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        'X-BEAP-Handshake': wire.handshake_id,
      },
      body: JSON.stringify(wire),
      signal: controller.signal,
    })
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      return { ok: false, code: 'E_REMOTE_PROTOCOL', message: `non-JSON response (status ${res.status})` }
    }
    const body = parseResponseBody(json)
    if (!body) {
      return { ok: false, code: 'E_REMOTE_PROTOCOL', message: `unparseable response (status ${res.status})` }
    }
    return { ok: true, body }
  } catch (e) {
    const name = (e as Error)?.name
    const msg = name === 'AbortError' ? `request timed out after ${timeoutMs}ms` : ((e as Error)?.message ?? String(e))
    return { ok: false, code: 'E_REMOTE_LINK_DOWN', message: msg }
  } finally {
    clearTimeout(timer)
  }
}

/** Throw a typed `CriticalJobError` for a non-OK transport result (helper for the executor). */
export function throwTransportError(r: Extract<CriticalJobTransportResult, { ok: false }>): never {
  throw new CriticalJobError(r.code, r.message)
}

export type { CriticalJobServiceEnvelope }
