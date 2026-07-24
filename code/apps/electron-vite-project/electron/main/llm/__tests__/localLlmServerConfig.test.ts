/**
 * build038 persisted inference-settings tests: production-correct defaults,
 * sanitization of invalid JSON, and round-trip persistence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

let tmpUserData: string

vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData },
}))

import {
  DEFAULT_LOCAL_LLM_SERVER_CONFIG,
  getLocalLlmServerConfig,
  sanitizeLocalLlmServerConfig,
  setLocalLlmServerConfig,
} from '../localLlmServerConfig'

beforeEach(() => {
  tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-server-config-'))
})

afterEach(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true })
})

describe('defaults', () => {
  it('ships the recommended production setup for zero-configuration installs', () => {
    expect(DEFAULT_LOCAL_LLM_SERVER_CONFIG).toEqual({
      ctxMode: 'standard',
      parallel: 4,
      reasoningEnabled: false,
    })
    // No file on disk → defaults.
    expect(getLocalLlmServerConfig()).toEqual(DEFAULT_LOCAL_LLM_SERVER_CONFIG)
  })
})

describe('sanitizeLocalLlmServerConfig', () => {
  it('falls back per-field on invalid values', () => {
    expect(
      sanitizeLocalLlmServerConfig({ ctxMode: 'huge', parallel: 3, reasoningEnabled: 'yes' }),
    ).toEqual(DEFAULT_LOCAL_LLM_SERVER_CONFIG)
    expect(sanitizeLocalLlmServerConfig(null)).toEqual(DEFAULT_LOCAL_LLM_SERVER_CONFIG)
    expect(
      sanitizeLocalLlmServerConfig({ ctxMode: 'long', parallel: 2, reasoningEnabled: true }),
    ).toEqual({ ctxMode: 'long', parallel: 2, reasoningEnabled: true })
  })
})

describe('persistence round-trip', () => {
  it('persists partial patches and re-reads them', () => {
    setLocalLlmServerConfig({ reasoningEnabled: true })
    expect(getLocalLlmServerConfig()).toEqual({ ...DEFAULT_LOCAL_LLM_SERVER_CONFIG, reasoningEnabled: true })

    setLocalLlmServerConfig({ ctxMode: 'max', parallel: 2 })
    expect(getLocalLlmServerConfig()).toEqual({ ctxMode: 'max', parallel: 2, reasoningEnabled: true })
  })

  it('recovers to defaults when the file is corrupt', () => {
    fs.writeFileSync(path.join(tmpUserData, 'local-llm-server-config.json'), '{not json', 'utf-8')
    expect(getLocalLlmServerConfig()).toEqual(DEFAULT_LOCAL_LLM_SERVER_CONFIG)
  })
})
