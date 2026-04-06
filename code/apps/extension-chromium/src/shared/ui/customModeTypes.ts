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
  /**
   * Optional periodic scan interval (minutes). Chat and manual scan are always available;
   * when set, periodic runs are also scheduled.
   */
  intervalMinutes: number | null
  createdAt: string
  updatedAt: string
  /** Future: expert presets, LoRA ids, provider tokens, etc. */
  metadata?: Record<string, unknown>
}

/** Persisted optional scope: websites (http(s) URLs or host patterns) and folder diff watch path. */
export type CustomModeScopeMetadata = {
  /** Pages or sites this mode should prioritize (full URLs or host patterns). */
  scopeUrls?: string[]
  /** Absolute path watched for file add/change diffs (Electron desktop). */
  diffWatchFolder?: string
}

/** Wizard-only draft for the scope URL textarea (stripped before persist). */
export const CUSTOM_MODE_SCOPE_URLS_DRAFT_KEY = '_scopeUrlsDraft' as const

export function getCustomModeScopeFromMetadata(
  metadata: Record<string, unknown> | undefined,
): { scopeUrls: string[]; diffWatchFolder: string } {
  if (!metadata || typeof metadata !== 'object') return { scopeUrls: [], diffWatchFolder: '' }
  const scopeUrls = Array.isArray(metadata.scopeUrls)
    ? (metadata.scopeUrls as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  const diffWatchFolder = typeof metadata.diffWatchFolder === 'string' ? metadata.diffWatchFolder.trim() : ''
  return { scopeUrls, diffWatchFolder }
}

/** Textarea value for the scope URLs step (draft or joined persisted URLs). */
export function getScopeUrlsDraftText(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || typeof metadata !== 'object') return ''
  const draft = metadata[CUSTOM_MODE_SCOPE_URLS_DRAFT_KEY]
  if (typeof draft === 'string') return draft
  if (Array.isArray(metadata.scopeUrls)) {
    return (metadata.scopeUrls as string[]).filter((s) => typeof s === 'string').join('\n')
  }
  return ''
}

/**
 * True if the line is empty or looks like an http(s) URL or host/path pattern for scoping.
 */
export function isValidCustomModeScopeUrlLine(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  try {
    const u = new URL(t)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    try {
      new URL(`https://${t}`)
      return true
    } catch {
      return /^[\w.\-\/*:?]+$/.test(t) && (t.includes('.') || t.includes('*'))
    }
  }
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
  const intervalMinutes = migrateIntervalMinutes(partial)

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
    intervalMinutes,
    createdAt: partial.createdAt && isIsoDate(partial.createdAt) ? partial.createdAt : now,
    updatedAt: partial.updatedAt && isIsoDate(partial.updatedAt) ? partial.updatedAt : now,
    metadata: sanitizeCustomModeMetadataForPersist(partial.metadata),
  }
}

/** Drop wizard-only keys (e.g. live Ollama tag lists) before persisting. */
function sanitizeCustomModeMetadataForPersist(
  metadata: CustomModeDefinition['metadata'],
): CustomModeDefinition['metadata'] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  const m = { ...metadata } as Record<string, unknown>
  delete m._ollamaTags
  delete m._sessionLabel

  const draftUrls = m[CUSTOM_MODE_SCOPE_URLS_DRAFT_KEY]
  if (typeof draftUrls === 'string') {
    const scopeUrls = draftUrls
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (scopeUrls.length) m.scopeUrls = scopeUrls
    else delete m.scopeUrls
  } else if (Array.isArray(m.scopeUrls)) {
    const scopeUrls = (m.scopeUrls as unknown[])
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
    if (scopeUrls.length) m.scopeUrls = scopeUrls
    else delete m.scopeUrls
  }
  delete m[CUSTOM_MODE_SCOPE_URLS_DRAFT_KEY]

  if (typeof m.diffWatchFolder === 'string') {
    const fp = m.diffWatchFolder.trim()
    if (fp) m.diffWatchFolder = fp
    else delete m.diffWatchFolder
  }

  return Object.keys(m).length ? (m as Record<string, unknown>) : undefined
}

function isIsoDate(s: string): boolean {
  return !Number.isNaN(Date.parse(s))
}

/** Legacy rows stored `runMode` + `intervalMinutes`; new schema uses only `intervalMinutes`. */
function migrateIntervalMinutes(
  partial: Partial<CustomModeDefinition> & { runMode?: unknown },
): number | null {
  const hasLegacyRun = 'runMode' in partial && partial.runMode !== undefined
  if (hasLegacyRun) {
    if (partial.runMode === 'interval') {
      const n = partial.intervalMinutes
      if (n === undefined || n === null || !Number.isFinite(Number(n))) return 5
      return Math.max(1, Math.floor(Number(n)))
    }
    return null
  }
  if (partial.intervalMinutes === undefined || partial.intervalMinutes === null) return null
  const n = Math.floor(Number(partial.intervalMinutes))
  if (!Number.isFinite(n) || n < 1) return null
  return n
}
