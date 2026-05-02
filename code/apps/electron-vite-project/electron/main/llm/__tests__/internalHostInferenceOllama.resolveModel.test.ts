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

vi.mock('../ollama-manager', () => ({
  ollamaManager: {
    listModels: () => listModels(),
    getEffectiveChatModelName: () => getEffectiveChatModelName(),
  },
}))

import { resolveModelForInternalInference } from '../internalHostInferenceOllama'

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
