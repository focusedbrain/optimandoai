import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../local-llm-manager', () => ({
  localLlmManager: {
    listModels: vi.fn(),
    getEffectiveChatModelName: vi.fn(),
  },
}))

import { localLlmManager } from '../local-llm-manager'
import {
  isOllamaModelInstalled,
  resolveDeclaredLocalOllamaModel,
} from '../resolveDeclaredModelAvailability'

describe('resolveDeclaredLocalOllamaModel', () => {
  beforeEach(() => {
    vi.mocked(localLlmManager.listModels).mockResolvedValue([
      { name: 'gemma4:12b-it-q8_0', size: 1, modified: '', digest: '', isActive: true },
      { name: 'llama3.1:8b', size: 1, modified: '', digest: '', isActive: false },
    ])
    vi.mocked(localLlmManager.getEffectiveChatModelName).mockResolvedValue('gemma4:12b-it-q8_0')
  })

  it('returns installed model unchanged', async () => {
    const r = await resolveDeclaredLocalOllamaModel('gemma4:12b-it-q8_0', 'test')
    expect(r).toMatchObject({
      ok: true,
      requestedModel: 'gemma4:12b-it-q8_0',
      actualModel: 'gemma4:12b-it-q8_0',
      fellBack: false,
    })
  })

  it('falls back missing declared model to active model', async () => {
    const r = await resolveDeclaredLocalOllamaModel('gemma3:12b', 'mode_run_agent')
    expect(r).toMatchObject({
      ok: true,
      requestedModel: 'gemma3:12b',
      actualModel: 'gemma4:12b-it-q8_0',
      fellBack: true,
      reason: 'not_installed',
    })
  })

  it('hard-fails when no active model exists', async () => {
    vi.mocked(localLlmManager.getEffectiveChatModelName).mockResolvedValue(null)
    const r = await resolveDeclaredLocalOllamaModel('gemma3:12b', 'test')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('no_active_model')
      expect(r.error).toContain('gemma3:12b')
    }
  })

  it('isOllamaModelInstalled matches case-insensitively', () => {
    expect(isOllamaModelInstalled(['Gemma4:12b'], 'gemma4:12b')).toBe(true)
  })
})
