/**
 * A1 regression: the Host inference handler resolves incoming model ids through the alias set
 * {full path, filename without .gguf, canonical name} against the LOADED model instead of strict
 * string equality. Unresolvable ids still fail with MODEL_UNAVAILABLE, but the error payload names
 * the Host's canonical active model so the Sandbox can correct its selection.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../email/inboxLlmChat', () => ({
  InboxLlmTimeoutError: class InboxLlmTimeoutError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'InboxLlmTimeoutError'
    }
  },
}))

const getEffectiveChatModelName = vi.hoisted(() => vi.fn())
vi.mock('../../llm/local-llm-manager', () => ({
  localLlmManager: {
    getEffectiveChatModelName: () => getEffectiveChatModelName(),
  },
}))

const runInference = vi.hoisted(() => vi.fn())
vi.mock('../../llm/internalHostInferenceLocal', () => ({
  runInternalHostOllamaInference: (...a: unknown[]) => runInference(...a),
}))

vi.mock('../dbAccess', () => ({
  getHandshakeDbForInternalInference: async () => null,
}))

vi.mock('../hostAiRemoteInferencePolicyResolve', () => ({
  resolveHostAiRemoteInferencePolicyBestEffort: () => ({ allowRemoteInference: true }),
}))

vi.mock('../hostInferencePolicyStore', () => ({
  getHostInternalInferencePolicy: () => ({
    modelAllowlist: [],
    timeoutMs: 5_000,
    maxOutputBytes: 1_000_000,
  }),
}))

vi.mock('../hostInferenceConcurrency', () => ({
  tryAcquireHostInferenceSlot: () => ({ ok: true, release: () => {} }),
}))

import { runHostInternalInference } from '../hostInferenceExecute'

const CANON = 'gemma-4-12B-it-Q4_K_M'
const WIN_PATH = `C:\\Users\\oscar\\.opengiraffe\\electron-data\\models\\${CANON}.gguf`

function ctxWithModel(model: string | undefined) {
  return {
    handshakeId: 'hs-test',
    requestId: 'req-1',
    modelRequested: model,
    messages: [{ role: 'user' as const, content: 'hi' }],
    options: undefined,
    peerDeviceId: 'peer-1',
    hostDeviceId: 'host-1',
  }
}

describe('runHostInternalInference — model alias gate (A1)', () => {
  beforeEach(() => {
    getEffectiveChatModelName.mockReset()
    runInference.mockReset()
    getEffectiveChatModelName.mockResolvedValue(CANON)
    runInference.mockResolvedValue({ text: 'ok', model: CANON, durationMs: 3 })
  })

  it('accepts the full GGUF path when the canonical model is loaded', async () => {
    const { wire } = await runHostInternalInference(ctxWithModel(WIN_PATH))
    expect(wire.type).toBe('internal_inference_result')
    // Executes with the canonical name, not the path spelling.
    expect(runInference).toHaveBeenCalledWith(expect.objectContaining({ requestedModel: CANON }))
  })

  it('accepts the filename spelling', async () => {
    const { wire } = await runHostInternalInference(ctxWithModel(`${CANON}.gguf`))
    expect(wire.type).toBe('internal_inference_result')
  })

  it('accepts the canonical name (baseline)', async () => {
    const { wire } = await runHostInternalInference(ctxWithModel(CANON))
    expect(wire.type).toBe('internal_inference_result')
  })

  it('accepts when the loaded model is path-spelled and the request is canonical', async () => {
    getEffectiveChatModelName.mockResolvedValue(WIN_PATH)
    const { wire } = await runHostInternalInference(ctxWithModel(CANON))
    expect(wire.type).toBe('internal_inference_result')
    expect(runInference).toHaveBeenCalledWith(expect.objectContaining({ requestedModel: CANON }))
  })

  it('rejects a stale Ollama tag with MODEL_UNAVAILABLE naming the canonical active model', async () => {
    const { wire } = await runHostInternalInference(ctxWithModel('gemma4:12b-it-q8_0'))
    expect(wire.type).toBe('internal_inference_error')
    if (wire.type !== 'internal_inference_error') throw new Error('unreachable')
    expect(wire.code).toBe('MODEL_UNAVAILABLE')
    expect(wire.message).toContain(`active=${CANON}`)
    expect(runInference).not.toHaveBeenCalled()
  })
})
