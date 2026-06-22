/**
 * Custom WR Chat modes — persisted schema (v4).
 * User rows: `custom:*`. Shipped built-in rows: `built-in:*` (non-deletable, e.g. Scam Watchdog).
 *
 * Optional `metadata` is reserved for future expert / fine-tuned / provider-specific extensions
 * without breaking the core shape.
 *
 * Add Mode wizard: orchestration and mode setup only (focus, ignore, WR Expert, scope, diff watch, interval).
 * Scan depth, external lookup, autonomy, and tool permissions belong at the agent level—not in mode metadata.
 */

import {
  isCustomModeIntervalPresetSeconds,
  snapSecondsToIntervalPreset,
} from './customModeIntervalPresets'

/** Persisted rows: `custom:*` (user) or `built-in:*` (shipped, non-deletable). */
export type ModeTypeKind = 'built-in' | 'custom'

export type SessionMode = 'shared' | 'dedicated' | 'fresh'

/** Structured profile field for career-builder-style modes (optional on any custom mode). */
export type CustomModeProfileFieldType = 'text' | 'longtext' | 'select'

export interface CustomModeProfileField {
  /** Stable key within the mode (slug from label when omitted on input). */
  key: string
  label: string
  value: string
  type?: CustomModeProfileFieldType
  /** Required when `type` is `select`. */
  options?: string[]
}

export interface CustomModeDefinition {
  /** Stable id — `custom:<uuid>` or `built-in:<key>`. */
  id: string
  type: ModeTypeKind
  /** When `false`, delete is rejected (built-in modes). */
  deletable?: boolean
  /** Stable built-in identifier, e.g. `scam-watchdog`. */
  builtInKey?: string
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
   * Optional structured profile fields (goals, location, criteria, etc.) folded into the LLM prefix.
   * Modes without this field behave exactly as before v3 schema.
   */
  profileFields?: CustomModeProfileField[]
  /**
   * Optional periodic scan interval (seconds). Only preset values from the wizard select are stored.
   * Chat and manual scan are always available; when set, periodic runs are also scheduled.
   */
  intervalSeconds: number | null
  createdAt: string
  updatedAt: string
  /**
   * Future: expert presets, LoRA ids, provider tokens, etc.
   * **`triggerBarIcon`** (string): optional; when set, this automation appears in the WR Chat header dropdown.
   */
  metadata?: Record<string, unknown>
}

/** Persisted optional scope: websites (http(s) URLs or host patterns) and folder diff watch paths. */
export type CustomModeScopeMetadata = {
  /** Pages or sites this mode should prioritize (full URLs or host patterns). */
  scopeUrls?: string[]
  /** Absolute paths watched for file add/change diffs (Electron desktop). */
  diffWatchFolders?: string[]
  /** @deprecated Use `diffWatchFolders`. Migrated on read. */
  diffWatchFolder?: string
}

/** Wizard-only draft for the scope URL textarea (stripped before persist). */
export const CUSTOM_MODE_SCOPE_URLS_DRAFT_KEY = '_scopeUrlsDraft' as const

/** Wizard-only draft for multi-line diff folder paths (stripped before persist). */
export const CUSTOM_MODE_DIFF_FOLDERS_DRAFT_KEY = '_diffWatchFoldersDraft' as const

/** When non-empty after trim, the automation is listed in the WR Chat header dropdown (desktop). */
export const CUSTOM_MODE_TRIGGER_BAR_ICON_KEY = 'triggerBarIcon' as const

export function getCustomModeTriggerBarIcon(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || typeof metadata !== 'object') return ''
  const v = metadata[CUSTOM_MODE_TRIGGER_BAR_ICON_KEY]
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

export function getCustomModeScopeFromMetadata(
  metadata: Record<string, unknown> | undefined,
): { scopeUrls: string[]; diffWatchFolders: string[] } {
  if (!metadata || typeof metadata !== 'object') return { scopeUrls: [], diffWatchFolders: [] }
  const scopeUrls = Array.isArray(metadata.scopeUrls)
    ? (metadata.scopeUrls as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  let diffWatchFolders: string[] = []
  if (Array.isArray(metadata.diffWatchFolders)) {
    diffWatchFolders = (metadata.diffWatchFolders as unknown[])
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
  } else if (typeof metadata.diffWatchFolder === 'string' && metadata.diffWatchFolder.trim()) {
    diffWatchFolders = [metadata.diffWatchFolder.trim()]
  }
  return { scopeUrls, diffWatchFolders }
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

/** Textarea value for diff watch folders (draft or joined persisted paths). */
export function getDiffWatchFoldersDraftText(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || typeof metadata !== 'object') return ''
  const draft = metadata[CUSTOM_MODE_DIFF_FOLDERS_DRAFT_KEY]
  if (typeof draft === 'string') return draft
  if (Array.isArray(metadata.diffWatchFolders)) {
    return (metadata.diffWatchFolders as string[]).filter((s) => typeof s === 'string').join('\n')
  }
  if (typeof metadata.diffWatchFolder === 'string') return metadata.diffWatchFolder
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
    profileFields: undefined,
    intervalSeconds: null,
    metadata: undefined,
  }
}

/** Slug for a profile field key from its label (wizard + normalize). */
export function slugCustomModeProfileFieldKey(label: string, index: number): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return slug || `field_${index + 1}`
}

/** Coerce persisted / draft profile rows; returns `undefined` when empty or invalid. */
export function normalizeProfileFields(raw: unknown): CustomModeProfileField[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: CustomModeProfileField[] = []
  const seenKeys = new Set<string>()
  raw.forEach((row, i) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return
    const r = row as Record<string, unknown>
    const label = typeof r.label === 'string' ? r.label.trim() : ''
    const value = typeof r.value === 'string' ? r.value : ''
    if (!label && !value.trim()) return
    let key = typeof r.key === 'string' ? r.key.trim() : ''
    if (!key) key = slugCustomModeProfileFieldKey(label || `Field ${i + 1}`, i)
    let uniqueKey = key
    let n = 2
    while (seenKeys.has(uniqueKey)) {
      uniqueKey = `${key}_${n++}`
    }
    seenKeys.add(uniqueKey)
    const type =
      r.type === 'text' || r.type === 'longtext' || r.type === 'select' ? r.type : undefined
    let options: string[] | undefined
    if (type === 'select' && Array.isArray(r.options)) {
      options = (r.options as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
      if (options.length === 0) options = undefined
    }
    const field: CustomModeProfileField = {
      key: uniqueKey,
      label: label || uniqueKey,
      value,
    }
    if (type) field.type = type
    if (options?.length) field.options = options
    out.push(field)
  })
  return out.length ? out : undefined
}

/** Labeled block for LLM prefix injection; `null` when no non-empty fields. */
export function formatCustomModeProfileFieldsForPrefix(
  fields: CustomModeProfileField[] | undefined,
): string | null {
  if (!fields?.length) return null
  const lines = fields
    .map((f) => {
      const label = f.label?.trim()
      const value = f.value?.trim()
      if (!label || !value) return null
      return `${label}: ${value}`
    })
    .filter((line): line is string => line !== null)
  if (lines.length === 0) return null
  return `[Mode profile]\n${lines.join('\n')}`
}

/** Empty profile row for the wizard “add field” action. */
export function createEmptyCustomModeProfileField(index: number): CustomModeProfileField {
  return {
    key: slugCustomModeProfileFieldKey('', index),
    label: '',
    value: '',
    type: 'text',
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

export function isBuiltInModeId(mode: string): boolean {
  return typeof mode === 'string' && mode.startsWith('built-in:')
}

export function isPersistedModeId(mode: string): boolean {
  return isCustomModeId(mode) || isBuiltInModeId(mode)
}

export function isModeDeletable(def: CustomModeDefinition): boolean {
  if (def.type === 'built-in') return false
  if (def.deletable === false) return false
  return def.id.startsWith('custom:')
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
  partial: Partial<CustomModeDefinition> & { id?: string; intervalMinutes?: number | null },
): CustomModeDefinition {
  const now = new Date().toISOString()
  const id =
    partial.id?.startsWith('custom:') || partial.id?.startsWith('built-in:')
      ? partial.id
      : partial.type === 'built-in' && partial.builtInKey
        ? `built-in:${partial.builtInKey}`
        : createCustomModeId()
  const type: ModeTypeKind = id.startsWith('built-in:') ? 'built-in' : 'custom'
  const intervalSeconds = migrateIntervalSeconds(partial)

  const normalized: CustomModeDefinition = {
    id,
    type,
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
    profileFields: normalizeProfileFields(partial.profileFields),
    intervalSeconds,
    createdAt: partial.createdAt && isIsoDate(partial.createdAt) ? partial.createdAt : now,
    updatedAt: partial.updatedAt && isIsoDate(partial.updatedAt) ? partial.updatedAt : now,
    metadata: sanitizeCustomModeMetadataForPersist(partial.metadata),
  }
  if (type === 'built-in') {
    normalized.deletable = false
    if (partial.builtInKey) normalized.builtInKey = partial.builtInKey
    else if (id.startsWith('built-in:')) normalized.builtInKey = id.slice('built-in:'.length)
  } else if (partial.deletable === false) {
    normalized.deletable = false
  }
  return normalized
}

/** Drop wizard-only keys (e.g. live Ollama tag lists) before persisting. */
function sanitizeCustomModeMetadataForPersist(
  metadata: CustomModeDefinition['metadata'],
): CustomModeDefinition['metadata'] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  const m = { ...metadata } as Record<string, unknown>
  delete m._ollamaTags
  delete m._sessionLabel
  delete m._wrExpertUploadError
  delete m.detectionScanMode
  delete m.externalWebVerification

  const wr = m.wrExpertProfile
  if (wr && typeof wr === 'object' && !Array.isArray(wr)) {
    const emphasis = (wr as { emphasis?: { terms?: unknown; entityHints?: unknown } }).emphasis
    const deemphasis = (wr as { deemphasis?: { terms?: unknown } }).deemphasis
    const eTerms = Array.isArray(emphasis?.terms) ? emphasis.terms.filter((x): x is string => typeof x === 'string') : []
    const eEnt = Array.isArray(emphasis?.entityHints)
      ? emphasis.entityHints.filter((x): x is string => typeof x === 'string')
      : []
    const dTerms = Array.isArray(deemphasis?.terms)
      ? deemphasis.terms.filter((x): x is string => typeof x === 'string')
      : []
    if (eTerms.length === 0 && eEnt.length === 0 && dTerms.length === 0) {
      delete m.wrExpertProfile
      delete m.wrExpertFileName
    }
  }

  const draftDiff = m[CUSTOM_MODE_DIFF_FOLDERS_DRAFT_KEY]
  if (typeof draftDiff === 'string') {
    const folders = draftDiff
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const seen = new Set<string>()
    const uniq = folders.filter((f) => (seen.has(f) ? false : (seen.add(f), true)))
    if (uniq.length) m.diffWatchFolders = uniq
    else delete m.diffWatchFolders
  } else if (Array.isArray(m.diffWatchFolders)) {
    const seen = new Set<string>()
    const folders = (m.diffWatchFolders as unknown[])
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((f) => (seen.has(f) ? false : (seen.add(f), true)))
    if (folders.length) m.diffWatchFolders = folders
    else delete m.diffWatchFolders
  }
  if (typeof m.diffWatchFolder === 'string') {
    const fp = m.diffWatchFolder.trim()
    if (fp && !Array.isArray(m.diffWatchFolders)) m.diffWatchFolders = [fp]
    delete m.diffWatchFolder
  }
  delete m[CUSTOM_MODE_DIFF_FOLDERS_DRAFT_KEY]

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

  if (typeof m[CUSTOM_MODE_TRIGGER_BAR_ICON_KEY] === 'string') {
    const pin = m[CUSTOM_MODE_TRIGGER_BAR_ICON_KEY].trim()
    if (pin) m[CUSTOM_MODE_TRIGGER_BAR_ICON_KEY] = pin
    else delete m[CUSTOM_MODE_TRIGGER_BAR_ICON_KEY]
  }

  return Object.keys(m).length ? (m as Record<string, unknown>) : undefined
}

function isIsoDate(s: string): boolean {
  return !Number.isNaN(Date.parse(s))
}

/** Legacy rows used `runMode` + `intervalMinutes` (minutes); v2 used `intervalMinutes`; current schema uses `intervalSeconds` (presets). */
function migrateIntervalSeconds(
  partial: Partial<CustomModeDefinition> & { runMode?: unknown; intervalMinutes?: number | null },
): number | null {
  const hasLegacyRun = 'runMode' in partial && partial.runMode !== undefined
  if (hasLegacyRun) {
    if (partial.runMode === 'interval') {
      const n = partial.intervalMinutes
      if (n === undefined || n === null || !Number.isFinite(Number(n))) {
        return snapSecondsToIntervalPreset(300) ?? 300
      }
      return snapSecondsToIntervalPreset(Math.max(1, Math.floor(Number(n))) * 60)
    }
    return null
  }
  if (partial.intervalSeconds != null && partial.intervalSeconds !== undefined) {
    const s = Number(partial.intervalSeconds)
    if (!Number.isFinite(s) || s <= 0) return null
    return isCustomModeIntervalPresetSeconds(s) ? s : snapSecondsToIntervalPreset(s)
  }
  if (partial.intervalMinutes === undefined || partial.intervalMinutes === null) return null
  const mins = Math.floor(Number(partial.intervalMinutes))
  if (!Number.isFinite(mins) || mins < 1) return null
  return snapSecondsToIntervalPreset(mins * 60)
}
