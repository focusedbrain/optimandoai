/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPersistedWrChatExtensionModel,
  loadPersistedWrChatExtensionModel,
  persistWrChatExtensionModelId,
  WRCHAT_EXT_ACTIVE_MODEL_KEY,
} from '../lib/wrChatExtensionModelPersistence'
import { buildWrChatExtensionAiExecutionPayload } from '../lib/wrChatExtensionAiContext'

describe('wrChatExtensionModelPersistence', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('persists and loads user selection', () => {
    persistWrChatExtensionModelId('gemma:2b', 'user')
    const v = loadPersistedWrChatExtensionModel()
    expect(v?.modelId).toBe('gemma:2b')
    expect(v?.selectionSource).toBe('user')
    expect(localStorage.getItem(WRCHAT_EXT_ACTIVE_MODEL_KEY)).toBe('gemma:2b')
  })

  it('popup picks up same key as sidebar (shared localStorage)', () => {
    persistWrChatExtensionModelId('llama3', 'user')
    const v2 = loadPersistedWrChatExtensionModel()
    expect(v2?.modelId).toBe('llama3')
  })

  it('clears when persist empty id', () => {
    persistWrChatExtensionModelId('x', 'user')
    persistWrChatExtensionModelId('', 'auto')
    expect(loadPersistedWrChatExtensionModel()).toBeNull()
  })
})

describe('buildWrChatExtensionAiExecutionPayload', () => {
  it('local model uses lane local', () => {
    const p = buildWrChatExtensionAiExecutionPayload('mistral:latest', [])
    expect(p?.lane).toBe('local')
    expect(p?.model).toBe('mistral:latest')
  })

  it('host-internal id uses beap lane by default', () => {
    const hostId = 'host-internal:' + encodeURIComponent('hid-1') + ':' + encodeURIComponent('gemma')
    const p = buildWrChatExtensionAiExecutionPayload(hostId, [
      { name: hostId, hostAi: true, section: 'host' },
    ])
    expect(p?.lane).toBe('beap')
    expect(p?.handshakeId).toBe('hid-1')
    expect(p?.model).toBe('gemma')
  })
})
