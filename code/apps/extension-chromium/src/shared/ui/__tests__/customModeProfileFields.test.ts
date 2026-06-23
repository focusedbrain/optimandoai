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
  it('schema version is v6', () => {
    expect(CUSTOM_MODES_SCHEMA_VERSION).toBe(6)
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
    expect(def.profileFields).toEqual([
      { key: 'dos', label: "Do's", value: 'Apply to fintech', type: 'text', usage: 'context' },
    ])
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
    expect(withProfile).toContain('[User-provided context]')
    expect(withProfile).toContain('Goals: Lead role')
    expect(withProfile).toContain("Don'ts: No crypto")
    expect(withProfile).toContain('[Mode focus: invoices]')

    const withoutProfile = getCustomModeLlmPrefix(customModeDefinitionToRuntime(baseMode()))
    expect(withoutProfile).not.toContain('[User-provided context]')
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
    expect(normalized.profileFields).toEqual([{ key: 'b', label: 'Valid', value: 'yes', usage: 'context' }])
  })

  it('typed fields persist and fold into prefix', () => {
    const mode = baseMode({
      profileFields: [
        { key: 'loc', label: 'Location', value: 'Hamburg', type: 'text' },
        { key: 'rel', label: 'Open to relocation', value: 'yes', type: 'toggle' },
        {
          key: 'ind',
          label: 'Industries',
          value: 'fintech, security',
          type: 'multiselect',
          options: ['fintech', 'security', 'health'],
        },
        {
          key: 'level',
          label: 'Seniority',
          value: 'Senior',
          type: 'select',
          options: ['Junior', 'Senior'],
        },
      ],
    })
    const json = stringifyCustomModes([mode])
    const parsed = parseCustomModesJson(json)
    expect(parsed[0].profileFields).toEqual(mode.profileFields)

    const prefix = getCustomModeLlmPrefix(customModeDefinitionToRuntime(mode))
    expect(prefix).toContain('Location: Hamburg')
    expect(prefix).toContain('Open to relocation: yes')
    expect(prefix).toContain('Industries: fintech, security')
    expect(prefix).toContain('Seniority: Senior')
  })

  it('toggle off and empty multiselect are omitted from prefix', () => {
    const prefix = getCustomModeLlmPrefix(
      customModeDefinitionToRuntime(
        baseMode({
          profileFields: [
            { key: 'a', label: 'Flag', value: 'no', type: 'toggle' },
            { key: 'b', label: 'Tags', value: '', type: 'multiselect', options: ['a', 'b'] },
            { key: 'c', label: 'Note', value: 'ok', type: 'text' },
          ],
        }),
      ),
    )
    expect(prefix).toContain('Flag: no')
    expect(prefix).not.toContain('Tags:')
    expect(prefix).toContain('Note: ok')
  })
})
