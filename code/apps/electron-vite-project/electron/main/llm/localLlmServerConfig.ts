/**
 * Persisted llama-server inference settings (Host orchestrator config).
 *
 * The app owns and configures llama-server entirely — these three values are the
 * only user-tunable knobs, exposed in the Backend Configuration panel in plain
 * language. Defaults are production-correct: a user who never opens the section
 * gets the recommended setup (8192 tokens/conversation, parallel 4, reasoning off).
 *
 * `ctxMode` maps to per-slot context at spawn (build039):
 *   'standard' → 8192/slot, 'long' → 16384/slot, 'max' → computed per-slot against VRAM
 *   (see {@link resolveSpawnContextBudget} in llamaServerArgs.ts). The llama-server
 *   `--ctx-size` arg is per_slot × parallel (kv_unified=false divides by parallel).
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const FILE_NAME = 'local-llm-server-config.json'

export type LocalLlmCtxMode = 'standard' | 'long' | 'max'

export interface LocalLlmServerConfig {
  /** "Memory per conversation" in the UI. */
  ctxMode: LocalLlmCtxMode
  /** "Parallel tasks" in the UI → `--parallel`. */
  parallel: 1 | 2 | 4
  /** "Response style" in the UI → `--reasoning-budget` (false → 0, true → unlimited). */
  reasoningEnabled: boolean
}

/** Per-slot preset: "Standard (recommended)" in the UI. */
export const LOCAL_LLM_CTX_STANDARD = 8_192
/** Per-slot preset: "Long documents" in the UI. */
export const LOCAL_LLM_CTX_LONG = 16_384

export const DEFAULT_LOCAL_LLM_SERVER_CONFIG: LocalLlmServerConfig = {
  ctxMode: 'standard',
  parallel: 4,
  reasoningEnabled: false,
}

/** Resolve the fixed ctx sizes; 'max' is resolved at spawn against VRAM. */
export function ctxTokensForMode(mode: LocalLlmCtxMode): number | 'max' {
  if (mode === 'standard') return LOCAL_LLM_CTX_STANDARD
  if (mode === 'long') return LOCAL_LLM_CTX_LONG
  return 'max'
}

/** Coerce unknown JSON into a valid config; invalid fields fall back to defaults. */
export function sanitizeLocalLlmServerConfig(raw: unknown): LocalLlmServerConfig {
  const d = DEFAULT_LOCAL_LLM_SERVER_CONFIG
  if (!raw || typeof raw !== 'object') return { ...d }
  const o = raw as Record<string, unknown>
  const ctxMode: LocalLlmCtxMode =
    o.ctxMode === 'standard' || o.ctxMode === 'long' || o.ctxMode === 'max'
      ? o.ctxMode
      : d.ctxMode
  const parallel: 1 | 2 | 4 =
    o.parallel === 1 || o.parallel === 2 || o.parallel === 4 ? o.parallel : d.parallel
  const reasoningEnabled = typeof o.reasoningEnabled === 'boolean' ? o.reasoningEnabled : d.reasoningEnabled
  return { ctxMode, parallel, reasoningEnabled }
}

function storePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

export function getLocalLlmServerConfig(): LocalLlmServerConfig {
  try {
    const p = storePath()
    if (!fs.existsSync(p)) return { ...DEFAULT_LOCAL_LLM_SERVER_CONFIG }
    return sanitizeLocalLlmServerConfig(JSON.parse(fs.readFileSync(p, 'utf-8')))
  } catch (e) {
    console.warn('[LocalLlmServerConfig] read failed:', e)
    return { ...DEFAULT_LOCAL_LLM_SERVER_CONFIG }
  }
}

export function setLocalLlmServerConfig(patch: Partial<LocalLlmServerConfig>): LocalLlmServerConfig {
  const next = sanitizeLocalLlmServerConfig({ ...getLocalLlmServerConfig(), ...patch })
  const p = storePath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const payload = JSON.stringify(next, null, 2)
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
  return next
}
