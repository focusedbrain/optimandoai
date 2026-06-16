/**
 * Host→sandbox ingestion poll trigger — control-plane service messages (PROMPT 2).
 *
 * Direction: host POSTs `ingestion_poll_request` to the sandbox `/beap/ingest`;
 * sandbox runs ONE `runSandboxIngestionPoll` and returns `ingestion_poll_result`
 * (counts only, INV-5) as the synchronous HTTP 200 body. Mail bytes return via the
 * existing `sandbox_email_delivery` path — not in this envelope.
 *
 * Never coordination-relay whitelisted (direct HTTP only, mirror `critical_job_*`).
 */

export const INGESTION_POLL_SCHEMA_VERSION = 1

export type IngestionPollServiceMessageType =
  | 'ingestion_poll_request'
  | 'ingestion_poll_result'
  | 'ingestion_poll_error'

export interface IngestionPollServiceEnvelopeBase {
  type: IngestionPollServiceMessageType
  schema_version: number
  request_id: string
  handshake_id: string
  sender_device_id: string
  target_device_id: string
  created_at: string
}

export interface IngestionPollRequestWire extends IngestionPollServiceEnvelopeBase {
  type: 'ingestion_poll_request'
  account_id: string
  pull_more?: boolean
  expires_at: string
}

/** Metadata-only poll outcome (INV-5 — no message content). */
export interface IngestionPollResultWire extends IngestionPollServiceEnvelopeBase {
  type: 'ingestion_poll_result'
  account_id: string
  poll_status: string
  fetched: number
  depackaged: number
  delivered: number
  held: number
}

export interface IngestionPollErrorWire extends IngestionPollServiceEnvelopeBase {
  type: 'ingestion_poll_error'
  code: string
  message: string
}

export type IngestionPollServiceEnvelope =
  | IngestionPollRequestWire
  | IngestionPollResultWire
  | IngestionPollErrorWire

export function isIngestionPollServiceType(t: unknown): t is IngestionPollServiceMessageType {
  return t === 'ingestion_poll_request' || t === 'ingestion_poll_result' || t === 'ingestion_poll_error'
}

export function isIngestionPollServiceRpcShape(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  return isIngestionPollServiceType((parsed as Record<string, unknown>).type)
}

export function isValidIngestionPollBaseEnvelope(parsed: unknown): parsed is IngestionPollServiceEnvelopeBase {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const o = parsed as Record<string, unknown>
  return (
    isIngestionPollServiceType(o.type) &&
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
