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

  it('local probe ok → returns local_sandbox', async () => {
    const { resolveSandboxInferenceTarget } = await import('../resolveSandboxInferenceTarget')
    const r = await resolveSandboxInferenceTarget({})
    expect(r.kind).toBe('local_sandbox')
    if (r.kind === 'local_sandbox') {
      expect(r.baseUrl).toBe('http://127.0.0.1:11434')
      expect(r.execution_transport).toBe('local_ollama')
    }
  })

  it('local probe failed + handshake + cross-device candidate → cross_device', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve({
          ok: false,
          status: 503,
        } as Response),
      ),
    )

    candidateMap.value = {
      route_kind: 'ollama_direct',
      handshake_id: 'hs-a',
      base_url: 'http://192.168.178.28:11434',
      endpoint_owner_device_id: 'host-dev',
      peer_host_device_id: 'host-dev',
      validated_at_ms: Date.now(),
    }

    const { resolveSandboxInferenceTarget } = await import('../resolveSandboxInferenceTarget')
    const r = await resolveSandboxInferenceTarget({ handshakeId: 'hs-a' })
    expect(r.kind).toBe('cross_device')
    if (r.kind === 'cross_device') {
      expect(r.baseUrl).toBe('http://192.168.178.28:11434')
      expect(r.execution_transport).toBe('ollama_direct')
      expect(r.endpointOwnerDeviceId).toBe('host-dev')
      expect(r.handshakeId).toBe('hs-a')
    }
  })

  it('local probe failed + no candidate → unavailable cross_device_caps_not_accepted', async () => {
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
    const r = await resolveSandboxInferenceTarget({ handshakeId: 'hs-none' })
    expect(r.kind).toBe('unavailable')
    if (r.kind === 'unavailable') expect(r.reason).toBe('cross_device_caps_not_accepted')
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
