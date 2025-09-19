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
}

export interface PresetsFile {
  regions: RegionPreset[]
  autoSend: boolean
}

const rootDir = path.join(app.getPath('home'), '.opengiraffe', 'lmgtfy')
const filePath = path.join(rootDir, 'regions.json')

function ensureDir() {
  fs.mkdirSync(rootDir, { recursive: true })
}

export function loadPresets(): PresetsFile {
  try {
    ensureDir()
    if (!fs.existsSync(filePath)) return { regions: [], autoSend: false }
    const raw = fs.readFileSync(filePath, 'utf8')
    const data = JSON.parse(raw)
    return { regions: data.regions ?? [], autoSend: !!data.autoSend }
  } catch {
    return { regions: [], autoSend: false }
  }
}

export function savePresets(data: PresetsFile) {
  ensureDir()
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

export function upsertRegion(preset: Omit<RegionPreset, 'id'> & { id?: string }): RegionPreset {
  const all = loadPresets()
  const id = preset.id ?? `r_${Date.now()}`
  const next: RegionPreset = { ...preset, id }
  const idx = all.regions.findIndex(r => r.id === id)
  if (idx >= 0) all.regions[idx] = next
  else all.regions.unshift(next)
  savePresets(all)
  return next
}


