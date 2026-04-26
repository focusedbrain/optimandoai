/**
 * Regression: capability / model-selector path waits on WebRTC events + single deadline timer, not a poll loop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSessionState, mockSubscribe } = vi.hoisted(() => ({
  mockGetSessionState: vi.fn(),
  mockSubscribe: vi.fn(),
}))

vi.mock('../p2pSession/p2pInferenceSessionManager', () => ({
  P2pSessionPhase: {
    idle: 'idle',
    starting: 'starting',
    signaling: 'signaling',
    connecting: 'connecting',
    datachannel_open: 'datachannel_open',
    ready: 'ready',
    failed: 'failed',
    closed: 'closed',
  },
  getSessionState: (hid: string) => mockGetSessionState(hid),
  subscribeP2pCapabilityDcWait: (hid: string, fn: (e: unknown) => void) => mockSubscribe(hid, fn),
}))

import {
  p2pCapabilityDcWaitOutcomeLogReason,
  waitForP2pDataChannelOpenOrTerminal,
} from '../p2pSession/p2pSessionWait'

describe('p2pSessionWait', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockGetSessionState.mockReset()
    mockSubscribe.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('p2pCapabilityDcWaitOutcomeLogReason', () => {
    it('formats ice_failed with ice and conn', () => {
      expect(
        p2pCapabilityDcWaitOutcomeLogReason({
          ok: false,
          reason: 'ice_failed',
          ice: 'failed',
          conn: 'connected',
        }),
      ).toBe('ice_failed ice=failed conn=connected')
    })

    it('formats p2p_session_failed', () => {
      expect(
        p2pCapabilityDcWaitOutcomeLogReason({
          ok: false,
          reason: 'p2p_session_failed',
          lastErrorCode: 'OFFER_CREATE_TIMEOUT',
        }),
      ).toBe('p2p_session_failed code=OFFER_CREATE_TIMEOUT')
    })
  })

  it('empty handshakeId resolves dc_open_timeout without subscribing', async () => {
    const p = waitForP2pDataChannelOpenOrTerminal('', 5_000)
    await expect(p).resolves.toEqual({ ok: false, reason: 'dc_open_timeout' })
    expect(mockSubscribe).not.toHaveBeenCalled()
  })

  it('resolves ok when session already datachannel_open (no subscribe)', async () => {
    mockGetSessionState.mockReturnValue({ phase: 'datachannel_open', lastErrorCode: null })
    const p = waitForP2pDataChannelOpenOrTerminal('hs-1', 5_000)
    await expect(p).resolves.toEqual({ ok: true })
    expect(mockSubscribe).not.toHaveBeenCalled()
  })

  it('resolves p2p_session_failed when session already failed', async () => {
    mockGetSessionState.mockReturnValue({ phase: 'failed', lastErrorCode: 'SIGNALING_ANSWER_TIMEOUT' })
    const p = waitForP2pDataChannelOpenOrTerminal('hs-1', 5_000)
    await expect(p).resolves.toEqual({
      ok: false,
      reason: 'p2p_session_failed',
      lastErrorCode: 'SIGNALING_ANSWER_TIMEOUT',
    })
    expect(mockSubscribe).not.toHaveBeenCalled()
  })

  it('uses one deadline timer and resolves dc_open_timeout when nothing fires', async () => {
    mockGetSessionState.mockReturnValue({ phase: 'connecting', lastErrorCode: null })
    mockSubscribe.mockReturnValue(() => {})
    const p = waitForP2pDataChannelOpenOrTerminal('hs-1', 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(p).resolves.toEqual({ ok: false, reason: 'dc_open_timeout' })
    expect(mockSubscribe).toHaveBeenCalledTimes(1)
  })

  it('resolves ice_failed when transport emits terminal ICE (event-driven)', async () => {
    mockGetSessionState.mockReturnValue({ phase: 'connecting', lastErrorCode: null })
    mockSubscribe.mockImplementation((_hid, listener) => {
      queueMicrotask(() =>
        (listener as (e: unknown) => void)({
          kind: 'webrtc_ice_terminal',
          ice: 'failed',
          conn: 'connected',
        }),
      )
      return () => {}
    })
    const p = waitForP2pDataChannelOpenOrTerminal('hs-1', 60_000)
    await vi.runAllTimersAsync()
    await expect(p).resolves.toEqual({
      ok: false,
      reason: 'ice_failed',
      ice: 'failed',
      conn: 'connected',
    })
  })

  it('dc_open event finishes ok when handshake is already up', async () => {
    mockGetSessionState
      .mockReturnValueOnce({ phase: 'connecting', lastErrorCode: null })
      .mockReturnValue({ phase: 'datachannel_open', lastErrorCode: null })
    mockSubscribe.mockImplementation((_hid, listener) => {
      queueMicrotask(() => (listener as (e: unknown) => void)({ kind: 'dc_open' }))
      return () => {}
    })
    const p = waitForP2pDataChannelOpenOrTerminal('hs-1', 60_000)
    await vi.runAllTimersAsync()
    await expect(p).resolves.toEqual({ ok: true })
  })
})
