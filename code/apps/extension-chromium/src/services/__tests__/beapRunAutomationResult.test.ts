import { describe, it, expect } from 'vitest'
import {
  interpretBeapAutomationModeRun,
  BEAP_AUTOMATION_NO_MODE_TRIGGER_MSG,
} from '../beapRunAutomationResult'

describe('interpretBeapAutomationModeRun', () => {
  it('fails when no mode-run matches', () => {
    const r = interpretBeapAutomationModeRun('session_1', { matches: [], executions: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.phase).toBe('mode_run')
      expect(r.error).toBe(BEAP_AUTOMATION_NO_MODE_TRIGGER_MSG)
    }
  })

  it('fails when matches exist but every execution fails', () => {
    const r = interpretBeapAutomationModeRun('session_1', {
      matches: { length: 2 },
      executions: [
        { success: false, agentName: 'A', error: 'LLM down' },
        { success: false, agentName: 'B', error: 'timeout' },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('A:')
      expect(r.error).toContain('B:')
    }
  })

  it('succeeds when at least one execution succeeds', () => {
    const r = interpretBeapAutomationModeRun('session_1', {
      matches: { length: 2 },
      executions: [
        { success: true, agentName: 'Good' },
        { success: false, agentName: 'Bad', error: 'x' },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.executed).toEqual(['Good'])
      expect(r.failures?.length).toBe(1)
    }
  })
})
