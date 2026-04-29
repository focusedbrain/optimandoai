/**
 * When orchestrator-mode.json says `host` but the ledger proves this device is the sandbox peer,
 * inbox / capsule LLM resolution must still honor persisted `ollama_direct` (no forced local tags).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/wrdesk-resolve-ai-exec',
    getAppPath: () => '/tmp/wrdesk-resolve-ai-exec',
  },
}))

const getEffectiveChatModelNameMock = vi.fn(async () => null)

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  isHostMode: () => true,
  isSandboxMode: () => false,
  getOrchestratorMode: () => ({
    mode: 'host',
    deviceName: 'S',
    instanceId: 'dev-sand-coord-1',
    pairingCode: '123456',
    connectedPeers: [] as const,
  }),
  getInstanceId: () => 'dev-sand-coord-1',
}))

vi.mock('../../internalInference/dbAccess', () => ({
  getHandshakeDbForInternalInference: async () => ({}),
}))

/** Mirrors ledger authority when persisted orchestrator mode disagrees with handshake roles. */
vi.mock('../../internalInference/hostAiEffectiveRole', () => ({
  getHostAiLedgerRoleSummaryFromDb: () => ({
    can_publish_host_endpoint: false,
    can_probe_host_endpoint: true,
    any_orchestrator_mismatch: true,
    effective_host_ai_role: 'sandbox',
  }),
}))

vi.mock('../../internalInference/sandboxHostAiOllamaDirectCandidate', () => ({
  getSandboxOllamaDirectRouteCandidate: () => ({
    base_url: 'http://192.168.178.28:11434',
    peer_host_device_id: 'dev-host-coord-1',
  }),
}))

vi.mock('../../internalInference/listInferenceTargets', () => ({
  listSandboxHostInternalInferenceTargets: async () => ({ targets: [] }),
}))

vi.mock('../ollama-manager', () => ({
  ollamaManager: {
    getEffectiveChatModelName: (...args: unknown[]) => getEffectiveChatModelNameMock(...args),
  },
}))

const readStoredAiExecutionContextMock = vi.fn()

vi.mock('../aiExecutionContextStore', () => ({
  readStoredAiExecutionContext: () => readStoredAiExecutionContextMock(),
}))

describe('resolveAiExecutionContextForLlm — ledger sandbox vs orchestrator host hint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readStoredAiExecutionContextMock.mockReturnValue({
      lane: 'ollama_direct',
      model: 'gemma3:12b',
      handshakeId: 'hs-effective-sandbox-1',
      peerDeviceId: 'dev-host-coord-1',
      ollamaDirectReady: true,
      beapReady: false,
    })
  })

  it('does not force local Ollama when ledger proves sandbox peer but orchestrator file says host', async () => {
    const { resolveAiExecutionContextForLlm } = await import('../resolveAiExecutionContext')
    const r = await resolveAiExecutionContextForLlm()
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected ok')
    expect(r.ctx.lane).toBe('ollama_direct')
    expect(r.ctx.model).toBe('gemma3:12b')
    expect(r.ctx.baseUrl).toBe('http://192.168.178.28:11434')
    expect(getEffectiveChatModelNameMock).not.toHaveBeenCalled()
  })
})
