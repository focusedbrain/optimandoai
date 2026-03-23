/**
 * Tests: HS Context draft lifecycle logic
 *
 * Validates cancel cleanup for the deferred-draft flow:
 * - Draft is created only on first upload OR explicit Save
 * - On Cancel: always delete draft when in create mode and draft exists
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest'
import {
  shouldDeleteDraftOnCancel,
  resolveNameAfterDraftCreation,
} from '../hsContextDraftLogic'

describe('shouldDeleteDraftOnCancel', () => {
  it('deletes draft when in create mode and draft exists (from upload)', () => {
    expect(shouldDeleteDraftOnCancel(undefined, 'hsp_123')).toBe(true)
  })

  it('deletes draft when in create mode regardless of name or uploads', () => {
    expect(shouldDeleteDraftOnCancel(undefined, 'hsp_123')).toBe(true)
  })

  it('does NOT delete when editing existing profile (profileId provided)', () => {
    expect(shouldDeleteDraftOnCancel('hsp_123', 'hsp_123')).toBe(false)
  })

  it('does NOT delete when no currentProfileId', () => {
    expect(shouldDeleteDraftOnCancel(undefined, undefined)).toBe(false)
  })
})

describe('resolveNameAfterDraftCreation', () => {
  it('preserves user-typed name when they edited during draft creation', () => {
    expect(resolveNameAfterDraftCreation('Acme Corp')).toBe('Acme Corp')
  })

  it('returns Untitled when name is empty', () => {
    expect(resolveNameAfterDraftCreation('')).toBe('Untitled')
  })

  it('returns Untitled when name is only whitespace', () => {
    expect(resolveNameAfterDraftCreation('   ')).toBe('Untitled')
  })

  it('preserves name with leading/trailing spaces', () => {
    expect(resolveNameAfterDraftCreation('  My Profile  ')).toBe('  My Profile  ')
  })

  it('returns Untitled when name is empty string (initial state)', () => {
    expect(resolveNameAfterDraftCreation('')).toBe('Untitled')
  })
})
