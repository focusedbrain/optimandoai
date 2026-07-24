import { describe, expect, it } from 'vitest'
import {
  globalSessionContextStorageKeys,
  normalizeOrchestratorSessionKey,
  resolveOrchestratorSessionKeyForInference,
} from '../resolveOrchestratorSessionKey'

describe('normalizeOrchestratorSessionKey', () => {
  it('accepts session_* and archive_session_* ids', () => {
    expect(normalizeOrchestratorSessionKey('session_123')).toBe('session_123')
    expect(normalizeOrchestratorSessionKey(' archive_session_9 ')).toBe('archive_session_9')
  })

  it('rejects empty, fallback, and non-orchestrator ids', () => {
    expect(normalizeOrchestratorSessionKey('')).toBeNull()
    expect(normalizeOrchestratorSessionKey('session_fallback')).toBeNull()
    expect(normalizeOrchestratorSessionKey('tab-42')).toBeNull()
    expect(normalizeOrchestratorSessionKey(null)).toBeNull()
  })
})

describe('globalSessionContextStorageKeys', () => {
  it('builds user and publisher keys from session id', () => {
    expect(globalSessionContextStorageKeys('session_abc')).toEqual({
      userContextKey: 'user_context_session_abc',
      publisherContextKey: 'publisher_context_session_abc',
      accountContextKey: 'optimando_account_context',
    })
  })
})

describe('resolveOrchestratorSessionKeyForInference', () => {
  it('prefers mode sessionId when mode is active', () => {
    expect(
      resolveOrchestratorSessionKeyForInference({
        modeSessionId: 'session_mode',
        modeIsActive: true,
        sidepanelSessionKey: 'session_side',
      }),
    ).toBe('session_mode')
  })

  it('falls through to sidepanel when mode has no sessionId', () => {
    expect(
      resolveOrchestratorSessionKeyForInference({
        modeSessionId: null,
        modeIsActive: true,
        sidepanelSessionKey: 'session_side',
      }),
    ).toBe('session_side')
  })

  it('ignores mode sessionId when mode is not active', () => {
    expect(
      resolveOrchestratorSessionKeyForInference({
        modeSessionId: 'session_mode',
        modeIsActive: false,
        sidepanelSessionKey: 'session_side',
      }),
    ).toBe('session_side')
  })

  it('uses explicit session key after sidepanel', () => {
    expect(
      resolveOrchestratorSessionKeyForInference({
        modeIsActive: false,
        sidepanelSessionKey: '',
        explicitSessionKey: 'session_explicit',
      }),
    ).toBe('session_explicit')
  })

  it('returns null when no valid key in sync path', () => {
    expect(resolveOrchestratorSessionKeyForInference({})).toBeNull()
  })
})
