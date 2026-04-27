/**
 * Internal (same-principal) direct-P2P service RPC for Host ↔ Sandbox inference.
 * Not user-visible BEAP inbox; not coordination relay in MVP.
 */

export const INTERNAL_INFERENCE_SCHEMA_VERSION = 1

export type InternalServiceMessageType =
  | 'internal_inference_request'
  | 'internal_inference_result'
  | 'internal_inference_error'
  /** Sandbox → Host: cancel a pending `internal_inference_request` on Host (rejects local pending on Sandbox). */
  | 'internal_inference_cancel'
  /** Sandbox → Host direct P2P POST; response body is `InternalInferenceCapabilitiesResultWire` (no second POST). */
  | 'internal_inference_capabilities_request'

/** Ingest JSON body only — not used as a separate POST to /beap/ingest in MVP (carried in HTTP response). */
export type InternalInferenceCapabilitiesResultType = 'internal_inference_capabilities_result'

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

export interface InternalInferenceCapabilitiesRequestWire extends InternalServiceEnvelopeBase {
  type: 'internal_inference_capabilities_request'
}

export interface InternalInferenceCapabilitiesModelEntry {
  provider: 'ollama'
  model: string
  label: string
  enabled: boolean
  /** Populated when rows come from Host `/api/tags` (not reconstructed sandbox-side state). */
  source?: 'host_ollama'
}

/** Current Host local Ollama selection (drives Sandbox “Host” label; not hardcoded in Sandbox). */
export interface ActiveLocalLlmWire {
  provider: 'ollama'
  model: string
  label: string
  enabled: boolean
}

/** Returned in the HTTP 200 body of `internal_inference_capabilities_request` (same connection; not inbox / not BEAP message). */
export interface InternalInferenceCapabilitiesResultWire {
  type: InternalInferenceCapabilitiesResultType
  schema_version: number
  request_id: string
  handshake_id: string
  sender_device_id: string
  target_device_id: string
  created_at: string
  transport_policy?: 'direct_only'
  host_computer_name: string
  /** Six decimal digits when known (e.g. "123456"). */
  host_pairing_code: string
  models: InternalInferenceCapabilitiesModelEntry[]
  policy_enabled: boolean
  /** Set when `policy_enabled` — Host’s active local Ollama from getEffective + policy (activeOllamaModelStore is read via ollamaManager). */
  active_local_llm?: ActiveLocalLlmWire
  inference_error_code?: string
  /**
   * Host Ollama “active / preferred” model from the same `getStatus` path as UI (no hardcoded name in Sandbox).
   * When `models` lists multiple installed tags, the UI prefers this for the primary label.
   * Prefer `active_local_llm` when present.
   */
  active_chat_model?: string
}

export type ServiceEnvelope =
  | InternalInferenceRequestWire
  | InternalInferenceResultWire
  | InternalInferenceErrorWire
