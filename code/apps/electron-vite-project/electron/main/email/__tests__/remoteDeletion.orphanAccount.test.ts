import { describe, it, expect } from 'vitest'
import { isGatewayOrphanAccountError } from '../gatewayOrphanAccountError'

describe('isGatewayOrphanAccountError', () => {
  it('detects gateway throw shape', () => {
    expect(isGatewayOrphanAccountError('Account not found: 331ec9cc-d88c-46f8-8ddf-ae6edb250fdb')).toBe(
      true,
    )
    expect(isGatewayOrphanAccountError('Account not found')).toBe(true)
  })

  it('returns false for other failures', () => {
    expect(isGatewayOrphanAccountError('Network timeout')).toBe(false)
    expect(isGatewayOrphanAccountError('')).toBe(false)
  })
})
