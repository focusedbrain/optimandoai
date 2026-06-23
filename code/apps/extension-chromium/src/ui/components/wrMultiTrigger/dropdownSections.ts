/**
 * Grouped top-dropdown sections: Modes vs Projects vs Shortcuts.
 */

import type {
  TriggerComposerEntry,
  TriggerFunctionId,
  TriggerProjectEntry,
} from '../../../types/triggerTypes'
import type { CustomModeDefinition } from '../../../shared/ui/customModeTypes'
import { getCustomModeTriggerBarIcon, isUserOwnedCustomMode } from '../../../shared/ui/customModeTypes'
import {
  createDefaultScamWatchdogBuiltInMode,
  isScamWatchdogBuiltInMode,
} from '../../../shared/ui/scamWatchdogBuiltIn'
import { automationUiKindFromTriggerFunctionId } from './automationUiKind'

export type TriggerBarDropdownRow = {
  id: string
  label: string
  icon: string
  functionId: TriggerFunctionId
  automationUiKind: ReturnType<typeof automationUiKindFromTriggerFunctionId>
}

export type TriggerBarDropdownSectionId = 'modes' | 'projects' | 'shortcuts'

export type TriggerBarDropdownSection = {
  id: TriggerBarDropdownSectionId
  label: string
  rows: TriggerBarDropdownRow[]
}

function buildProjectDropdownRows(projects: TriggerProjectEntry[]): TriggerBarDropdownRow[] {
  const rows: TriggerBarDropdownRow[] = []
  for (const p of projects) {
    const functionId: TriggerFunctionId = { type: 'auto-optimizer', projectId: p.projectId }
    rows.push({
      id: p.projectId,
      label: p.title,
      icon: p.icon,
      functionId,
      automationUiKind: automationUiKindFromTriggerFunctionId(functionId),
    })
  }
  return rows
}

function buildComposerDropdownRows(entries: TriggerComposerEntry[]): TriggerBarDropdownRow[] {
  const rows: TriggerBarDropdownRow[] = []
  for (const c of entries) {
    const functionId: TriggerFunctionId = { type: 'composer-shortcut', composerId: c.composerId }
    rows.push({
      id: `composer:${c.composerId}`,
      label: c.title,
      icon: c.icon,
      functionId,
      automationUiKind: automationUiKindFromTriggerFunctionId(functionId),
    })
  }
  return rows
}

function buildUserCustomModeDropdownRows(customModes: CustomModeDefinition[]): TriggerBarDropdownRow[] {
  const rows: TriggerBarDropdownRow[] = []
  for (const m of customModes) {
    if (!isUserOwnedCustomMode(m)) continue
    const icon =
      getCustomModeTriggerBarIcon(m.metadata as Record<string, unknown> | undefined) ||
      m.icon?.trim() ||
      '⚡'
    const functionId: TriggerFunctionId = { type: 'custom-automation', modeId: m.id }
    rows.push({
      id: m.id,
      label: m.name.trim() || 'Mode',
      icon,
      functionId,
      automationUiKind: automationUiKindFromTriggerFunctionId(functionId),
    })
  }
  rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  return rows
}

/** Top dropdown: Modes (Scam Watchdog + all custom:*) | Projects | Shortcuts. */
export function buildTriggerBarDropdownSections(
  customModes: CustomModeDefinition[],
  projectList: TriggerProjectEntry[],
  composerShortcutList: TriggerComposerEntry[],
): TriggerBarDropdownSection[] {
  const seedIcon = createDefaultScamWatchdogBuiltInMode().icon?.trim() || '🐕‍🦺'
  const scamWatchdogMode = customModes.find((m) => isScamWatchdogBuiltInMode(m)) ?? null

  const modeRows: TriggerBarDropdownRow[] = []
  if (scamWatchdogMode) {
    const functionId: TriggerFunctionId = { type: 'custom-automation', modeId: scamWatchdogMode.id }
    modeRows.push({
      id: scamWatchdogMode.id,
      label: scamWatchdogMode.name.trim() || 'Scam Watchdog',
      icon: scamWatchdogMode.icon?.trim() || seedIcon,
      functionId,
      automationUiKind: 'monitor',
    })
  }
  modeRows.push(...buildUserCustomModeDropdownRows(customModes))

  const sections: TriggerBarDropdownSection[] = [
    { id: 'modes', label: 'Modes', rows: modeRows },
    { id: 'projects', label: 'Projects', rows: buildProjectDropdownRows(projectList) },
  ]

  const shortcutRows = buildComposerDropdownRows(composerShortcutList)
  if (shortcutRows.length > 0) {
    sections.push({ id: 'shortcuts', label: 'Shortcuts', rows: shortcutRows })
  }

  return sections
}

export function flattenTriggerBarDropdownSections(
  sections: TriggerBarDropdownSection[],
): TriggerBarDropdownRow[] {
  return sections.flatMap((s) => s.rows)
}
