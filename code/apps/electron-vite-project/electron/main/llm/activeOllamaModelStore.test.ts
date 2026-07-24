import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const testUserData = path.join(os.tmpdir(), `active-ollama-vitest-${process.pid}`)

vi.mock('electron', () => ({
  app: {
    getPath: (_n: string) => testUserData,
  },
}))

import {
  resolveEffectiveLocalModel,
  setStoredActiveLocalModelId,
  getStoredActiveLocalModelId,
} from './activeLocalModelStore'

describe('activeOllamaModelStore', () => {
  beforeEach(() => {
    fs.rmSync(testUserData, { recursive: true, force: true })
    fs.mkdirSync(testUserData, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(testUserData, { recursive: true, force: true })
  })

  describe('resolveEffectiveLocalModel', () => {
    it('returns null when no models installed', () => {
      expect(resolveEffectiveLocalModel([], 'mistral')).toEqual({
        model: null,
        usedFallback: false,
        missingStored: false,
      })
    })

    it('uses stored id when present in tags', () => {
      expect(resolveEffectiveLocalModel(['a', 'b'], 'b')).toEqual({
        model: 'b',
        usedFallback: false,
        missingStored: false,
      })
    })

    it('falls back to first when stored is missing but tags exist', () => {
      expect(resolveEffectiveLocalModel(['x', 'y'], 'deleted')).toEqual({
        model: 'x',
        usedFallback: true,
        missingStored: true,
      })
    })

    it('falls back to first when nothing stored', () => {
      expect(resolveEffectiveLocalModel(['x', 'y'], null)).toEqual({
        model: 'x',
        usedFallback: true,
        missingStored: false,
      })
    })
  })

  describe('persistence', () => {
    it('round-trips activeOllamaModelId', () => {
      setStoredActiveLocalModelId('llama3.1:8b')
      expect(getStoredActiveLocalModelId()).toBe('llama3.1:8b')
    })
  })
})
