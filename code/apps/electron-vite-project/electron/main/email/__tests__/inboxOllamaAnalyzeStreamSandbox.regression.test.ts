/**
 * Regression: inbox analyze SSE stream posts to loopback /v1/chat/completions on host-only execution.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/wrdesk-inbox-stream-sandbox-regression',
    getAppPath: () => '/tmp/wrdesk-inbox-stream-sandbox-regression',
  },
}))

const effSandboxMock = vi.fn(async () => false)

vi.mock('../../llm/resolveAiExecutionContext', () => ({
  isEffectiveSandboxSideForAiExecution: () => effSandboxMock(),
}))

vi.mock('../../inference/inferenceGate', () => ({
  assertGpuInferenceAvailable: vi.fn(async () => undefined),
  assertGpuInferenceAvailableForRemoteOllama: vi.fn(async () => undefined),
  isLikelyLoopbackOrigin: vi.fn(() => true),
}))

vi.mock('../../llm/aiExecutionContextStore', () => ({
  readStoredAiExecutionContext: vi.fn(() => null),
}))

vi.mock('../../internalInference/chatWithContextRagOllamaGeneration', () => ({
  InferenceRoutingUnavailableError: class InferenceRoutingUnavailableError extends Error {
    constructor(code?: string, detail?: string) {
      super(detail ?? code ?? 'routing_unavailable')
      this.name = 'InferenceRoutingUnavailableError'
    }
  },
  logSandboxInferenceSend: vi.fn(),
}))

vi.mock('../../internalInference/resolveSandboxInferenceTarget', () => ({
  resolveSandboxInferenceTarget: vi.fn(),
}))

vi.mock('../inboxLlmChat', () => ({
  INBOX_LLM_TIMEOUT_MS: 45_000,
}))

vi.mock('../../llm/localLlmPaths', () => ({
  HOST_AI_DEFAULT_LOCAL_LLAMACPP_BASE: 'http://127.0.0.1:8080',
}))

describe('streamInboxOllamaAnalyzeWithSandboxRouting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    effSandboxMock.mockResolvedValue(false)
  })

  it('posts OpenAI SSE to loopback /v1/chat/completions on host-only path', async () => {
    const capturedUrls: string[] = []
    let capturedBody: Record<string, unknown> | null = null
    const ssePayload =
      'data: {"choices":[{"delta":{"content":"{\\"needsReply\\":"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"false}"}}]}\n\n' +
      'data: [DONE]\n\n'
    const encoder = new TextEncoder()
    const sseBytes = encoder.encode(ssePayload)
    let readOffset = 0

    const prevFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : String(input))
      if (init?.body && typeof init.body === 'string') {
        capturedBody = JSON.parse(init.body) as Record<string, unknown>
      }
      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              async read() {
                if (readOffset >= sseBytes.length) {
                  return { done: true as const, value: undefined }
                }
                const value = sseBytes.subarray(readOffset)
                readOffset = sseBytes.length
                return { done: false as const, value }
              },
            }
          },
        },
      } as unknown as Response
    })

    const { streamInboxOllamaAnalyzeWithSandboxRouting } = await import('../inboxOllamaChatStreamSandbox')

    const chunks: string[] = []
    try {
      for await (const chunk of streamInboxOllamaAnalyzeWithSandboxRouting('sys', 'user', 'gemma3:12b', null, {
        kind: 'analysis',
      })) {
        chunks.push(chunk)
      }
    } finally {
      globalThis.fetch = prevFetch
    }

    expect(capturedUrls.length).toBeGreaterThanOrEqual(1)
    expect(capturedUrls[0]).toBe('http://127.0.0.1:8080/v1/chat/completions')
    expect(capturedBody).toMatchObject({
      model: 'gemma3:12b',
      stream: true,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'user' },
      ],
    })
    expect(chunks.join('')).toBe('{"needsReply":false}')
  })
})
