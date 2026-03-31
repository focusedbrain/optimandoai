/**
 * One-shot Ollama model warm-up for bulk Auto-Sort first chunk only.
 *
 * Runs at most:
 * - Once per bulk run (first IPC chunk, chunkIndex 1 or omitted),
 * - Plus once after an active-model change (bypasses cooldown for that model id),
 * - Otherwise suppressed for PREWARM_COOLDOWN_MS per model (keep_alive + resident GPU state).
 *
 * No background loops — only `maybePrewarmOllamaForBulkClassify` from `inbox:aiClassifyBatch`.
 */

const OLLAMA_CHAT = 'http://127.0.0.1:11434/api/chat'

/** If we prewarmed this model recently, skip — longer bulk keep_alive usually keeps it loaded. */
const PREWARM_COOLDOWN_MS = 120_000

/** Ollama load_duration under this suggests weights were already in VRAM/RAM. */
const RESIDENT_LOAD_MS_THRESHOLD = 200

const lastPrewarmAtByModel = new Map<string, number>()

/**
 * Set when user persists a new active local model. Next bulk first chunk for that id
 * bypasses cooldown so the new weights load before parallel classifies.
 */
let postSwitchBypassModelId: string | null = null

export function noteOllamaActiveModelChangedForBulkPrewarm(modelId: string): void {
  const t = modelId?.trim()
  postSwitchBypassModelId = t || null
}

export type OllamaBulkPrewarmDiag = {
  action:
    | 'ran'
    | 'skipped_cooldown'
    | 'skipped_not_first_chunk'
    | 'skipped_ollama_unreachable'
    | 'failed'
  wallMs?: number
  /** From Ollama JSON load_duration (ns → ms), when action === 'ran'. */
  prewarmLoadDurationMs?: number
  /**
   * Heuristic: following classify calls in this chunk should not pay full cold-load,
   * if prewarm succeeded or we skipped on cooldown (model likely still resident).
   */
  followingClassifyLikelyResident?: boolean
  /** Only when action === 'ran' and Ollama reported a small load_duration. */
  residentBeforePrewarm?: boolean
}

function nsToMs(ns: unknown): number | undefined {
  if (typeof ns !== 'number' || !Number.isFinite(ns)) return undefined
  return Math.round(ns / 1e6)
}

export async function maybePrewarmOllamaForBulkClassify(
  model: string,
  opts: { chunkIndex?: number },
): Promise<OllamaBulkPrewarmDiag> {
  const idx = opts.chunkIndex
  if (idx != null && idx !== 1) {
    return { action: 'skipped_not_first_chunk', followingClassifyLikelyResident: true }
  }

  const now = Date.now()
  const trimmed = model?.trim()
  if (!trimmed) {
    return { action: 'failed', followingClassifyLikelyResident: false }
  }

  let bypassCooldown = false
  if (postSwitchBypassModelId != null && postSwitchBypassModelId === trimmed) {
    postSwitchBypassModelId = null
    bypassCooldown = true
  }

  if (!bypassCooldown) {
    const last = lastPrewarmAtByModel.get(trimmed)
    if (last != null && now - last < PREWARM_COOLDOWN_MS) {
      return {
        action: 'skipped_cooldown',
        followingClassifyLikelyResident: true,
      }
    }
  }

  const wallT0 = performance.now()
  const ac = new AbortController()
  const to = setTimeout(() => ac.abort(), 60_000)
  try {
    const res = await fetch(OLLAMA_CHAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        model: trimmed,
        stream: false,
        keep_alive: '15m',
        messages: [{ role: 'user', content: '.' }],
        options: { num_predict: 1 },
      }),
    })
    const wallMs = Math.round(performance.now() - wallT0)
    if (!res.ok) {
      return {
        action: 'failed',
        wallMs,
        followingClassifyLikelyResident: false,
      }
    }
    const data = (await res.json()) as { load_duration?: number }
    const loadMs = nsToMs(data.load_duration)
    lastPrewarmAtByModel.set(trimmed, Date.now())
    const wasAlreadyHot = loadMs != null && loadMs < RESIDENT_LOAD_MS_THRESHOLD
    return {
      action: 'ran',
      wallMs,
      prewarmLoadDurationMs: loadMs,
      followingClassifyLikelyResident: true,
      residentBeforePrewarm: wasAlreadyHot ? true : undefined,
    }
  } catch {
    const wallMs = Math.round(performance.now() - wallT0)
    return {
      action: 'skipped_ollama_unreachable',
      wallMs,
      followingClassifyLikelyResident: false,
    }
  } finally {
    clearTimeout(to)
  }
}
