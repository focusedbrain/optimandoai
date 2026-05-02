/**
 * Host BEAP ad: coordination 403 from stale registry → re-register → retry POST.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => `/tmp/wrdesk-test/${name}`,
    getAppPath: () => '/tmp/wrdesk-test/app',
  },
}))

import * as authSession from '../../../../src/auth/session'
import {
  p2pSignalRelayPostTestHooks,
  postHostAiDirectBeapAdToCoordination,
  resetP2pSignalRelayOutboundStateForTests,
} from '../p2pSignalRelayPost'

const reregMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })))

vi.mock('../../handshake/outboundQueue', () => ({
  getOutboundQueueAuthRefresh: () => null,
}))

vi.mock('../../p2p/relaySync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../p2p/relaySync')>()
  return {
    ...actual,
    reregisterInternalHandshakeAfterCoordinationP2pSignal403: (...a: unknown[]) => reregMock(...a),
  }
})

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => 'dev-host-1',
}))

vi.mock('../../p2p/p2pConfig', () => ({
  getP2PConfig: () => ({
    use_coordination: true,
    coordination_url: 'https://coord.example',
  }),
}))

describe('postHostAiDirectBeapAdToCoordination — 403 registry drift recovery', () => {
  const db = {}
  let postN = 0

  beforeEach(() => {
    postN = 0
    reregMock.mockClear()
    resetP2pSignalRelayOutboundStateForTests()
    const payload = Buffer.from(
      JSON.stringify({ exp: 2_000_000_000, email: 'user@example.com' }),
    ).toString('base64url')
    vi.spyOn(authSession, 'getAccessToken').mockReturnValue(`h.${payload}.s`)
    p2pSignalRelayPostTestHooks.post = async () => {
      postN += 1
      if (postN === 1) {
        return {
          status: 403,
          bodyText: JSON.stringify({ error: 'RELAY_RECIPIENT_RESOLUTION_FAILED' }),
        }
      }
      return { status: 200, bodyText: '{}' }
    }
  })

  afterEach(() => {
    p2pSignalRelayPostTestHooks.post = null
    vi.restoreAllMocks()
  })

  it('re-registers internal handshake then succeeds on second POST', async () => {
    const r = await postHostAiDirectBeapAdToCoordination({
      db,
      handshakeId: 'hs-1',
      endpointUrl: 'http://192.168.1.5:9/beap/ingest',
      senderDeviceId: 'dev-host-1',
      receiverDeviceId: 'dev-sand-1',
      adSeq: 3,
      modelsCount: 2,
    })
    expect(r.ok).toBe(true)
    expect(r.status).toBe(200)
    expect(postN).toBe(2)
    expect(reregMock).toHaveBeenCalledTimes(1)
    expect(reregMock.mock.calls[0][1]).toBe('hs-1')
  })

  it('does not re-register when 403 body is not a known registry drift code', async () => {
    postN = 0
    p2pSignalRelayPostTestHooks.post = async () => {
      postN += 1
      return { status: 403, bodyText: JSON.stringify({ error: 'RELAY_CAP_UNKNOWN' }) }
    }
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const r = await postHostAiDirectBeapAdToCoordination({
        db,
        handshakeId: 'hs-2',
        endpointUrl: 'http://192.168.1.5:9/beap/ingest',
        senderDeviceId: 'dev-host-1',
        receiverDeviceId: 'dev-sand-1',
        adSeq: 1,
        modelsCount: 1,
      })
      expect(r.ok).toBe(false)
      expect(r.status).toBe(403)
      expect(reregMock).not.toHaveBeenCalled()
      expect(postN).toBe(1)
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(out).toContain('[HOST_AI_RELAY_POST_FAILED]')
      expect(out).toContain('RELAY_CAP_UNKNOWN')
    } finally {
      logSpy.mockRestore()
    }
  })
})
