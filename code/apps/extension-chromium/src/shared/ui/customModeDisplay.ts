/**
 * Safe display helpers for custom mode rows and draft fields (persisted data may be partial or legacy).
 */

import type { SessionMode } from './customModeTypes'

export function safeCustomModeRowLabel(name: unknown, icon: unknown): { label: string; iconChar: string } {
  const n = typeof name === 'string' && name.trim() ? name.trim() : 'Custom mode'
  const ic = typeof icon === 'string' && icon.trim() ? icon.trim() : '✨'
  return { label: n, iconChar: ic }
}

export function safeDraftString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Coerce unknown persisted session mode to a known enum value for UI. */
export function coerceSessionMode(value: unknown, allowed: readonly SessionMode[]): SessionMode {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as SessionMode)
    : 'shared'
}

