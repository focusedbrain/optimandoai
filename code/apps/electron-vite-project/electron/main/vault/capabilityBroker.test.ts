/**
 * Tests: canPerform() maps vault/key-provider/validator state to the
 * correct CapabilityResult.
 *
 * All 16 required scenarios from W2-P5 are covered, plus edge cases.
 * Modules are fully stubbed so no real vault, DB, or subprocess is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VaultStatusReport } from './vaultCanon'

// ---------------------------------------------------------------------------
// Stubs — set per-test via the mutable `state` object
// ---------------------------------------------------------------------------

const state = {
  outerActive: true,
  innerUnlocked: true,
  keyProviderBound: true,
  validatorRunning: true,
}

function makeReport(): VaultStatusReport {
  const hints: string[] = []
  if (!state.outerActive) hints.push('outer_inactive')
  if (!state.innerUnlocked) hints.push('inner_locked')
  return {
    outerActive: state.outerActive,
    innerUnlocked: state.innerUnlocked,
    reasonHints: hints,
  }
}

vi.mock('./vaultCanon', () => ({
  getVaultStatusReport: () => makeReport(),
  isOuterVaultActive: () => state.outerActive,
  isInnerVaultUnlocked: () => state.innerUnlocked,
  getOuterVaultDb: () => null,
  getInnerVaultDb: () => null,
}))

vi.mock('../sealed-storage', () => ({
  isKeyProviderBound: () => state.keyProviderBound,
}))

vi.mock('../validator-process/orchestrator', () => ({
  validatorOrchestrator: {
    getLiveness: () => (state.validatorRunning ? 'running' : 'dead'),
  },
}))

// Import after mocks are registered
import { canPerform } from './capabilityBroker'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allReady() {
  state.outerActive = true
  state.innerUnlocked = true
  state.keyProviderBound = true
  state.validatorRunning = true
}

// ---------------------------------------------------------------------------
// Required scenario matrix
// ---------------------------------------------------------------------------

describe('canPerform — beap_send priority order (tests 1–5)', () => {
  beforeEach(allReady)

  // Row 1
  it("returns outer_vault_inactive when outer inactive, inner locked, key unbound, validator stopped", () => {
    state.outerActive = false
    state.innerUnlocked = false
    state.keyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_send')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('outer_vault_inactive')
  })

  // Row 2
  it("returns inner_vault_locked when outer active but inner locked", () => {
    state.innerUnlocked = false
    state.keyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_send')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('inner_vault_locked')
  })

  // Row 3
  it("returns key_provider_unbound when outer+inner ready but key provider not bound", () => {
    state.keyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_send')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('key_provider_unbound')
  })

  // Row 4
  it("returns validator_unhealthy when outer+inner+key ready but validator stopped", () => {
    state.validatorRunning = false
    const r = canPerform('beap_send')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('validator_unhealthy')
  })

  // Row 5
  it("returns ok when all conditions met for beap_send", () => {
    const r = canPerform('beap_send')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })
})

describe('canPerform — beap_receive (tests 6–7)', () => {
  beforeEach(allReady)

  // Row 6
  it("returns inner_vault_locked for beap_receive when inner locked", () => {
    state.innerUnlocked = false
    state.keyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_receive')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('inner_vault_locked')
  })

  // Row 7
  it("returns ok for beap_receive when all ready", () => {
    const r = canPerform('beap_receive')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })
})

describe('canPerform — beap_clone (tests 8–9)', () => {
  beforeEach(allReady)

  // Row 8
  it("returns inner_vault_locked for beap_clone when inner locked", () => {
    state.innerUnlocked = false
    state.keyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_clone')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('inner_vault_locked')
  })

  // Row 9
  it("returns ok for beap_clone when all ready", () => {
    const r = canPerform('beap_clone')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })
})

describe('canPerform — context_sync (tests 10–11)', () => {
  beforeEach(allReady)

  // Row 10
  it("returns inner_vault_locked for context_sync when inner locked", () => {
    state.innerUnlocked = false
    state.keyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('context_sync')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('inner_vault_locked')
  })

  // Row 11: context_sync does NOT require key provider or validator
  it("returns ok for context_sync when outer+inner ready, even if key/validator not ready", () => {
    state.keyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('context_sync')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })
})

describe('canPerform — beap_receive_confidential (tests 12–13)', () => {
  beforeEach(allReady)

  // Row 12
  it("returns inner_vault_locked for beap_receive_confidential when inner locked", () => {
    state.innerUnlocked = false
    state.keyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_receive_confidential')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('inner_vault_locked')
  })

  // Row 13
  it("returns ok for beap_receive_confidential when all ready", () => {
    const r = canPerform('beap_receive_confidential')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })
})

describe('canPerform — inbox_read_confidential (tests 14–15)', () => {
  beforeEach(allReady)

  // Row 14
  it("returns inner_vault_locked for inbox_read_confidential when inner locked", () => {
    state.innerUnlocked = false
    state.keyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('inbox_read_confidential')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('inner_vault_locked')
  })

  // Row 15
  it("returns ok for inbox_read_confidential when all ready", () => {
    const r = canPerform('inbox_read_confidential')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })
})

describe('canPerform — outer vault takes priority over all other state (test 16)', () => {
  beforeEach(allReady)

  // Row 16: outer inactive even though inner/key/validator are all ready
  it("returns outer_vault_inactive for beap_send when outer inactive despite everything else ready", () => {
    state.outerActive = false
    const r = canPerform('beap_send')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('outer_vault_inactive')
  })
})

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe('canPerform — retryStrategy values', () => {
  beforeEach(allReady)

  it("outer_vault_inactive has retryStrategy=user_action", () => {
    state.outerActive = false
    expect(canPerform('beap_send').retryStrategy).toBe('user_action')
  })

  it("inner_vault_locked has retryStrategy=auto_on_unlock", () => {
    state.innerUnlocked = false
    expect(canPerform('beap_send').retryStrategy).toBe('auto_on_unlock')
  })

  it("key_provider_unbound has retryStrategy=transient", () => {
    state.keyProviderBound = false
    state.validatorRunning = false
    expect(canPerform('beap_send').retryStrategy).toBe('transient')
  })

  it("validator_unhealthy has retryStrategy=transient", () => {
    state.validatorRunning = false
    expect(canPerform('beap_send').retryStrategy).toBe('transient')
  })

  it("context_sync inner_vault_locked has retryStrategy=auto_on_unlock", () => {
    state.innerUnlocked = false
    expect(canPerform('context_sync').retryStrategy).toBe('auto_on_unlock')
  })
})

describe('canPerform — outer inactive applies to all operations', () => {
  beforeEach(() => {
    allReady()
    state.outerActive = false
  })

  const ops = [
    'beap_send', 'beap_receive', 'beap_clone',
    'beap_receive_confidential', 'context_sync', 'inbox_read_confidential',
  ] as const

  for (const op of ops) {
    it(`returns outer_vault_inactive for ${op}`, () => {
      const r = canPerform(op)
      expect(r.allowed).toBe(false)
      expect(r.reasonCode).toBe('outer_vault_inactive')
    })
  }
})

describe('canPerform — ok result shape', () => {
  beforeEach(allReady)

  it("ok result has allowed=true, empty userMessage, reasonCode=ok", () => {
    const r = canPerform('beap_send')
    expect(r).toEqual({
      allowed: true,
      reasonCode: 'ok',
      userMessage: '',
      retryStrategy: 'transient',
    })
  })
})
