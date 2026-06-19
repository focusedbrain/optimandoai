/**
 * Sealed inner wire for Host AI control-plane over unified service-RPC relay (Phase C).
 * Inner JSON carries the same body that would POST to /beap/p2p-signal — inside ciphertext only.
 */

export const HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_INNER_TYPE = 'host_ai_p2p_signal_v1' as const
export const HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_SCHEMA_VERSION = 1 as const

export type HostAiP2pSignalUnifiedRelayWire = {
  readonly type: typeof HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_INNER_TYPE
  readonly schema_version: typeof HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_SCHEMA_VERSION
  readonly handshake_id: string
  readonly sender_device_id: string
  readonly receiver_device_id: string
  /** Exact JSON string for coordination p2p_signal payload (schema_version, signal_type, …). */
  readonly p2p_signal_body: string
}

export function buildHostAiP2pSignalUnifiedRelayWire(params: {
  handshakeId: string
  senderDeviceId: string
  receiverDeviceId: string
  p2pSignalBodyJson: string
}): HostAiP2pSignalUnifiedRelayWire {
  return {
    type: HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_INNER_TYPE,
    schema_version: HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_SCHEMA_VERSION,
    handshake_id: params.handshakeId.trim(),
    sender_device_id: params.senderDeviceId.trim(),
    receiver_device_id: params.receiverDeviceId.trim(),
    p2p_signal_body: params.p2pSignalBodyJson,
  }
}

export function parseHostAiP2pSignalUnifiedRelayWire(
  parsed: unknown,
): { ok: true; wire: HostAiP2pSignalUnifiedRelayWire } | { ok: false; message: string } {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'inner payload must be an object' }
  }
  const o = parsed as Record<string, unknown>
  if (o.type !== HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_INNER_TYPE) {
    return { ok: false, message: 'unexpected inner type' }
  }
  if (o.schema_version !== HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_SCHEMA_VERSION) {
    return { ok: false, message: 'unsupported schema_version' }
  }
  const hid = typeof o.handshake_id === 'string' ? o.handshake_id.trim() : ''
  const sender = typeof o.sender_device_id === 'string' ? o.sender_device_id.trim() : ''
  const receiver = typeof o.receiver_device_id === 'string' ? o.receiver_device_id.trim() : ''
  const body = typeof o.p2p_signal_body === 'string' ? o.p2p_signal_body : ''
  if (!hid || !sender || !receiver || !body.trim()) {
    return { ok: false, message: 'missing routing or p2p_signal_body' }
  }
  return {
    ok: true,
    wire: {
      type: HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_INNER_TYPE,
      schema_version: HOST_AI_P2P_SIGNAL_UNIFIED_RELAY_SCHEMA_VERSION,
      handshake_id: hid,
      sender_device_id: sender,
      receiver_device_id: receiver,
      p2p_signal_body: body,
    },
  }
}

export function parseP2pSignalPayloadFromUnifiedRelayBody(
  bodyJson: string,
): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(bodyJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'p2p_signal_body must be a JSON object' }
    }
    return { ok: true, payload: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, message: 'p2p_signal_body is not valid JSON' }
  }
}
