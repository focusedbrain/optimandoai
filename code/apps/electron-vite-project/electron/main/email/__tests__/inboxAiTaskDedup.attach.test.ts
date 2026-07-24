import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/wrdesk-inbox-ai-task-attach',
    getAppPath: () => '/tmp/wrdesk-inbox-ai-task-attach',
  },
}))

vi.mock('../inboxLlmChat', () => ({
  resolveInboxLlmSettings: () => ({ provider: 'openai' }),
}))

vi.mock('../../inference/inferenceGate', () => ({
  assertGpuInferenceAvailable: vi.fn(),
  InferenceUnavailableError: class InferenceUnavailableError extends Error {},
}))

import {
  initAnalysisStreamReplay,
  appendAnalysisStreamReplayChunk,
  markAnalysisStreamReplayDone,
  runInboxAiTaskWithDedup,
  tryAttachManualInboxAnalysisToRunningAuto,
} from '../inboxAiTaskDedup'

describe('tryAttachManualInboxAnalysisToRunningAuto', () => {
  it('attaches manual invoke to a running auto task and replays buffered stream', async () => {
    const taskKey = `analysis-stream:msg-attach:llama:cloud:${Date.now()}`
    const messageId = 'msg-attach'
    const prefix = `analysis-stream:${messageId}:`
    let releaseRun!: () => void
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve
    })

    const sent: Array<{ channel: string; payload: Record<string, unknown> }> = []
    const send = (channel: string, payload: Record<string, unknown>) => {
      sent.push({ channel, payload })
    }

    const autoPromise = runInboxAiTaskWithDedup(
      taskKey,
      {
        supersedeKeyPrefix: prefix,
        messageId,
        manual: false,
      },
      async (requestId) => {
        initAnalysisStreamReplay(taskKey, messageId, requestId)
        appendAnalysisStreamReplayChunk(taskKey, '{"summary":')
        await runGate
        appendAnalysisStreamReplayChunk(taskKey, '"done"}')
        markAnalysisStreamReplayDone(taskKey)
        return { started: true }
      },
    )

    await new Promise((r) => setTimeout(r, 0))

    const attachPromise = tryAttachManualInboxAnalysisToRunningAuto(taskKey, send)
    expect(attachPromise).not.toBeNull()

    releaseRun()
    const attached = await attachPromise
    await autoPromise

    expect(attached).toMatchObject({ attachedToAuto: true, started: true })
    expect(sent.some((s) => s.channel === 'inbox:aiAnalyzeMessageChunk')).toBe(true)
    expect(sent.some((s) => s.channel === 'inbox:aiAnalyzeMessageDone')).toBe(true)
  })

  it('returns null when no auto task is running', async () => {
    const taskKey = `analysis-stream:msg-idle:llama:cloud:${Date.now()}`
    const attached = await tryAttachManualInboxAnalysisToRunningAuto(taskKey, () => {})
    expect(attached).toBeNull()
  })
})
