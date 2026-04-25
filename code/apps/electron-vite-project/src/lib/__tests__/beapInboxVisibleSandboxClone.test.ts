import { describe, test, expect } from 'vitest'
import { canCloneVisibleInboxMessageToSandbox } from '../beapInboxVisibleSandboxClone'

describe('canCloneVisibleInboxMessageToSandbox', () => {
  test('returns true when message has an id', () => {
    expect(canCloneVisibleInboxMessageToSandbox({ id: 'm1' })).toBe(true)
  })

  test('returns false for null, undefined, or missing id', () => {
    expect(canCloneVisibleInboxMessageToSandbox(null)).toBe(false)
    expect(canCloneVisibleInboxMessageToSandbox(undefined)).toBe(false)
    expect(canCloneVisibleInboxMessageToSandbox({})).toBe(false)
  })
})
