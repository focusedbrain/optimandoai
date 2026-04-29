/**
 * Regression: inbox analyze NDJSON stream uses LAN execCtx.baseUrl on effective sandbox (never implicit localhost fallback).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiExecutionContext } from '../../llm/aiExecutionTypes'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/wrdesk-inbox-stream-sandbox-regression',
    getAppPath: () => '/tmp/wrdesk-inbox-stream-sandbox-regression',
  },
}))

const effSandboxMock = vi.fn(async () => true)

vi.mock('../../llm/resolveAiExecutionContext', () => ({
  isEffectiveSandboxSideForAiExecution: () => effSandboxMock(),
}))

describe('streamInboxOllamaAnalyzeWithSandboxRouting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    effSandboxMock.mockResolvedValue(true)
  })

  it('posts to execCtx.baseUrl/api/chat when lane=ollama_direct and ollamaDirectReady', async () => {
    const captured: string[] = []
    const prevFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      captured.push(typeof input === 'string' ? input : input instanceof URL ? input.href : String(input))
      return {
        ok: true,
        body: {
          getReader() {
            return {
              async read() {
                return { done: true as const, value: undefined }
              },
            }
          },
        },
      } as unknown as Response
    })

    const { streamInboxOllamaAnalyzeWithSandboxRouting } = await import('../inboxOllamaChatStreamSandbox')

    const execCtx: AiExecutionContext = {
      lane: 'ollama_direct',
      model: 'gemma3:12b',
      handshakeId: 'hs-1',
      peerDeviceId: 'host-1',
      baseUrl: 'http://192.168.178.28:11434',
      beapReady: false,
      ollamaDirectReady: true,
    }

    try {
      for await (const _ of streamInboxOllamaAnalyzeWithSandboxRouting('sys', 'user', 'gemma3:12b', execCtx, {
        kind: 'analysis',
      })) {
        /* drain */
      }
    } finally {
      globalThis.fetch = prevFetch
    }

    expect(captured.length).toBeGreaterThanOrEqual(1)
    expect(captured[0]).toBe('http://192.168.178.28:11434/api/chat')
    expect(captured.some((u) => u.includes('127.0.0.1'))).toBe(false)
  })
})
