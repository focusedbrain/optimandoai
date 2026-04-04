/**
 * Single source of truth for Trigger Name → routing hash-tag for InputCoordinator.
 * Strips leading `#` / `@`, lowercases the bare name (matches InputCoordinator
 * case-insensitive trigger comparison), then emits `#tag`.
 *
 * // normaliseTriggerTag('#a1')  → '#a1'
 * // normaliseTriggerTag('@a1')  → '#a1'
 * // normaliseTriggerTag('a1')   → '#a1'
 * // normaliseTriggerTag('#@a1') → '#a1'
 * // normaliseTriggerTag('#A1')  → '#a1'
 * // normaliseTriggerTag('')     → ''
 */
export function normaliseTriggerTag(raw: string): string {
  const bare = raw.trim().replace(/^[#@]+/, '').toLowerCase()
  return bare ? `#${bare}` : ''
}
