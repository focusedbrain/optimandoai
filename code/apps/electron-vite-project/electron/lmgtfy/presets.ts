import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface RegionPreset {
  id: string
  name?: string
  /** Optional command text saved with the area trigger (WR Chat augmentation). */
  command?: string
  /** Normalised `#tag` for InputCoordinator / agent routing (derived from name). */
  tag?: string
  displayId?: number
  x: number
  y: number
  w: number
  h: number
  mode?: 'screenshot' | 'stream'
  headless?: boolean
  createdAt: number
  updatedAt: number
}

export interface PresetsFile {
  regions: RegionPreset[]
  autoSend: boolean
}

// Lazy getters to avoid calling app.getPath() before app is ready
function getRootDir() {
  return path.join(app.getPath('home'), '.opengiraffe', 'lmgtfy')
}

function getFilePath() {
  return path.join(getRootDir(), 'regions.json')
}

function getTaggedTriggersPath() {
  return path.join(getRootDir(), 'tagged-triggers.json')
}

/** Same normalisation as extension `normaliseTriggerTag` — persisted for stable agent matching. */
export function normalisePresetTag(raw: string | undefined): string {
  if (!raw || typeof raw !== 'string') return ''
  const bare = raw.trim().replace(/^[#@]+/, '').toLowerCase()
  return bare ? `#${bare}` : ''
}

function ensureDir() {
  fs.mkdirSync(getRootDir(), { recursive: true })
}

export function loadPresets(): PresetsFile {
  try {
    ensureDir()
    const fp = getFilePath()
    if (!fs.existsSync(fp)) return { regions: [], autoSend: false }
    const raw = fs.readFileSync(fp, 'utf8')
    const data = JSON.parse(raw)
    return { regions: data.regions ?? [], autoSend: !!data.autoSend }
  } catch {
    return { regions: [], autoSend: false }
  }
}

export function savePresets(data: PresetsFile) {
  ensureDir()
  fs.writeFileSync(getFilePath(), JSON.stringify(data, null, 2), 'utf8')
}

export function loadTaggedTriggersList(): unknown[] {
  try {
    ensureDir()
    const fp = getTaggedTriggersPath()
    if (!fs.existsSync(fp)) return []
    const raw = fs.readFileSync(fp, 'utf8')
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch (parseErr) {
      console.error('[loadTaggedTriggersList] JSON parse error — returning empty list. File may be corrupt.', parseErr)
      return []
    }
    if (!data || typeof data !== 'object' || !Array.isArray((data as { triggers?: unknown }).triggers)) {
      console.error('[loadTaggedTriggersList] Unexpected structure (expected { triggers: [...] }) — returning empty list.', typeof data)
      return []
    }
    return (data as { triggers: unknown[] }).triggers
  } catch (err) {
    console.error('[loadTaggedTriggersList] Failed to read triggers file:', err)
    return []
  }
}

export function saveTaggedTriggersList(triggers: unknown[]): void {
  ensureDir()
  fs.writeFileSync(getTaggedTriggersPath(), JSON.stringify({ triggers }, null, 2), 'utf8')
}

export function upsertRegion(preset: Omit<RegionPreset, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): RegionPreset {
  const all = loadPresets()
  const id = preset.id ?? `r_${Date.now()}`
  const now = Date.now()
  const existing = all.regions.find(r => r.id === id) || null
  const createdAt = existing?.createdAt ?? now
  const next: RegionPreset = { ...preset, id, createdAt, updatedAt: now }
  const idx = all.regions.findIndex(r => r.id === id)
  if (idx >= 0) all.regions[idx] = next
  else all.regions.unshift(next)
  savePresets(all)
  return next
}



