/**
 * Internal (same-principal) direct-P2P service RPC for Host ↔ Sandbox inference.
 * Not user-visible BEAP inbox; not coordination relay in MVP.
 */

export const INTERNAL_INFERENCE_SCHEMA_VERSION = 1

export type InternalServiceMessageType =
  | 'internal_inference_request'
  | 'internal_inference_result'
  | 'internal_inference_error'

export interface InternalServiceEnvelopeBase {
  type: InternalServiceMessageType
  /** Wire schema version (integer). */
  schema_version: number
  request_id: string
  handshake_id: string
  sender_device_id: string
  target_device_id: string
  transport_policy?: 'direct_only'
  created_at: string
}

export interface InternalInferenceRequestWire extends InternalServiceEnvelopeBase {
  type: 'internal_inference_request'
  stream?: false
  model?: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  options?: {
    temperature?: number
    max_tokens?: number
  }
  /** ISO-8601; request invalid after this instant. */
  expires_at: string
}

export interface InternalInferenceResultWire extends InternalServiceEnvelopeBase {
  type: 'internal_inference_result'
  model: string
  output: string
  usage?: Record<string, unknown>
  duration_ms: number
}

export interface InternalInferenceErrorWire {
  type: 'internal_inference_error'
  schema_version: number
  request_id: string
  handshake_id: string
  sender_device_id: string
  target_device_id: string
  transport_policy?: 'direct_only'
  created_at: string
  code: string
  message: string
  retryable: boolean
  duration_ms: number
}

export type ServiceEnvelope =
  | InternalInferenceRequestWire
  | InternalInferenceResultWire
  | InternalInferenceErrorWire
