import { describe, it, expect } from 'vitest'
import { getValidationState } from '../validationState'

describe('getValidationState', () => {
  it('plain_email_no_validation_required with validated_at → validated', () => {
    expect(getValidationState('2026-01-01T00:00:00.000Z', 'plain_email_no_validation_required')).toBe('validated')
  })

  it('non_confidential_ledger_sealed with validated_at → validated', () => {
    expect(getValidationState('2026-01-01T00:00:00.000Z', 'non_confidential_ledger_sealed')).toBe('validated')
  })

  it('validator rejection reason → rejected', () => {
    expect(getValidationState('2026-01-01T00:00:00.000Z', 'ARTEFACT_FORMAT_INVALID')).toBe('rejected')
  })

  it('null stamps → pending', () => {
    expect(getValidationState(null, null)).toBe('pending')
  })

  it('validated_at only → validated', () => {
    expect(getValidationState('2026-01-01T00:00:00.000Z', null)).toBe('validated')
  })
})
