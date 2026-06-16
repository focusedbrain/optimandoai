/**
 * Host-side transport for `ingestion_poll_request` (direct HTTP to sandbox `/beap/ingest`).
 */

import {
  isIngestionPollServiceRpcShape,
  isValidIngestionPollBaseEnvelope,
  type IngestionPollErrorWire,
  type IngestionPollRequestWire,
  type IngestionPollResultWire,
} from './wire'

export interface IngestionPollTransportArgs {
  readonly endpoint: string
  readonly bearer: string | null
  readonly wire: IngestionPollRequestWire
  readonly timeoutMs: number
}

export type IngestionPollTransportResult =
  | { readonly ok: true; readonly body: IngestionPollResultWire | IngestionPollErrorWire }
  | { readonly ok: false; readonly code: string; readonly message: string }

export type IngestionPollTransport = (args: IngestionPollTransportArgs) => Promise<IngestionPollTransportResult>

function parseResponseBody(raw: unknown): IngestionPollResultWire | IngestionPollErrorWire | null {
  if (!isIngestionPollServiceRpcShape(raw) || !isValidIngestionPollBaseEnvelope(raw)) return null
  const t = (raw as { type: string }).type
  if (t === 'ingestion_poll_result' || t === 'ingestion_poll_error') {
    return raw as IngestionPollResultWire | IngestionPollErrorWire
  }
  return null
}

export const httpIngestionPollTransport: IngestionPollTransport = async ({
  endpoint,
  bearer,
  wire,
  timeoutMs,
}) => {
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
      return { ok: false, code: 'E_INGESTION_POLL_PROTOCOL', message: `non-JSON response (status ${res.status})` }
    }
    const body = parseResponseBody(json)
    if (!body) {
      return { ok: false, code: 'E_INGESTION_POLL_PROTOCOL', message: `unparseable response (status ${res.status})` }
    }
    return { ok: true, body }
  } catch (e) {
    const name = (e as Error)?.name
    const msg =
      name === 'AbortError' ? `request timed out after ${timeoutMs}ms` : ((e as Error)?.message ?? String(e))
    return { ok: false, code: 'E_INGESTION_POLL_LINK_DOWN', message: msg }
  } finally {
    clearTimeout(timer)
  }
}
