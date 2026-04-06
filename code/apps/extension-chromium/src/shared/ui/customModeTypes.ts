/**
 * Custom WR Chat modes — persisted schema (v2).
 * Built-in modes remain in uiState.ts (MODE_INFO); only `type: "custom"` rows are stored here.
 *
 * Optional `metadata` is reserved for future expert / fine-tuned / provider-specific extensions
 * without breaking the core shape.
 */

/** Persisted custom rows are always `custom`; `built-in` documents the union for tooling/UI. */
export type ModeTypeKind = 'built-in' | 'custom'

export type SessionMode = 'shared' | 'dedicated' | 'fresh'

/** How the mode runs in the shell (stored form). */
export type CustomRunMode = 'chat' | 'chat_scan' | 'interval'

export interface CustomModeDefinition {
  /** Stable id, format `custom:<uuid>` */
  id: string
  type: 'custom'
  name: string
  description: string
  icon: string
  modelProvider: string
  modelName: string
  /** e.g. Ollama base URL */
  endpoint: string
  sessionId: string | null
  sessionMode: SessionMode
  searchFocus: string
  ignoreInstructions: string
  runMode: CustomRunMode
  /** Set when `runMode === 'interval'`; otherwise `null` */
  intervalMinutes: number | null
  createdAt: string
  updatedAt: string
  /** Future: expert presets, LoRA ids, provider tokens, etc. */
  metadata?: Record<string, unknown>
}

/** Input for creating a new custom mode (server assigns id + timestamps). */
export type CustomModeDraft = Omit<CustomModeDefinition, 'id' | 'createdAt' | 'updatedAt' | 'type'>

export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434'

export function defaultCustomModeDraft(): CustomModeDraft {
  return {
    name: '',
    description: '',
    icon: '⚡',
    modelProvider: 'ollama',
    modelName: '',
    endpoint: DEFAULT_OLLAMA_ENDPOINT,
    sessionId: null,
    sessionMode: 'shared',
    searchFocus: '',
    ignoreInstructions: '',
    runMode: 'chat',
    intervalMinutes: null,
    metadata: undefined,
  }
}

/** Lowercase key for duplicate name checks (matches normalized persisted `name`). */
export function normalizeCustomModeNameKey(name: string | undefined): string {
  return (name?.trim() || 'Untitled').toLowerCase()
}

/**
 * New custom mode id — `custom:` + RFC-4122 UUID when available.
 * Falls back to a time-random segment only if `crypto.randomUUID` is missing.
 */
export function createCustomModeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `custom:${crypto.randomUUID()}`
  }
  const a = Date.now().toString(36)
  const b = Math.random().toString(36).slice(2, 12)
  const c = Math.random().toString(36).slice(2, 12)
  return `custom:${a}-${b}-${c}`
}

export function isCustomModeId(mode: string): boolean {
  return typeof mode === 'string' && mode.startsWith('custom:')
}

/**
 * Build a full persisted record from a draft (new mode).
 */
export function buildCustomModeFromDraft(draft: CustomModeDraft): CustomModeDefinition {
  const now = new Date().toISOString()
  const id = createCustomModeId()
  return normalizeCustomModeFields({
    ...draft,
    id,
    type: 'custom',
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * Apply safe defaults and clamp invalid values (single source of truth for “empty store” / partial rows).
 */
export function normalizeCustomModeFields(
  partial: Partial<CustomModeDefinition> & { id?: string },
): CustomModeDefinition {
  const now = new Date().toISOString()
  const id = partial.id?.startsWith('custom:') ? partial.id : createCustomModeId()
  const runMode: CustomRunMode =
    partial.runMode === 'chat' || partial.runMode === 'chat_scan' || partial.runMode === 'interval'
      ? partial.runMode
      : 'chat'
  let intervalMinutes: number | null =
    partial.intervalMinutes !== undefined && partial.intervalMinutes !== null
      ? Math.max(1, Math.floor(Number(partial.intervalMinutes)))
      : null
  if (runMode !== 'interval') {
    intervalMinutes = null
  } else if (intervalMinutes === null || !Number.isFinite(intervalMinutes)) {
    intervalMinutes = 5
  }

  return {
    id,
    type: 'custom',
    name: (partial.name ?? 'Untitled').trim() || 'Untitled',
    description: typeof partial.description === 'string' ? partial.description : '',
    icon: (partial.icon ?? '⚡').trim() || '⚡',
    modelProvider: (partial.modelProvider ?? 'ollama').trim() || 'ollama',
    modelName: (partial.modelName ?? '').trim(),
    endpoint: (partial.endpoint ?? DEFAULT_OLLAMA_ENDPOINT).trim() || DEFAULT_OLLAMA_ENDPOINT,
    sessionId:
      partial.sessionId === null || partial.sessionId === undefined || partial.sessionId === ''
        ? null
        : String(partial.sessionId),
    sessionMode:
      partial.sessionMode === 'dedicated' || partial.sessionMode === 'fresh' || partial.sessionMode === 'shared'
        ? partial.sessionMode
        : 'shared',
    searchFocus: typeof partial.searchFocus === 'string' ? partial.searchFocus : '',
    ignoreInstructions: typeof partial.ignoreInstructions === 'string' ? partial.ignoreInstructions : '',
    runMode,
    intervalMinutes,
    createdAt: partial.createdAt && isIsoDate(partial.createdAt) ? partial.createdAt : now,
    updatedAt: partial.updatedAt && isIsoDate(partial.updatedAt) ? partial.updatedAt : now,
    metadata:
      partial.metadata && typeof partial.metadata === 'object' && !Array.isArray(partial.metadata)
        ? { ...partial.metadata }
        : undefined,
  }
}

function isIsoDate(s: string): boolean {
  return !Number.isNaN(Date.parse(s))
}
