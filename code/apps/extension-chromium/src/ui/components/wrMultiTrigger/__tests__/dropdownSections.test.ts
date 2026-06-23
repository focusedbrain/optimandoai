import { describe, it, expect } from 'vitest'
import { normalizeCustomModeFields } from '../../../../shared/ui/customModeTypes'
import {
  BUILTIN_SCAM_WATCHDOG_ID,
  createDefaultScamWatchdogBuiltInMode,
} from '../../../../shared/ui/scamWatchdogBuiltIn'
import { buildTriggerBarDropdownSections, flattenTriggerBarDropdownSections } from '../dropdownSections'

describe('buildTriggerBarDropdownSections', () => {
  const scamWatchdog = createDefaultScamWatchdogBuiltInMode()

  const customWithIcon = normalizeCustomModeFields({
    id: 'custom:a',
    type: 'custom',
    name: 'Alpha Mode',
    icon: '🎯',
    modelProvider: 'ollama',
    modelName: 'm',
    endpoint: 'http://127.0.0.1:11434',
    sessionId: null,
    sessionMode: 'shared',
    searchFocus: '',
    ignoreInstructions: '',
    intervalSeconds: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  const customNoIcon = normalizeCustomModeFields({
    ...customWithIcon,
    id: 'custom:b',
    name: 'Beta Mode',
    icon: '',
    metadata: {},
  })

  it('groups Modes (Scam Watchdog + all custom:*) separately from Projects', () => {
    const sections = buildTriggerBarDropdownSections(
      [scamWatchdog, customWithIcon, customNoIcon],
      [{ projectId: 'proj-1', title: 'Dashboard Refinement', icon: '📊' }],
      [],
    )
    expect(sections.map((s) => s.id)).toEqual(['modes', 'projects'])
    expect(sections[0].label).toBe('Modes')
    expect(sections[1].label).toBe('Projects')

    const modeIds = sections[0].rows.map((r) => r.id)
    expect(modeIds).toContain(BUILTIN_SCAM_WATCHDOG_ID)
    expect(modeIds).toContain('custom:a')
    expect(modeIds).toContain('custom:b')
    expect(sections[1].rows[0].label).toBe('Dashboard Refinement')
  })

  it('includes custom modes without triggerBarIcon using default fallback icon', () => {
    const sections = buildTriggerBarDropdownSections([scamWatchdog, customNoIcon], [], [])
    const beta = sections[0].rows.find((r) => r.id === 'custom:b')
    expect(beta?.icon).toBe('⚡')
  })

  it('excludes built-in Scam Watchdog from user custom rows (single watchdog entry)', () => {
    const sections = buildTriggerBarDropdownSections([scamWatchdog], [], [])
    const watchdogRows = sections[0].rows.filter((r) => r.id === BUILTIN_SCAM_WATCHDOG_ID)
    expect(watchdogRows).toHaveLength(1)
  })

  it('flattenTriggerBarDropdownSections preserves row order across sections', () => {
    const sections = buildTriggerBarDropdownSections(
      [scamWatchdog, customWithIcon],
      [{ projectId: 'p1', title: 'Project One', icon: '📁' }],
      [{ composerId: 'email', title: 'Email', icon: '✉️', launchMode: 'dashboard-email-compose' }],
    )
    const flat = flattenTriggerBarDropdownSections(sections)
    expect(flat[0].id).toBe(BUILTIN_SCAM_WATCHDOG_ID)
    expect(flat.some((r) => r.id === 'custom:a')).toBe(true)
    expect(flat.some((r) => r.id === 'p1')).toBe(true)
    expect(flat.some((r) => r.id === 'composer:email')).toBe(true)
  })
})
