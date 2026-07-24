import { describe, expect, it } from 'vitest'

import {
  canonicalLocalModelName,
  dedupeCanonicalModelNames,
  localModelIdsMatch,
  resolveLocalModelAlias,
} from '../localModelIdentity'

const CANON = 'gemma-4-12B-it-Q4_K_M'
const WIN_PATH = 'C:\\Users\\oscar\\.opengiraffe\\electron-data\\models\\gemma-4-12B-it-Q4_K_M.gguf'
const POSIX_PATH = '/home/user/.opengiraffe/models/gemma-4-12B-it-Q4_K_M.gguf'
const FILENAME = 'gemma-4-12B-it-Q4_K_M.gguf'
const STALE_TAG = 'gemma4:12b-it-q8_0'

describe('canonicalLocalModelName', () => {
  it('strips Windows path and .gguf', () => {
    expect(canonicalLocalModelName(WIN_PATH)).toBe(CANON)
  })
  it('strips POSIX path and .gguf', () => {
    expect(canonicalLocalModelName(POSIX_PATH)).toBe(CANON)
  })
  it('strips .gguf from a bare filename (case-insensitive)', () => {
    expect(canonicalLocalModelName(FILENAME)).toBe(CANON)
    expect(canonicalLocalModelName('model.GGUF')).toBe('model')
  })
  it('leaves canonical names and Ollama tags unchanged', () => {
    expect(canonicalLocalModelName(CANON)).toBe(CANON)
    expect(canonicalLocalModelName(STALE_TAG)).toBe(STALE_TAG)
  })
  it('empty / null → empty string', () => {
    expect(canonicalLocalModelName('')).toBe('')
    expect(canonicalLocalModelName(null)).toBe('')
    expect(canonicalLocalModelName(undefined)).toBe('')
  })
})

describe('resolveLocalModelAlias', () => {
  it('resolves full path against canonical installed name', () => {
    expect(resolveLocalModelAlias(WIN_PATH, [CANON])).toBe(CANON)
  })
  it('resolves canonical against path-spelled installed entry', () => {
    expect(resolveLocalModelAlias(CANON, [WIN_PATH])).toBe(CANON)
  })
  it('resolves filename against canonical installed name', () => {
    expect(resolveLocalModelAlias(FILENAME, [CANON])).toBe(CANON)
  })
  it('does NOT resolve a stale Ollama tag', () => {
    expect(resolveLocalModelAlias(STALE_TAG, [CANON, WIN_PATH])).toBeNull()
  })
  it('null for empty request or empty install list', () => {
    expect(resolveLocalModelAlias('', [CANON])).toBeNull()
    expect(resolveLocalModelAlias(CANON, [])).toBeNull()
  })
})

describe('localModelIdsMatch', () => {
  it('path == name == filename', () => {
    expect(localModelIdsMatch(WIN_PATH, CANON)).toBe(true)
    expect(localModelIdsMatch(FILENAME, WIN_PATH)).toBe(true)
  })
  it('stale tag != canonical', () => {
    expect(localModelIdsMatch(STALE_TAG, CANON)).toBe(false)
  })
  it('empty never matches', () => {
    expect(localModelIdsMatch('', '')).toBe(false)
  })
})

describe('dedupeCanonicalModelNames', () => {
  it('collapses path/name/filename duplicates to one canonical entry, keeps distinct tags', () => {
    expect(dedupeCanonicalModelNames([WIN_PATH, CANON, FILENAME, STALE_TAG])).toEqual([
      CANON,
      STALE_TAG,
    ])
  })
  it('drops empties', () => {
    expect(dedupeCanonicalModelNames(['', null, undefined, CANON])).toEqual([CANON])
  })
})
