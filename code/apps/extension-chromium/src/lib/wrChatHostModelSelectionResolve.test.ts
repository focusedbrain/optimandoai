import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hostInternalInferenceModelId } from './hostInferenceRouteIds'
import type { WrChatSelectorRow } from './wrChatModelsFromLlmStatus'
import {
  migrateWrChatHostSelectionId,
  resolveWrChatExtensionModelForSend,
} from './wrChatHostModelSelectionResolve'

const CANON = 'gemma-4-12B-it-Q4_K_M'
const STALE = 'gemma4:12b-it-q8_0'
const HS = 'hs-e8a385c7-test'

function hostRow(overrides: Partial<WrChatSelectorRow> = {}): WrChatSelectorRow {
  const canonicalId = hostInternalInferenceModelId(HS, CANON)
  return {
    name: canonicalId,
    displayTitle: `Host AI · ${CANON}`,
    hostAi: true,
    section: 'host',
    hostActiveModel: CANON,
    isHostActiveModel: true,
    hostAvailable: true,
    ...overrides,
  }
}

describe('migrateWrChatHostSelectionId', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('migrates URL-encoded stale Ollama tag to roster active model', () => {
    const staleId = hostInternalInferenceModelId(HS, STALE)
    const rows = [hostRow()]
    const result = migrateWrChatHostSelectionId(staleId, rows, 'sidebar_wrchat')
    expect(result.migrated).toBe(true)
    expect(result.reason).toBe('unresolvable_migrated_to_active')
    expect(result.modelId).toBe(hostInternalInferenceModelId(HS, CANON))
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[WRCHAT_SELECTION_MIGRATION]'),
    )
  })

  it('leaves canonical selection untouched (idempotent)', () => {
    const canonicalId = hostInternalInferenceModelId(HS, CANON)
    const rows = [hostRow()]
    const first = migrateWrChatHostSelectionId(canonicalId, rows, 'popup_wrchat')
    const second = migrateWrChatHostSelectionId(canonicalId, rows, 'popup_wrchat')
    expect(first.migrated).toBe(false)
    expect(second.migrated).toBe(false)
    expect(first.modelId).toBe(canonicalId)
  })
})

describe('resolveWrChatExtensionModelForSend', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('resolves stale selection to canonical wire model for outbound send', () => {
    const staleId = hostInternalInferenceModelId(HS, STALE)
    const rows = [hostRow()]
    const result = resolveWrChatExtensionModelForSend(staleId, rows, 'active_mode_wrchat')
    expect(result.error).toBeUndefined()
    expect(result.wireModel).toBe(CANON)
    expect(result.modelId).toBe(hostInternalInferenceModelId(HS, CANON))
  })

  it('errors when roster has no host models', () => {
    const staleId = hostInternalInferenceModelId(HS, STALE)
    const result = resolveWrChatExtensionModelForSend(staleId, [], 'sidebar_wrchat')
    expect(result.error).toBe('HOST_NO_ACTIVE_LOCAL_LLM')
  })

  it('errors when host rows exist but roster has no installed models', () => {
    const staleId = hostInternalInferenceModelId(HS, STALE)
    const rows: WrChatSelectorRow[] = [
      {
        name: `host-internal:${encodeURIComponent(HS)}:unavailable`,
        hostAi: true,
        section: 'host',
        hostAvailable: true,
      },
    ]
    const result = resolveWrChatExtensionModelForSend(staleId, rows, 'popup_wrchat')
    expect(result.error).toBe('HOST_NO_ACTIVE_LOCAL_LLM')
  })
})
