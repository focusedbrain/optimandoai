import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface RegionPreset {
  id: string
  name?: string
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



