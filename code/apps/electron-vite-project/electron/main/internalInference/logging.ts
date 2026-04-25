import type { InternalServiceMessageType } from './types'

const PREFIX = '[internal-inference]'

export interface InternalInferenceLogMeta {
  request_id: string
  handshake_id: string
  sender_device_id: string
  target_device_id: string
  message_type: InternalServiceMessageType | 'internal_inference_error'
  /** `hostname` from peer URL, or '(invalid-url)' */
  direct_endpoint_host: string
  duration_ms?: number
  /** Allowed metadata; never log message bodies or `output` text. */
  model?: string
  prompt_bytes?: number
  message_count?: number
  error_code?: string
}

function endpointHostOnly(endpoint: string): string {
  try {
    return new URL(endpoint).hostname
  } catch {
    return '(invalid-url)'
  }
}

export function logInternalInferenceEvent(
  event: 'send' | 'recv' | 'complete',
  meta: InternalInferenceLogMeta,
  endpointUrlForHost?: string,
): void {
  const direct_endpoint_host = endpointUrlForHost
    ? endpointHostOnly(endpointUrlForHost)
    : meta.direct_endpoint_host
  const { duration_ms, ...rest } = meta
  const line = {
    event,
    ...rest,
    direct_endpoint_host,
    ...(typeof duration_ms === 'number' ? { duration_ms } : {}),
  }
  console.log(PREFIX, JSON.stringify(line))
}

export { endpointHostOnly }
