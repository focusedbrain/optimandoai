import { describe, expect, it } from 'vitest'
import {
  isOrchestratorKvSessionKey,
  kvBlobToOrchestratorSession,
  resolveOrchestratorSessionDisplayName,
} from '../sessionKeyUtils'

describe('sessionKeyUtils', () => {
  it('accepts canonical session KV keys only', () => {
    expect(isOrchestratorKvSessionKey('session_1775237973387')).toBe(true)
    expect(isOrchestratorKvSessionKey('archive_session_abc')).toBe(true)
    expect(isOrchestratorKvSessionKey('beap-import-foo')).toBe(false)
    expect(isOrchestratorKvSessionKey('settings_foo')).toBe(false)
    expect(isOrchestratorKvSessionKey('')).toBe(false)
  })

  it('maps KV blob to Session with agents on config', () => {
    const kv = {
      sessionAlias: 'Optimando3',
      agents: [{ id: 'a1', name: 'agent1' }],
      agentBoxes: [{ id: 'b1' }],
      displayGrids: [{ layout: '10-slot' }],
      timestamp: '2026-05-03T17:18:40.000Z',
    }
    const session = kvBlobToOrchestratorSession('session_1775237973387', kv)
    expect(session.id).toBe('session_1775237973387')
    expect(session.name).toBe('Optimando3')
    expect(session.config.agents).toHaveLength(1)
    expect(session.config.agentBoxes).toHaveLength(1)
  })

  it('resolves display name with archive prefix', () => {
    const name = resolveOrchestratorSessionDisplayName('archive_session_x', { tabName: 'Old' })
    expect(name).toBe('Archived: Old')
  })
})
