/**
 * Tests: canPerform() maps vault/key-provider/validator state to the
 * correct CapabilityResult.
 *
 * W4-P11 update: the broker is now classification-aware.
 *   Non-confidential (default, no ctx): checks outer key only.
 *   Confidential (ctx with handshakeId whose classification is confidential):
 *     checks inner vault + inner key + validator.
 *
 * All modules are fully stubbed — no real vault, DB, or subprocess needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VaultStatusReport } from './vaultCanon'
import type { HandshakeClassification } from './vaultCanon'

// ---------------------------------------------------------------------------
// Stubs — set per-test via the mutable `state` object
// ---------------------------------------------------------------------------

const state = {
  outerActive: true,
  innerUnlocked: true,
  innerKeyProviderBound: true,
  outerKeyProviderBound: true,
  validatorRunning: true,
  handshakeClassification: 'non_confidential' as HandshakeClassification,
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
  getHandshakeClassification: (_id: string) => state.handshakeClassification,
}))

vi.mock('../sealed-storage', () => ({
  isKeyProviderBound: (source = 'inner') =>
    source === 'outer' ? state.outerKeyProviderBound : state.innerKeyProviderBound,
}))

vi.mock('../validation/inProcessValidator', () => ({
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
  state.innerKeyProviderBound = true
  state.outerKeyProviderBound = true
  state.validatorRunning = true
  state.handshakeClassification = 'non_confidential'
}

// ---------------------------------------------------------------------------
// Non-confidential path (default — no ctx, all beap_* ops)
// ---------------------------------------------------------------------------

describe('canPerform — non-confidential beap_send (outer path, no ctx)', () => {
  beforeEach(allReady)

  it('outer_vault_inactive when outer inactive regardless of everything else', () => {
    state.outerActive = false
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.outerKeyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_send')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('outer_vault_inactive')
  })

  it('key_provider_unbound when outer active but outer key not bound (inner locked)', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.outerKeyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_send')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('key_provider_unbound')
  })

  it('key_provider_unbound when outer+inner ready but outer key not bound', () => {
    state.outerKeyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_send')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('key_provider_unbound')
  })

  it('ok when outer key is bound, even when inner locked and validator stopped', () => {
    // Non-confidential: inner vault and validator are NOT required.
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_send')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })

  it('ok when all conditions met for beap_send', () => {
    const r = canPerform('beap_send')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })
})

describe('canPerform — non-confidential beap_receive (outer path, no ctx)', () => {
  beforeEach(allReady)

  it('key_provider_unbound when outer key not bound (inner locked)', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.outerKeyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_receive')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('key_provider_unbound')
  })

  it('ok for beap_receive with only outer vault (SSO-only)', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_receive')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })

  it('ok for beap_receive when all ready', () => {
    const r = canPerform('beap_receive')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })
})

describe('canPerform — non-confidential beap_clone (outer path, no ctx)', () => {
  beforeEach(allReady)

  it('key_provider_unbound for beap_clone when outer key not bound', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.outerKeyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_clone')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('key_provider_unbound')
  })

  it('ok for beap_clone with only outer vault (SSO-only)', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_clone')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })

  it('ok for beap_clone when all ready', () => {
    const r = canPerform('beap_clone')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// Classification-aware: W4-P11 matrix (Table from prompt)
// ---------------------------------------------------------------------------

describe('canPerform — W4-P11 classification matrix (beap_send with ctx)', () => {
  beforeEach(allReady)

  const CONF_CTX = { handshakeId: 'hs-confidential' }
  const NC_CTX = { handshakeId: 'hs-non-confidential' }

  // Non-confidential: inner locked, outer key bound → ok
  it('ok for beap_send non_confidential when inner locked but outer key bound', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.handshakeClassification = 'non_confidential'
    const r = canPerform('beap_send', NC_CTX)
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })

  // Confidential: inner locked → inner_vault_locked
  it('inner_vault_locked for beap_send confidential when inner locked', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.outerKeyProviderBound = true
    state.handshakeClassification = 'confidential'
    const r = canPerform('beap_send', CONF_CTX)
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('inner_vault_locked')
  })

  // Non-confidential: outer key unbound → key_provider_unbound
  it('key_provider_unbound for beap_send non_confidential when outer key not bound', () => {
    state.innerUnlocked = false
    state.outerKeyProviderBound = false
    state.handshakeClassification = 'non_confidential'
    const r = canPerform('beap_send', NC_CTX)
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('key_provider_unbound')
  })

  // Both vaults unlocked + non_confidential → ok
  it('ok for beap_send non_confidential when all ready', () => {
    state.handshakeClassification = 'non_confidential'
    const r = canPerform('beap_send', NC_CTX)
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })

  // Both vaults unlocked + confidential → ok
  it('ok for beap_send confidential when all ready', () => {
    state.handshakeClassification = 'confidential'
    const r = canPerform('beap_send', CONF_CTX)
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })

  // Confidential: inner key unbound → key_provider_unbound
  it('key_provider_unbound for beap_send confidential when inner key not bound', () => {
    state.innerKeyProviderBound = false
    state.validatorRunning = false
    state.handshakeClassification = 'confidential'
    const r = canPerform('beap_send', CONF_CTX)
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('key_provider_unbound')
  })

  // Confidential: inner key bound but validator stopped → validator_unhealthy
  it('validator_unhealthy for beap_send confidential when validator stopped', () => {
    state.validatorRunning = false
    state.handshakeClassification = 'confidential'
    const r = canPerform('beap_send', CONF_CTX)
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('validator_unhealthy')
  })

  // Same patterns for beap_receive
  it('ok for beap_receive non_confidential with only outer vault', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.validatorRunning = false
    state.handshakeClassification = 'non_confidential'
    const r = canPerform('beap_receive', NC_CTX)
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })

  it('inner_vault_locked for beap_receive confidential when inner locked', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.handshakeClassification = 'confidential'
    const r = canPerform('beap_receive', CONF_CTX)
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('inner_vault_locked')
  })

  // Same patterns for beap_clone
  it('ok for beap_clone non_confidential with only outer vault', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.validatorRunning = false
    state.handshakeClassification = 'non_confidential'
    const r = canPerform('beap_clone', NC_CTX)
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })

  it('inner_vault_locked for beap_clone confidential when inner locked', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.handshakeClassification = 'confidential'
    const r = canPerform('beap_clone', CONF_CTX)
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('inner_vault_locked')
  })
})

// ---------------------------------------------------------------------------
// context_sync (unchanged from W2-P5)
// ---------------------------------------------------------------------------

describe('canPerform — context_sync', () => {
  beforeEach(allReady)

  it('inner_vault_locked for context_sync when inner locked', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('context_sync')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('inner_vault_locked')
  })

  it('ok for context_sync when outer+inner ready, even if key/validator not ready', () => {
    state.innerKeyProviderBound = false
    state.outerKeyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('context_sync')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// beap_receive_confidential / inbox_read_confidential (always-inner)
// ---------------------------------------------------------------------------

describe('canPerform — beap_receive_confidential (always inner)', () => {
  beforeEach(allReady)

  it('inner_vault_locked when inner locked', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('beap_receive_confidential')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('inner_vault_locked')
  })

  it('ok when all ready', () => {
    const r = canPerform('beap_receive_confidential')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })
})

describe('canPerform — inbox_read_confidential (always inner)', () => {
  beforeEach(allReady)

  it('inner_vault_locked when inner locked', () => {
    state.innerUnlocked = false
    state.innerKeyProviderBound = false
    state.validatorRunning = false
    const r = canPerform('inbox_read_confidential')
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('inner_vault_locked')
  })

  it('ok when all ready', () => {
    const r = canPerform('inbox_read_confidential')
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// Outer vault takes priority over all other state
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// retryStrategy values
// ---------------------------------------------------------------------------

describe('canPerform — retryStrategy values', () => {
  beforeEach(allReady)

  it('outer_vault_inactive has retryStrategy=user_action', () => {
    state.outerActive = false
    expect(canPerform('beap_send').retryStrategy).toBe('user_action')
  })

  it('non-confidential key_provider_unbound has retryStrategy=transient', () => {
    state.outerKeyProviderBound = false
    expect(canPerform('beap_send').retryStrategy).toBe('transient')
  })

  it('confidential inner_vault_locked has retryStrategy=auto_on_unlock', () => {
    state.handshakeClassification = 'confidential'
    state.innerUnlocked = false
    expect(canPerform('beap_send', { handshakeId: 'hs-conf' }).retryStrategy).toBe('auto_on_unlock')
  })

  it('context_sync inner_vault_locked has retryStrategy=auto_on_unlock', () => {
    state.innerUnlocked = false
    expect(canPerform('context_sync').retryStrategy).toBe('auto_on_unlock')
  })
})

// ---------------------------------------------------------------------------
// ok result shape
// ---------------------------------------------------------------------------

describe('canPerform — ok result shape', () => {
  beforeEach(allReady)

  it('ok result has allowed=true, empty userMessage, reasonCode=ok', () => {
    const r = canPerform('beap_send')
    expect(r).toEqual({
      allowed: true,
      reasonCode: 'ok',
      userMessage: '',
      retryStrategy: 'transient',
    })
  })
})
