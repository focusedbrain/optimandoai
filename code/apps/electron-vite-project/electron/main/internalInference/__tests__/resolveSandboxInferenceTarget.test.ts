/**
 * Unit tests: {@link resolveSandboxInferenceTarget} probe cache + cross-device branch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SandboxOllamaDirectRouteCandidate } from '../sandboxHostAiOllamaDirectCandidate'

const candidateMap = vi.hoisted(() => ({ value: undefined as SandboxOllamaDirectRouteCandidate | undefined }))
const getCandidateMock = vi.hoisted(() => vi.fn<(id: string) => SandboxOllamaDirectRouteCandidate | undefined>((id) => candidateMap.value))

vi.mock('../sandboxHostAiOllamaDirectCandidate', () => ({
  getSandboxOllamaDirectRouteCandidate: (id: string) => getCandidateMock(id),
}))

vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: vi.fn(async () => null),
}))

const sampleCandidate: SandboxOllamaDirectRouteCandidate = {
  route_kind: 'ollama_direct',
  handshake_id: 'hs-a',
  base_url: 'http://192.168.178.28:11434',
  endpoint_owner_device_id: 'host-dev',
  peer_host_device_id: 'host-dev',
  validated_at_ms: Date.now(),
}

describe('resolveSandboxInferenceTarget', () => {
  beforeEach(async () => {
    const { invalidateLocalSandboxOllamaProbeCache } = await import('../resolveSandboxInferenceTarget')
    invalidateLocalSandboxOllamaProbeCache()
    candidateMap.value = undefined
    getCandidateMock.mockImplementation(() => candidateMap.value)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve({
          ok: true,
          status: 200,
        } as Response),
      ),
    )
  })

  afterEach(async () => {
    const { invalidateLocalSandboxOllamaProbeCache } = await import('../resolveSandboxInferenceTarget')
    invalidateLocalSandboxOllamaProbeCache()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('no handshakeId + local probe ok → returns local_sandbox', async () => {
    const { resolveSandboxInferenceTarget } = await import('../resolveSandboxInferenceTarget')
    const r = await resolveSandboxInferenceTarget({})
    expect(r.kind).toBe('local_sandbox')
    if (r.kind === 'local_sandbox') {
      expect(r.baseUrl).toBe('http://127.0.0.1:11434')
      expect(r.execution_transport).toBe('local_ollama')
    }
  })

  it('caller handshakeId + valid candidate → cross_device even when local probe would succeed', async () => {
    candidateMap.value = sampleCandidate
    const fetchSpy = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
      } as Response),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const { resolveSandboxInferenceTarget } = await import('../resolveSandboxInferenceTarget')
    const r = await resolveSandboxInferenceTarget({ handshakeId: 'hs-a' })
    expect(r.kind).toBe('cross_device')
    if (r.kind === 'cross_device') {
      expect(r.baseUrl).toBe('http://192.168.178.28:11434')
      expect(r.execution_transport).toBe('ollama_direct')
      expect(r.endpointOwnerDeviceId).toBe('host-dev')
      expect(r.handshakeId).toBe('hs-a')
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('caller handshakeId + candidate appears during bounded wait → cross_device without local probe', async () => {
    vi.useFakeTimers()
    try {
      candidateMap.value = undefined
      const fetchSpy = vi.fn(async () =>
        Promise.resolve({
          ok: true,
          status: 200,
        } as Response),
      )
      vi.stubGlobal('fetch', fetchSpy)

      const { resolveSandboxInferenceTarget } = await import('../resolveSandboxInferenceTarget')
      const p = resolveSandboxInferenceTarget({ handshakeId: 'hs-a' })

      await vi.advanceTimersByTimeAsync(100)
      candidateMap.value = sampleCandidate
      await vi.advanceTimersByTimeAsync(100)

      const r = await p
      expect(r.kind).toBe('cross_device')
      if (r.kind === 'cross_device') {
        expect(r.handshakeId).toBe('hs-a')
        expect(r.baseUrl).toBe('http://192.168.178.28:11434')
      }
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('caller handshakeId + no candidate → falls through to local probe (local ok → local_sandbox)', async () => {
    vi.useFakeTimers()
    try {
      candidateMap.value = undefined
      const { resolveSandboxInferenceTarget } = await import('../resolveSandboxInferenceTarget')
      const p = resolveSandboxInferenceTarget({ handshakeId: 'hs-missing' })
      await vi.advanceTimersByTimeAsync(2100)
      const r = await p
      expect(r.kind).toBe('local_sandbox')
      if (r.kind === 'local_sandbox') {
        expect(r.execution_transport).toBe('local_ollama')
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('caller handshakeId + no candidate + local probe failed → unavailable cross_device_caps_not_accepted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve({
          ok: false,
          status: 503,
        } as Response),
      ),
    )

    vi.useFakeTimers()
    try {
      candidateMap.value = undefined
      const { resolveSandboxInferenceTarget } = await import('../resolveSandboxInferenceTarget')
      const p = resolveSandboxInferenceTarget({ handshakeId: 'hs-none' })
      await vi.advanceTimersByTimeAsync(2100)
      const r = await p
      expect(r.kind).toBe('unavailable')
      if (r.kind === 'unavailable') expect(r.reason).toBe('cross_device_caps_not_accepted')
    } finally {
      vi.useRealTimers()
    }
  })

  it('no handshakeId + local probe failed + db unavailable → no_local_ollama_no_cross_device_host', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve({
          ok: false,
          status: 503,
        } as Response),
      ),
    )

    candidateMap.value = undefined
    const { resolveSandboxInferenceTarget } = await import('../resolveSandboxInferenceTarget')
    const r = await resolveSandboxInferenceTarget({})
    expect(r.kind).toBe('unavailable')
    if (r.kind === 'unavailable') expect(r.reason).toBe('no_local_ollama_no_cross_device_host')
  })

  it('second call within TTL does not hit fetch twice', async () => {
    const fetchSpy = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
      } as Response),
    )
    vi.stubGlobal('fetch', fetchSpy)
    const { resolveSandboxInferenceTarget } = await import('../resolveSandboxInferenceTarget')
    await resolveSandboxInferenceTarget({})
    await resolveSandboxInferenceTarget({})
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
