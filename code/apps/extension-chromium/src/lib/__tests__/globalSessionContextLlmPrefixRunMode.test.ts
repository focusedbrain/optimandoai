import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildInferenceContextPrefix } from '../globalSessionContextLlmPrefix'
import type { CustomModeRuntimeConfig } from '../../shared/ui/customModeRuntime'

const baseMode = (overrides: Partial<CustomModeRuntimeConfig> = {}): CustomModeRuntimeConfig => ({
  modeId: 'custom:test',
  name: 'Test',
  modelProvider: 'ollama',
  modelName: '',
  endpoint: '',
  sessionId: 'session_1',
  sessionMode: 'shared',
  systemInstructions: 'Run these steps',
  searchFocus: 'Focus on invoices',
  ignoreInstructions: '',
  profileFields: [{ key: 'role', label: 'Role', value: 'Analyst' }],
  intervalSeconds: null,
  scopeUrls: [],
  diffWatchFolders: [],
  wrExpertProfile: null,
  ...overrides,
})

describe('buildInferenceContextPrefix runMode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses full run prefix when runMode is true', async () => {
    vi.spyOn(
      await import('../globalSessionContextStorage'),
      'loadGlobalSessionContextForKey',
    ).mockResolvedValue({
      sessionKey: 'session_1',
      user: null,
      publisher: null,
      account: null,
    })

    const prefix = await buildInferenceContextPrefix({
      sessionKey: 'session_1',
      modeRuntime: baseMode(),
      resolvedModelId: 'other-model',
      wrChatPickerModelId: 'picker',
      runMode: true,
    })

    expect(prefix).toContain('Run these steps')
    expect(prefix).toContain('Focus on invoices')
    expect(prefix).toContain('Role: Analyst')
  })

  it('uses WR Chat subset without runMode even when modeRuntime is set', async () => {
    vi.spyOn(
      await import('../globalSessionContextStorage'),
      'loadGlobalSessionContextForKey',
    ).mockResolvedValue({
      sessionKey: 'session_1',
      user: null,
      publisher: null,
      account: null,
    })

    const prefix = await buildInferenceContextPrefix({
      sessionKey: 'session_1',
      modeRuntime: baseMode(),
      resolvedModelId: 'picker-model',
      wrChatPickerModelId: 'picker-model',
      runMode: false,
    })

    expect(prefix).not.toContain('Run these steps')
    expect(prefix).not.toContain('Focus on invoices')
    expect(prefix).toContain('Role: Analyst')
  })
})
