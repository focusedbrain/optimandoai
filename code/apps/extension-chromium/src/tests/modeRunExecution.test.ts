import { describe, it, expect, vi, afterEach } from 'vitest'
import * as processFlow from '../services/processFlow'
import { executeModeRunAgents } from '../services/modeRunExecution'

describe('executeModeRunAgents', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not call fetch when mode-run matching yields no agents', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.spyOn(processFlow, 'loadAgentsFromSession').mockResolvedValue([])
    vi.spyOn(processFlow, 'loadAgentBoxesFromSession').mockResolvedValue([])

    const r = await executeModeRunAgents({
      modeLinkedSessionId: 'session-a',
      currentOrchestratorSessionId: 'session-a',
      fallbackModel: 'tinyllama',
      getFetchHeaders: async () => ({ 'Content-Type': 'application/json' }),
    })

    expect(r.matches).toEqual([])
    expect(r.executions).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
