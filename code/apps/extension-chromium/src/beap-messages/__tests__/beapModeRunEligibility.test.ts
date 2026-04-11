import { describe, it, expect } from 'vitest'
import { matchAgentsForModeRun, type AgentConfig } from '../../services/processFlow'

function baseAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-test',
    name: 'Test Agent',
    icon: '\u{1F916}',
    enabled: true,
    ...overrides,
  }
}

describe('BEAP Run — mode_trigger eligibility via matchAgentsForModeRun', () => {
  const sessionId = 'linked-session-1'

  it('does not match when the only mode_trigger row is disabled', () => {
    const agents = [
      baseAgent({
        listening: {
          unifiedTriggers: [{ id: 't1', type: 'mode_trigger', enabled: false }],
        },
      }),
    ]
    expect(matchAgentsForModeRun(agents, [], sessionId, sessionId)).toHaveLength(0)
  })

  it('matches when mode_trigger is enabled and session ids align', () => {
    const agents = [
      baseAgent({
        listening: {
          unifiedTriggers: [{ id: 't1', type: 'mode_trigger', enabled: true }],
        },
      }),
    ]
    expect(matchAgentsForModeRun(agents, [], sessionId, sessionId).length).toBeGreaterThan(0)
  })
})
