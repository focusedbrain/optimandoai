import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/wrdesk-inbox-ai-task-replay',
    getAppPath: () => '/tmp/wrdesk-inbox-ai-task-replay',
  },
}))

import {
  appendAnalysisStreamReplayChunk,
  clearAnalysisStreamReplayPrefix,
  initAnalysisStreamReplay,
  markAnalysisStreamReplayDone,
  replayAnalysisStreamState,
} from '../inboxAiTaskDedup'

describe('analysis stream replay state', () => {
  it('replays buffered chunks and done to a remounted listener', () => {
    const taskKey = `analysis-stream:msg-replay:llama3.1:8b:ollama_direct:${Date.now()}`
    const sent: Array<{ channel: string; payload: Record<string, unknown> }> = []

    clearAnalysisStreamReplayPrefix('analysis-stream:msg-replay:')
    initAnalysisStreamReplay(taskKey, 'msg-replay', 'req-1')
    appendAnalysisStreamReplayChunk(taskKey, '{"summary":')
    appendAnalysisStreamReplayChunk(taskKey, '"ok"}')
    markAnalysisStreamReplayDone(taskKey)

    const terminal = replayAnalysisStreamState(taskKey, (channel, payload) => {
      sent.push({ channel, payload })
    })

    expect(terminal).toBe('done')
    expect(sent).toEqual([
      { channel: 'inbox:aiAnalyzeMessageChunk', payload: { messageId: 'msg-replay', chunk: '{"summary":' } },
      { channel: 'inbox:aiAnalyzeMessageChunk', payload: { messageId: 'msg-replay', chunk: '"ok"}' } },
      { channel: 'inbox:aiAnalyzeMessageDone', payload: { messageId: 'msg-replay' } },
    ])
  })
})
