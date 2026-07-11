import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/wrdesk-internal-host-inf',
    getAppPath: () => '/tmp/wrdesk-internal-host-inf',
  },
}))

vi.mock('../../email/inboxLlmChat', () => ({
  InboxLlmTimeoutError: class InboxLlmTimeoutError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'InboxLlmTimeoutError'
    }
  },
}))

const listModels = vi.fn()
const getEffectiveChatModelName = vi.fn()

vi.mock('../local-llm-manager', () => ({
  localLlmManager: {
    listModels: () => listModels(),
    getEffectiveChatModelName: () => getEffectiveChatModelName(),
  },
}))

import { resolveModelForInternalInference } from '../internalHostInferenceLocal'

describe('resolveModelForInternalInference — multi-entry allowlist uses effective active when installed', () => {
  beforeEach(() => {
    listModels.mockReset()
    getEffectiveChatModelName.mockReset()
  })

  it('prefers getEffectiveChatModelName when it is in allowlist (not allowlist[0] order)', async () => {
    listModels.mockResolvedValue([{ name: 'llama3.1:8b' }, { name: 'gemma2:12b' }])
    getEffectiveChatModelName.mockResolvedValue('gemma2:12b')
    const r = await resolveModelForInternalInference(undefined, ['llama3.1:8b', 'gemma2:12b'])
    expect(r).toEqual({ model: 'gemma2:12b' })
  })

  it('falls back to allowlist[0] when effective active is not in allowlist', async () => {
    listModels.mockResolvedValue([{ name: 'llama3.1:8b' }, { name: 'gemma2:12b' }])
    getEffectiveChatModelName.mockResolvedValue('other:latest')
    const r = await resolveModelForInternalInference(undefined, ['llama3.1:8b', 'gemma2:12b'])
    expect(r).toEqual({ model: 'llama3.1:8b' })
  })
})

describe('resolveModelForInternalInference — alias resolution (path / filename / canonical)', () => {
  const CANON = 'gemma-4-12B-it-Q4_K_M'
  const WIN_PATH = 'C:\\Users\\oscar\\.opengiraffe\\electron-data\\models\\gemma-4-12B-it-Q4_K_M.gguf'

  beforeEach(() => {
    listModels.mockReset()
    getEffectiveChatModelName.mockReset()
  })

  it('resolves a full GGUF path request against the canonical installed name', async () => {
    listModels.mockResolvedValue([{ name: CANON }])
    const r = await resolveModelForInternalInference(WIN_PATH, [])
    expect(r).toEqual({ model: CANON })
  })

  it('resolves a canonical request against a path-spelled installed entry (legacy list)', async () => {
    listModels.mockResolvedValue([{ name: WIN_PATH }])
    const r = await resolveModelForInternalInference(CANON, [])
    expect(r).toEqual({ model: CANON })
  })

  it('rejects a stale Ollama tag that resolves to nothing installed', async () => {
    listModels.mockResolvedValue([{ name: CANON }])
    const r = await resolveModelForInternalInference('gemma4:12b-it-q8_0', [])
    expect(r).toEqual({ error: 'MODEL_UNAVAILABLE' })
  })

  it('returns canonical names even when active/installed are path-spelled', async () => {
    listModels.mockResolvedValue([{ name: WIN_PATH }])
    getEffectiveChatModelName.mockResolvedValue(WIN_PATH)
    const r = await resolveModelForInternalInference(undefined, [])
    expect(r).toEqual({ model: CANON })
  })
})
