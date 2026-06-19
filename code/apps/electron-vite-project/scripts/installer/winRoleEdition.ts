/**
 * Mirrors build/installer/detect-windows-edition.ps1 and installer.nsh EditionID lists.
 * Pure logic for unit tests (no registry).
 */
export type WindowsEditionClass = 'home' | 'pro' | 'other'

const HOME_EDITION_IDS = new Set([
  'Core',
  'CoreSingleLanguage',
  'CoreCountrySpecific',
  'Home',
  'Home N',
  'Home Single Language',
])

const PRO_EDITION_IDS = new Set([
  'Professional',
  'ProfessionalEducation',
  'ProfessionalEducationN',
  'ProfessionalN',
  'ProfessionalWorkstation',
  'ProfessionalWorkstationN',
  'Enterprise',
  'EnterpriseN',
  'Education',
  'EducationN',
])

export function classifyWindowsEdition(editionId: string): WindowsEditionClass {
  const id = editionId.trim()
  if (!id) return 'other'
  if (HOME_EDITION_IDS.has(id)) return 'home'
  if (PRO_EDITION_IDS.has(id)) return 'pro'
  return 'other'
}

/** Path segment used by seed script — must stay aligned with getWrDeskUserDataPath(). */
export const ORCHESTRATOR_SEED_RELATIVE = ['.opengiraffe', 'electron-data', 'orchestrator-mode.json'] as const

import path from 'node:path'

export function orchestratorSeedPathFromProfile(userProfile: string): string {
  return path.join(userProfile, ...ORCHESTRATOR_SEED_RELATIVE)
}
