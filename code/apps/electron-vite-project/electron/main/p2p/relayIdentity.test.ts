import { describe, it, expect } from 'vitest'
import { getRelayUserIdForRegistry } from './relayIdentity'

describe('relayIdentity', () => {
  it('getRelayUserIdForRegistry returns JWT sub', () => {
    expect(getRelayUserIdForRegistry({ sub: 'abc', wrdesk_user_id: 'xyz' } as any)).toBe('abc')
  })

  it('returns null without sub', () => {
    expect(getRelayUserIdForRegistry({ wrdesk_user_id: 'only-wrdesk' } as any)).toBeNull()
  })
})
