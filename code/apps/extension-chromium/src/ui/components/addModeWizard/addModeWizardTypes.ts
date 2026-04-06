/**
 * Add Mode wizard — step metadata and shared types (decoupled from ModeSelect).
 *
 * Future-facing hooks (not implemented yet):
 * - `AddModeWizardIntent`: reuse the same flow for create vs edit; pass initial draft + `intent: 'edit'`.
 * - Import/export: serialize `CustomModeDraft` / persisted `CustomMode` to JSON alongside version.
 * - Advanced provider settings: extend `CustomModeDraft` or `metadata` with provider-specific fields.
 * - Expert / fine-tuned models: store identifiers and display labels in `metadata` (see `CustomModeDraft.metadata`).
 */

import type { CustomModeDraft } from '../../../shared/ui/customModeTypes'

export const ADD_MODE_WIZARD_STEPS = [
  'Basics',
  'Model',
  'Session',
  'Focus',
  'Run',
  'Review',
] as const

export type AddModeWizardStepIndex = 0 | 1 | 2 | 3 | 4 | 5

/** Discriminator for reusing the wizard for create vs edit custom modes. */
export type AddModeWizardIntent = 'create' | 'edit'

export type AddModeWizardData = CustomModeDraft

export type ValidateStepFn = (stepIndex: AddModeWizardStepIndex, data: CustomModeDraft) => string | null
