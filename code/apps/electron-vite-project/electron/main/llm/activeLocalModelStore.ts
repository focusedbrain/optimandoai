/**
 * Persisted user preference for which local llama.cpp model to use (inbox, HTTP chat,
 * and Backend Configuration ACTIVE badge). Single JSON file under Electron userData.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const FILE_NAME = 'active-local-llm-model.json'

/** Set true only when debugging model selection. */
export const DEBUG_ACTIVE_LOCAL_MODEL = false

function dbg(...args: unknown[]) {
  if (DEBUG_ACTIVE_LOCAL_MODEL) console.warn('[ActiveLocalModel]', ...args)
}

function storePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

interface StoreFile {
  activeLocalModelId: string | null
}

function readRaw(): StoreFile {
  try {
    const p = storePath()
    if (!fs.existsSync(p)) {
      const legacy = path.join(app.getPath('userData'), 'active-ollama-model.json')
      if (fs.existsSync(legacy)) {
        const j = JSON.parse(fs.readFileSync(legacy, 'utf-8'))
        const id = j?.activeOllamaModelId
        if (typeof id === 'string' && id.trim()) {
          return { activeLocalModelId: id.trim() }
        }
      }
      return { activeLocalModelId: null }
    }
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'))
    const id = j?.activeLocalModelId
    return {
      activeLocalModelId: typeof id === 'string' && id.trim() ? id.trim() : null,
    }
  } catch (e) {
    console.warn('[ActiveLocalModel] read failed:', e)
    return { activeLocalModelId: null }
  }
}

export function getStoredActiveLocalModelId(): string | null {
  return readRaw().activeLocalModelId
}

export function setStoredActiveLocalModelId(modelId: string): void {
  const trimmed = modelId.trim()
  if (!trimmed) throw new Error('modelId is required')
  const p = storePath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const payload = JSON.stringify({ activeLocalModelId: trimmed }, null, 2)
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
  dbg('persisted', trimmed)
}

/**
 * Pick the model id used for chat/status when models are installed.
 */
export function resolveEffectiveLocalModel(
  installedNames: string[],
  storedId: string | null,
): { model: string | null; usedFallback: boolean; missingStored: boolean } {
  if (installedNames.length === 0) {
    return { model: null, usedFallback: false, missingStored: false }
  }
  if (storedId && installedNames.includes(storedId)) {
    dbg('resolved runtime model', storedId, '(stored)')
    return { model: storedId, usedFallback: false, missingStored: false }
  }
  const missingStored = !!storedId
  dbg(
    'resolved runtime model',
    installedNames[0],
    missingStored ? '(stored missing, fallback first)' : '(no preference, first installed)',
  )
  return {
    model: installedNames[0],
    usedFallback: true,
    missingStored,
  }
}
