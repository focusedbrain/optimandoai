/**
 * Persisted user preference for which local Ollama model to use (inbox, HTTP chat,
 * and Backend Configuration ACTIVE badge). Single JSON file under Electron userData.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const FILE_NAME = 'active-ollama-model.json'

/** Set true only when debugging model selection. */
export const DEBUG_ACTIVE_OLLAMA_MODEL = false

function dbg(...args: unknown[]) {
  if (DEBUG_ACTIVE_OLLAMA_MODEL) console.warn('[ActiveOllamaModel]', ...args)
}

function storePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

interface StoreFile {
  activeOllamaModelId: string | null
}

function readRaw(): StoreFile {
  try {
    const p = storePath()
    if (!fs.existsSync(p)) return { activeOllamaModelId: null }
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'))
    const id = j?.activeOllamaModelId
    return {
      activeOllamaModelId: typeof id === 'string' && id.trim() ? id.trim() : null,
    }
  } catch (e) {
    console.warn('[ActiveOllamaModel] read failed:', e)
    return { activeOllamaModelId: null }
  }
}

export function getStoredActiveOllamaModelId(): string | null {
  return readRaw().activeOllamaModelId
}

export function setStoredActiveOllamaModelId(modelId: string): void {
  const trimmed = modelId.trim()
  if (!trimmed) throw new Error('modelId is required')
  const p = storePath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const payload = JSON.stringify({ activeOllamaModelId: trimmed }, null, 2)
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, payload, 'utf-8')
    // Windows: rename cannot replace an existing target; replace atomically best-effort.
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
 * Pick the model name used for chat/status when Ollama has `installed` models.
 *
 * - If `storedId` matches an installed name exactly → use it.
 * - Else if `storedId` is set but missing (e.g. deleted) → first installed (fallback).
 * - If nothing stored → first installed.
 * - Empty installed → null.
 */
export function resolveEffectiveOllamaModel(
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
  dbg('resolved runtime model', installedNames[0], missingStored ? '(stored missing, fallback first)' : '(no preference, first installed)')
  return {
    model: installedNames[0],
    usedFallback: true,
    missingStored,
  }
}
