import { describe, it, expect, vi } from 'vitest'
import {
  inboxCloneRequiresInnerVault,
  inboxSealKeySourceRequiresInnerVault,
  isDepackagedEmailInboxSourceType,
  probeInboxMessageCloneVaultRequirement,
} from '../beapInboxClonePrepare'

// Fixture premise: the handshakes under test are non-confidential. Since roadmap 0.16 an
// unreadable classification (no ledger in this harness) reads as confidential, so state it.
vi.mock('../../handshake/handshakeConfidentiality', async (io) => {
  const mod = await io<typeof import('../../handshake/handshakeConfidentiality')>()
  return { ...mod, getHandshakeClassification: () => 'non_confidential' as const }
})

describe('inbox clone vault requirement', () => {
  it('depackaged email source types never require inner vault', () => {
    expect(isDepackagedEmailInboxSourceType('email_plain')).toBe(true)
    expect(isDepackagedEmailInboxSourceType('email_beap')).toBe(true)
    expect(isDepackagedEmailInboxSourceType('direct_beap')).toBe(false)
    expect(
      inboxCloneRequiresInnerVault({ sourceType: 'email_plain', handshakeId: 'hs-1' }),
    ).toBe(false)
    expect(
      inboxCloneRequiresInnerVault({ sourceType: 'email_beap', handshakeId: 'hs-1' }),
    ).toBe(false)
  })

  it('native direct_beap on non-confidential handshake does not require inner (W4-P11)', () => {
    expect(
      inboxCloneRequiresInnerVault({ sourceType: 'direct_beap', handshakeId: 'hs-1' }),
    ).toBe(false)
  })

  it('vmk seal key source always requires inner vault', () => {
    expect(inboxSealKeySourceRequiresInnerVault('vmk')).toBe(true)
    expect(inboxSealKeySourceRequiresInnerVault('ledger')).toBe(false)
    expect(inboxSealKeySourceRequiresInnerVault(null)).toBe(false)
  })

  it('probeInboxMessageCloneVaultRequirement marks email_plain as outer-only', () => {
    const db = {
      prepare: () => ({
        get: () => ({
          source_type: 'email_plain',
          handshake_id: 'hs-x',
          seal_key_source: 'vmk',
        }),
      }),
    }
    const p = probeInboxMessageCloneVaultRequirement(db, 'msg-1')
    expect(p?.requiresInnerVault).toBe(false)
    expect(p?.isDepackagedEmail).toBe(true)
    expect(p?.sealKeySource).toBe('vmk')
  })
})
