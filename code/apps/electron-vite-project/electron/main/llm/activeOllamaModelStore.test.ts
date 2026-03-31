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
  resolveEffectiveOllamaModel,
  setStoredActiveOllamaModelId,
  getStoredActiveOllamaModelId,
} from './activeOllamaModelStore'

describe('activeOllamaModelStore', () => {
  beforeEach(() => {
    fs.rmSync(testUserData, { recursive: true, force: true })
    fs.mkdirSync(testUserData, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(testUserData, { recursive: true, force: true })
  })

  describe('resolveEffectiveOllamaModel', () => {
    it('returns null when no models installed', () => {
      expect(resolveEffectiveOllamaModel([], 'mistral')).toEqual({
        model: null,
        usedFallback: false,
        missingStored: false,
      })
    })

    it('uses stored id when present in tags', () => {
      expect(resolveEffectiveOllamaModel(['a', 'b'], 'b')).toEqual({
        model: 'b',
        usedFallback: false,
        missingStored: false,
      })
    })

    it('falls back to first when stored is missing but tags exist', () => {
      expect(resolveEffectiveOllamaModel(['x', 'y'], 'deleted')).toEqual({
        model: 'x',
        usedFallback: true,
        missingStored: true,
      })
    })

    it('falls back to first when nothing stored', () => {
      expect(resolveEffectiveOllamaModel(['x', 'y'], null)).toEqual({
        model: 'x',
        usedFallback: true,
        missingStored: false,
      })
    })
  })

  describe('persistence', () => {
    it('round-trips activeOllamaModelId', () => {
      setStoredActiveOllamaModelId('llama3.1:8b')
      expect(getStoredActiveOllamaModelId()).toBe('llama3.1:8b')
    })
  })
})
