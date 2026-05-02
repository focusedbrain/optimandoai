import { describe, expect, it } from 'vitest'
import { buildSyntheticOkProbeFromOllamaDirectTags } from '../sandboxHostAiOllamaDirectSyntheticProbe'
import type { SandboxOllamaDirectTagsFetchResult } from '../sandboxHostAiOllamaDirectTags'

function tagsAvailable(models: string[]): SandboxOllamaDirectTagsFetchResult {
  return {
    classification: 'available',
    models_count: models.length,
    models: models.map((model) => ({
      id: model,
      model,
      label: '',
      provider: 'ollama' as const,
      transport: 'ollama_direct' as const,
      source: 'remote_ollama_tags' as const,
      endpoint_owner_device_id: 'dev-host',
    })),
    ok: true,
    http_status: 200,
    error_code: null,
    duration_ms: 0,
    cache_hit: false,
    inflight_reused: false,
  }
}

describe('buildSyntheticOkProbeFromOllamaDirectTags', () => {
  it('uses peer relay active_model_id when present in tags (not first tag order)', () => {
    const tags = tagsAvailable(['llama3.1:8b', 'gemma2:12b'])
    const probe = buildSyntheticOkProbeFromOllamaDirectTags(tags, {
      hostComputerName: 'H',
      peerAdvertisedOllamaRoster: {
        models: [
          { id: 'llama3.1:8b', name: 'llama3.1:8b', provider: 'ollama', available: true, active: false },
          { id: 'gemma2:12b', name: 'gemma2:12b', provider: 'ollama', available: true, active: true },
        ],
        active_model_id: 'gemma2:12b',
        active_model_name: 'gemma2:12b',
        model_source: 'relay',
        max_concurrent_local_models: 1,
      },
    })
    expect(probe.defaultChatModel).toBe('gemma2:12b')
    expect(probe.hostDefaultModelSource).toBe('peer_relay_active_model')
    expect(probe.hostAvailableModelIds).toEqual(['gemma2:12b', 'llama3.1:8b'])
  })

  it('falls back to first tag when relay active is not in tags', () => {
    const tags = tagsAvailable(['llama3.1:8b'])
    const probe = buildSyntheticOkProbeFromOllamaDirectTags(tags, {
      hostComputerName: 'H',
      peerAdvertisedOllamaRoster: {
        models: [],
        active_model_id: 'missing:model',
        active_model_name: 'missing:model',
        model_source: 'relay',
        max_concurrent_local_models: 1,
      },
    })
    expect(probe.defaultChatModel).toBe('llama3.1:8b')
    expect(probe.hostDefaultModelSource).toBe('ollama_tags_primary_order')
    expect(probe.hostOllamaSyntheticFallbackUsed).toBe(true)
  })
})
