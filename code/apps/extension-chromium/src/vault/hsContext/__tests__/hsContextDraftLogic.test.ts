/**
 * Tests: HS Context draft lifecycle logic
 *
 * Validates blocking fixes for the draft-upload flow:
 * 1. Cancel cleanup — do not delete draft if document was uploaded
 * 2. Name preservation — user-typed name during draft creation is preserved
 * 3. Empty draft cleanup — empty untouched draft can be deleted on cancel
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest'
import {
  shouldDeleteDraftOnCancel,
  resolveNameAfterDraftCreation,
} from '../hsContextDraftLogic'

describe('shouldDeleteDraftOnCancel', () => {
  it('does NOT delete when document was uploaded (hasUploaded=true)', () => {
    expect(
      shouldDeleteDraftOnCancel(undefined, 'hsp_123', 'Untitled', true),
    ).toBe(false)
  })

  it('does NOT delete when documents.length would be stale but hasUploaded is true', () => {
    expect(
      shouldDeleteDraftOnCancel(undefined, 'hsp_123', 'Untitled', true),
    ).toBe(false)
  })

  it('deletes empty untouched draft (hasUploaded=false, name=Untitled)', () => {
    expect(
      shouldDeleteDraftOnCancel(undefined, 'hsp_123', 'Untitled', false),
    ).toBe(true)
  })

  it('does NOT delete when editing existing profile (profileId provided)', () => {
    expect(
      shouldDeleteDraftOnCancel('hsp_123', 'hsp_123', 'Untitled', false),
    ).toBe(false)
  })

  it('does NOT delete when no currentProfileId', () => {
    expect(
      shouldDeleteDraftOnCancel(undefined, undefined, 'Untitled', false),
    ).toBe(false)
  })

  it('does NOT delete when user changed name from Untitled', () => {
    expect(
      shouldDeleteDraftOnCancel(undefined, 'hsp_123', 'My Company', false),
    ).toBe(false)
  })

  it('does NOT delete when name has extra spaces but is effectively Untitled', () => {
    expect(
      shouldDeleteDraftOnCancel(undefined, 'hsp_123', '  Untitled  ', false),
    ).toBe(true)
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
