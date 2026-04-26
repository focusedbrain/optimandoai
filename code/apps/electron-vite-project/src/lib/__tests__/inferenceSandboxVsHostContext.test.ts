/**
 * Sandbox-local Ollama discovery vs Host AI (remote host provider) are independent invariants
 * (validateStoredSelection + orchestrator restore).
 */
import { describe, it, expect } from 'vitest'
import { validateStoredSelectionForOrchestratorWithDiagnostics } from '../inferenceSelectionPersistence'

describe('inference target context: sandbox local vs host remote', () => {
  it('host_internal selection does not use hasLocalModelsInList (no sandbox-local Ollama still ok)', () => {
    const stored = {
      v: 1 as const,
      kind: 'host_internal' as const,
      id: 'host-internal:hs1:unavailable',
      model: 'x',
      account_key: null,
    }
    const r = validateStoredSelectionForOrchestratorWithDiagnostics(
      stored,
      [],
      [
        {
          id: 'host-internal:hs1:unavailable',
          handshake_id: 'hs1',
          available: true,
          availability: 'available',
          p2pUiPhase: 'ready',
        } as any,
      ],
      true,
      false,
    )
    expect(r.diagnostics.provider).toBe('host_ai')
    expect(r.diagnostics.source).toBe('inference_targets')
    expect(r.diagnostics.valid).toBe(true)
  })

  it('local_ollama selection is invalid when sandbox has zero local models in list', () => {
    const stored = {
      v: 1 as const,
      kind: 'local_ollama' as const,
      id: 'llama3',
      model: 'llama3',
      account_key: null,
    }
    const r = validateStoredSelectionForOrchestratorWithDiagnostics(stored, [], undefined, true, false)
    expect(r.error).toBe('unknown_model')
    expect(r.diagnostics.source).toBe('local_models')
  })
})
