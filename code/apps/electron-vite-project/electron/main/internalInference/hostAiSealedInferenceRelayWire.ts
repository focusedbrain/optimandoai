/**
 * Sealed inner wire types for Host AI inference over the coordination relay.
 * Carried inside sealed_service_rpc_v1 envelopes (X25519+HKDF+AES-256-GCM).
 * INV-ENCRYPT: prompt/completion lives ONLY inside ciphertext — relay sees routing + opaque blob.
 */

export const HOST_AI_INFERENCE_REQUEST_INNER_TYPE = 'host_ai_inference_request_v1' as const
export const HOST_AI_INFERENCE_RESULT_INNER_TYPE = 'host_ai_inference_result_v1' as const
export const HOST_AI_INFERENCE_ERROR_INNER_TYPE = 'host_ai_inference_error_v1' as const
export const HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION = 1 as const

export interface HostAiInferenceRequestRelayWire {
  readonly type: typeof HOST_AI_INFERENCE_REQUEST_INNER_TYPE
  readonly schema_version: typeof HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION
  readonly request_id: string
  readonly handshake_id: string
  readonly sender_device_id: string
  readonly receiver_device_id: string
  readonly model?: string
  readonly messages: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>
  readonly options?: { temperature?: number; max_tokens?: number }
  readonly created_at: string
  readonly expires_at: string
}

export interface HostAiInferenceResultRelayWire {
  readonly type: typeof HOST_AI_INFERENCE_RESULT_INNER_TYPE
  readonly schema_version: typeof HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION
  readonly request_id: string
  readonly handshake_id: string
  readonly sender_device_id: string
  readonly receiver_device_id: string
  readonly model: string
  readonly output: string
  readonly duration_ms: number
}

export interface HostAiInferenceErrorRelayWire {
  readonly type: typeof HOST_AI_INFERENCE_ERROR_INNER_TYPE
  readonly schema_version: typeof HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION
  readonly request_id: string
  readonly handshake_id: string
  readonly sender_device_id: string
  readonly receiver_device_id: string
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly duration_ms: number
}

export type HostAiInferenceRelayWire =
  | HostAiInferenceRequestRelayWire
  | HostAiInferenceResultRelayWire
  | HostAiInferenceErrorRelayWire

export function isHostAiInferenceRequestRelayInnerType(t: string): boolean {
  return t === HOST_AI_INFERENCE_REQUEST_INNER_TYPE
}

export function isHostAiInferenceResultOrErrorRelayInnerType(t: string): boolean {
  return t === HOST_AI_INFERENCE_RESULT_INNER_TYPE || t === HOST_AI_INFERENCE_ERROR_INNER_TYPE
}

export function parseHostAiInferenceRequestFromPlaintext(
  plaintextJson: string,
): { ok: true; wire: HostAiInferenceRequestRelayWire } | { ok: false; message: string } {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(plaintextJson)
  } catch {
    return { ok: false, message: 'inner JSON parse failed' }
  }
  if (o.type !== HOST_AI_INFERENCE_REQUEST_INNER_TYPE) {
    return { ok: false, message: 'unexpected inner type' }
  }
  if (o.schema_version !== HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION) {
    return { ok: false, message: 'unsupported schema_version' }
  }
  const hid = typeof o.handshake_id === 'string' ? o.handshake_id.trim() : ''
  const rid = typeof o.request_id === 'string' ? o.request_id.trim() : ''
  const sender = typeof o.sender_device_id === 'string' ? o.sender_device_id.trim() : ''
  const receiver = typeof o.receiver_device_id === 'string' ? o.receiver_device_id.trim() : ''
  if (!hid || !rid || !sender || !receiver) {
    return { ok: false, message: 'missing required routing fields' }
  }
  if (!Array.isArray(o.messages) || o.messages.length === 0) {
    return { ok: false, message: 'messages required and must be non-empty array' }
  }
  return {
    ok: true,
    wire: {
      type: HOST_AI_INFERENCE_REQUEST_INNER_TYPE,
      schema_version: HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION,
      request_id: rid,
      handshake_id: hid,
      sender_device_id: sender,
      receiver_device_id: receiver,
      model: typeof o.model === 'string' ? o.model.trim() : undefined,
      messages: o.messages as HostAiInferenceRequestRelayWire['messages'],
      options: o.options as HostAiInferenceRequestRelayWire['options'],
      created_at: typeof o.created_at === 'string' ? o.created_at : new Date().toISOString(),
      expires_at: typeof o.expires_at === 'string' ? o.expires_at : '',
    },
  }
}

export function parseHostAiInferenceResultOrErrorFromPlaintext(
  plaintextJson: string,
): { ok: true; wire: HostAiInferenceResultRelayWire | HostAiInferenceErrorRelayWire } | { ok: false; message: string } {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(plaintextJson)
  } catch {
    return { ok: false, message: 'inner JSON parse failed' }
  }
  if (o.type !== HOST_AI_INFERENCE_RESULT_INNER_TYPE && o.type !== HOST_AI_INFERENCE_ERROR_INNER_TYPE) {
    return { ok: false, message: 'unexpected inner type' }
  }
  const rid = typeof o.request_id === 'string' ? o.request_id.trim() : ''
  if (!rid) {
    return { ok: false, message: 'missing request_id' }
  }
  if (o.type === HOST_AI_INFERENCE_RESULT_INNER_TYPE) {
    return {
      ok: true,
      wire: {
        type: HOST_AI_INFERENCE_RESULT_INNER_TYPE,
        schema_version: HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION,
        request_id: rid,
        handshake_id: typeof o.handshake_id === 'string' ? o.handshake_id.trim() : '',
        sender_device_id: typeof o.sender_device_id === 'string' ? o.sender_device_id.trim() : '',
        receiver_device_id: typeof o.receiver_device_id === 'string' ? o.receiver_device_id.trim() : '',
        model: typeof o.model === 'string' ? o.model : '',
        output: typeof o.output === 'string' ? o.output : '',
        duration_ms: typeof o.duration_ms === 'number' ? o.duration_ms : 0,
      },
    }
  }
  return {
    ok: true,
    wire: {
      type: HOST_AI_INFERENCE_ERROR_INNER_TYPE,
      schema_version: HOST_AI_INFERENCE_RELAY_SCHEMA_VERSION,
      request_id: rid,
      handshake_id: typeof o.handshake_id === 'string' ? o.handshake_id.trim() : '',
      sender_device_id: typeof o.sender_device_id === 'string' ? o.sender_device_id.trim() : '',
      receiver_device_id: typeof o.receiver_device_id === 'string' ? o.receiver_device_id.trim() : '',
      code: typeof o.code === 'string' ? o.code : 'UNKNOWN',
      message: typeof o.message === 'string' ? o.message : '',
      retryable: o.retryable === true,
      duration_ms: typeof o.duration_ms === 'number' ? o.duration_ms : 0,
    },
  }
}

const MAX_SEALED_CAPSULE_PAYLOAD_BYTES = 10 * 1024 * 1024

export function assertInferencePayloadWithinCapsuleLimit(jsonStr: string): boolean {
  return Buffer.byteLength(jsonStr, 'utf8') <= MAX_SEALED_CAPSULE_PAYLOAD_BYTES
}
