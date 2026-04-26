/**
 * Prompt 7 — Two-probe lifecycle: model selector open → populate → close → immediate reopen.
 * Validates IPC TTL cache (no second full list_begin) and that cache expires after the window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  /** Pulls in via orchestrator / policy side effects when importing `ipc` in some graphs. */
  app: {
    getPath: vi.fn(() => '/tmp/wrdesk-test-userdata'),
    getAppPath: vi.fn(() => '/tmp/wrdesk-test-app'),
  },
}))

vi.mock('../webrtc/webrtcTransportIpc', () => ({
  registerWebrtcTransportIpc: vi.fn(),
}))

const listSandboxHostInternalInferenceTargetsMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    ok: true as const,
    targets: [{ handshake_id: 'hs-lifecycle-1' } as Record<string, unknown>],
    refreshMeta: { hadCapabilitiesProbed: false },
  }),
)

vi.mock('../listInferenceTargets', () => ({
  listSandboxHostInternalInferenceTargets: () => listSandboxHostInternalInferenceTargetsMock(),
}))

import {
  dispatchListInferenceTargetsIpc,
  resetListInferenceTargetsIpcCacheForOrchestrator,
} from '../ipc'

describe('model selector lifecycle — listTargets IPC cache (two probes)', () => {
  beforeEach(() => {
    resetListInferenceTargetsIpcCacheForOrchestrator()
    listSandboxHostInternalInferenceTargetsMock.mockClear()
  })

  afterEach(() => {
    resetListInferenceTargetsIpcCacheForOrchestrator()
    vi.useRealTimers()
  })

  it('run 1: cold cache calls listSandboxHostInternalInferenceTargets; run 2 immediate: same payload, one list call, probe_coalesced log', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const arg = { coalesceHandshakeId: 'hs-lifecycle-1' }
    const first = await dispatchListInferenceTargetsIpc(arg)
    const second = await dispatchListInferenceTargetsIpc(arg)

    expect(first).toEqual(second)
    expect(listSandboxHostInternalInferenceTargetsMock).toHaveBeenCalledTimes(1)

    const coalesced = logSpy.mock.calls.some(
      (c) => typeof c[0] === 'string' && c[0].includes('[HOST_INFERENCE_TARGETS] probe_coalesced age_ms='),
    )
    expect(coalesced).toBe(true)

    logSpy.mockRestore()
  })

  it('run 1 unkeyed ({}); run 2 unkeyed immediate: second hits global cache', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await dispatchListInferenceTargetsIpc({})
    await dispatchListInferenceTargetsIpc({})

    expect(listSandboxHostInternalInferenceTargetsMock).toHaveBeenCalledTimes(1)
  })

  it('after TTL, third dispatch runs list again', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const arg = { coalesceHandshakeId: 'hs-lifecycle-1' }
    await dispatchListInferenceTargetsIpc(arg)
    vi.advanceTimersByTime(1600)
    await dispatchListInferenceTargetsIpc(arg)

    expect(listSandboxHostInternalInferenceTargetsMock).toHaveBeenCalledTimes(2)
  })
})
