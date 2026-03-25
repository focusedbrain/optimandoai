import { describe, it, expect } from 'vitest'
import { activeEmailAccountIdsForSync } from '../stores/useEmailInboxStore'

describe('activeEmailAccountIdsForSync', () => {
  it('treats missing processingPaused as eligible (legacy rows = not paused)', () => {
    expect(activeEmailAccountIdsForSync([{ id: 'a', status: 'active' }])).toEqual(['a'])
  })

  it('excludes paused accounts from sync targets', () => {
    expect(
      activeEmailAccountIdsForSync([
        { id: 'p', status: 'active', processingPaused: true },
        { id: 'u', status: 'active', processingPaused: false },
      ]),
    ).toEqual(['u'])
  })

  it('keeps auth_error separate: pause still excludes; auth_error without pause can still be targeted via fallback branch', () => {
    expect(
      activeEmailAccountIdsForSync([
        { id: 'auth', status: 'auth_error', processingPaused: true },
        { id: 'auth2', status: 'auth_error' },
      ]),
    ).toEqual(['auth2'])
  })

  it('prefers active accounts when both active and auth_error exist', () => {
    expect(
      activeEmailAccountIdsForSync([
        { id: 'x', status: 'auth_error' },
        { id: 'y', status: 'active' },
      ]),
    ).toEqual(['y'])
  })
})
