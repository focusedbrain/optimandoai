/**
 * Phase 11 — DataChannel wire: request/result helpers call WebRTC with bounded payloads (no main-process logging of bodies here).
 */
import { describe, expect, it, vi } from 'vitest'
import { INTERNAL_INFERENCE_SCHEMA_VERSION, type InternalInferenceRequestWire } from '../types'

const webrtcSendData = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: () => 't', getAppPath: () => 't', isPackaged: true },
}))

vi.mock('../webrtc/webrtcTransportIpc', () => ({
  webrtcSendData: (...args: unknown[]) => webrtcSendData(...args),
}))

import { sendHostInferenceRequestOverP2pDataChannel } from '../p2pDc/p2pDcInference'

describe('Phase 11 — p2p DataChannel wire', () => {
  it('sendHostInferenceRequestOverP2pDataChannel forwards JSON to webrtc (request/result path)', async () => {
    webrtcSendData.mockResolvedValue(undefined)
    const req: InternalInferenceRequestWire = {
      type: 'internal_inference_request',
      schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
      request_id: 'r1',
      handshake_id: 'hs-1',
      sender_device_id: 'sand',
      target_device_id: 'host',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      messages: [{ role: 'user', content: 'hello' }],
    }
    const ok = await sendHostInferenceRequestOverP2pDataChannel('p2p-sid', 'hs-1', req)
    expect(ok).toBe(true)
    expect(webrtcSendData).toHaveBeenCalledTimes(1)
    const ab = webrtcSendData.mock.calls[0][2] as ArrayBuffer
    const json = new TextDecoder().decode(new Uint8Array(ab))
    expect(json).toContain('inference_request')
    expect(json).toContain('hello')
  })

  it('sendHostInferenceRequestOverP2pDataChannel returns false when JSON exceeds DataChannel cap (no webrtc call)', async () => {
    webrtcSendData.mockClear()
    const big = 'x'.repeat(2_500_000)
    const req: InternalInferenceRequestWire = {
      type: 'internal_inference_request',
      schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
      request_id: 'r-big',
      handshake_id: 'hs-1',
      sender_device_id: 'sand',
      target_device_id: 'host',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      messages: [{ role: 'user', content: big }],
    }
    const ok = await sendHostInferenceRequestOverP2pDataChannel('p2p-sid', 'hs-1', req)
    expect(ok).toBe(false)
    expect(webrtcSendData).not.toHaveBeenCalled()
  })
})
