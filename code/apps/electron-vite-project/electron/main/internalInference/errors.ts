/** Stable codes returned to callers and in HTTP JSON for internal service RPC. */

export const InternalInferenceErrorCode = {
  NO_ACTIVE_INTERNAL_HOST_HANDSHAKE: 'NO_ACTIVE_INTERNAL_HOST_HANDSHAKE',
  HOST_DIRECT_P2P_UNAVAILABLE: 'HOST_DIRECT_P2P_UNAVAILABLE',
  INVALID_INTERNAL_ROLE: 'INVALID_INTERNAL_ROLE',
  POLICY_FORBIDDEN: 'POLICY_FORBIDDEN',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  SERVICE_RPC_NOT_SUPPORTED: 'SERVICE_RPC_NOT_SUPPORTED',
  /** Wire / required-field validation (client or inbound). */
  MALFORMED_SERVICE_MESSAGE: 'MALFORMED_SERVICE_MESSAGE',
  /** Host policy: internal inference is off. */
  HOST_INFERENCE_DISABLED: 'HOST_INFERENCE_DISABLED',
  /** Host has no active local Ollama model configured, but Sandbox sent a model id. */
  HOST_NO_ACTIVE_LOCAL_LLM: 'HOST_NO_ACTIVE_LOCAL_LLM',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  OLLAMA_UNAVAILABLE: 'OLLAMA_UNAVAILABLE',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  REQUEST_EXPIRED: 'REQUEST_EXPIRED',
  /** Client requested cancel; Sandbox may treat as a soft error. */
  REQUEST_CANCELLED: 'REQUEST_CANCELLED',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  /** Provider (e.g. Ollama) not running or not reachable; distinct from time-based timeouts. */
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_BUSY: 'PROVIDER_BUSY',
  INTERNAL_INFERENCE_FAILED: 'INTERNAL_INFERENCE_FAILED',
  /**
   * Host no longer serves `internal_inference_request` on HTTP /beap/ingest when P2P+DC is the
   * configured path — old Sandboxes must use DataChannel, or set `WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT=1`.
   */
  P2P_INFERENCE_REQUIRED: 'P2P_INFERENCE_REQUIRED',
} as const

export type InternalInferenceErrorCodeType =
  (typeof InternalInferenceErrorCode)[keyof typeof InternalInferenceErrorCode]
