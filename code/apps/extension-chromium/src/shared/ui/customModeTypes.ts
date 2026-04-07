/**
 * Custom WR Chat modes — persisted schema (v2).
 * Built-in modes remain in uiState.ts (MODE_INFO); only `type: "custom"` rows are stored here.
 *
 * Optional `metadata` is reserved for future expert / fine-tuned / provider-specific extensions
 * without breaking the core shape.
 */

import {
  isCustomModeIntervalPresetSeconds,
  snapSecondsToIntervalPreset,
} from './customModeIntervalPresets'

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
   * Optional periodic scan interval (seconds). Only preset values from the wizard select are stored.
   * Chat and manual scan are always available; when set, periodic runs are also scheduled.
   */
  intervalSeconds: number | null
  createdAt: string
  updatedAt: string
  /** Future: expert presets, LoRA ids, provider tokens, etc. */
  metadata?: Record<string, unknown>
}

/** Detection wizard scan presets (Add Mode → Focus step). */
export type DetectionScanModePreset = 'quick_scan' | 'structured_page_scan' | 'verified_research'

export function getDetectionScanMode(metadata: Record<string, unknown> | undefined): DetectionScanModePreset {
  const v = metadata?.detectionScanMode
  if (v === 'quick_scan' || v === 'structured_page_scan' || v === 'verified_research') return v
  return 'quick_scan'
}

/** True only when preset is verified research and the user opted in (read-only external verification). */
export function getExternalWebVerificationEnabled(metadata: Record<string, unknown> | undefined): boolean {
  if (getDetectionScanMode(metadata) !== 'verified_research') return false
  return metadata?.externalWebVerification === true
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
    intervalSeconds: null,
    metadata: {
      detectionScanMode: 'quick_scan',
      externalWebVerification: false,
    },
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
  partial: Partial<CustomModeDefinition> & { id?: string; intervalMinutes?: number | null },
): CustomModeDefinition {
  const now = new Date().toISOString()
  const id = partial.id?.startsWith('custom:') ? partial.id : createCustomModeId()
  const intervalSeconds = migrateIntervalSeconds(partial)

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
    intervalSeconds,
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
  delete m._wrExpertUploadError

  const scanMode = getDetectionScanMode(m)
  m.detectionScanMode = scanMode
  if (scanMode !== 'verified_research') {
    m.externalWebVerification = false
  } else if (m.externalWebVerification !== true) {
    m.externalWebVerification = false
  }

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
