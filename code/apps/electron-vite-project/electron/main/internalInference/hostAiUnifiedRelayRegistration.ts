/**
 * Lazy registration so p2pSignalRelayPost does not statically import the sealed-relay sender (Phase C).
 */

export type HostAiUnifiedRelaySendResult =
  | { readonly ok: true; readonly status: 200 | 202 }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly message: string }

export type HostAiUnifiedRelaySendFn = (params: {
  db: unknown
  handshakeId: string
  senderDeviceId: string
  receiverDeviceId: string
  p2pSignalBodyJson: string
}) => Promise<HostAiUnifiedRelaySendResult | null>

let registeredSend: HostAiUnifiedRelaySendFn | null = null

export function registerHostAiUnifiedRelaySend(fn: HostAiUnifiedRelaySendFn | null): void {
  registeredSend = fn
}

export function getRegisteredHostAiUnifiedRelaySend(): HostAiUnifiedRelaySendFn | null {
  return registeredSend
}

export function resetHostAiUnifiedRelayRegistrationForTests(): void {
  registeredSend = null
}
