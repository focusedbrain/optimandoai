/**
 * Structured profile fields — schema, migration, prefix wiring.
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
    searchFocus: 'invoices',
    ignoreInstructions: 'noise',
    intervalSeconds: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  })
}

describe('custom mode profileFields', () => {
  it('schema version is v3', () => {
    expect(CUSTOM_MODES_SCHEMA_VERSION).toBe(4)
  })

  it('old modes without profileFields load unchanged via migration', () => {
    const legacy = {
      state: {
        modes: [
          {
            id: 'custom:legacy-no-profile',
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
    const migrated = migrateCustomModesPersistedState(legacy, 2)
    expect(migrated.state.modes).toHaveLength(1)
    expect(migrated.state.modes[0].profileFields).toBeUndefined()
    expect(migrated.state.modes[0].searchFocus).toBe('focus text')
  })

  it('profileFields persist and round-trip through JSON helpers', () => {
    const mode = baseMode({
      profileFields: [
        { key: 'goals', label: 'Career goals', value: 'Staff engineer', type: 'longtext' },
        { key: 'location', label: 'Location', value: 'Remote EU', type: 'text' },
      ],
    })
    const json = stringifyCustomModes([mode])
    const parsed = parseCustomModesJson(json)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].profileFields).toEqual(mode.profileFields)
  })

  it('buildCustomModeFromDraft preserves profileFields', () => {
    const def = buildCustomModeFromDraft({
      name: 'Career',
      description: '',
      icon: '⚡',
      modelProvider: 'ollama',
      modelName: '',
      endpoint: 'http://127.0.0.1:11434',
      sessionId: null,
      sessionMode: 'shared',
      searchFocus: '',
      ignoreInstructions: '',
      profileFields: [{ key: 'dos', label: "Do's", value: 'Apply to fintech', type: 'text' }],
      intervalSeconds: null,
    })
    expect(def.profileFields).toEqual([{ key: 'dos', label: "Do's", value: 'Apply to fintech', type: 'text' }])
  })

  it('profileFields fold into LLM prefix; absent leaves prefix unchanged', () => {
    const withProfile = getCustomModeLlmPrefix(
      customModeDefinitionToRuntime(
        baseMode({
          profileFields: [
            { key: 'goals', label: 'Goals', value: 'Lead role' },
            { key: 'donts', label: "Don'ts", value: 'No crypto' },
          ],
        }),
      ),
    )
    expect(withProfile).toContain('[Mode profile]')
    expect(withProfile).toContain('Goals: Lead role')
    expect(withProfile).toContain("Don'ts: No crypto")
    expect(withProfile).toContain('[Mode focus: invoices]')

    const withoutProfile = getCustomModeLlmPrefix(customModeDefinitionToRuntime(baseMode()))
    expect(withoutProfile).not.toContain('[Mode profile]')
    expect(withoutProfile).toBe('[Mode focus: invoices]\n[Deprioritize or ignore: noise]')
  })

  it('drops empty profile rows on normalize', () => {
    const normalized = normalizeCustomModeFields({
      id: 'custom:x',
      profileFields: [
        { key: 'a', label: '', value: '' },
        { key: 'b', label: 'Valid', value: 'yes' },
      ],
    })
    expect(normalized.profileFields).toEqual([{ key: 'b', label: 'Valid', value: 'yes' }])
  })
})
