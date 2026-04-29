/**
 * Regression: orchestrator restore must not treat ollama_direct readiness as “pending” or stale purely from local HOST_CAPS.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  validateStoredSelectionForOrchestratorWithDiagnostics,
  isHostInternalSelectionStaleForOrchestratorUi,
} from '../inferenceSelectionPersistence'
import { hostInternalInferenceModelId } from '../hostInferenceModelIds'
import { getCachedUserInfo } from '../auth/sessionCache'
import type { HostInferenceTargetRow } from '../../hooks/useSandboxHostInference'

vi.mock('../auth/sessionCache', () => ({
  getCachedUserInfo: vi.fn(() => ({ wrdesk_user_id: 'wrd-user-test', sub: 'sub-t' })),
}))

beforeEach(() => {
  vi.mocked(getCachedUserInfo).mockReturnValue({ wrdesk_user_id: 'wrd-user-test', sub: 'sub-t' } as any)
})

describe('validateStoredSelectionForOrchestrator — ollama_direct', () => {
  it('does not mark host_internal as pending when available=false but ollamaDirectReady=true (BEAP missing)', () => {
    const hid = 'hs-odl'
    const modelId = hostInternalInferenceModelId(hid, 'gemma3:12b')
    const stored = {
      v: 1 as const,
      kind: 'host_internal' as const,
      id: modelId,
      model: 'gemma3:12b',
      handshake_id: hid,
    }
    const targets: HostInferenceTargetRow[] = [
      {
        kind: 'host_internal',
        id: modelId,
        label: 'Host',
        model: 'gemma3:12b',
        handshake_id: hid,
        host_device_id: 'd',
        host_computer_name: 'HostPc',
        direct_reachable: true,
        policy_enabled: true,
        available: false,
        availability: 'ollama_direct_lane',
        host_role: 'Host',
        failureCode: 'HOST_AI_DIRECT_PEER_BEAP_MISSING',
        host_ai_target_status: 'ollama_direct_only',
        execution_transport: 'ollama_direct',
        canChat: false,
        canUseOllamaDirect: false,
        ollamaDirectReady: true,
        visibleInModelSelector: true,
      },
    ]
    const v = validateStoredSelectionForOrchestratorWithDiagnostics(
      stored,
      [{ id: modelId, type: 'host_internal' }],
      targets,
      true,
      false,
    )
    expect(v.error).toBeUndefined()
    expect(v.modelId).toBe(modelId)
    expect(v.diagnostics.pending).toBe(false)
    expect(v.diagnostics.reason).toBe('ok')
  })

  it('isHostInternalSelectionStaleForOrchestratorUi is false when merged row would be ODL-ready', () => {
    const hid = 'hs-odl'
    const modelId = hostInternalInferenceModelId(hid, 'gemma3:12b')
    const t: HostInferenceTargetRow = {
      kind: 'host_internal',
      id: modelId,
      label: 'Host',
      model: 'gemma3:12b',
      handshake_id: hid,
      host_device_id: 'd',
      host_computer_name: 'HostPc',
      direct_reachable: true,
      policy_enabled: true,
      available: false,
      availability: 'ollama_direct_lane',
      host_role: 'Host',
      host_ai_target_status: 'ollama_direct_only',
      execution_transport: 'ollama_direct',
      canChat: false,
      ollamaDirectReady: true,
      visibleInModelSelector: true,
    }
    const stale = isHostInternalSelectionStaleForOrchestratorUi(modelId, [{ id: modelId, type: 'host_internal' }], [t])
    expect(stale).toBe(false)
  })
})

describe('validateStoredSelectionForOrchestrator — sandbox local_ollama', () => {
  it('clears local_ollama when sandbox has no local rows (remote host selection is separate)', () => {
    const stored = { v: 1 as const, kind: 'local_ollama' as const, id: 'llama3', model: 'llama3' }
    const v = validateStoredSelectionForOrchestratorWithDiagnostics(stored, [], [], true, false)
    expect(v.error).toBe('unknown_model')
    expect(v.diagnostics.reason).toBe('local_model_missing')
  })
})
