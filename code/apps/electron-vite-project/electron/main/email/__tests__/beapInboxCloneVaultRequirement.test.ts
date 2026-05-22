import { describe, it, expect } from 'vitest'
import {
  inboxCloneAllowsTrustedRead,
  inboxCloneRequiresInnerVault,
  isDepackagedEmailInboxSourceType,
  isConformantInboxValidationForCloneRead,
  probeInboxMessageCloneVaultRequirement,
} from '../beapInboxClonePrepare'

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

  it('conformant validation stamps for trusted depackaged read', () => {
    expect(
      isConformantInboxValidationForCloneRead(
        '2025-01-01T00:00:00.000Z',
        'plain_email_no_validation_required',
      ),
    ).toBe(true)
    expect(isConformantInboxValidationForCloneRead('2025-01-01T00:00:00.000Z', 'rejected')).toBe(
      false,
    )
    expect(isConformantInboxValidationForCloneRead(null, 'plain_email_no_validation_required')).toBe(
      false,
    )
  })

  it('inboxCloneAllowsTrustedRead for direct_beap sandbox clone of plain email', () => {
    const dep = JSON.stringify({
      inbox_sandbox_clone_provenance: { original_source_type: 'email_plain', sandbox_clone: true },
    })
    expect(
      inboxCloneAllowsTrustedRead({
        sourceType: 'direct_beap',
        handshakeId: 'hs-1',
        seal: 'seal',
        sealInputJson: '{}',
        validatedAt: '2025-01-01T00:00:00.000Z',
        validationReason: null,
        cloneSignalRow: {
          source_type: 'direct_beap',
          handshake_id: 'hs-1',
          depackaged_json: dep,
        },
      }),
    ).toBe(true)
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
