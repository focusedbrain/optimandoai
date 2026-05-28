import { describe, test, expect } from 'vitest'

import { SetupStateMachine } from '../src/setupState.js'

describe('SetupStateMachine', () => {
  test('rejects sub mismatch on initiate', () => {
    const sm = new SetupStateMachine()
    sm.onSignedIn()
    const code = sm.ensurePairingCode().code
    const result = sm.initiatePairing({
      pairingCode: code,
      orchestratorSub: 'user-a',
      orchestratorPublicKey: 'a'.repeat(64),
      orchestratorNonce: 'n-orch',
      agentSignedInSub: 'user-b',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('sub_mismatch')
  })

  test('consumes code on initiate', () => {
    const sm = new SetupStateMachine()
    sm.onSignedIn()
    const code = sm.ensurePairingCode().code
    const ok = sm.initiatePairing({
      pairingCode: code,
      orchestratorSub: 'user-a',
      orchestratorPublicKey: 'a'.repeat(64),
      orchestratorNonce: 'n-orch',
      agentSignedInSub: 'user-a',
    })
    expect(ok.ok).toBe(true)
    const retry = sm.initiatePairing({
      pairingCode: code,
      orchestratorSub: 'user-a',
      orchestratorPublicKey: 'b'.repeat(64),
      orchestratorNonce: 'n2',
      agentSignedInSub: 'user-a',
    })
    expect(retry.ok).toBe(false)
    if (!retry.ok) expect(retry.error).toBe('code_consumed')
  })

  test('rejects expired code', () => {
    const sm = new SetupStateMachine()
    sm.onSignedIn()
    const codeState = sm.ensurePairingCode()
    codeState.expiresAt = Date.now() - 1
    const result = sm.initiatePairing({
      pairingCode: codeState.code,
      orchestratorSub: 'u',
      orchestratorPublicKey: 'a'.repeat(64),
      orchestratorNonce: 'n',
      agentSignedInSub: 'u',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('code_expired')
  })

  test('requires both confirmations before persist ready', () => {
    const sm = new SetupStateMachine()
    sm.onSignedIn()
    const code = sm.ensurePairingCode().code
    const started = sm.initiatePairing({
      pairingCode: code,
      orchestratorSub: 'u',
      orchestratorPublicKey: 'c'.repeat(64),
      orchestratorNonce: 'no',
      agentSignedInSub: 'u',
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(sm.isSessionReadyToPersist()).toBe(false)
    sm.confirmAgentUi(started.session.sessionId)
    expect(sm.isSessionReadyToPersist()).toBe(false)
    sm.confirmOrchestrator(started.session.sessionId)
    expect(sm.isSessionReadyToPersist()).toBe(true)
  })
})
