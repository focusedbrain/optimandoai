/**
 * Main-process custom WR Chat modes store — shared by dashboard + extension.
 * Model references (`modelName`) are opaque strings; resolution happens in runtime layers below.
 */

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { isUserDataPathBootstrapped } from '../../userDataBootstrapState'
import type { CustomModeDefinition, CustomModeDraft } from '../../../../extension-chromium/src/shared/ui/customModeTypes'
import {
  buildCustomModeFromDraft,
  normalizeCustomModeFields,
  normalizeCustomModeNameKey,
} from '../../../../extension-chromium/src/shared/ui/customModeTypes'
import {
  CUSTOM_MODES_SCHEMA_VERSION,
  coerceCustomModeRecord,
  migrateCustomModesPersistedState,
} from '../../../../extension-chromium/src/shared/ui/customModePersistence'

const MODES_FILE = 'custom-modes.json'
const META_FILE = 'custom-modes-meta.json'

export type CustomModesMigrationOrigin = 'dashboard' | 'extension'

export interface CustomModesMigrationMeta {
  localStorageImport: { dashboard: boolean; extension: boolean }
  completedAt?: string
}

interface CustomModesFileEnvelope {
  schemaVersion: number
  modes: CustomModeDefinition[]
  updatedAt: string
}

type StoreResult =
  | { ok: true; data: CustomModeDefinition[] }
  | { ok: false; error: string }

let writeLock: Promise<void> = Promise.resolve()

function withStoreLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = writeLock.then(() => fn())
  writeLock = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function modesPath(): string {
  if (!app.isPackaged && !isUserDataPathBootstrapped()) {
    console.error(
      '[CustomModes] INVARIANT VIOLATION: modesPath() before bootstrapUserData — ' +
        'may read/write default Electron userData instead of ~/.opengiraffe/electron-data',
    )
  }
  return path.join(app.getPath('userData'), MODES_FILE)
}

function metaPath(): string {
  return path.join(app.getPath('userData'), META_FILE)
}

function modesBackupPath(): string {
  return `${modesPath()}.bak`
}

function defaultMigrationMeta(): CustomModesMigrationMeta {
  return { localStorageImport: { dashboard: false, extension: false } }
}

function readMeta(): CustomModesMigrationMeta {
  try {
    const p = metaPath()
    if (!fs.existsSync(p)) return defaultMigrationMeta()
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<CustomModesMigrationMeta>
    const ls = parsed.localStorageImport
    return {
      localStorageImport: {
        dashboard: ls?.dashboard === true,
        extension: ls?.extension === true,
      },
      completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : undefined,
    }
  } catch (e) {
    console.warn('[CustomModes] readMeta failed:', e instanceof Error ? e.message : e)
    return defaultMigrationMeta()
  }
}

function writeMeta(meta: CustomModesMigrationMeta): void {
  const p = metaPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const payload = JSON.stringify(meta, null, 2)
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, payload, 'utf-8')
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
    fs.renameSync(tmp, p)
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

function backupModesFileIfExists(): void {
  const p = modesPath()
  if (!fs.existsSync(p)) return
  try {
    fs.copyFileSync(p, modesBackupPath())
  } catch (e) {
    console.warn('[CustomModes] .bak copy skipped:', e instanceof Error ? e.message : e)
  }
}

function atomicWriteModes(envelope: CustomModesFileEnvelope): void {
  const p = modesPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  backupModesFileIfExists()
  const payload = JSON.stringify(envelope, null, 2)
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, payload, 'utf-8')
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
    fs.renameSync(tmp, p)
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

function normalizeModesFromRaw(raw: unknown[]): CustomModeDefinition[] {
  return raw
    .map((row) => coerceCustomModeRecord(row))
    .filter((m): m is CustomModeDefinition => m !== null)
    .map((m) => normalizeCustomModeFields(m))
}

function readModesEnvelope(): CustomModesFileEnvelope {
  const empty: CustomModesFileEnvelope = {
    schemaVersion: CUSTOM_MODES_SCHEMA_VERSION,
    modes: [],
    updatedAt: new Date().toISOString(),
  }
  const p = modesPath()
  if (!fs.existsSync(p)) return empty

  const tryParse = (label: 'primary' | 'backup', text: string): CustomModesFileEnvelope | null => {
    try {
      const parsed = JSON.parse(text) as unknown
      if (Array.isArray(parsed)) {
        return {
          schemaVersion: CUSTOM_MODES_SCHEMA_VERSION,
          modes: normalizeModesFromRaw(parsed),
          updatedAt: new Date().toISOString(),
        }
      }
      if (!parsed || typeof parsed !== 'object') return null
      const o = parsed as Record<string, unknown>
      if (Array.isArray(o.modes)) {
        const migrated = migrateCustomModesPersistedState({ state: { modes: o.modes } }, CUSTOM_MODES_SCHEMA_VERSION)
        return {
          schemaVersion: CUSTOM_MODES_SCHEMA_VERSION,
          modes: migrated.state.modes,
          updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
        }
      }
      if (o.state && typeof o.state === 'object' && Array.isArray((o.state as { modes?: unknown[] }).modes)) {
        const migrated = migrateCustomModesPersistedState(parsed, CUSTOM_MODES_SCHEMA_VERSION)
        return {
          schemaVersion: CUSTOM_MODES_SCHEMA_VERSION,
          modes: migrated.state.modes,
          updatedAt: new Date().toISOString(),
        }
      }
      console.warn(`[CustomModes] readModesEnvelope: unrecognized shape (${label})`)
      return null
    } catch (e) {
      console.warn(`[CustomModes] readModesEnvelope parse failed (${label}):`, e instanceof Error ? e.message : e)
      return null
    }
  }

  try {
    const primary = fs.readFileSync(p, 'utf-8')
    const fromPrimary = tryParse('primary', primary)
    if (fromPrimary) return fromPrimary
  } catch (e) {
    console.warn('[CustomModes] readModesEnvelope primary read failed:', e instanceof Error ? e.message : e)
  }

  const bak = modesBackupPath()
  if (fs.existsSync(bak)) {
    try {
      const backup = fs.readFileSync(bak, 'utf-8')
      const fromBackup = tryParse('backup', backup)
      if (fromBackup) {
        console.warn('[CustomModes] Loaded modes from .bak after primary read/parse failed')
        return fromBackup
      }
    } catch (e) {
      console.warn('[CustomModes] readModesEnvelope backup read failed:', e instanceof Error ? e.message : e)
    }
  }

  return empty
}

function writeModes(modes: CustomModeDefinition[]): CustomModeDefinition[] {
  const normalized = modes.map((m) => normalizeCustomModeFields(m))
  atomicWriteModes({
    schemaVersion: CUSTOM_MODES_SCHEMA_VERSION,
    modes: normalized,
    updatedAt: new Date().toISOString(),
  })
  return normalized
}

function findDuplicateName(modes: CustomModeDefinition[], name: string, excludeId?: string): boolean {
  const key = normalizeCustomModeNameKey(name)
  return modes.some((m) => m.id !== excludeId && normalizeCustomModeNameKey(m.name) === key)
}

/**
 * Merge incoming modes into existing list.
 * Same id → newest `updatedAt` wins; tie → prefer incoming batch.
 * Same normalized name, different ids → skip incoming and log (metadata only).
 */
export function mergeCustomModes(
  existing: CustomModeDefinition[],
  incoming: CustomModeDefinition[],
  preferIncomingOnTie = true,
): CustomModeDefinition[] {
  const byId = new Map<string, CustomModeDefinition>()
  for (const mode of existing.map((m) => normalizeCustomModeFields(m))) {
    byId.set(mode.id, mode)
  }

  for (const raw of incoming) {
    const coerced = coerceCustomModeRecord(raw)
    if (!coerced) continue
    const mode = normalizeCustomModeFields(coerced)
    const prev = byId.get(mode.id)
    if (prev) {
      const prevTs = Date.parse(prev.updatedAt) || 0
      const nextTs = Date.parse(mode.updatedAt) || 0
      if (nextTs > prevTs || (nextTs === prevTs && preferIncomingOnTie)) {
        byId.set(mode.id, mode)
      }
      continue
    }

    const nameKey = normalizeCustomModeNameKey(mode.name)
    const nameConflict = [...byId.values()].some(
      (m) => m.id !== mode.id && normalizeCustomModeNameKey(m.name) === nameKey,
    )
    if (nameConflict) {
      console.log('[CustomModes] import skip duplicate name', {
        nameKey,
        incomingId: mode.id,
      })
      continue
    }
    byId.set(mode.id, mode)
  }

  return [...byId.values()]
}

function mutateModes(mutator: (modes: CustomModeDefinition[]) => CustomModeDefinition[]): StoreResult {
  try {
    const current = readModesEnvelope().modes
    const next = mutator(current)
    const written = writeModes(next)
    return { ok: true, data: written }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'unknown')
    console.error('[CustomModes] mutation failed:', msg)
    return { ok: false, error: msg }
  }
}

export function listModes(): CustomModeDefinition[] {
  return readModesEnvelope().modes
}

export function getModeById(id: string): CustomModeDefinition | undefined {
  return listModes().find((m) => m.id === id)
}

export function getMigrationStatus(): CustomModesMigrationMeta {
  return readMeta()
}

export async function createMode(draft: CustomModeDraft): Promise<StoreResult> {
  return withStoreLock(() => {
    if (findDuplicateName(readModesEnvelope().modes, draft.name ?? '')) {
      return { ok: false, error: 'A mode with this name already exists. Choose a different name.' }
    }
    let created: CustomModeDefinition
    try {
      created = buildCustomModeFromDraft(draft)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? 'unknown')
      return { ok: false, error: msg }
    }
    return mutateModes((modes) => [...modes, created])
  })
}

export async function updateMode(id: string, patch: Partial<CustomModeDraft>): Promise<StoreResult> {
  return withStoreLock(() => {
    if (!id.startsWith('custom:')) {
      return { ok: false, error: 'invalid mode id' }
    }
    const envelope = readModesEnvelope()
    const idx = envelope.modes.findIndex((m) => m.id === id)
    if (idx < 0) {
      return { ok: false, error: 'mode not found' }
    }
    const nextName = patch.name !== undefined ? patch.name : envelope.modes[idx].name
    if (findDuplicateName(envelope.modes, nextName, id)) {
      return { ok: false, error: 'A mode with this name already exists. Choose a different name.' }
    }
    const now = new Date().toISOString()
    return mutateModes((modes) =>
      modes.map((m) => {
        if (m.id !== id) return m
        return normalizeCustomModeFields({
          ...m,
          ...patch,
          id,
          type: 'custom',
          updatedAt: now,
        })
      }),
    )
  })
}

export async function deleteMode(id: string): Promise<StoreResult> {
  return withStoreLock(() => {
    if (!id.startsWith('custom:')) {
      return { ok: false, error: 'invalid mode id' }
    }
    const envelope = readModesEnvelope()
    if (!envelope.modes.some((m) => m.id === id)) {
      return { ok: false, error: 'mode not found' }
    }
    return mutateModes((modes) => modes.filter((m) => m.id !== id))
  })
}

export async function importModes(
  modes: unknown[],
  origin: CustomModesMigrationOrigin,
): Promise<StoreResult> {
  return withStoreLock(() => {
    const incoming = normalizeModesFromRaw(Array.isArray(modes) ? modes : [])
    const result = mutateModes((existing) => mergeCustomModes(existing, incoming, true))
    if (result.ok) {
      const meta = readMeta()
      meta.localStorageImport[origin] = true
      if (meta.localStorageImport.dashboard && meta.localStorageImport.extension) {
        meta.completedAt = new Date().toISOString()
      }
      writeMeta(meta)
    }
    return result
  })
}

/** @internal Test helper — reset in-memory lock between cases. */
export function resetCustomModesWriteLockForTests(): void {
  writeLock = Promise.resolve()
}

/** @internal Test helper — read envelope directly. */
export function readModesEnvelopeForTests(): CustomModesFileEnvelope {
  return readModesEnvelope()
}
