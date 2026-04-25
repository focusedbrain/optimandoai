/**
 * [HOST_AI_INFER] — metadata only; never log prompt, output, or message content.
 */

export function logHostAiInferRequestSend(args: {
  handshakeId: string
  requestId: string
  promptBytes: number
  messageCount: number
  transport: 'p2p' | 'http'
}): void {
  console.log(
    `[HOST_AI_INFER] request_send handshake=${args.handshakeId} request_id=${args.requestId} prompt_bytes=${args.promptBytes} message_count=${args.messageCount} transport=${args.transport}`,
  )
}

export function logHostAiInferRequestReceived(args: {
  handshakeId: string
  requestId: string
  transport: 'p2p' | 'http'
}): void {
  console.log(
    `[HOST_AI_INFER] request_received handshake=${args.handshakeId} request_id=${args.requestId} transport=${args.transport}`,
  )
}

export function logHostAiInferComplete(args: {
  handshakeId: string
  requestId: string
  durationMs: number
  outputBytes: number
}): void {
  console.log(
    `[HOST_AI_INFER] complete handshake=${args.handshakeId} request_id=${args.requestId} duration_ms=${args.durationMs} output_bytes=${args.outputBytes}`,
  )
}

export function logHostAiInferError(args: { handshakeId: string; requestId: string; code: string }): void {
  console.log(
    `[HOST_AI_INFER] error handshake=${args.handshakeId} request_id=${args.requestId} code=${args.code}`,
  )
}

/** Sandbox: DC result arrived (no output payload in log). */
export function logHostAiInferResponseReceived(args: {
  handshakeId: string
  requestId: string
  transport: 'p2p' | 'http'
}): void {
  console.log(
    `[HOST_AI_INFER] response_received handshake=${args.handshakeId} request_id=${args.requestId} transport=${args.transport}`,
  )
}
