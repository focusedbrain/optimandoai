import { describe, expect, it } from 'vitest'
import {
  formatGlobalSessionContextForLlmPrefix,
  shouldApplyModeContextLayer,
} from '../globalSessionContextLlmPrefix'
import type { CustomModeRuntimeConfig } from '../../shared/ui/customModeRuntime'

const baseMode = (overrides: Partial<CustomModeRuntimeConfig> = {}): CustomModeRuntimeConfig => ({
  modeId: 'custom:test',
  name: 'Test',
  modelProvider: 'ollama',
  modelName: '',
  endpoint: '',
  sessionId: 'session_1',
  sessionMode: 'shared',
  systemInstructions: '',
  searchFocus: '',
  ignoreInstructions: '',
  profileFields: [{ key: 'role', label: 'Role', value: 'Analyst' }],
  intervalSeconds: null,
  scopeUrls: [],
  diffWatchFolders: [],
  wrExpertProfile: null,
  ...overrides,
})

describe('formatGlobalSessionContextForLlmPrefix', () => {
  it('returns null when all sections empty', () => {
    expect(
      formatGlobalSessionContextForLlmPrefix({
        sessionKey: 'session_1',
        user: null,
        publisher: null,
        account: null,
      }),
    ).toBeNull()
  })

  it('orders user, publisher, account sections', () => {
    const block = formatGlobalSessionContextForLlmPrefix({
      sessionKey: 'session_1',
      user: { text: 'Oscar hospital project' },
      publisher: { text: 'Publisher note' },
      account: { text: 'Account note' },
    })
    expect(block).toContain('[Session context — user]')
    expect(block).toContain('Oscar hospital project')
    expect(block).toContain('[Session context — publisher]')
    expect(block).toContain('[Account context]')
    expect(block!.indexOf('user')).toBeLessThan(block!.indexOf('publisher'))
  })

  it('notes attached PDFs without embedding data URLs', () => {
    const block = formatGlobalSessionContextForLlmPrefix({
      sessionKey: 'session_1',
      user: { text: '', pdfFiles: [{ name: 'a.pdf' }, { name: 'b.pdf' }] },
      publisher: null,
      account: null,
    })
    expect(block).toContain('[2 attached documents]')
  })
})

describe('shouldApplyModeContextLayer', () => {
  it('applies when resolved model matches explicit allocation', () => {
    const mode = baseMode({ modelName: 'llama3:8b' })
    expect(shouldApplyModeContextLayer(mode, 'llama3:8b', 'mistral')).toBe(true)
    expect(shouldApplyModeContextLayer(mode, 'mistral', 'mistral')).toBe(false)
  })

  it('applies to picker model when mode has no explicit allocation', () => {
    const mode = baseMode({ modelName: '' })
    expect(shouldApplyModeContextLayer(mode, 'mistral', 'mistral')).toBe(true)
    expect(shouldApplyModeContextLayer(mode, 'llama3:8b', 'mistral')).toBe(false)
  })
})
