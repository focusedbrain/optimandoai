/**
 * systemInstructions + profile field usage — schema v6, migration, prompt order.
 */

import { describe, it, expect } from 'vitest'
import {
  buildCustomModeFromDraft,
  normalizeCustomModeFields,
  type CustomModeDefinition,
} from '../customModeTypes'
import { customModeDefinitionToRuntime } from '../customModeRuntime'
import {
  CUSTOM_MODES_SCHEMA_VERSION,
  migrateCustomModesPersistedState,
  parseCustomModesJson,
  stringifyCustomModes,
} from '../customModePersistence'
import { getCustomModeLlmPrefix } from '../../../utils/customModeLlmPrefix'

function baseMode(partial: Partial<CustomModeDefinition> = {}): CustomModeDefinition {
  return normalizeCustomModeFields({
    id: 'custom:test-1',
    type: 'custom',
    name: 'Test Mode',
    description: '',
    icon: '⚡',
    modelProvider: 'ollama',
    modelName: 'llama3',
    endpoint: 'http://127.0.0.1:11434',
    sessionId: null,
    sessionMode: 'shared',
    systemInstructions: '',
    searchFocus: 'invoices',
    ignoreInstructions: 'noise',
    intervalSeconds: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  })
}

describe('custom mode systemInstructions + profile usage (v6)', () => {
  it('schema version is v6', () => {
    expect(CUSTOM_MODES_SCHEMA_VERSION).toBe(6)
  })

  it('old modes without systemInstructions migrate to empty string', () => {
    const legacy = {
      state: {
        modes: [
          {
            id: 'custom:legacy',
            type: 'custom',
            name: 'Legacy',
            description: '',
            icon: '⚡',
            modelProvider: 'ollama',
            modelName: 'm',
            endpoint: 'http://127.0.0.1:11434',
            sessionId: null,
            sessionMode: 'shared',
            searchFocus: 'focus text',
            ignoreInstructions: '',
            intervalSeconds: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    }
    const migrated = migrateCustomModesPersistedState(legacy, 5)
    expect(migrated.state.modes[0].systemInstructions).toBe('')
  })

  it('systemInstructions persists and round-trips through JSON helpers', () => {
    const mode = baseMode({ systemInstructions: 'You are a fraud analyst.' })
    const json = stringifyCustomModes([mode])
    const parsed = parseCustomModesJson(json)
    expect(parsed[0].systemInstructions).toBe('You are a fraud analyst.')
  })

  it('buildCustomModeFromDraft preserves systemInstructions', () => {
    const def = buildCustomModeFromDraft({
      name: 'Career',
      description: '',
      icon: '⚡',
      modelProvider: 'ollama',
      modelName: '',
      endpoint: 'http://127.0.0.1:11434',
      sessionId: null,
      sessionMode: 'shared',
      systemInstructions: 'You help with job search.',
      searchFocus: '',
      ignoreInstructions: '',
      intervalSeconds: null,
    })
    expect(def.systemInstructions).toBe('You help with job search.')
  })

  it('profileFields usage defaults to context on normalize', () => {
    const normalized = normalizeCustomModeFields({
      id: 'custom:x',
      profileFields: [{ key: 'a', label: 'Goal', value: 'Staff' }],
    })
    expect(normalized.profileFields?.[0].usage).toBe('context')
  })

  it('profileFields usage persists through JSON round-trip', () => {
    const mode = baseMode({
      profileFields: [{ key: 'g', label: 'Goal', value: 'Lead', usage: 'context' }],
    })
    const parsed = parseCustomModesJson(stringifyCustomModes([mode]))
    expect(parsed[0].profileFields?.[0].usage).toBe('context')
  })

  it('prompt assembly orders systemInstructions before focus and user context', () => {
    const prefix = getCustomModeLlmPrefix(
      customModeDefinitionToRuntime(
        baseMode({
          systemInstructions: 'You are a scam detector.',
          profileFields: [{ key: 'loc', label: 'Location', value: 'EU', usage: 'context' }],
        }),
      ),
    )
    expect(prefix).not.toBeNull()
    const sysIdx = prefix!.indexOf('[System instructions for this mode]')
    const focusIdx = prefix!.indexOf('[Mode focus: invoices]')
    const ctxIdx = prefix!.indexOf('[User-provided context]')
    expect(sysIdx).toBeGreaterThanOrEqual(0)
    expect(focusIdx).toBeGreaterThan(sysIdx)
    expect(ctxIdx).toBeGreaterThan(focusIdx)
    expect(prefix).toContain('You are a scam detector.')
  })

  it('empty systemInstructions is omitted from prefix', () => {
    const prefix = getCustomModeLlmPrefix(customModeDefinitionToRuntime(baseMode()))
    expect(prefix).not.toContain('[System instructions for this mode]')
  })
})
