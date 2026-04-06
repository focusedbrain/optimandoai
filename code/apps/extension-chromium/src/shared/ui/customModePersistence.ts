/**
 * Local persistence helpers for custom modes (Zustand-compatible + standalone JSON).
 * Backward-safe: empty arrays, legacy v1 nested shape, partial rows.
 */

import {
  type CustomModeDefinition,
  type CustomRunMode,
  type SessionMode,
  DEFAULT_OLLAMA_ENDPOINT,
  normalizeCustomModeFields,
} from './customModeTypes'

/** Zustand persist localStorage name (unchanged so existing installs keep their data). */
export const CUSTOM_MODES_PERSIST_KEY = 'wr-ui-custom-modes-v1'

export const CUSTOM_MODES_SCHEMA_VERSION = 2

type PersistedSlice = { modes: CustomModeDefinition[] }

/**
 * Migrate unknown persisted Zustand state to `{ state: { modes } }` shape.
 * Call from persist `migrate` (version &lt; 2 or defensive normalize on v2).
 */
export function migrateCustomModesPersistedState(
  persistedState: unknown,
  _storedVersion: number,
): { state: PersistedSlice } {
  const empty = { state: { modes: [] as CustomModeDefinition[] } }
  if (persistedState === null || persistedState === undefined) return empty
  if (typeof persistedState !== 'object') return empty

  const p = persistedState as { state?: { modes?: unknown } }
  const rawModes = Array.isArray(p.state?.modes) ? p.state!.modes! : []

  const modes = rawModes
    .map((row) => coerceCustomModeRecord(row))
    .filter((m): m is CustomModeDefinition => m !== null)
    .map((m) => normalizeCustomModeFields(m))

  return { state: { modes } }
}

/**
 * Accept legacy nested v1 rows or flat v2 rows; return a normalized definition or null.
 */
export function coerceCustomModeRecord(raw: unknown): CustomModeDefinition | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  if (isLegacyNestedShape(r)) {
    return migrateLegacyNestedRow(r)
  }

  if (typeof r.id === 'string' && r.id.startsWith('custom:')) {
    return normalizeCustomModeFields(r as Partial<CustomModeDefinition>)
  }

  return null
}

function isLegacyNestedShape(r: Record<string, unknown>): boolean {
  return (
    r.model !== null &&
    typeof r.model === 'object' &&
    r.focus !== null &&
    typeof r.focus === 'object' &&
    !('searchFocus' in r)
  )
}

function migrateLegacyNestedRow(r: Record<string, unknown>): CustomModeDefinition | null {
  const id = typeof r.id === 'string' ? r.id : ''
  if (!id.startsWith('custom:')) return null

  const model = r.model as Record<string, unknown>
  const session = (r.session as Record<string, unknown>) ?? {}
  const focus = (r.focus as Record<string, unknown>) ?? {}

  const runBehavior = String(r.runBehavior ?? '')
  let runMode: CustomRunMode = 'chat'
  if (runBehavior === 'chat_only') runMode = 'chat'
  else if (runBehavior === 'chat_and_scan') runMode = 'chat_scan'
  else if (runBehavior === 'interval') runMode = 'interval'

  const intervalMs = typeof r.intervalMs === 'number' ? r.intervalMs : null
  let intervalMinutes: number | null = null
  if (runMode === 'interval') {
    intervalMinutes = Math.max(1, Math.round((intervalMs ?? 300_000) / 60_000))
  }

  const createdAt = typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString()

  return normalizeCustomModeFields({
    id,
    type: 'custom',
    name: String(r.name ?? ''),
    description: r.description !== undefined && r.description !== null ? String(r.description) : '',
    icon: String(r.icon ?? '⚡'),
    modelProvider: String(model?.provider ?? 'ollama'),
    modelName: String(model?.modelName ?? ''),
    endpoint:
      model?.endpoint !== undefined && model?.endpoint !== null && String(model.endpoint).trim() !== ''
        ? String(model.endpoint)
        : DEFAULT_OLLAMA_ENDPOINT,
    sessionId:
      session.sessionId === null || session.sessionId === undefined || session.sessionId === ''
        ? null
        : String(session.sessionId),
    sessionMode: normalizeSessionMode(session.sessionMode),
    searchFocus: String(focus.lookFor ?? ''),
    ignoreInstructions:
      focus.ignoreInstructions !== undefined && focus.ignoreInstructions !== null
        ? String(focus.ignoreInstructions)
        : '',
    runMode,
    intervalMinutes,
    createdAt,
    updatedAt: createdAt,
    metadata: undefined,
  })
}

function normalizeSessionMode(v: unknown): SessionMode {
  if (v === 'dedicated' || v === 'fresh' || v === 'shared') return v
  return 'shared'
}

// ── Standalone JSON helpers (export/import, tests, backup) ─────────────────

/** Serialize modes array to JSON (pretty optional). */
export function stringifyCustomModes(modes: CustomModeDefinition[], pretty = false): string {
  const payload = { schemaVersion: CUSTOM_MODES_SCHEMA_VERSION, modes }
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload)
}

/**
 * Parse JSON from backup or clipboard; returns empty array on failure / empty input.
 */
export function parseCustomModesJson(json: string | null | undefined): CustomModeDefinition[] {
  if (json === null || json === undefined || String(json).trim() === '') return []
  try {
    const data = JSON.parse(json) as unknown
    let raw: unknown[] = []
    if (Array.isArray(data)) {
      raw = data
    } else if (data && typeof data === 'object') {
      const o = data as Record<string, unknown>
      if (Array.isArray(o.modes)) raw = o.modes
      else if (o.state && typeof o.state === 'object' && Array.isArray((o.state as { modes?: unknown[] }).modes)) {
        raw = (o.state as { modes: unknown[] }).modes
      }
    }
    return raw
      .map((row) => coerceCustomModeRecord(row))
      .filter((m): m is CustomModeDefinition => m !== null)
      .map((m) => normalizeCustomModeFields(m))
  } catch {
    return []
  }
}

/**
 * Read modes from localStorage backup key (optional second copy); same coercion as persist.
 */
export function loadCustomModesFromLocalStorageKey(storageKey: string): CustomModeDefinition[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey)
    return parseCustomModesJson(raw)
  } catch {
    return []
  }
}

/**
 * Write modes to a backup key (does not replace Zustand persist — use for export/duplicate).
 */
export function saveCustomModesToLocalStorageKey(storageKey: string, modes: CustomModeDefinition[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(storageKey, stringifyCustomModes(modes))
  } catch {
    /* quota / private mode */
  }
}
